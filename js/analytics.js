/*
 * analytics.js — motor de Análise de Redes Organizacionais (ONA).
 *
 * Funções puras, sem dependência de DOM: rodam no navegador e no Node
 * (usado pelos testes em tests/analytics.test.js).
 *
 * Modelo de dados esperado:
 *   data.people[]     { id, name, role, departmentId, level(1-5), managerId,
 *                       knowledge(1-5), skills[ids do catálogo], stance(-2..2|null), tenure, notes }
 *   data.knowledge[]  { id, name, category, importance(1 desejável, 2 importante, 3 essencial) }
 *   data.relations[]  { id, source, target, type, strength(1-5), sentiment(-2..2), notes }
 *   data.incidents[]  { id, date, type, actors[], targets[], severity(1-5), description }
 *   data.departments[]{ id, name, color }
 *   data.settings     { focalId, formalTieStrength }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OrgAnalytics = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RELATION_TYPES = {
    colaboracao: { label: 'Trabalham juntos', directed: false, sentiment: 1 },
    amizade: { label: 'Amizade / afinidade', directed: false, sentiment: 2 },
    familiar: { label: 'Parentes ou casal', directed: false, sentiment: 2 },
    influencia: { label: 'Influencia (é ouvido pelo outro)', directed: true, sentiment: 1 },
    mentoria: { label: 'Ensina / orienta', directed: true, sentiment: 1 },
    informacao: { label: 'Passa informações', directed: true, sentiment: 1 },
    conflito: { label: 'Conflito / atrito', directed: false, sentiment: -1 },
    boicote: { label: 'Boicota / atrapalha', directed: true, sentiment: -2 },
  };

  const INCIDENT_TYPES = {
    boicote: { label: 'Boicote / sabotagem', valence: -1 },
    retencao_info: { label: 'Retenção de informação', valence: -1 },
    desautorizacao: { label: 'Desautorização / contradição pública', valence: -1 },
    descumprimento: { label: 'Descumprimento ou atraso deliberado', valence: -1 },
    rumor: { label: 'Rumor / comentário depreciativo', valence: -1 },
    alianca: { label: 'Articulação de grupo contra decisão', valence: -1 },
    apoio: { label: 'Apoio / colaboração visível', valence: 1 },
    outro: { label: 'Outro', valence: 0 },
  };

  const LEVELS = {
    1: 'Operacional',
    2: 'Técnico / Analista',
    3: 'Coordenação / Supervisão',
    4: 'Gerência',
    5: 'Diretoria / CEO',
  };

  // Pesos dos índices compostos (documentados em docs/GUIA.md).
  const WEIGHTS = {
    influence: { pagerank: 0.4, betweenness: 0.3, strength: 0.3 },
    peso: { influence: 0.45, knowledge: 0.3, formal: 0.25 },
  };

  const STANCE_THRESHOLD = 0.75;

  const IMPORTANCE = { 3: 'Essencial', 2: 'Importante', 1: 'Desejável' };
  const IMPORTANCE_WEIGHT = { 3: 1, 2: 0.6, 1: 0.3 };
  const EPS = 1e-9;

  // ---------------------------------------------------------------- utilidades
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const addTo = (m, k, w) => m.set(k, (m.get(k) || 0) + w);
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  const normalize = (arr) => {
    const max = Math.max(0, ...arr);
    return arr.map((v) => (max > 0 ? v / max : 0));
  };
  const normSkill = (s) => String(s).trim().toLowerCase();
  // Nota de 1 a 5; vazio = não avaliado (null).
  const grade = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : clamp(Number(v), 1, 5));
  const isSet = (v) => !(v === null || v === undefined || v === '' || Number.isNaN(Number(v)));

  // Notas extremas só valem com um motivo escrito (fato que justifica).
  // Sem motivo, a nota é ignorada nos cálculos e tratada como "?".
  const GRADE_RULES = {
    performance: { label: 'Desempenho', needsReason: [1, 2, 5] },
    engagement: { label: 'Engajamento', needsReason: [1, 2, 5] },
    knowledge: { label: 'Difícil de substituir', needsReason: [5] },
    stance: { label: 'Postura com o gerente', needsReason: [-2, 2] },
  };
  const reasonOf = (p, field) => ((p.gradeNotes || {})[field] || {}).text || '';
  /** Valor da nota que o sistema usa: null se vazia ou extrema sem motivo. */
  function effectiveGrade(p, field) {
    const v = p[field];
    if (!isSet(v)) return null;
    const n = Number(v);
    if (GRADE_RULES[field].needsReason.includes(n) && !reasonOf(p, field).trim()) return null;
    return n;
  }
  /** Notas dadas sem o motivo exigido (ignoradas nos cálculos). */
  const unjustifiedGrades = (p) => Object.keys(GRADE_RULES).filter((f) => isSet(p[f]) && effectiveGrade(p, f) === null);
  const personGroups = (p) => [...new Set((p.groups || []).map((x) => String(x).trim()).filter(Boolean))];

  function sentimentOf(r) {
    const t = RELATION_TYPES[r.type] || RELATION_TYPES.colaboracao;
    if (r.sentiment === undefined || r.sentiment === null || r.sentiment === '') return t.sentiment;
    return clamp(Number(r.sentiment), -2, 2);
  }

  function stanceLabel(v) {
    if (v === null || v === undefined || Number.isNaN(v)) return 'desconhecido';
    if (v >= STANCE_THRESHOLD) return 'apoiador';
    if (v <= -STANCE_THRESHOLD) return 'resistente';
    return 'neutro';
  }

  // ------------------------------------------------------------------- grafo
  /**
   * Constrói as estruturas de grafo ignorando as pessoas em `removed`.
   *  pos: laços positivos não-direcionados (peso = força)
   *  neg: laços negativos não-direcionados (peso = força × |sentimento| / 2)
   *  pr : arestas direcionadas "u segue/escuta v" usadas no PageRank
   */
  function buildGraph(data, removed) {
    removed = removed || new Set();
    const people = (data.people || []).filter((p) => !removed.has(p.id));
    const n = people.length;
    const idx = new Map(people.map((p, i) => [p.id, i]));
    const pos = Array.from({ length: n }, () => new Map());
    const neg = Array.from({ length: n }, () => new Map());
    const pr = Array.from({ length: n }, () => new Map());
    const family = new Set();
    const explicitPairs = new Set();

    for (const r of data.relations || []) {
      const a = idx.get(r.source);
      const b = idx.get(r.target);
      if (a === undefined || b === undefined || a === b) continue;
      const t = RELATION_TYPES[r.type] || RELATION_TYPES.colaboracao;
      const s = clamp(Number(r.strength) || 1, 1, 5);
      const sent = sentimentOf(r);
      explicitPairs.add(pairKey(a, b));
      if (r.type === 'familiar') family.add(pairKey(a, b));
      if (sent < 0) {
        const w = (s * -sent) / 2;
        addTo(neg[a], b, w);
        addTo(neg[b], a, w);
        continue;
      }
      addTo(pos[a], b, s);
      addTo(pos[b], a, s);
      if (t.directed) addTo(pr[b], a, s); // o destino "segue" a origem
      else {
        addTo(pr[a], b, s);
        addTo(pr[b], a, s);
      }
    }

    // Hierarquia formal como laço fraco, apenas quando não há relação explícita.
    const fs = Number(data.settings && data.settings.formalTieStrength);
    const formalStrength = Number.isFinite(fs) ? fs : 2;
    if (formalStrength > 0) {
      for (const p of people) {
        if (!p.managerId) continue;
        const a = idx.get(p.id);
        const b = idx.get(p.managerId);
        if (b === undefined || a === b || explicitPairs.has(pairKey(a, b))) continue;
        addTo(pos[a], b, formalStrength);
        addTo(pos[b], a, formalStrength);
        addTo(pr[a], b, formalStrength);
      }
    }
    return { people, n, idx, pos, neg, pr, family };
  }

  // Caminhos mínimos ponderados (distância = 1/força) a partir de s,
  // com acumulação de dependências de Brandes.
  function singleSource(g, s, ebc) {
    const n = g.n;
    const dist = new Float64Array(n).fill(Infinity);
    const sigma = new Float64Array(n);
    const preds = Array.from({ length: n }, () => []);
    const done = new Uint8Array(n);
    const order = [];
    dist[s] = 0;
    sigma[s] = 1;
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        if (!done[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u < 0) break;
      done[u] = 1;
      order.push(u);
      for (const [v, w] of g.pos[u]) {
        if (done[v]) continue;
        const nd = dist[u] + 1 / w;
        if (nd < dist[v] - EPS) {
          dist[v] = nd;
          sigma[v] = sigma[u];
          preds[v] = [u];
        } else if (Math.abs(nd - dist[v]) <= EPS) {
          sigma[v] += sigma[u];
          preds[v].push(u);
        }
      }
    }
    const delta = new Float64Array(n);
    for (let k = order.length - 1; k >= 0; k--) {
      const w = order[k];
      for (const v of preds[w]) {
        const c = (sigma[v] / sigma[w]) * (1 + delta[w]);
        delta[v] += c;
        if (ebc) addTo(ebc, pairKey(v, w), c);
      }
    }
    return { dist, delta, order };
  }

  function betweenness(g) {
    const n = g.n;
    const bc = new Float64Array(n);
    const ebc = new Map();
    for (let s = 0; s < n; s++) {
      const { delta } = singleSource(g, s, ebc);
      for (let v = 0; v < n; v++) if (v !== s) bc[v] += delta[v];
    }
    const scale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 0; // já inclui a divisão por 2 (não-direcionado)
    for (let v = 0; v < n; v++) bc[v] *= scale;
    for (const [k, v] of ebc) ebc.set(k, v / 2);
    return { bc: Array.from(bc), ebc };
  }

  function bfs(g, s, skip) {
    const d = new Int32Array(g.n).fill(-1);
    d[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const v of g.pos[u].keys()) {
        if (d[v] === -1 && !(skip && skip.has(v))) {
          d[v] = d[u] + 1;
          q.push(v);
        }
      }
    }
    return d;
  }

  function components(g) {
    const comp = new Int32Array(g.n).fill(-1);
    const sizes = [];
    for (let s = 0; s < g.n; s++) {
      if (comp[s] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      const stack = [s];
      comp[s] = id;
      while (stack.length) {
        const u = stack.pop();
        size++;
        for (const v of g.pos[u].keys()) {
          if (comp[v] === -1) {
            comp[v] = id;
            stack.push(v);
          }
        }
      }
      sizes.push(size);
    }
    return { comp: Array.from(comp), sizes };
  }

  // Eficiência global (média de 1/distância) entre os nós em `nodes`.
  function efficiency(g, nodes) {
    const set = new Set(nodes);
    let total = 0;
    let pairs = 0;
    for (const s of nodes) {
      const d = bfs(g, s);
      for (const t of nodes) {
        if (t === s) continue;
        pairs++;
        if (d[t] > 0) total += 1 / d[t];
      }
    }
    return pairs ? total / pairs : 0;
  }

  function harmonicCloseness(g) {
    const out = [];
    for (let s = 0; s < g.n; s++) {
      const d = bfs(g, s);
      let h = 0;
      for (let t = 0; t < g.n; t++) if (t !== s && d[t] > 0) h += 1 / d[t];
      out.push(g.n > 1 ? h / (g.n - 1) : 0);
    }
    return out;
  }

  function pagerank(g, damping = 0.85) {
    const n = g.n;
    if (!n) return [];
    let r = new Float64Array(n).fill(1 / n);
    const outW = g.pr.map((m) => sum([...m.values()]));
    for (let it = 0; it < 200; it++) {
      const nr = new Float64Array(n).fill((1 - damping) / n);
      let dangling = 0;
      for (let u = 0; u < n; u++) {
        if (outW[u] === 0) {
          dangling += r[u];
          continue;
        }
        for (const [v, w] of g.pr[u]) nr[v] += (damping * r[u] * w) / outW[u];
      }
      let diff = 0;
      for (let i = 0; i < n; i++) {
        nr[i] += (damping * dangling) / n;
        diff += Math.abs(nr[i] - r[i]);
      }
      r = nr;
      if (diff < 1e-10) break;
    }
    return Array.from(r);
  }

  // Pontos de articulação e pontes (Tarjan) no grafo positivo.
  function articulation(g) {
    const n = g.n;
    const disc = new Int32Array(n).fill(-1);
    const low = new Int32Array(n);
    const ap = new Uint8Array(n);
    const bridges = new Set();
    let time = 0;
    const dfs = (u, parent) => {
      disc[u] = low[u] = time++;
      let children = 0;
      for (const v of g.pos[u].keys()) {
        if (disc[v] === -1) {
          children++;
          dfs(v, u);
          low[u] = Math.min(low[u], low[v]);
          if (parent !== -1 && low[v] >= disc[u]) ap[u] = 1;
          if (low[v] > disc[u]) bridges.add(pairKey(u, v));
        } else if (v !== parent) {
          low[u] = Math.min(low[u], disc[v]);
        }
      }
      if (parent === -1 && children > 1) ap[u] = 1;
    };
    for (let u = 0; u < n; u++) if (disc[u] === -1) dfs(u, -1);
    return { ap: Array.from(ap), bridges };
  }

  // Detecção de comunidades (clusters) pelo método de Louvain.
  function louvain(g) {
    const n0 = g.n;
    let nodeComm = Array.from({ length: n0 }, (_, i) => i);
    let adj = g.pos.map((m) => new Map(m));
    let self = new Array(n0).fill(0);
    for (let level = 0; level < 20; level++) {
      const n = adj.length;
      const k = adj.map((m, i) => sum([...m.values()]) + 2 * self[i]);
      const m2 = sum(k);
      if (m2 === 0) break;
      const comm = Array.from({ length: n }, (_, i) => i);
      const tot = k.slice();
      let improved = false;
      let moved = true;
      for (let pass = 0; moved && pass < 100; pass++) {
        moved = false;
        for (let i = 0; i < n; i++) {
          const ci = comm[i];
          const links = new Map();
          for (const [j, w] of adj[i]) addTo(links, comm[j], w);
          tot[ci] -= k[i];
          let bestC = ci;
          let bestGain = (links.get(ci) || 0) - (tot[ci] * k[i]) / m2;
          for (const [c, w] of links) {
            const gain = w - (tot[c] * k[i]) / m2;
            if (gain > bestGain + EPS) {
              bestGain = gain;
              bestC = c;
            }
          }
          tot[bestC] += k[i];
          if (bestC !== ci) {
            comm[i] = bestC;
            moved = true;
            improved = true;
          }
        }
      }
      if (!improved) break;
      const renum = new Map();
      for (const c of comm) if (!renum.has(c)) renum.set(c, renum.size);
      const cOf = comm.map((c) => renum.get(c));
      nodeComm = nodeComm.map((c) => cOf[c]);
      const nAdj = Array.from({ length: renum.size }, () => new Map());
      const nSelf = new Array(renum.size).fill(0);
      for (let i = 0; i < n; i++) {
        nSelf[cOf[i]] += self[i];
        for (const [j, w] of adj[i]) {
          if (cOf[i] === cOf[j]) nSelf[cOf[i]] += w / 2;
          else addTo(nAdj[cOf[i]], cOf[j], w);
        }
      }
      adj = nAdj;
      self = nSelf;
    }
    return nodeComm;
  }

  function modularity(g, comm) {
    const k = g.pos.map((m) => sum([...m.values()]));
    const m2 = sum(k);
    if (!m2) return 0;
    let q = 0;
    for (let i = 0; i < g.n; i++) {
      for (const [j, w] of g.pos[i]) if (comm[i] === comm[j]) q += w;
    }
    const tot = new Map();
    for (let i = 0; i < g.n; i++) addTo(tot, comm[i], k[i]);
    for (const t of tot.values()) q -= (t * t) / m2;
    return q / m2;
  }

  // ------------------------------------------------------- posicionamento
  /**
   * Posicionamento efetivo de cada pessoa em relação à pessoa focal
   * (ex.: o novo gerente geral). Ordem de evidência:
   *   1. informado manualmente (person.stance)
   *   2. relações diretas com a pessoa focal (sentimento ponderado pela força)
   *   3. ocorrências registradas (apoio/boicote envolvendo a pessoa focal)
   *   4. inferido pela vizinhança (propagação amortecida — baixa confiança)
   */
  function computeStances(data, g, focalIdx) {
    const n = g.n;
    const stance = new Array(n).fill(null);
    const source = new Array(n).fill('');
    if (focalIdx === undefined) return { stance, source };
    const focalId = g.people[focalIdx].id;

    const rel = Array.from({ length: n }, () => ({ s: 0, w: 0 }));
    for (const r of data.relations || []) {
      let other;
      if (r.source === focalId) other = g.idx.get(r.target);
      else if (r.target === focalId) other = g.idx.get(r.source);
      if (other === undefined || other === focalIdx) continue;
      const w = clamp(Number(r.strength) || 1, 1, 5);
      rel[other].s += sentimentOf(r) * w;
      rel[other].w += w;
    }
    const inc = new Array(n).fill(0);
    const incCount = new Array(n).fill(0);
    for (const ev of data.incidents || []) {
      const t = INCIDENT_TYPES[ev.type] || INCIDENT_TYPES.outro;
      if (!t.valence) continue;
      const targetsFocal = (ev.targets || []).includes(focalId);
      if (!targetsFocal) continue;
      for (const a of ev.actors || []) {
        const i = g.idx.get(a);
        if (i === undefined || i === focalIdx) continue;
        inc[i] += t.valence * (0.5 + 0.1 * clamp(Number(ev.severity) || 3, 1, 5));
        incCount[i]++;
      }
    }

    for (let i = 0; i < n; i++) {
      if (i === focalIdx) continue;
      const p = g.people[i];
      const informed = effectiveGrade(p, 'stance');
      if (informed !== null) {
        stance[i] = clamp(informed, -2, 2);
        source[i] = 'informado';
      } else if (rel[i].w > 0) {
        stance[i] = rel[i].s / rel[i].w;
        source[i] = 'relação direta';
      } else if (incCount[i] > 0) {
        stance[i] = clamp(inc[i], -2, 2);
        source[i] = 'ocorrências';
      }
    }

    // Propagação para quem não tem evidência direta.
    const known = stance.map((s) => s !== null);
    let cur = stance.map((s) => (s === null ? 0 : s));
    for (let it = 0; it < 30; it++) {
      const next = cur.slice();
      for (let i = 0; i < n; i++) {
        if (known[i] || i === focalIdx) continue;
        let s = 0;
        let w = 0;
        for (const [j, wt] of g.pos[i]) {
          if (j === focalIdx) continue;
          s += cur[j] * wt;
          w += wt;
        }
        next[i] = w > 0 ? (0.7 * s) / w : 0;
      }
      cur = next;
    }
    for (let i = 0; i < n; i++) {
      if (i === focalIdx || known[i]) continue;
      stance[i] = cur[i];
      source[i] = 'inferido';
    }
    return { stance, source };
  }

  // ------------------------------------------------------------- análise
  function analyze(data, removedIds) {
    const removed = new Set(removedIds || []);
    const g = buildGraph(data, removed);
    const n = g.n;
    const depById = new Map((data.departments || []).map((d) => [d.id, d]));

    const strength = g.pos.map((m) => sum([...m.values()]));
    const ties = g.pos.map((m) => m.size);
    const negStrength = g.neg.map((m) => sum([...m.values()]));
    const { bc, ebc } = betweenness(g);
    const closeness = harmonicCloseness(g);
    const pr = pagerank(g);
    const { ap, bridges } = articulation(g);
    const comm = louvain(g);
    const comps = components(g);

    const prN = normalize(pr);
    const bcN = normalize(bc);
    const stN = normalize(strength);
    const influence = prN.map(
      (_, i) =>
        WEIGHTS.influence.pagerank * prN[i] +
        WEIGHTS.influence.betweenness * bcN[i] +
        WEIGHTS.influence.strength * stN[i]
    );

    // Conhecimento: itens do catálogo (ou texto livre, em dados antigos).
    // Conhecimentos que só uma pessoa domina aumentam o risco de perdê-la,
    // ponderados pela importância (essencial pesa mais que desejável).
    const catalog = new Map((data.knowledge || []).map((k) => [k.id, k]));
    const skillKey = (s) => (catalog.has(s) ? s : normSkill(s));
    const skillLabel = (key) => (catalog.has(key) ? catalog.get(key).name : key);
    const skillWeight = (key) => IMPORTANCE_WEIGHT[(catalog.get(key) || {}).importance] || IMPORTANCE_WEIGHT[2];
    const keysOf = (p) => [...new Set((p.skills || []).map(skillKey).filter(Boolean))];
    const holders = new Map();
    g.people.forEach((p, i) => {
      for (const s of keysOf(p)) {
        if (!holders.has(s)) holders.set(s, []);
        holders.get(s).push(i);
      }
    });
    const uniqueKeys = g.people.map((p) => keysOf(p).filter((s) => holders.get(s).length === 1));
    const uniqueSkills = uniqueKeys.map((ks) => ks.map(skillLabel));
    const uniqueEssential = uniqueKeys.map((ks) => ks.filter((k) => (catalog.get(k) || {}).importance === 3).map(skillLabel));
    const knowledgeRisk = g.people.map((p, i) => {
      const all = keysOf(p);
      const total = sum(all.map(skillWeight));
      const share = total ? sum(uniqueKeys[i].map(skillWeight)) / total : 0;
      const kGrade = effectiveGrade(p, 'knowledge');
      // Sem a nota ("?"), o risco vem só do checklist: "não sei" não é "fácil de substituir".
      if (kGrade === null) return 0.8 * share;
      return (clamp(kGrade, 0, 5) / 5) * (0.4 + 0.6 * share);
    });
    const formal = g.people.map((p) => clamp(Number(p.level) || 1, 1, 5) / 5);
    const peso = influence.map(
      (v, i) =>
        WEIGHTS.peso.influence * v +
        WEIGHTS.peso.knowledge * knowledgeRisk[i] +
        WEIGHTS.peso.formal * formal[i]
    );

    const focalId = data.settings && data.settings.focalId;
    const focalIdx = focalId ? g.idx.get(focalId) : undefined;
    const { stance, source: stanceSource } = computeStances(data, g, focalIdx);

    const rank = (arr) => {
      const order = arr.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      const r = new Array(arr.length);
      order.forEach(([, i], k) => (r[i] = k + 1));
      return r;
    };
    const influenceRank = rank(influence);
    const formalRank = rank(formal.map((f, i) => f + strength[i] * 1e-6));

    const metrics = g.people.map((p, i) => ({
      id: p.id,
      name: p.name,
      departmentId: p.departmentId,
      ties: ties[i],
      strength: strength[i],
      negStrength: negStrength[i],
      betweenness: bc[i],
      closeness: closeness[i],
      pagerank: pr[i],
      influence: influence[i],
      knowledgeRisk: knowledgeRisk[i],
      uniqueSkills: uniqueSkills[i],
      uniqueEssential: uniqueEssential[i],
      knowledge: effectiveGrade(p, 'knowledge') === null ? null : clamp(effectiveGrade(p, 'knowledge'), 0, 5),
      performance: grade(effectiveGrade(p, 'performance')),
      engagement: grade(effectiveGrade(p, 'engagement')),
      unjustified: unjustifiedGrades(p),
      groups: personGroups(p),
      formal: formal[i],
      peso: peso[i],
      community: comm[i],
      articulation: !!ap[i],
      stance: stance[i],
      stanceSource: stanceSource[i],
      stanceLabel: i === focalIdx ? 'focal' : stanceLabel(stance[i]),
      influenceRank: influenceRank[i],
      formalRank: formalRank[i],
    }));
    const byId = new Map(metrics.map((m) => [m.id, m]));

    // Comunidades
    const communities = [];
    comm.forEach((c, i) => {
      if (!communities[c]) communities[c] = { id: c, members: [] };
      communities[c].members.push(g.people[i].id);
    });
    for (const c of communities) {
      const mem = c.members.map((id) => byId.get(id));
      const depCount = new Map();
      for (const m of mem) addTo(depCount, m.departmentId || '', 1);
      const [topDep] = [...depCount.entries()].sort((a, b) => b[1] - a[1])[0];
      c.leader = mem.slice().sort((a, b) => b.influence - a.influence)[0].id;
      c.mainDepartment = topDep;
      c.departments = depCount.size;
      c.influence = sum(mem.map((m) => m.influence));
      const st = mem.filter((m) => m.stance !== null).map((m) => m.stance);
      c.avgStance = st.length ? sum(st) / st.length : null;
      c.departmentIds = [...depCount.keys()].filter(Boolean);
      c.stanceCounts = { apoiador: 0, neutro: 0, resistente: 0, desconhecido: 0 };
      c.stanceEstimated = { apoiador: 0, neutro: 0, resistente: 0 };
      for (const m of mem) {
        if (c.stanceCounts[m.stanceLabel] !== undefined) c.stanceCounts[m.stanceLabel]++;
        if (m.stanceSource === 'inferido' && c.stanceEstimated[m.stanceLabel] !== undefined) c.stanceEstimated[m.stanceLabel]++;
      }
      c.hasFocal = focalIdx !== undefined && c.members.includes(g.people[focalIdx].id);

      // Ligações com as outras turmas e quem faz essa ponte.
      const idxs = c.members.map((id) => g.idx.get(id));
      const inside = new Set(idxs);
      let internal = 0;
      const extBy = new Map();
      const linksTo = new Map();
      for (const i of idxs) {
        for (const [j, w] of g.pos[i]) {
          if (inside.has(j)) internal += w / 2;
          else {
            addTo(extBy, i, w);
            addTo(linksTo, comm[j], w);
          }
        }
      }
      const size = idxs.length;
      c.density = size > 1 ? sum(idxs.map((i) => [...g.pos[i].keys()].filter((j) => inside.has(j)).length)) / (size * (size - 1)) : 0;
      c.internalStrength = internal;
      c.externalStrength = sum([...extBy.values()]);
      c.connectors = [...extBy.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([i, w]) => ({ id: g.people[i].id, strength: w }));
      c.linksTo = [...linksTo.entries()].sort((a, b) => b[1] - a[1]).map(([to, w]) => ({ community: to, strength: w }));
    }

    // Setores (departamentos) e grupos
    const setStats = (id, name, mem) => {
      const set = new Set(mem.map(([, i]) => i));
      let internal = 0;
      let external = 0;
      let negative = 0;
      const extBy = new Map();
      for (const [, i] of mem) {
        for (const j of g.pos[i].keys()) {
          if (set.has(j)) internal++;
          else {
            external++;
            addTo(extBy, i, 1);
          }
        }
        negative += g.neg[i].size;
      }
      internal /= 2;
      const size = mem.length;
      const possible = (size * (size - 1)) / 2;
      const st = mem.map(([, i]) => stance[i]).filter((v) => v !== null);
      const perf = mem.map(([p]) => grade(p.performance)).filter((v) => v !== null);
      const connectors = [...extBy.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([i, c]) => ({ id: g.people[i].id, external: c }));
      return {
        id,
        name,
        size,
        members: mem.map(([p]) => p.id),
        density: possible ? internal / possible : 0,
        internalTies: internal,
        externalTies: external,
        openness: internal + external ? external / (internal + external) : 0,
        negativeTies: negative,
        avgStance: st.length ? sum(st) / st.length : null,
        avgPerformance: perf.length ? sum(perf) / perf.length : null,
        influence: sum(mem.map(([, i]) => influence[i])),
        connectors,
      };
    };
    const indexed = g.people.map((p, i) => [p, i]);
    const departments = (data.departments || []).map((d) =>
      setStats(d.id, d.name, indexed.filter(([p]) => p.departmentId === d.id))
    );
    const groupNames = [...new Set(g.people.flatMap(personGroups))].sort((a, b) => a.localeCompare(b));
    const groups = groupNames.map((name) => setStats(name, name, indexed.filter(([p]) => personGroups(p).includes(name))));

    // Pares-chave (laços positivos mais estratégicos)
    const ebcVals = [...ebc.values()];
    const ebcMax = Math.max(0, ...ebcVals);
    const keyPairs = [];
    for (let a = 0; a < n; a++) {
      for (const [b, w] of g.pos[a]) {
        if (b <= a) continue;
        const key = pairKey(a, b);
        const e = ebcMax ? (ebc.get(key) || 0) / ebcMax : 0;
        const tags = [];
        if (bridges.has(key)) tags.push('ponte única');
        const pa = g.people[a];
        const pb = g.people[b];
        if (pa.departmentId !== pb.departmentId) tags.push('entre departamentos');
        if (g.family.has(key)) tags.push('vínculo familiar');
        if (stanceLabel(stance[a]) === 'resistente' && stanceLabel(stance[b]) === 'resistente')
          tags.push('núcleo de resistência');
        if (a === focalIdx || b === focalIdx) tags.push('acesso à pessoa focal');
        keyPairs.push({
          a: pa.id,
          b: pb.id,
          strength: w,
          edgeBetweenness: e,
          score: 0.45 * e + 0.35 * ((influence[a] + influence[b]) / 2) + 0.2 * (Math.min(w, 5) / 5),
          tags,
        });
      }
    }
    keyPairs.sort((x, y) => y.score - x.score);

    // Conflitos críticos
    const conflicts = [];
    for (let a = 0; a < n; a++) {
      for (const [b, w] of g.neg[a]) {
        if (b <= a) continue;
        conflicts.push({
          a: g.people[a].id,
          b: g.people[b].id,
          intensity: w,
          score: w * (influence[a] + influence[b]),
          involvesFocal: a === focalIdx || b === focalIdx,
        });
      }
    }
    conflicts.sort((x, y) => y.score - x.score);

    // Tríades desbalanceadas (teoria do equilíbrio estrutural)
    const sign = (a, b) => (g.pos[a].has(b) ? 1 : g.neg[a].has(b) ? -1 : 0);
    const triads = [];
    const tension = new Array(n).fill(0);
    if (n <= 400) {
      const nb = g.pos.map((m, i) => new Set([...m.keys(), ...g.neg[i].keys()]));
      for (let a = 0; a < n; a++) {
        for (const b of nb[a]) {
          if (b <= a) continue;
          for (const c of nb[b]) {
            if (c <= b || !nb[a].has(c)) continue;
            const s = [sign(a, b), sign(b, c), sign(a, c)];
            if (s.includes(0)) continue;
            const negatives = s.filter((x) => x < 0).length;
            if (negatives % 2 === 1) {
              // Quem tem dois laços positivos fica "dividido" entre os outros dois.
              let torn = null;
              if (negatives === 1) {
                if (s[2] < 0) torn = b;
                else if (s[1] < 0) torn = a;
                else torn = c;
              }
              triads.push({
                members: [a, b, c].map((i) => g.people[i].id),
                torn: torn === null ? null : g.people[torn].id,
                negatives,
              });
              tension[a]++;
              tension[b]++;
              tension[c]++;
            }
          }
        }
      }
    }
    metrics.forEach((m, i) => (m.tension = tension[i]));

    // Organização "sombra": influência informal × posição formal
    const shadow = metrics
      .map((m) => ({
        id: m.id,
        gap: (m.formalRank - m.influenceRank) / Math.max(1, n),
        influenceRank: m.influenceRank,
        formalRank: m.formalRank,
      }))
      .sort((a, b) => b.gap - a.gap);

    // Habilidades
    const skills = [...holders.entries()]
      .map(([key, hs]) => ({
        id: key,
        skill: skillLabel(key),
        importance: (catalog.get(key) || {}).importance || null,
        holders: hs.map((i) => g.people[i].id),
      }))
      .sort((a, b) => a.holders.length - b.holders.length || a.skill.localeCompare(b.skill));

    const model = {
      n,
      people: g.people,
      metrics,
      byId,
      communities,
      modularity: modularity(g, comm),
      components: comps.sizes.length,
      largestComponent: Math.max(0, ...comps.sizes),
      density: n > 1 ? sum(ties) / 2 / ((n * (n - 1)) / 2) : 0,
      departments,
      groups,
      keyPairs,
      conflicts,
      triads,
      shadow,
      skills,
      articulationPoints: metrics.filter((m) => m.articulation).map((m) => m.id),
      focalId: focalIdx !== undefined ? focalId : null,
      focal: null,
      _g: g,
    };
    if (focalIdx !== undefined) model.focal = focalAnalysis(data, g, model, focalIdx);
    return model;
  }

  // Análise de resistência/boicote em torno da pessoa focal.
  function focalAnalysis(data, g, model, f) {
    const n = g.n;
    const M = model.metrics;
    const label = M.map((m) => m.stanceLabel);

    // Exposição: média do posicionamento dos vizinhos (exceto a focal).
    const exposure = new Array(n).fill(null);
    const pressure = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (i === f) continue;
      let s = 0;
      let w = 0;
      for (const [j, wt] of g.pos[i]) {
        if (j === f || M[j].stance === null) continue;
        s += M[j].stance * wt;
        w += wt;
        if (label[j] === 'resistente') pressure[i] += wt * Math.abs(M[j].stance) * M[j].influence;
      }
      exposure[i] = w ? s / w : null;
      M[i].exposure = exposure[i];
      M[i].pressure = pressure[i];
    }

    // Alcance da pessoa focal e "porteiros" (gatekeepers) de que ela depende.
    const hops = bfs(g, f);
    const reach1 = [...hops].filter((d) => d === 1).length;
    const reach2 = [...hops].filter((d) => d >= 1 && d <= 2).length;
    const unreachable = [...hops].filter((d, i) => d === -1 && i !== f).length;
    const { delta } = singleSource(g, f);
    const reachable = Math.max(1, n - 1 - unreachable);
    const gatekeepers = [];
    for (let v = 0; v < n; v++) {
      if (v === f || delta[v] < 0.5) continue;
      gatekeepers.push({ id: g.people[v].id, dependency: delta[v] / reachable, people: delta[v], stance: label[v] });
    }
    gatekeepers.sort((a, b) => b.dependency - a.dependency);

    // Núcleos de resistência: componentes conexos entre resistentes.
    const res = [];
    for (let i = 0; i < n; i++) if (label[i] === 'resistente') res.push(i);
    const resSet = new Set(res);
    const seen = new Set();
    const nuclei = [];
    for (const s of res) {
      if (seen.has(s)) continue;
      const members = [];
      const stack = [s];
      seen.add(s);
      while (stack.length) {
        const u = stack.pop();
        members.push(u);
        for (const v of g.pos[u].keys()) {
          if (resSet.has(v) && !seen.has(v)) {
            seen.add(v);
            stack.push(v);
          }
        }
      }
      const memSet = new Set(members);
      const audience = new Set();
      const familyPairs = [];
      let internal = 0;
      for (const u of members) {
        for (const [v, w] of g.pos[u]) {
          if (memSet.has(v)) {
            if (u < v) {
              internal += w;
              if (g.family.has(pairKey(u, v))) familyPairs.push([g.people[u].id, g.people[v].id]);
            }
          } else if (v !== f && !resSet.has(v)) audience.add(v);
        }
      }
      const power = sum(members.map((u) => M[u].influence * Math.abs(M[u].stance)));
      nuclei.push({
        members: members.map((u) => g.people[u].id).sort((a, b) => M[g.idx.get(b)].influence - M[g.idx.get(a)].influence),
        power,
        internalStrength: internal,
        familyPairs,
        audience: [...audience].map((v) => g.people[v].id),
        audienceShare: n > 1 ? audience.size / (n - 1) : 0,
        departments: new Set(members.map((u) => g.people[u].departmentId)).size,
      });
    }
    nuclei.sort((a, b) => b.power - a.power);

    // Prioridade de engajamento: neutros influentes sob pressão de resistentes.
    const pMax = Math.max(0, ...pressure);
    const bcN = normalize(M.map((m) => m.betweenness));
    const engagement = [];
    for (let i = 0; i < n; i++) {
      if (i === f || label[i] !== 'neutro') continue;
      const pN = pMax ? pressure[i] / pMax : 0;
      engagement.push({
        id: g.people[i].id,
        score: M[i].influence * (0.6 + 0.4 * pN) + 0.2 * bcN[i],
        exposure: exposure[i],
        pressure: pN,
      });
    }
    engagement.sort((a, b) => b.score - a.score);

    const allies = [];
    for (let i = 0; i < n; i++) {
      if (label[i] === 'apoiador') allies.push({ id: g.people[i].id, score: M[i].influence * M[i].stance });
    }
    allies.sort((a, b) => b.score - a.score);

    const count = { apoiador: 0, neutro: 0, resistente: 0, desconhecido: 0 };
    label.forEach((l, i) => i !== f && (count[l] = (count[l] || 0) + 1));
    const resistancePower = sum(res.map((i) => M[i].influence * Math.abs(M[i].stance)));
    const supportPower = sum(allies.map((a) => a.score));

    // Ocorrências por pessoa (como autora).
    const incidentsBy = new Map();
    for (const ev of data.incidents || []) {
      const t = INCIDENT_TYPES[ev.type] || INCIDENT_TYPES.outro;
      for (const a of ev.actors || []) {
        if (!g.idx.has(a)) continue;
        const cur = incidentsBy.get(a) || { negative: 0, positive: 0, severity: 0 };
        if (t.valence < 0) {
          cur.negative++;
          cur.severity += Number(ev.severity) || 3;
        } else if (t.valence > 0) cur.positive++;
        incidentsBy.set(a, cur);
      }
    }

    return {
      id: g.people[f].id,
      reach1,
      reach2,
      unreachable,
      reach2Share: n > 1 ? reach2 / (n - 1) : 0,
      gatekeepers,
      nuclei,
      engagement,
      allies,
      count,
      resistancePower,
      supportPower,
      incidentsBy: Object.fromEntries(incidentsBy),
    };
  }

  // -------------------------------------------------------- simulação
  /**
   * Simula a saída (demissão/afastamento) de um conjunto de pessoas.
   * Compara a rede antes e depois mantendo o mesmo conjunto de pessoas
   * remanescentes, para isolar o dano estrutural.
   */
  function simulateRemoval(data, removedIds, baseline) {
    const removed = new Set(removedIds);
    const before = baseline || analyze(data);
    const after = analyze(data, removed);
    const gB = before._g;
    const gA = after._g;
    const remainingB = gB.people.map((p, i) => i).filter((i) => !removed.has(gB.people[i].id));
    const remainingA = gA.people.map((p, i) => i);

    const effBefore = efficiency(gB, remainingB);
    const effAfter = efficiency(gA, remainingA);
    const efficiencyLoss = effBefore > 0 ? Math.max(0, (effBefore - effAfter) / effBefore) : 0;

    // Pessoas que ficam desconectadas do maior grupo.
    const compsB = components(gB);
    const giantB = compsB.sizes.indexOf(Math.max(...compsB.sizes, 0));
    const compsA = components(gA);
    const giantA = compsA.sizes.indexOf(Math.max(...compsA.sizes, 0));
    const isolated = remainingA
      .filter((i) => compsA.comp[i] !== giantA)
      .map((i) => gA.people[i].id)
      .filter((id) => compsB.comp[gB.idx.get(id)] === giantB);

    // Conhecimento
    const skillsBefore = new Map(before.skills.map((s) => [s.skill, s.holders]));
    const skillsLost = [];
    const skillsAtRisk = [];
    for (const [skill, hs] of skillsBefore) {
      const left = hs.filter((id) => !removed.has(id));
      if (left.length === 0) skillsLost.push(skill);
      else if (left.length === 1 && hs.length > 1) skillsAtRisk.push({ skill, holder: left[0] });
    }
    const totalSkills = skillsBefore.size;

    // Influência e laços perdidos
    const totalInfluence = sum(before.metrics.map((m) => m.influence)) || 1;
    const removedMetrics = before.metrics.filter((m) => removed.has(m.id));
    const influenceShare = sum(removedMetrics.map((m) => m.influence)) / totalInfluence;
    const maxKnowledgeRisk = Math.max(0, ...removedMetrics.map((m) => m.knowledgeRisk));

    // Contágio: quem tem laço forte com quem sai pode se desengajar ou sair junto.
    const contagion = [];
    for (const id of removed) {
      const u = gB.idx.get(id);
      if (u === undefined) continue;
      for (const [v, w] of gB.pos[u]) {
        const vid = gB.people[v].id;
        if (removed.has(vid)) continue;
        const fam = gB.family.has(pairKey(u, v));
        if (w >= 4 || fam) {
          contagion.push({ id: vid, from: id, strength: w, family: fam, stance: before.byId.get(vid).stanceLabel });
        }
      }
    }
    contagion.sort((a, b) => b.family - a.family || b.strength - a.strength);

    let positiveTies = 0;
    let negativeTies = 0;
    for (const id of removed) {
      const u = gB.idx.get(id);
      if (u === undefined) continue;
      positiveTies += gB.pos[u].size;
      negativeTies += gB.neg[u].size;
    }

    const resBefore = before.focal ? before.focal.resistancePower : 0;
    const resAfter = after.focal ? after.focal.resistancePower : 0;
    const resistanceReduction = resBefore > 0 ? Math.max(0, (resBefore - resAfter) / resBefore) : 0;

    const s1 = Math.min(1, efficiencyLoss * 2);
    const s2 = Math.min(1, (isolated.length / Math.max(1, remainingA.length)) * 3);
    const s3 = Math.min(1, influenceShare * 3);
    const s4 = Math.min(1, (totalSkills ? (skillsLost.length / totalSkills) * 3 : 0) + maxKnowledgeRisk * 0.5);
    const s5 = Math.min(1, contagion.length / 5);
    // Desempenho: perder quem entrega muito custa mais. Sem nota, assume-se 3 (médio).
    // Desempenho sem nota NÃO é suposto "médio": o item sai da conta e os
    // demais pesos são reescalados para continuar de 0 a 100.
    const perf = removedMetrics.map((m) => m.performance).filter((v) => v !== null);
    const perfKnown = perf.length > 0;
    const s6 = perfKnown ? Math.max(0, Math.max(...perf) - 2) / 3 : 0;
    const base = 0.2 * s1 + 0.1 * s2 + 0.2 * s3 + 0.25 * s4 + 0.1 * s5;
    const operationalCost = 100 * (perfKnown ? base + 0.15 * s6 : base / 0.85);

    return {
      removed: [...removed],
      efficiencyBefore: effBefore,
      efficiencyAfter: effAfter,
      efficiencyLoss,
      componentsBefore: before.components,
      componentsAfter: after.components,
      isolated,
      skillsLost,
      skillsAtRisk,
      influenceShare,
      maxKnowledgeRisk,
      contagion,
      positiveTies,
      negativeTies,
      resistanceBefore: resBefore,
      resistanceAfter: resAfter,
      resistanceReduction,
      focalReachBefore: before.focal ? before.focal.reach2Share : null,
      focalReachAfter: after.focal ? after.focal.reach2Share : null,
      operationalCost,
      breakdown: { efficiency: s1, isolation: s2, influence: s3, knowledge: s4, contagion: s5, performance: perfKnown ? s6 : null },
      performanceKnown: perfKnown,
      after,
    };
  }

  function impactRanking(data, baseline) {
    const before = baseline || analyze(data);
    return before.metrics
      .filter((m) => m.id !== before.focalId)
      .map((m) => {
        const sim = simulateRemoval(data, [m.id], before);
        return {
          id: m.id,
          operationalCost: sim.operationalCost,
          resistanceReduction: sim.resistanceReduction,
          skillsLost: sim.skillsLost.length,
          isolated: sim.isolated.length,
          contagion: sim.contagion.length,
        };
      })
      .sort((a, b) => b.operationalCost - a.operationalCost);
  }

  // ------------------------------------------------ painel de decisão
  const DECISION_CATEGORIES = {
    cuidado: { label: 'Atenção: ter cuidado', hint: 'Resistem ao gerente e têm força para atrapalhar: muita gente os ouve, a comunicação passa por eles ou já houve boicote registrado.' },
    trazer: { label: 'Conquistar para o seu lado', hint: 'Ainda não tomaram partido (ou resistem pouco) e são ouvidos pelos colegas. Vale investir neles primeiro.' },
    influente: { label: 'Quem tem voz na empresa', hint: 'As pessoas que os colegas mais escutam, seja qual for o cargo.' },
    aliado: { label: 'Aliados do gerente', hint: 'Apoiam o gerente e são ouvidos. Podem ajudar a espalhar as mudanças.' },
    reter: { label: 'Não pode perder', hint: 'Se saírem, a empresa sente: sabem coisas que ninguém mais sabe, ligam equipes, levariam colegas junto ou têm desempenho excelente.' },
    confirmar: { label: 'Confirmar postura', hint: 'O sistema só estimou a postura destas pessoas, pelas pessoas próximas. Antes de agir, observe e marque a postura na ficha.' },
    cortar: { label: 'Onde dá para cortar', hint: 'A saída teria pouco impacto E há motivo concreto: desempenho baixo, pouco engajamento ou boicotes registrados.' },
  };

  const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : 0);

  /**
   * Classifica cada pessoa nas perguntas do gerente: cuidado, trazer para o lado,
   * influentes, aliados, demissão é risco e onde é possível cortar.
   * `ranking` é o resultado de impactRanking (custo de saída individual).
   */
  function decisionBoard(data, model, ranking) {
    ranking = ranking || impactRanking(data, model);
    const F = model.focal;
    const exit = new Map(ranking.map((r) => [r.id, r]));
    const others = model.metrics.filter((m) => m.id !== model.focalId);
    const costs = ranking.map((r) => r.operationalCost).sort((a, b) => a - b);
    const infl = others.map((m) => m.influence).sort((a, b) => a - b);
    const hiCost = Math.max(quantile(costs, 0.7), 1);
    const loCost = quantile(costs, 0.35);
    const hiInfl = Math.max(quantile(infl, 0.75), 0.35);
    const medInfl = quantile(infl, 0.5);
    const engageInfl = quantile(infl, 0.4);

    const gate = new Map(F ? F.gatekeepers.map((g) => [g.id, g]) : []);
    const nucleus = new Map();
    if (F) F.nuclei.forEach((nu, i) => nu.members.forEach((id) => nucleus.set(id, { index: i, size: nu.members.length })));
    const engageTop = new Set(F ? F.engagement.slice(0, Math.max(3, Math.ceil(others.length * 0.25))).map((e) => e.id) : []);
    const incidents = (F && F.incidentsBy) || {};
    const negIncidents = (id) => {
      if (F) return (incidents[id] || {}).negative || 0;
      let c = 0;
      for (const ev of data.incidents || []) {
        if ((INCIDENT_TYPES[ev.type] || {}).valence < 0 && (ev.actors || []).includes(id)) c++;
      }
      return c;
    };

    // Quantas das 4 notas sustentam a recomendação.
    const basisOf = (m) => {
      const confirmed = [];
      const estimated = [];
      const missing = [];
      for (const [f, rule] of Object.entries(GRADE_RULES)) {
        if (f === 'stance') {
          if (m.stance === null) missing.push(rule.label);
          else if (m.stanceSource === 'inferido') estimated.push(rule.label);
          else confirmed.push(rule.label);
        } else if (m[f] === null) missing.push(rule.label);
        else confirmed.push(rule.label);
      }
      return { confirmed, estimated, missing, unjustified: m.unjustified.map((f) => GRADE_RULES[f].label) };
    };

    const people = others.map((m) => {
      const r = exit.get(m.id) || { operationalCost: 0, contagion: 0, skillsLost: 0, resistanceReduction: 0 };
      const reasons = {};
      const add = (cat, text) => (reasons[cat] = reasons[cat] || []).push(text);
      const neg = negIncidents(m.id);
      const label = m.stanceLabel;
      const estimated = m.stanceSource === 'inferido';

      if (m.influence >= hiInfl) add('influente', `é a ${m.influenceRank}ª pessoa mais ouvida da empresa`);

      if (label === 'resistente' && estimated && m.influence >= engageInfl)
        add('confirmar', 'o sistema estima que resiste (pelas pessoas próximas), mas ninguém confirmou');
      if (label === 'apoiador' && estimated && m.influence >= medInfl)
        add('confirmar', 'o sistema estima que apoia (pelas pessoas próximas), mas ninguém confirmou');
      if (label === 'resistente' && !estimated) {
        if (m.influence >= medInfl) add('cuidado', 'resiste ao gerente e é ouvido(a) por muitos colegas');
        const nu = nucleus.get(m.id);
        if (nu && nu.size > 1) add('cuidado', `faz parte de um grupo de ${nu.size} pessoas que resistem juntas`);
        const gk = gate.get(m.id);
        if (gk && gk.dependency >= 0.1) add('cuidado', `a comunicação do gerente com ${Math.round(gk.dependency * 100)}% da empresa passa por essa pessoa`);
      }
      if (neg >= 1) add('cuidado', `${neg} ocorrência(s) de boicote ou atrito registrada(s)`);
      if ((m.tension || 0) >= 3 && label !== 'apoiador') add('cuidado', `está no meio de ${m.tension} conflitos entre colegas`);

      if (label === 'neutro' && engageTop.has(m.id) && m.influence >= engageInfl) add('trazer', 'ainda não tomou partido, é ouvido(a) pelos colegas e convive com quem resiste');
      if (label === 'resistente' && !estimated && m.stance > -1.5 && neg === 0 && m.stanceSource !== 'informado')
        add('trazer', 'resiste pouco e não tem boicote registrado: dá para reverter');
      if (label === 'apoiador' && m.engagement !== null && m.engagement <= 2) add('trazer', 'apoia o gerente, mas está desmotivado(a)');

      if (label === 'apoiador' && !estimated && m.influence >= medInfl) add('aliado', 'apoia o gerente e é ouvido(a) pelos colegas');

      if (r.operationalCost >= hiCost) add('reter', `a saída teria impacto alto (${Math.round(r.operationalCost)} de 100)`);
      if (m.uniqueSkills.length && (m.knowledge === null || m.knowledge >= 3 || m.uniqueEssential.length)) add('reter', `é a única pessoa que sabe: ${m.uniqueSkills.join(', ')}`);
      if (m.articulation) add('reter', 'é a única ligação entre partes da equipe');
      if (r.contagion >= 3) add('reter', `${r.contagion} colegas muito próximos podem sair junto`);
      if (m.performance === 5 || (m.performance === 4 && reasons.reter)) add('reter', `desempenho excelente (${m.performance} de 5)`);

      const lowImpact = r.operationalCost <= loCost && !m.articulation && !m.uniqueSkills.length && r.contagion <= 1 && !reasons.reter;
      if (lowImpact) {
        const why = [];
        if (m.performance !== null && m.performance <= 2) why.push(`desempenho baixo (${m.performance} de 5)`);
        if (m.engagement !== null && m.engagement <= 2) why.push(`pouco engajamento (${m.engagement} de 5)`);
        if (neg >= 2) why.push(`${neg} boicotes/atritos registrados`);
        if (why.length) add('cortar', `a saída teria pouco impacto (${Math.round(r.operationalCost)} de 100) e ${why.join(', ')}`);
      }

      const has = (c) => !!reasons[c];
      let action;
      let tone;
      if (has('cuidado') && has('reter')) {
        action = 'Risco alto: resiste ao gerente e faz falta se sair. Primeiro, passe o conhecimento dessa pessoa para outra (treinar um substituto). Ao mesmo tempo, converse sobre a conduta e registre tudo por escrito.';
        tone = 'critico';
      } else if (has('cuidado')) {
        action = 'Atenção: converse a sós, deixe claro o que se espera dela por escrito e registre as ocorrências. Não deixe que as mensagens do gerente passem só por ela.';
        tone = 'cuidado';
      } else if (has('cortar')) {
        action = 'Saída com pouco impacto. Antes de desligar: dê um retorno claro, combine metas com prazo e decida pelo resultado, com orientação jurídica.';
        tone = 'cortar';
      } else if (has('trazer')) {
        action = 'Conquistar: chame para participar de decisões e projetos do gerente, reconheça em público.';
        tone = 'trazer';
      } else if (has('reter')) {
        action = 'Não perder: valorize, dê perspectiva de crescimento e prepare alguém para aprender o que ela sabe.';
        tone = 'reter';
      } else if (has('aliado')) {
        action = 'Aliado: peça ajuda para explicar e defender as mudanças junto às equipes.';
        tone = 'aliado';
      } else {
        action = 'Sem alerta: acompanhar normalmente.';
        tone = 'normal';
      }

      return {
        id: m.id,
        reasons,
        categories: Object.keys(reasons),
        action,
        tone,
        exitCost: r.operationalCost,
        resistanceReduction: r.resistanceReduction,
        influence: m.influence,
        stance: m.stance,
        stanceLabel: label,
        performance: m.performance,
        engagement: m.engagement,
        lowImpact,
        basis: basisOf(m),
      };
    });

    const lists = {};
    for (const cat of Object.keys(DECISION_CATEGORIES)) {
      lists[cat] = people
        .filter((p) => p.reasons[cat])
        .sort((a, b) =>
          cat === 'cortar' ? a.exitCost - b.exitCost : cat === 'reter' ? b.exitCost - a.exitCost : b.influence - a.influence
        );
    }
    return {
      people,
      lists,
      thresholds: { hiCost, loCost, hiInfl, medInfl },
      missingPerformance: others.filter((m) => m.performance === null).length,
      unjustifiedCount: others.filter((m) => m.unjustified.length).length,
      estimatedStance: others.filter((m) => m.stanceSource === 'inferido').length,
      lowImpactWithoutGrades: people.filter((p) => p.lowImpact && !p.reasons.cortar && p.performance === null).map((p) => p.id),
    };
  }

  // --------------------------------------------------- recomendações
  function recommendations(data, model) {
    const name = (id) => (model.byId.get(id) || { name: id }).name;
    const out = [];
    const F = model.focal;
    if (F) {
      for (const nu of F.nuclei.filter((x) => x.members.length > 1 || x.power > 0.3).slice(0, 4)) {
        out.push({
          level: 'alto',
          area: 'Resistência',
          text:
            `Grupo que resiste junto: ${nu.members.map(name).join(', ')}. ` +
            `Eles conversam diretamente com ${Math.round(nu.audienceShare * 100)}% da empresa. ` +
            'Converse com cada um separadamente, deixando claro por escrito o que se espera; ' +
            'evite reuniões só com eles, que fortalecem o grupo.',
        });
        for (const [a, b] of nu.familyPairs) {
          out.push({
            level: 'alto',
            area: 'Regra para parentes',
            text:
              `${name(a)} e ${name(b)} são parentes/casal e estão no mesmo grupo de resistência. ` +
              'Crie uma regra para parentes: um não decide nem avalia nada da área do outro, ' +
              'cada um responde a um chefe diferente e decisões que envolvam os dois passam pelo gerente geral.',
          });
        }
      }
      for (const gk of F.gatekeepers.filter((x) => x.stance === 'resistente' && x.dependency >= 0.1).slice(0, 3)) {
        out.push({
          level: 'alto',
          area: 'Comunicação',
          text:
            `A comunicação do gerente com ${Math.round(gk.dependency * 100)}% da empresa passa por ${name(gk.id)}, ` +
            'que resiste a ele. O recado pode chegar filtrado. Crie contato direto: reuniões com as equipes, ' +
            'conversas individuais com os líderes abaixo dessa pessoa e comunicados por escrito.',
        });
      }
      const sw = F.engagement.slice(0, 3);
      if (sw.length) {
        out.push({
          level: 'médio',
          area: 'Conquistar',
          text:
            `Conquiste primeiro: ${sw.map((x) => name(x.id)).join(', ')}. Ainda não tomaram partido e são ouvidos. ` +
            'Chame-os para decisões e projetos do novo gerente antes que o grupo de resistência os convença.',
        });
      }
      const al = F.allies.slice(0, 3);
      if (al.length) {
        out.push({
          level: 'médio',
          area: 'Aliados',
          text: `Aliados mais ouvidos: ${al.map((x) => name(x.id)).join(', ')}. Peça ajuda a eles para explicar e defender as mudanças.`,
        });
      }
      if (F.reach2Share < 0.6) {
        out.push({
          level: 'médio',
          area: 'Contato direto',
          text: `O gerente só consegue chegar a ${Math.round(F.reach2Share * 100)}% da empresa por meio de no máximo uma pessoa. Ele precisa de mais contato direto com as equipes.`,
        });
      }
    }
    for (const m of model.metrics.filter((x) => x.articulation && x.knowledgeRisk >= 0.4)) {
      out.push({
        level: 'médio',
        area: 'Continuidade',
        text: `${name(m.id)} é a única ligação entre partes da equipe e sabe coisas importantes. Registre os processos e treine um substituto.`,
      });
    }
    const lost = model.skills.filter((s) => s.holders.length === 1).slice(0, 8);
    if (lost.length) {
      out.push({
        level: 'baixo',
        area: 'Conhecimento',
        text: `Só uma pessoa sabe: ${lost.map((s) => `${s.skill} (${name(s.holders[0])})`).join('; ')}. Se ela sair, a empresa perde esse conhecimento.`,
      });
    }
    for (const d of model.departments.filter((x) => x.size >= 3 && x.openness < 0.2)) {
      out.push({
        level: 'baixo',
        area: 'Área isolada',
        text: `${d.name} trabalha isolado: só ${Math.round(d.openness * 100)}% das relações são com outras áreas. Crie reuniões e projetos em conjunto.`,
      });
    }
    return out;
  }

  return {
    RELATION_TYPES,
    INCIDENT_TYPES,
    LEVELS,
    WEIGHTS,
    IMPORTANCE,
    STANCE_THRESHOLD,
    analyze,
    simulateRemoval,
    impactRanking,
    recommendations,
    decisionBoard,
    DECISION_CATEGORIES,
    GRADE_RULES,
    effectiveGrade,
    stanceLabel,
    sentimentOf,
    // expostos para testes
    _internal: { buildGraph, betweenness, pagerank, louvain, modularity, articulation, efficiency, components },
  };
});
