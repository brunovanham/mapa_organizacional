/*
 * app.js — interface: mapa (Cytoscape), cadastros, análises, resistência,
 * simulação de saída e registro de ocorrências.
 */
(function () {
  'use strict';
  const A = window.OrgAnalytics;
  const S = window.Store;

  // ------------------------------------------------------------ helpers
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) =>
    String(s === null || s === undefined ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');
  const fx = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const STANCE_OPTIONS = [
    ['', 'Desconhecido (inferir)'],
    ['2', '+2 Apoia ativamente'],
    ['1', '+1 Tende a apoiar'],
    ['0', '0 Neutro'],
    ['-1', '−1 Tende a resistir'],
    ['-2', '−2 Resiste / boicota'],
  ];
  const SENTIMENT_OPTIONS = [
    ['', 'Padrão do tipo'],
    ['2', '+2 Muito positiva'],
    ['1', '+1 Positiva'],
    ['0', '0 Neutra'],
    ['-1', '−1 Tensa'],
    ['-2', '−2 Hostil'],
  ];
  const STANCE_COLORS = () => ({
    apoiador: cssVar('--ok'),
    neutro: cssVar('--neutral'),
    resistente: cssVar('--bad'),
    desconhecido: cssVar('--unknown'),
    focal: cssVar('--accent'),
  });
  const CLUSTER_PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

  let model = null;
  let cy = null;
  let currentView = 'painel';
  let selectedId = null;
  let lastLayoutKey = '';
  const simSelection = new Set();
  let simResult = null;
  let ranking = null;
  const sortState = {};

  const data = () => S.data;
  const person = (id) => data().people.find((p) => p.id === id);
  const pname = (id) => {
    const p = person(id);
    return p ? p.name || '(sem nome)' : '(removido)';
  };
  const dep = (id) => data().departments.find((d) => d.id === id);
  const depName = (id) => (dep(id) || { name: '—' }).name;

  function recompute() {
    model = A.analyze(data());
    ranking = null;
    simResult = null;
    board = null;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  const options = (pairs, selected) =>
    pairs
      .map(([v, l]) => `<option value="${esc(v)}"${String(selected ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`)
      .join('');
  const peopleOptions = (selected, emptyLabel) =>
    (emptyLabel !== undefined ? `<option value="">${esc(emptyLabel)}</option>` : '') +
    options(
      data().people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.id, p.name]),
      selected
    );
  const depOptions = (selected) =>
    '<option value="">—</option>' + options(data().departments.map((d) => [d.id, d.name]), selected);

  function stanceBadge(m) {
    if (!m) return '';
    const l = m.stanceLabel;
    const src = m.stanceSource ? ` <span class="muted small">(${esc(m.stanceSource)})</span>` : '';
    const val = m.stance === null || l === 'focal' ? '' : ` ${fx(m.stance, 1)}`;
    return `<span class="badge st-${l}">${esc(l)}${val}</span>${src}`;
  }

  function personLink(id) {
    return `<a href="#" data-action="select-person" data-id="${esc(id)}">${esc(pname(id))}</a>`;
  }

  // Tabela genérica ordenável.
  function table(id, columns, rows, defaultSort) {
    const st = sortState[id] || defaultSort || {};
    const col = columns.find((c) => c.key === st.key);
    if (col) {
      const get = col.sort || ((r) => r[col.key]);
      rows = rows.slice().sort((a, b) => {
        const x = get(a);
        const y = get(b);
        const r = typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity);
        return st.dir === 'asc' ? r : -r;
      });
    }
    const head = columns
      .map((c) => {
        const arrow = st.key === c.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : '';
        return c.nosort
          ? `<th>${esc(c.label)}</th>`
          : `<th><button class="th" data-action="sort" data-table="${id}" data-key="${c.key}" title="${esc(c.title || '')}">${esc(c.label)}${arrow}</button></th>`;
      })
      .join('');
    const body = rows.length
      ? rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}" class="muted">Nada para mostrar.</td></tr>`;
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  const bar = (v, cls) => `<span class="bar ${cls || ''}"><span style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></span></span>`;
  const kpi = (label, value, hint) =>
    `<div class="kpi"><div class="kpi-v">${value}</div><div class="kpi-l">${esc(label)}</div>${hint ? `<div class="kpi-h">${esc(hint)}</div>` : ''}</div>`;

  function emptyState(msg) {
    return `<div class="empty card"><p>${msg}</p>
      <p><button class="primary" data-action="load-sample">Carregar exemplo fictício</button>
      <button data-action="goto" data-id="pessoas">Cadastrar pessoas</button></p></div>`;
  }

  // ------------------------------------------------------------- views
  function setView(v) {
    currentView = v;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
    render();
  }

  function render() {
    $('#company-name').textContent = data().settings.companyName || '';
    const r = {
      mapa: renderMap,
      painel: renderPainel,
      colaboradores: renderColaboradores,
      departamentos: renderDepartments,
      relacoes: renderRelations,
      analise: renderAnalysis,
      resistencia: renderResistance,
      simulacao: renderSimulation,
      ocorrencias: renderIncidents,
      dados: renderData,
    }[currentView];
    if (r) r();
  }

  // --------------------------------------------------------------- MAPA
  function nodeColor(p, m, colorBy) {
    if (colorBy === 'stance') return STANCE_COLORS()[m.stanceLabel] || cssVar('--unknown');
    if (colorBy === 'community') return CLUSTER_PALETTE[m.community % CLUSTER_PALETTE.length];
    if (colorBy === 'group') {
      const gi = allGroups().indexOf((p.groups || [])[0]);
      return gi >= 0 ? CLUSTER_PALETTE[gi % CLUSTER_PALETTE.length] : cssVar('--unknown');
    }
    return (dep(p.departmentId) || {}).color || cssVar('--unknown');
  }

  function renderMap() {
    const box = $('#cy');
    if (!window.cytoscape) {
      box.innerHTML = '<p class="pad">A biblioteca de grafos não carregou (vendor/cytoscape.min.js).</p>';
      return;
    }
    if (!data().people.length) {
      if (cy) {
        cy.destroy();
        cy = null;
      }
      box.innerHTML = emptyState('Nenhuma pessoa cadastrada ainda.');
      $('#legend').innerHTML = '';
      return;
    }
    if (!cy && box.querySelector('.empty')) box.innerHTML = '';
    if (cy) cy.resize();

    const colorBy = $('#color-by').value;
    const sizeBy = $('#size-by').value;
    const showPos = $('#show-pos').checked;
    const showNeg = $('#show-neg').checked;
    const showFormal = $('#show-formal').checked;
    const vals = model.metrics.map((m) => m[sizeBy] || 0);
    const max = Math.max(1e-9, ...vals);

    const els = [];
    for (const p of data().people) {
      const m = model.byId.get(p.id);
      if (!m) continue;
      els.push({
        group: 'nodes',
        data: {
          id: p.id,
          label: p.name,
          color: nodeColor(p, m, colorBy),
          size: 24 + 56 * ((m[sizeBy] || 0) / max),
          focal: p.id === model.focalId ? 1 : 0,
          ap: m.articulation ? 1 : 0,
        },
      });
    }
    const ids = new Set(data().people.map((p) => p.id));
    for (const r of data().relations) {
      if (!ids.has(r.source) || !ids.has(r.target)) continue;
      const sent = A.sentimentOf(r);
      const neg = sent < 0;
      if ((neg && !showNeg) || (!neg && !showPos)) continue;
      const t = A.RELATION_TYPES[r.type] || {};
      els.push({
        group: 'edges',
        data: { id: 'e_' + r.id, source: r.source, target: r.target, w: Number(r.strength) || 1, rel: r.id },
        classes: [neg ? 'neg' : 'pos', r.type, t.directed ? 'directed' : ''].join(' '),
      });
    }
    if (showFormal) {
      for (const p of data().people) {
        if (p.managerId && ids.has(p.managerId)) {
          els.push({ group: 'edges', data: { id: 'f_' + p.id, source: p.managerId, target: p.id, w: 1 }, classes: 'formal directed' });
        }
      }
    }

    const style = [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          width: 'data(size)',
          height: 'data(size)',
          label: 'data(label)',
          'font-size': 11,
          color: cssVar('--text'),
          'text-valign': 'bottom',
          'text-margin-y': 4,
          'text-outline-color': cssVar('--bg'),
          'text-outline-width': 2,
          'border-width': 1,
          'border-color': cssVar('--bg'),
        },
      },
      { selector: 'node[focal = 1]', style: { 'border-width': 4, 'border-color': cssVar('--accent'), shape: 'star' } },
      { selector: 'node[ap = 1]', style: { 'border-width': 3, 'border-style': 'double', 'border-color': cssVar('--warn') } },
      { selector: 'node:selected', style: { 'border-width': 4, 'border-color': cssVar('--text') } },
      {
        selector: 'edge',
        style: {
          width: 'mapData(w, 1, 5, 1, 6)',
          'curve-style': 'bezier',
          'line-color': cssVar('--edge'),
          'target-arrow-color': cssVar('--edge'),
          opacity: 0.75,
        },
      },
      { selector: 'edge.directed', style: { 'target-arrow-shape': 'triangle', 'arrow-scale': 0.9 } },
      { selector: 'edge.neg', style: { 'line-color': cssVar('--bad'), 'target-arrow-color': cssVar('--bad'), 'line-style': 'dashed', opacity: 0.9 } },
      { selector: 'edge.familiar', style: { 'line-color': cssVar('--family'), opacity: 1 } },
      { selector: 'edge.formal', style: { 'line-color': cssVar('--muted'), 'target-arrow-color': cssVar('--muted'), 'line-style': 'dotted', width: 1.5, opacity: 0.8 } },
      { selector: '.faded', style: { opacity: 0.12 } },
    ];

    const layoutName = $('#layout').value;
    const layoutKey = layoutName + '|' + data().people.map((p) => p.id).join(',');
    const prev = cy ? Object.fromEntries(cy.nodes().map((n) => [n.id(), n.position()])) : {};
    if (!cy) {
      cy = cytoscape({ container: box, elements: els, style, wheelSensitivity: 0.3 });
      cy.on('tap', 'node', (e) => selectPerson(e.target.id()));
      cy.on('tap', (e) => {
        if (e.target === cy) selectPerson(null);
      });
    } else {
      cy.elements().remove();
      cy.style(style);
      cy.add(els);
    }
    if (layoutKey === lastLayoutKey && cy.nodes().every((n) => prev[n.id()])) {
      cy.nodes().forEach((n) => n.position(prev[n.id()]));
    } else {
      runLayout(layoutName);
      lastLayoutKey = layoutKey;
    }
    if (selectedId && cy.getElementById(selectedId).nonempty()) highlight(selectedId);
    renderLegend(colorBy);
    renderDetail();
  }

  function runLayout(name) {
    let opts;
    if (name === 'concentric') {
      opts = { name: 'concentric', concentric: (n) => (model.byId.get(n.id()) || {}).influence || 0, levelWidth: () => 0.15, minNodeSpacing: 20 };
    } else if (name === 'breadthfirst') {
      const roots = data().people.filter((p) => !p.managerId || !person(p.managerId)).map((p) => '#' + CSS.escape(p.id));
      // Arestas formais temporárias garantem a árvore hierárquica.
      const tmp = data().people
        .filter((p) => p.managerId && person(p.managerId))
        .map((p) => ({ group: 'edges', data: { id: 'tmp_' + p.id, source: p.managerId, target: p.id }, classes: 'tmp' }));
      const added = cy.add(tmp);
      added.style('display', 'none');
      cy.layout({ name: 'breadthfirst', directed: true, roots: roots.join(','), spacingFactor: 1.1, padding: 20 }).run();
      added.remove();
      return;
    } else {
      opts = {
        name: 'cose',
        animate: false,
        idealEdgeLength: (e) => 140 - 15 * (e.data('w') || 1),
        nodeRepulsion: () => 9000,
        edgeElasticity: (e) => (e.hasClass('neg') ? 20 : 100 * (e.data('w') || 1)),
        padding: 30,
        randomize: true,
      };
    }
    cy.layout({ ...opts, padding: 30 }).run();
  }

  function highlight(id) {
    if (!cy) return;
    cy.elements().removeClass('faded');
    cy.nodes().unselect();
    if (!id) return;
    const n = cy.getElementById(id);
    if (n.empty()) return;
    n.select();
    const hood = n.closedNeighborhood();
    cy.elements().not(hood).addClass('faded');
  }

  function renderLegend(colorBy) {
    let items = [];
    if (colorBy === 'stance') {
      const c = STANCE_COLORS();
      items = Object.entries(c).map(([k, v]) => [k, v]);
    } else if (colorBy === 'group') {
      items = allGroups().map((g, i) => [g, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]]).concat([['sem grupo', cssVar('--unknown')]]);
    } else if (colorBy === 'community') {
      items = model.communities.map((c) => [`Cluster ${c.id + 1} (${pname(c.leader)})`, CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length]]);
    } else {
      items = data().departments.map((d) => [d.name, d.color]);
    }
    $('#legend').innerHTML =
      items.map(([l, c]) => `<span><i style="background:${esc(c)}"></i>${esc(l)}</span>`).join('') +
      `<span><i class="ln neg"></i>conflito/boicote</span><span><i class="ln fam"></i>familiar</span>` +
      `<span>★ pessoa focal</span><span><i class="ring"></i>ponto único de conexão</span>`;
  }

  function selectPerson(id) {
    selectedId = id;
    if (currentView !== 'mapa') setView('mapa');
    highlight(id);
    renderDetail();
  }

  function renderDetail() {
    const box = $('#detail');
    const p = selectedId && person(selectedId);
    const m = p && model.byId.get(p.id);
    const wasHidden = box.classList.contains('hidden');
    box.classList.toggle('hidden', !p || !m);
    // O painel muda a largura do mapa: reajusta o enquadramento.
    if (cy && wasHidden !== box.classList.contains('hidden')) {
      cy.resize();
      cy.fit(undefined, 30);
    }
    if (!p || !m) return;
    const rels = data().relations.filter((r) => r.source === p.id || r.target === p.id);
    const inc = model.focal && model.focal.incidentsBy[p.id];
    const relRows = rels
      .map((r) => {
        const other = r.source === p.id ? r.target : r.source;
        const t = A.RELATION_TYPES[r.type] || { label: r.type };
        const dir = t.directed ? (r.source === p.id ? '→' : '←') : '↔';
        const s = A.sentimentOf(r);
        return `<li class="${s < 0 ? 'neg-text' : ''}">${dir} ${personLink(other)} <span class="muted small">${esc(t.label.split(' (')[0])} · força ${esc(r.strength)} · sent. ${s > 0 ? '+' : ''}${s}</span>
          <button class="link small" data-action="edit-rel" data-id="${esc(r.id)}">editar</button></li>`;
      })
      .join('');
    const sub = data().people.filter((x) => x.managerId === p.id);
    box.innerHTML = `
      <button class="close" data-action="close-detail" aria-label="Fechar">×</button>
      <h3>${esc(p.name)}</h3>
      <p class="muted">${esc(p.role || '')} · ${esc(depName(p.departmentId))} · ${esc(A.LEVELS[p.level] || '')}</p>
      <p>${stanceBadge(m)} ${m.articulation ? '<span class="badge warn">ponto único de conexão</span>' : ''}</p>
      <table class="mini">
        <tr><td>Notas</td><td>desempenho ${m.performance ?? '—'} · engajamento ${m.engagement ?? '—'} · conhecimento ${m.knowledge}</td></tr>
        <tr><td>Influência</td><td>${bar(m.influence)} ${fx(m.influence)} <span class="muted">(#${m.influenceRank})</span></td></tr>
        <tr><td>Peso geral</td><td>${bar(m.peso)} ${fx(m.peso)}</td></tr>
        <tr><td>Intermediação</td><td>${fx(m.betweenness, 3)}</td></tr>
        <tr><td>Proximidade</td><td>${fx(m.closeness)}</td></tr>
        <tr><td>Laços positivos</td><td>${m.ties} (força ${fx(m.strength, 0)})</td></tr>
        <tr><td>Conflitos</td><td>${fx(m.negStrength, 1)}</td></tr>
        <tr><td>Risco de conhecimento</td><td>${bar(m.knowledgeRisk, 'warn')} ${fx(m.knowledgeRisk)}</td></tr>
        <tr><td>Tríades em tensão</td><td>${m.tension || 0}</td></tr>
        <tr><td>Cluster</td><td>${m.community + 1}</td></tr>
        ${m.exposure !== undefined ? `<tr><td>Exposição (vizinhança)</td><td>${fx(m.exposure, 1)}</td></tr>` : ''}
        ${inc ? `<tr><td>Ocorrências</td><td>${inc.negative} negativas · ${inc.positive} positivas</td></tr>` : ''}
      </table>
      ${m.uniqueSkills.length ? `<p class="small"><strong>Conhecimento exclusivo:</strong> ${m.uniqueSkills.map(esc).join(', ')}</p>` : ''}
      <p class="small"><strong>Gestor:</strong> ${p.managerId ? personLink(p.managerId) : '—'}
      ${sub.length ? `<br><strong>Liderados:</strong> ${sub.map((x) => personLink(x.id)).join(', ')}` : ''}</p>
      <h4>Relações (${rels.length})</h4>
      <ul class="rel-list">${relRows || '<li class="muted">Nenhuma relação cadastrada.</li>'}</ul>
      <div class="btn-row">
        <button data-action="edit-person" data-id="${esc(p.id)}">Abrir ficha</button>
        <button data-action="new-rel-from" data-id="${esc(p.id)}">+ Relação</button>
        <button data-action="simulate-person" data-id="${esc(p.id)}">Simular saída</button>
        ${model.focalId !== p.id ? `<button data-action="set-focal" data-id="${esc(p.id)}">Definir como focal</button>` : ''}
      </div>`;
  }

  // ------------------------------------------------------- COLABORADORES
  // Tela de cadastro rápido: lista à esquerda, ficha completa à direita.
  // As alterações da ficha são salvas automaticamente (sem botão "salvar").
  let fichaId = null;
  let peopleTableMode = false;

  const RATINGS = [
    { field: 'performance', label: 'Desempenho', values: [1, 2, 3, 4, 5], low: 'abaixo do esperado', high: 'excepcional' },
    { field: 'knowledge', label: 'Conhecimento crítico', values: [0, 1, 2, 3, 4, 5], low: 'fácil de substituir', high: 'insubstituível' },
    { field: 'engagement', label: 'Engajamento', values: [1, 2, 3, 4, 5], low: 'desmotivado(a)', high: 'muito engajado(a)' },
    { field: 'stance', label: 'Posição em relação ao gerente', values: [-2, -1, 0, 1, 2], low: 'resiste / boicota', high: 'apoia ativamente', signed: true },
  ];

  const filledGrades = (p) => RATINGS.filter((r) => p[r.field] !== null && p[r.field] !== undefined && p[r.field] !== '').length;
  const linksOf = (id) => data().relations.filter((r) => r.source === id || r.target === id);
  const allGroups = () => [...new Set(data().people.flatMap((p) => p.groups || []))].sort((a, b) => a.localeCompare(b));

  function renderColaboradores() {
    $('.cad').hidden = peopleTableMode;
    $('#people-table').hidden = !peopleTableMode;
    $('#toggle-table-label').textContent = peopleTableMode ? 'Voltar à ficha' : 'Ver tabela';
    if (peopleTableMode) return renderPeopleTable();
    renderCadList();
    renderFicha();
  }

  function renderCadList() {
    const q = ($('#cad-search').value || '').trim().toLowerCase();
    const groups = new Map();
    for (const p of data().people.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
      if (q && !`${p.name} ${p.role} ${depName(p.departmentId)} ${(p.groups || []).join(' ')}`.toLowerCase().includes(q)) continue;
      const k = p.departmentId ? depName(p.departmentId) : 'Sem setor';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    $('#cad-items').innerHTML = groups.size
      ? [...groups.entries()]
          .map(
            ([d, ps]) => `<div class="cad-group"><div class="cad-group-title">${esc(d)} <span class="muted">(${ps.length})</span></div>${ps
              .map((p) => {
                const g = filledGrades(p);
                const l = linksOf(p.id).length;
                return `<button class="cad-item${p.id === fichaId ? ' active' : ''}" data-action="open-ficha" data-id="${esc(p.id)}">
                  <span class="cad-name">${esc(p.name || '(sem nome)')}</span>
                  <span class="cad-meta"><span class="dots" title="${g} de 4 notas preenchidas">${'●'.repeat(g)}${'○'.repeat(4 - g)}</span> ${l} vínculo${l === 1 ? '' : 's'}</span>
                </button>`;
              })
              .join('')}</div>`
          )
          .join('')
      : `<p class="muted small pad">${data().people.length ? 'Ninguém encontrado.' : 'Nenhum colaborador ainda.'}</p>`;
  }

  function ratingRow(p, r) {
    const cur = p[r.field];
    const isSet = cur !== null && cur !== undefined && cur !== '';
    const btn = (v) => {
      const label = r.signed && v > 0 ? '+' + v : String(v);
      const tone = r.signed ? (v < 0 ? ' neg' : v > 0 ? ' pos' : '') : '';
      return `<button type="button" class="rate-btn${tone}${isSet && Number(cur) === v ? ' active' : ''}" data-action="rate" data-field="${r.field}" data-value="${v}" aria-pressed="${isSet && Number(cur) === v}">${label}</button>`;
    };
    return `<div class="rating">
      <div class="rating-label">${esc(r.label)}</div>
      <div class="rating-scale">
        <span class="rating-end">${esc(r.low)}</span>
        ${r.values.map(btn).join('')}
        <span class="rating-end">${esc(r.high)}</span>
        <button type="button" class="rate-btn clear${isSet ? '' : ' active'}" data-action="rate" data-field="${r.field}" data-value="" title="Não avaliado">?</button>
      </div>
    </div>`;
  }

  function chips(list, kind) {
    return (list || [])
      .map((x) => `<span class="chip">${esc(x)}<button type="button" data-action="chip-del" data-kind="${kind}" data-id="${esc(x)}" aria-label="Remover ${esc(x)}">×</button></span>`)
      .join('');
  }

  function renderFicha() {
    const box = $('#ficha');
    const p = fichaId && person(fichaId);
    if (!p) {
      fichaId = null;
      box.innerHTML = `<div class="card guide">
        <h3>Como cadastrar</h3>
        <ol>
          <li><strong>Setores</strong>: crie pelo campo "Setor" da ficha (opção "+ Novo setor…") ou na aba Setores e grupos.</li>
          <li><strong>Colaboradores</strong>: clique em <em>+ Novo colaborador</em> ou cole uma lista de nomes à esquerda.</li>
          <li><strong>Notas</strong>: clique nos números (desempenho, conhecimento, engajamento e posição em relação ao gerente).</li>
          <li><strong>Vínculos</strong>: digite o nome de quem se relaciona com a pessoa, escolha o tipo e a força.</li>
          <li>Abra o <strong>Painel</strong> para ver as recomendações.</li>
        </ol>
        <p class="muted small">Tudo é salvo automaticamente. A bolinha ●○ na lista mostra quantas notas já foram dadas.</p>
        ${data().people.length ? '' : '<p><button data-action="load-sample">Ver com exemplo fictício</button></p>'}
      </div>`;
      return;
    }
    const m = model.byId.get(p.id);
    const others = data().people.filter((x) => x.id !== p.id);
    const links = linksOf(p.id);
    const ids = data().people.map((x) => x.id);
    const idx = ids.indexOf(p.id);
    const sentOpts = SENTIMENT_OPTIONS.slice(1);
    const linkRows = links
      .map((r) => {
        const other = r.source === p.id ? r.target : r.source;
        const t = A.RELATION_TYPES[r.type] || {};
        const dir = t.directed ? (r.source === p.id ? `${esc(p.name.split(' ')[0] || 'esta pessoa')} → ${esc(pname(other).split(' ')[0])}` : `${esc(pname(other).split(' ')[0])} → ${esc(p.name.split(' ')[0] || 'esta pessoa')}`) : '';
        const s = A.sentimentOf(r);
        return `<tr class="${s < 0 ? 'row-neg' : ''}">
          <td><a href="#" data-action="open-ficha" data-id="${esc(other)}">${esc(pname(other))}</a><div class="muted small">${esc(depName((person(other) || {}).departmentId))}</div></td>
          <td><select data-rel="${esc(r.id)}" data-relfield="type">${typeOptions(r.type)}</select>
            ${t.directed ? `<div class="small muted">${dir} <button class="link small" data-action="rel-flip" data-id="${esc(r.id)}">inverter</button></div>` : ''}</td>
          <td><select data-rel="${esc(r.id)}" data-relfield="strength">${options([1, 2, 3, 4, 5].map((v) => [v, v]), r.strength)}</select></td>
          <td><select data-rel="${esc(r.id)}" data-relfield="sentiment">${options([['', 'padrão (' + (A.RELATION_TYPES[r.type] || {}).sentiment + ')'], ...sentOpts], r.sentiment ?? '')}</select></td>
          <td><button class="link danger-text" data-action="rel-del" data-id="${esc(r.id)}" aria-label="Remover vínculo">remover</button></td>
        </tr>`;
      })
      .join('');

    box.innerHTML = `<div class="card ficha-card">
      <div class="ficha-head">
        <input class="ficha-name" data-field="name" value="${esc(p.name)}" placeholder="Nome do colaborador" aria-label="Nome">
        <div class="ficha-badges">
          ${m ? stanceBadge(m) : ''}
          ${m ? `<span class="badge" title="Posição no ranking de influência">influência #${m.influenceRank}</span>` : ''}
          ${p.id === model.focalId ? '<span class="badge st-focal">pessoa focal</span>' : ''}
        </div>
      </div>

      <div class="grid3">
        <label>Cargo<input data-field="role" value="${esc(p.role)}" placeholder="ex.: Supervisor de produção"></label>
        <label>Setor<select data-field="departmentId">${depOptions(p.departmentId)}<option value="__new">+ Novo setor…</option></select></label>
        <label>Nível<select data-field="level">${options(Object.entries(A.LEVELS), p.level)}</select></label>
        <label>Gestor direto<select data-field="managerId"><option value="">—</option>${options(others.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => [x.id, x.name]), p.managerId)}</select></label>
        <label>Tempo de casa (anos)<input data-field="tenure" type="number" min="0" step="0.5" value="${esc(p.tenure ?? '')}"></label>
        <div class="field">
          <span class="field-label">Grupos / equipes</span>
          <div class="chips">${chips(p.groups, 'groups')}<input id="group-input" list="groups-datalist" placeholder="digite e Enter" aria-label="Adicionar grupo"></div>
          <datalist id="groups-datalist">${allGroups().map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
        </div>
      </div>

      <h4>Notas</h4>
      <div class="ratings">${RATINGS.map((r) => ratingRow(p, r)).join('')}</div>
      <p class="muted small">"?" = ainda não avaliado. Sem a posição informada, o sistema estima pela rede de relações.</p>

      <h4>Conhecimentos / habilidades</h4>
      <div class="chips">${chips(p.skills, 'skills')}<input id="skill-input" list="skills-datalist" placeholder="ex.: ERP, carteira sul — Enter" aria-label="Adicionar habilidade"></div>
      <datalist id="skills-datalist">${[...new Set(data().people.flatMap((x) => x.skills || []))].map((s) => `<option value="${esc(s)}">`).join('')}</datalist>

      <h4>Vínculos (${links.length})</h4>
      <div class="link-add">
        <input id="link-person" list="people-datalist" placeholder="Com quem? (nome)" aria-label="Pessoa">
        <datalist id="people-datalist">${others.map((x) => `<option value="${esc(x.name)}">${esc(depName(x.departmentId))}</option>`).join('')}</datalist>
        <select id="link-type" aria-label="Tipo">${typeOptions(fichaLinkDefaults.type)}</select>
        <select id="link-strength" aria-label="Força" title="Força / frequência">${options([1, 2, 3, 4, 5].map((v) => [v, 'força ' + v]), fichaLinkDefaults.strength)}</select>
        <select id="link-sent" aria-label="Sentimento">${options(SENTIMENT_OPTIONS, fichaLinkDefaults.sentiment)}</select>
        <button class="primary" data-action="link-add">Adicionar vínculo</button>
      </div>
      ${links.length ? `<div class="table-wrap"><table class="links"><thead><tr><th>Pessoa</th><th>Tipo</th><th>Força</th><th>Sentimento</th><th></th></tr></thead><tbody>${linkRows}</tbody></table></div>` : '<p class="muted small">Nenhum vínculo ainda. Digite um nome acima — se a pessoa não existir, ela é criada.</p>'}

      <label>Observações<textarea data-field="notes" rows="2">${esc(p.notes)}</textarea></label>

      <div class="btn-row">
        <button data-action="open-ficha" data-id="${esc(ids[idx - 1] || '')}" ${idx > 0 ? '' : 'disabled'}>← Anterior</button>
        <button data-action="open-ficha" data-id="${esc(ids[idx + 1] || '')}" ${idx < ids.length - 1 ? '' : 'disabled'}>Próximo →</button>
        <button data-action="new-person">+ Novo colaborador</button>
        <span class="spacer"></span>
        <button data-action="select-person" data-id="${esc(p.id)}">Ver no mapa</button>
        <button class="danger" data-action="delete-person" data-id="${esc(p.id)}">Excluir</button>
      </div>
    </div>`;
  }

  const fichaLinkDefaults = { type: 'colaboracao', strength: 3, sentiment: '' };

  // Salva uma alteração da ficha sem recarregar a tela inteira.
  function updatePerson(patch, rerenderFicha) {
    S.upsert('people', { id: fichaId, ...patch }, 'p', { silent: true });
    afterSilentEdit(rerenderFicha);
  }

  function afterSilentEdit(rerenderFicha) {
    recompute();
    renderCadList();
    if (rerenderFicha) renderFicha();
  }

  function openFicha(id, focusName) {
    fichaId = id || null;
    peopleTableMode = false;
    if (currentView !== 'colaboradores') setView('colaboradores');
    else renderColaboradores();
    if (focusName) {
      const n = $('.ficha-name');
      if (n) n.focus();
    } else window.scrollTo({ top: 0 });
  }

  function newPerson(name) {
    const cur = fichaId && person(fichaId);
    const p = S.upsert(
      'people',
      { name: name || '', role: '', departmentId: cur ? cur.departmentId : null, level: 2, managerId: null, knowledge: 3, performance: null, engagement: null, stance: null, skills: [], groups: [], notes: '' },
      'p',
      { silent: true }
    );
    recompute();
    return p;
  }

  function findPersonByName(name) {
    const q = name.trim().toLowerCase();
    if (!q) return null;
    const exact = data().people.find((p) => (p.name || '').toLowerCase() === q);
    if (exact) return exact;
    const partial = data().people.filter((p) => (p.name || '').toLowerCase().includes(q));
    return partial.length === 1 ? partial[0] : null;
  }

  function addLinkFromFicha() {
    const name = $('#link-person').value.trim();
    if (!name) return toast('Digite o nome da pessoa.');
    let other = findPersonByName(name);
    if (other && other.id === fichaId) return toast('Escolha outra pessoa.');
    if (!other) {
      if (!confirm(`"${name}" ainda não está cadastrado(a). Criar agora?`)) return;
      const keep = fichaId;
      other = newPerson(name);
      fichaId = keep;
    }
    fichaLinkDefaults.type = $('#link-type').value;
    fichaLinkDefaults.strength = Number($('#link-strength').value);
    fichaLinkDefaults.sentiment = $('#link-sent').value;
    const dup = data().relations.find(
      (r) => r.type === fichaLinkDefaults.type && ((r.source === fichaId && r.target === other.id) || (!(A.RELATION_TYPES[r.type] || {}).directed && r.source === other.id && r.target === fichaId))
    );
    if (dup) return toast('Esse vínculo já existe — ajuste-o na lista.');
    S.upsert(
      'relations',
      {
        source: fichaId,
        target: other.id,
        type: fichaLinkDefaults.type,
        strength: fichaLinkDefaults.strength,
        sentiment: fichaLinkDefaults.sentiment === '' ? null : Number(fichaLinkDefaults.sentiment),
        notes: '',
      },
      'r',
      { silent: true }
    );
    afterSilentEdit(true);
    const inp = $('#link-person');
    if (inp) inp.focus();
    toast(`Vínculo com ${other.name} adicionado.`);
  }

  function addChip(kind, value) {
    const v = value.trim();
    if (!v) return;
    const p = person(fichaId);
    const list = (p[kind] || []).slice();
    if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
    updatePerson({ [kind]: list }, true);
    const inp = $(kind === 'groups' ? '#group-input' : '#skill-input');
    if (inp) inp.focus();
  }

  function pasteList(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return 0;
    const d = JSON.parse(JSON.stringify(data()));
    const depByName = new Map(d.departments.map((x) => [x.name.toLowerCase(), x]));
    const existing = new Set(d.people.map((p) => (p.name || '').toLowerCase()));
    let n = 0;
    for (const line of lines) {
      const [name, role = '', setor = '', grupos = ''] = line.split(/\t|;/).map((x) => x.trim());
      if (!name || existing.has(name.toLowerCase())) continue;
      let depId = null;
      if (setor) {
        let dd = depByName.get(setor.toLowerCase());
        if (!dd) {
          dd = { id: 'd' + Math.random().toString(36).slice(2, 9), name: setor, color: CLUSTER_PALETTE[d.departments.length % CLUSTER_PALETTE.length] };
          d.departments.push(dd);
          depByName.set(setor.toLowerCase(), dd);
        }
        depId = dd.id;
      }
      d.people.push({
        id: 'p' + Math.random().toString(36).slice(2, 9),
        name,
        role,
        departmentId: depId,
        level: 2,
        managerId: null,
        knowledge: 3,
        performance: null,
        engagement: null,
        stance: null,
        skills: [],
        groups: grupos.split('|').map((g) => g.trim()).filter(Boolean),
        notes: '',
      });
      existing.add(name.toLowerCase());
      n++;
    }
    S.replace(d);
    return n;
  }

  function renderPeopleTable() {
    const rows = data().people.map((p) => ({ p, m: model.byId.get(p.id) }));
    const grade = (v) => (v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : esc(v));
    const cols = [
      { key: 'name', label: 'Nome', sort: (r) => r.p.name, render: (r) => `<a href="#" data-action="open-ficha" data-id="${esc(r.p.id)}">${esc(r.p.name || '(sem nome)')}</a>` },
      { key: 'role', label: 'Cargo', sort: (r) => r.p.role || '', render: (r) => esc(r.p.role) },
      { key: 'dep', label: 'Setor', sort: (r) => depName(r.p.departmentId), render: (r) => esc(depName(r.p.departmentId)) },
      { key: 'groups', label: 'Grupos', sort: (r) => (r.p.groups || []).join(), render: (r) => esc((r.p.groups || []).join(', ')) },
      { key: 'performance', label: 'Desemp.', sort: (r) => Number(r.p.performance) || 0, render: (r) => grade(r.p.performance) },
      { key: 'knowledge', label: 'Conhec.', sort: (r) => Number(r.p.knowledge) || 0, render: (r) => grade(r.p.knowledge) },
      { key: 'engagement', label: 'Engaj.', sort: (r) => Number(r.p.engagement) || 0, render: (r) => grade(r.p.engagement) },
      { key: 'stance', label: 'Posição', sort: (r) => r.m.stance ?? -9, render: (r) => stanceBadge(r.m) },
      { key: 'links', label: 'Vínculos', sort: (r) => linksOf(r.p.id).length, render: (r) => linksOf(r.p.id).length },
      { key: 'influence', label: 'Influência', sort: (r) => r.m.influence, render: (r) => `${bar(r.m.influence)} ${fx(r.m.influence)}` },
      { key: 'peso', label: 'Peso', sort: (r) => r.m.peso, render: (r) => `${bar(r.m.peso)} ${fx(r.m.peso)}` },
    ];
    $('#people-table').innerHTML = data().people.length
      ? table('people', cols, rows, { key: 'peso', dir: 'desc' })
      : emptyState('Nenhum colaborador cadastrado.');
  }

  // --------------------------------------------------------------- PAINEL
  let board = null;
  const BOARD_ORDER = ['cuidado', 'trazer', 'influente', 'reter', 'cortar', 'aliado'];
  const TONE_LABEL = {
    critico: 'Risco crítico',
    cuidado: 'Cuidado',
    cortar: 'Pode cortar',
    trazer: 'Trazer para o lado',
    reter: 'Reter',
    aliado: 'Aliado',
    normal: 'Acompanhar',
  };

  function getBoard() {
    if (!board) {
      if (!ranking) ranking = A.impactRanking(data(), model);
      board = A.decisionBoard(data(), model, ranking);
    }
    return board;
  }

  function renderPainel() {
    const box = $('#painel');
    if (data().people.length < 3) {
      box.innerHTML = emptyState('Cadastre ao menos 3 colaboradores com vínculos para ver o painel de decisão.');
      return;
    }
    if (!board && !ranking && data().people.length > 150) {
      box.innerHTML = `<div class="card"><p>Empresa grande: o painel simula a saída de cada pessoa e pode levar alguns segundos.</p>
        <button class="primary" data-action="build-board">Calcular painel</button></div>`;
      return;
    }
    const b = getBoard();
    const focalNote = model.focalId
      ? ''
      : '<p class="notice-inline">Defina a <strong>pessoa focal</strong> (o gerente geral) para calcular quem resiste, quem apoia e com quem ter cuidado.</p>';

    const item = (cat, p) => {
      const reasons = p.reasons[cat];
      const pp = person(p.id);
      return `<li>
        <div class="row-top">${personLink(p.id)} <span class="muted small">${esc(pp.role || '')}${pp.role ? ' · ' : ''}${esc(depName(pp.departmentId))}</span></div>
        <div class="small">${esc(reasons[0])}${reasons.length > 1 ? ` <span class="more" title="${esc(reasons.slice(1).join(' · '))}">+${reasons.length - 1}</span>` : ''}</div>
      </li>`;
    };
    const cards = BOARD_ORDER.map((cat) => {
      const info = A.DECISION_CATEGORIES[cat];
      const list = b.lists[cat];
      let extra = '';
      if (cat === 'cortar') {
        if (b.missingPerformance) extra += `<p class="small warn-text">${b.missingPerformance} pessoa(s) sem nota de desempenho — avalie na ficha para esta análise ficar confiável.</p>`;
        if (b.lowImpactWithoutGrades.length) extra += `<p class="small muted">Baixo impacto de saída, mas sem notas: ${b.lowImpactWithoutGrades.map(personLink).join(', ')}</p>`;
      }
      return `<section class="board-card cat-${cat}">
        <header><h3>${esc(info.label)} <span class="count">${list.length}</span></h3><p class="muted small">${esc(info.hint)}</p></header>
        <ul>${list.map((p) => item(cat, p)).join('') || '<li class="muted small">Ninguém nesta categoria.</li>'}</ul>
        ${extra}
      </section>`;
    }).join('');

    const tableHtml = table(
      'board',
      [
        { key: 'name', label: 'Pessoa', sort: (r) => pname(r.id), render: (r) => personLink(r.id) },
        { key: 'dep', label: 'Setor', sort: (r) => depName(person(r.id).departmentId), render: (r) => esc(depName(person(r.id).departmentId)) },
        { key: 'tone', label: 'Classificação', sort: (r) => BOARD_TONES.indexOf(r.tone), render: (r) => `<span class="tone tone-${r.tone}">${esc(TONE_LABEL[r.tone])}</span>` },
        { key: 'action', label: 'O que fazer', nosort: true, render: (r) => `<span class="small">${esc(r.action)}</span>` },
        { key: 'influence', label: 'Influência', render: (r) => `${bar(r.influence)} ${fx(r.influence)}` },
        { key: 'exitCost', label: 'Custo de saída', render: (r) => `${bar(r.exitCost / 100, 'warn')} ${Math.round(r.exitCost)}` },
        { key: 'performance', label: 'Desemp.', sort: (r) => r.performance ?? -1, render: (r) => (r.performance ?? '—') },
        { key: 'stance', label: 'Posição', sort: (r) => r.stance ?? -9, render: (r) => stanceBadge(model.byId.get(r.id)) },
      ],
      b.people,
      { key: 'tone', dir: 'asc' }
    );

    box.innerHTML = `
      <div class="card painel-top">
        <label class="inline">Gerente / pessoa focal:
          <select id="focal-select">${peopleOptions(model.focalId, 'Selecione…')}</select></label>
        ${focalNote}
      </div>
      <div class="board">${cards}</div>
      <div class="card">
        <h3>Matriz de decisão</h3>
        <p class="muted small">Horizontal: quanto custa perder a pessoa (conhecimento, influência, conexões, contágio, desempenho). Vertical: posição em relação ao gerente. Tamanho: influência. Passe o mouse para detalhes; clique para ver no mapa.</p>
        ${matrixSvg(b)}
      </div>
      <div class="card">
        <h3>Recomendação por pessoa</h3>
        ${tableHtml}
      </div>
      <p class="muted small">Recomendações são apoio à decisão, não veredito. Antes de qualquer desligamento: feedback documentado, plano de melhoria e orientação jurídica. Vínculo familiar nunca é motivo de demissão.</p>`;
  }
  const BOARD_TONES = ['critico', 'cuidado', 'cortar', 'trazer', 'reter', 'aliado', 'normal'];

  function matrixSvg(b) {
    const W = 860;
    const H = 440;
    const m = { l: 72, r: 24, t: 40, b: 66 };
    const maxCost = Math.max(40, ...b.people.map((p) => p.exitCost)) * 1.08;
    const X = (v) => m.l + (v / maxCost) * (W - m.l - m.r);
    // Margem de 0,3 acima e abaixo para os círculos nos extremos não serem cortados.
    const Y = (v) => m.t + ((2.3 - v) / 4.6) * (H - m.t - m.b);
    const cut = b.thresholds.hiCost;
    const xt = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].filter((v) => v <= maxCost);
    const yt = [
      [2, '+2 apoia'],
      [1, '+1'],
      [0, '0'],
      [-1, '−1'],
      [-2, '−2 resiste'],
    ];
    const labelled = new Set(
      b.people
        .slice()
        .sort((a, c) => c.influence - a.influence)
        .slice(0, 8)
        .map((p) => p.id)
        .concat(b.people.filter((p) => p.tone === 'critico' || p.tone === 'cortar').map((p) => p.id))
    );
    const pts = b.people
      .slice()
      .sort((a, c) => c.influence - a.influence)
      .map((p) => {
        const cx = X(p.exitCost);
        const cy = Y(p.stance === null ? 0 : Math.max(-2, Math.min(2, p.stance)));
        const r = 5 + 10 * p.influence;
        const first = pname(p.id).split(' ')[0];
        return `<g class="pt" data-action="select-person" data-id="${esc(p.id)}" data-tip="${esc(
          `${pname(p.id)} · ${depName(person(p.id).departmentId)}\nCusto de saída ${Math.round(p.exitCost)}/100 · posição ${p.stance === null ? '?' : fx(p.stance, 1)} · influência ${fx(p.influence)}\n${p.action}`
        )}">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" class="dot-${p.stanceLabel}${p.stance === null ? ' hollow' : ''}"></circle>
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(r, 12).toFixed(1)}" class="hit"></circle>
          ${labelled.has(p.id) ? `<text x="${(cx + r + 4).toFixed(1)}" y="${(cy + 4).toFixed(1)}" class="pt-label">${esc(first)}</text>` : ''}
        </g>`;
      })
      .join('');
    const legend = [
      ['apoiador', 'apoiador'],
      ['neutro', 'neutro'],
      ['resistente', 'resistente'],
    ]
      .map(([k, l]) => `<span><i class="lg-dot dot-${k}"></i>${l}</span>`)
      .join('');
    return `<div class="matrix-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="matrix" role="img" aria-label="Matriz: custo de saída por posição em relação ao gerente">
        <rect x="${X(cut)}" y="${Y(0)}" width="${X(maxCost) - X(cut)}" height="${Y(-2.3) - Y(0)}" class="zone-risk"></rect>
        ${xt.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${Y(2.3)}" y2="${H - m.b}" class="grid"></line><text x="${X(v)}" y="${H - m.b + 16}" class="tick" text-anchor="middle">${v}</text>`).join('')}
        ${yt.map(([v, l]) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid${v === 0 ? ' zero' : ''}"></line><text x="${m.l - 6}" y="${Y(v) + 4}" class="tick" text-anchor="end">${l}</text>`).join('')}
        <line x1="${X(cut)}" x2="${X(cut)}" y1="${m.t}" y2="${H - m.b}" class="cut"></line>
        <text x="${X(cut) + 4}" y="${H - m.b + 32}" class="tick">custo alto →</text>
        <text x="${W - m.r}" y="${m.t - 12}" class="quad" text-anchor="end">↗ Pilares: reter e valorizar</text>
        <text x="${m.l}" y="${m.t - 12}" class="quad">↖ Apoiadores de baixo custo de saída</text>
        <text x="${W - m.r}" y="${H - 6}" class="quad" text-anchor="end">Risco crítico: cuidado ↘</text>
        <text x="${m.l}" y="${H - 6}" class="quad">↙ Resistentes de baixo impacto</text>
        <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" class="axis" text-anchor="middle">Custo de saída (0–100)</text>
        ${pts}
      </svg>
      <div class="matrix-tip" hidden></div>
      <div class="legend">${legend}<span>tamanho = influência</span><span><i class="lg-dot hollow-lg"></i>posição desconhecida</span></div>
    </div>`;
  }

  // ------------------------------------------------------ DEPARTAMENTOS
  function renderDepartments() {
    const rows = model.departments;
    const cols = [
      {
        key: 'name', label: 'Setor',
        render: (r) => `<i class="dot" style="background:${esc((dep(r.id) || {}).color)}"></i>${esc(r.name)}`,
      },
      { key: 'size', label: 'Pessoas' },
      { key: 'density', label: 'Coesão interna', title: 'Densidade de laços dentro do setor', render: (r) => `${bar(r.density)} ${pct(r.density)}` },
      { key: 'openness', label: 'Abertura', title: '% dos laços que vão para outras áreas', render: (r) => `${bar(r.openness)} ${pct(r.openness)}` },
      { key: 'negativeTies', label: 'Conflitos' },
      { key: 'avgStance', label: 'Posic. médio', render: (r) => fx(r.avgStance, 1) },
      { key: 'influence', label: 'Influência total', render: (r) => fx(r.influence) },
      { key: 'conn', label: 'Conectores', nosort: true, render: (r) => r.connectors.map((c) => personLink(c.id)).join(', ') || '—' },
      { key: 'act', label: '', nosort: true, render: (r) => `<button class="link" data-action="edit-dep" data-id="${esc(r.id)}">editar</button>` },
    ];
    $('#dep-table').innerHTML = data().departments.length
      ? table('deps', cols, rows, { key: 'size', dir: 'desc' })
      : emptyState('Crie os setores (ex.: Operações, Comercial, Financeiro).');
    const gcols = [
      { key: 'name', label: 'Grupo / equipe' },
      { key: 'size', label: 'Pessoas' },
      { key: 'members', label: 'Membros', nosort: true, render: (r) => r.members.map(personLink).join(', ') },
      { key: 'density', label: 'Coesão interna', render: (r) => `${bar(r.density)} ${pct(r.density)}` },
      { key: 'negativeTies', label: 'Conflitos' },
      { key: 'avgPerformance', label: 'Desempenho médio', render: (r) => fx(r.avgPerformance, 1) },
      { key: 'avgStance', label: 'Posição média', render: (r) => fx(r.avgStance, 1) },
      { key: 'influence', label: 'Influência total', render: (r) => fx(r.influence) },
    ];
    $('#group-table').innerHTML = model.groups.length
      ? table('groups', gcols, model.groups, { key: 'size', dir: 'desc' })
      : '<p class="muted">Nenhum grupo ainda. Adicione grupos/equipes na ficha de cada colaborador (ex.: Turno A, Projeto ERP, Comitê).</p>';
  }

  function depForm(d) {
    d = d || { color: CLUSTER_PALETTE[data().departments.length % CLUSTER_PALETTE.length] };
    openModal(
      d.id ? 'Editar setor' : 'Novo setor',
      `<label>Nome<input name="name" required value="${esc(d.name)}"></label>
       <label>Cor<input name="color" type="color" value="${esc(d.color)}"></label>`,
      (f) => {
        S.upsert('departments', { id: d.id, name: f.name.trim(), color: f.color }, 'd');
        toast('Setor salvo.');
      },
      d.id &&
        (() => {
          if (confirm(`Excluir o setor ${d.name}? As pessoas ficarão sem setor.`)) {
            S.remove('departments', d.id);
            return true;
          }
          return false;
        })
    );
  }

  // ------------------------------------------------------------ RELAÇÕES
  const typeOptions = (sel) => options(Object.entries(A.RELATION_TYPES).map(([k, t]) => [k, t.label]), sel);

  function renderRelations() {
    if (!$('#rel-type-filter').options.length) {
      $('#rel-type-filter').innerHTML = '<option value="">Todos os tipos</option>' + typeOptions('');
    }
    renderBulkForm();
    const q = $('#rel-filter').value.trim().toLowerCase();
    const tf = $('#rel-type-filter').value;
    const rows = data()
      .relations.filter((r) => !tf || r.type === tf)
      .filter((r) => !q || (pname(r.source) + ' ' + pname(r.target)).toLowerCase().includes(q));
    const cols = [
      { key: 'source', label: 'Origem', sort: (r) => pname(r.source), render: (r) => personLink(r.source) },
      { key: 'type', label: 'Tipo', sort: (r) => r.type, render: (r) => esc((A.RELATION_TYPES[r.type] || { label: r.type }).label) },
      { key: 'target', label: 'Destino', sort: (r) => pname(r.target), render: (r) => personLink(r.target) },
      { key: 'strength', label: 'Força', sort: (r) => Number(r.strength) },
      {
        key: 'sentiment', label: 'Sentimento', sort: (r) => A.sentimentOf(r),
        render: (r) => {
          const s = A.sentimentOf(r);
          return `<span class="${s < 0 ? 'neg-text' : ''}">${s > 0 ? '+' : ''}${s}</span>`;
        },
      },
      { key: 'notes', label: 'Observações', sort: (r) => r.notes || '' },
      {
        key: 'act', label: '', nosort: true,
        render: (r) => `<button class="link" data-action="edit-rel" data-id="${esc(r.id)}">editar</button>`,
      },
    ];
    $('#rel-table').innerHTML = data().people.length < 2
      ? emptyState('Cadastre ao menos duas pessoas para criar relações.')
      : table('rels', cols, rows, { key: 'source', dir: 'asc' });
  }

  function renderBulkForm() {
    const box = $('#bulk-form');
    const cur = box.dataset.person || '';
    const byDep = new Map();
    for (const p of data().people.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      if (p.id === cur) continue;
      const k = depName(p.departmentId);
      if (!byDep.has(k)) byDep.set(k, []);
      byDep.get(k).push(p);
    }
    const existing = new Set(
      data().relations.filter((r) => r.source === cur || r.target === cur).map((r) => (r.source === cur ? r.target : r.source))
    );
    box.innerHTML = `
      <div class="grid4">
        <label>Pessoa<select id="bulk-person">${peopleOptions(cur, 'Selecione…')}</select></label>
        <label>Tipo<select id="bulk-type">${typeOptions(box.dataset.type || 'colaboracao')}</select></label>
        <label>Força<select id="bulk-strength">${options([1, 2, 3, 4, 5].map((v) => [v, v]), box.dataset.strength || 3)}</select></label>
        <label>Sentimento<select id="bulk-sent">${options(SENTIMENT_OPTIONS, box.dataset.sent || '')}</select></label>
      </div>
      ${
        cur
          ? `<div class="bulk-grid">${[...byDep.entries()]
              .map(
                ([d, ps]) => `<fieldset><legend>${esc(d)}</legend>${ps
                  .map(
                    (p) => `<label class="chk"><input type="checkbox" value="${esc(p.id)}"> ${esc(p.name)}${existing.has(p.id) ? ' <span class="muted small">(já relacionado)</span>' : ''}</label>`
                  )
                  .join('')}</fieldset>`
              )
              .join('')}</div>
             <p class="muted small">Para tipos direcionados, a pessoa selecionada acima é a origem.</p>
             <button class="primary" data-action="bulk-add">Adicionar relações marcadas</button>`
          : '<p class="muted">Escolha uma pessoa para marcar rapidamente com quem ela trabalha, quem influencia, com quem tem conflito…</p>'
      }`;
  }

  function relationForm(r) {
    r = r || { type: 'colaboracao', strength: 3, sentiment: null };
    openModal(
      r.id ? 'Editar relação' : 'Nova relação',
      `
      <div class="grid2">
        <label>Origem<select name="source" required>${peopleOptions(r.source, 'Selecione…')}</select></label>
        <label>Destino<select name="target" required>${peopleOptions(r.target, 'Selecione…')}</select></label>
      </div>
      <label>Tipo<select name="type">${typeOptions(r.type)}</select></label>
      <div class="grid2">
        <label>Força / frequência (1–5)<select name="strength">${options([1, 2, 3, 4, 5].map((v) => [v, v]), r.strength)}</select></label>
        <label>Sentimento<select name="sentiment">${options(SENTIMENT_OPTIONS, r.sentiment ?? '')}</select></label>
      </div>
      <label>Observações / evidência<textarea name="notes" rows="2">${esc(r.notes)}</textarea></label>`,
      (f) => {
        if (!f.source || !f.target || f.source === f.target) {
          toast('Escolha duas pessoas diferentes.');
          return false;
        }
        S.upsert(
          'relations',
          { id: r.id, source: f.source, target: f.target, type: f.type, strength: Number(f.strength), sentiment: f.sentiment === '' ? null : Number(f.sentiment), notes: f.notes },
          'r'
        );
        toast('Relação salva.');
      },
      r.id &&
        (() => {
          S.remove('relations', r.id);
          return true;
        })
    );
  }

  // ------------------------------------------------------------- ANÁLISE
  function renderAnalysis() {
    const box = $('#analysis');
    if (data().people.length < 2) {
      box.innerHTML = emptyState('Cadastre pessoas e relações para ver a análise.');
      return;
    }
    const recs = A.recommendations(data(), model);
    const M = model.metrics;
    const informal = model.shadow.filter((s) => s.gap > 0.15).slice(0, 6);
    const formalOnly = model.shadow.slice().reverse().filter((s) => s.gap < -0.15).slice(0, 6);

    const rankingCols = [
      { key: 'name', label: 'Pessoa', sort: (r) => r.name, render: (r) => personLink(r.id) },
      { key: 'dep', label: 'Setor', sort: (r) => depName(r.departmentId), render: (r) => esc(depName(r.departmentId)) },
      { key: 'influence', label: 'Influência', title: 'PageRank + intermediação + força dos laços', render: (r) => `${bar(r.influence)} ${fx(r.influence)}` },
      { key: 'peso', label: 'Peso', title: 'Influência + conhecimento + posição formal', render: (r) => `${bar(r.peso)} ${fx(r.peso)}` },
      { key: 'pagerank', label: 'PageRank', render: (r) => fx(r.pagerank, 3) },
      { key: 'betweenness', label: 'Intermediação', render: (r) => fx(r.betweenness, 3) },
      { key: 'closeness', label: 'Proximidade', render: (r) => fx(r.closeness) },
      { key: 'ties', label: 'Laços' },
      { key: 'knowledgeRisk', label: 'Risco conhec.', render: (r) => `${bar(r.knowledgeRisk, 'warn')} ${fx(r.knowledgeRisk)}` },
      { key: 'tension', label: 'Tensão' },
      { key: 'community', label: 'Cluster', render: (r) => r.community + 1 },
      { key: 'stance', label: 'Posic.', sort: (r) => r.stance ?? -9, render: (r) => stanceBadge(r) },
    ];

    box.innerHTML = `
      <div class="kpis">
        ${kpi('Pessoas', model.n)}
        ${kpi('Relações', data().relations.length)}
        ${kpi('Densidade', pct(model.density), 'laços existentes / possíveis')}
        ${kpi('Clusters', model.communities.length, 'grupos informais')}
        ${kpi('Modularidade', fx(model.modularity), '> 0,4 = grupos bem separados')}
        ${kpi('Componentes', model.components, '1 = todos conectados')}
      </div>

      <div class="card">
        <h3>Recomendações</h3>
        ${recs.length ? `<ul class="recs">${recs.map((r) => `<li class="lvl-${esc(r.level)}"><span class="badge">${esc(r.area)}</span> ${esc(r.text)}</li>`).join('')}</ul>` : '<p class="muted">Sem alertas no momento.</p>'}
      </div>

      <div class="card">
        <h3>Ranking de influência, peso e conhecimento</h3>
        ${table('ranking', rankingCols, M, { key: 'peso', dir: 'desc' })}
      </div>

      <div class="card">
        <h3>Clusters (grupos informais)</h3>
        <p class="muted small">Detectados pelo algoritmo de Louvain sobre os laços positivos. Clusters que misturam setores mostram onde o trabalho realmente acontece; um cluster com posicionamento médio negativo é um foco de resistência.</p>
        <div class="cards">${model.communities
          .map(
            (c) => `<div class="mini-card" style="border-left-color:${CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length]}">
              <strong>Cluster ${c.id + 1}</strong> · líder informal: ${personLink(c.leader)}<br>
              <span class="small muted">${c.members.length} pessoas · ${c.departments} depto(s) · posic. médio ${fx(c.avgStance, 1)}</span>
              <div class="small">${c.members.map(personLink).join(', ')}</div></div>`
          )
          .join('')}</div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>Pares-chave</h3>
          <p class="muted small">Laços que mais sustentam o fluxo da rede (intermediação da aresta) entre pessoas influentes.</p>
          ${table('pairs', [
            { key: 'pair', label: 'Par', nosort: true, render: (r) => `${personLink(r.a)} ↔ ${personLink(r.b)}` },
            { key: 'strength', label: 'Força' },
            { key: 'score', label: 'Relevância', render: (r) => `${bar(r.score)} ${fx(r.score)}` },
            { key: 'tags', label: 'Sinais', nosort: true, render: (r) => r.tags.map((t) => `<span class="badge small">${esc(t)}</span>`).join(' ') },
          ], model.keyPairs.slice(0, 15), { key: 'score', dir: 'desc' })}
        </div>
        <div class="card">
          <h3>Conflitos críticos</h3>
          <p class="muted small">Intensidade × influência das duas pessoas.</p>
          ${table('conflicts', [
            { key: 'pair', label: 'Par', nosort: true, render: (r) => `${personLink(r.a)} ✕ ${personLink(r.b)}` },
            { key: 'intensity', label: 'Intensidade', render: (r) => fx(r.intensity, 1) },
            { key: 'score', label: 'Criticidade', render: (r) => fx(r.score) },
            { key: 'f', label: '', nosort: true, render: (r) => (r.involvesFocal ? '<span class="badge st-focal">pessoa focal</span>' : '') },
          ], model.conflicts.slice(0, 15), { key: 'score', dir: 'desc' })}
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>Organização "sombra"</h3>
          <p class="muted small">Comparação entre posição formal e influência real.</p>
          <h4>Líderes informais (influência acima do cargo)</h4>
          <ul>${informal.map((s) => `<li>${personLink(s.id)} — influência #${s.influenceRank}, cargo #${s.formalRank}</li>`).join('') || '<li class="muted">Nenhum destaque.</li>'}</ul>
          <h4>Autoridade com pouca influência</h4>
          <ul>${formalOnly.map((s) => `<li>${personLink(s.id)} — cargo #${s.formalRank}, influência #${s.influenceRank}</li>`).join('') || '<li class="muted">Nenhum destaque.</li>'}</ul>
        </div>
        <div class="card">
          <h3>Pontos únicos de falha</h3>
          <p class="muted small">Pessoas cuja saída desconecta partes da rede e conhecimentos com um só detentor.</p>
          <p>${model.articulationPoints.map(personLink).join(', ') || '<span class="muted">Nenhum ponto de articulação.</span>'}</p>
          <h4>Conhecimento com um único detentor</h4>
          <ul class="cols">${model.skills.filter((s) => s.holders.length === 1).map((s) => `<li>${esc(s.skill)} — ${personLink(s.holders[0])}</li>`).join('') || '<li class="muted">Nenhum.</li>'}</ul>
        </div>
      </div>

      <div class="card">
        <h3>Tríades em tensão</h3>
        <p class="muted small">Trios com número ímpar de laços negativos (teoria do equilíbrio estrutural). Quem está "dividido" tem laço positivo com duas pessoas que estão em conflito entre si — é pressionado a escolher um lado.</p>
        <ul>${model.triads.slice(0, 20).map((t) => `<li>${t.members.map(personLink).join(' · ')}${t.torn ? ` — dividido(a): <strong>${esc(pname(t.torn))}</strong>` : ' — três laços negativos'}</li>`).join('') || '<li class="muted">Nenhuma.</li>'}</ul>
      </div>`;
  }

  // --------------------------------------------------------- RESISTÊNCIA
  function renderResistance() {
    const box = $('#resistance');
    if (data().people.length < 2) {
      box.innerHTML = emptyState('Cadastre pessoas e relações primeiro.');
      return;
    }
    const focalSel = `<label class="inline">Pessoa focal (quem está sofrendo boicote / liderando a mudança):
      <select id="focal-select">${peopleOptions(model.focalId, 'Selecione…')}</select></label>`;
    const F = model.focal;
    if (!F) {
      box.innerHTML = `<div class="card">${focalSel}<p class="muted">Escolha a pessoa focal — por exemplo, o novo gerente geral — para calcular apoiadores, resistentes, núcleos de boicote e porteiros.</p></div>`;
      return;
    }
    const recs = A.recommendations(data(), model).filter((r) => ['Resistência', 'Governança', 'Comunicação', 'Engajamento', 'Aliados', 'Alcance'].includes(r.area));
    const others = model.metrics.filter((m) => m.id !== model.focalId);
    box.innerHTML = `
      <div class="card">${focalSel}</div>
      <div class="kpis">
        ${kpi('Apoiadores', F.count.apoiador || 0)}
        ${kpi('Neutros', F.count.neutro || 0)}
        ${kpi('Resistentes', F.count.resistente || 0)}
        ${kpi('Poder de resistência', fx(F.resistancePower), 'Σ influência × intensidade')}
        ${kpi('Poder de apoio', fx(F.supportPower))}
        ${kpi('Alcance da focal', pct(F.reach2Share), 'da empresa em até 2 passos')}
      </div>

      <div class="card">
        <h3>Plano de ação sugerido</h3>
        ${recs.length ? `<ul class="recs">${recs.map((r) => `<li class="lvl-${esc(r.level)}"><span class="badge">${esc(r.area)}</span> ${esc(r.text)}</li>`).join('')}</ul>` : '<p class="muted">Sem alertas.</p>'}
      </div>

      <div class="card">
        <h3>Núcleos de resistência</h3>
        <p class="muted small">Resistentes conectados entre si por laços positivos formam uma coalizão. "Audiência" = pessoas não resistentes ligadas diretamente ao núcleo (quem ele pode contaminar).</p>
        <div class="cards">${F.nuclei
          .map(
            (nu, i) => `<div class="mini-card bad">
              <strong>Núcleo ${i + 1}</strong> · poder ${fx(nu.power)} · ${nu.departments} depto(s)<br>
              <div>${nu.members.map(personLink).join(', ')}</div>
              ${nu.familyPairs.length ? `<div class="small"><span class="badge fam">vínculo familiar</span> ${nu.familyPairs.map(([a, b]) => `${esc(pname(a))} + ${esc(pname(b))}`).join('; ')}</div>` : ''}
              <div class="small muted">Audiência: ${nu.audience.length} pessoas (${pct(nu.audienceShare)}) — ${nu.audience.map((id) => esc(pname(id))).join(', ')}</div>
              <button class="small" data-action="simulate-group" data-id="${esc(nu.members.join(','))}">Simular saída do núcleo</button>
            </div>`
          )
          .join('') || '<p class="muted">Nenhum resistente identificado.</p>'}</div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>Porteiros da pessoa focal</h3>
          <p class="muted small">Por quem passam os caminhos mais curtos da focal até o resto da empresa. Porteiro resistente = risco de informação filtrada ou bloqueada.</p>
          ${table('gate', [
            { key: 'name', label: 'Pessoa', sort: (r) => pname(r.id), render: (r) => personLink(r.id) },
            { key: 'dependency', label: 'Dependência', render: (r) => `${bar(r.dependency, r.stance === 'resistente' ? 'bad' : '')} ${pct(r.dependency)}` },
            { key: 'stance', label: 'Posic.', render: (r) => `<span class="badge st-${r.stance}">${esc(r.stance)}</span>` },
          ], F.gatekeepers.slice(0, 10), { key: 'dependency', dir: 'desc' })}
        </div>
        <div class="card">
          <h3>Prioridade de engajamento</h3>
          <p class="muted small">Neutros influentes e expostos à pressão dos resistentes: quem conquistar primeiro.</p>
          ${table('engage', [
            { key: 'name', label: 'Pessoa', sort: (r) => pname(r.id), render: (r) => personLink(r.id) },
            { key: 'score', label: 'Prioridade', render: (r) => `${bar(r.score)} ${fx(r.score)}` },
            { key: 'pressure', label: 'Pressão', render: (r) => `${bar(r.pressure, 'bad')} ${fx(r.pressure)}` },
            { key: 'exposure', label: 'Exposição', render: (r) => fx(r.exposure, 1) },
          ], F.engagement.slice(0, 10), { key: 'score', dir: 'desc' })}
        </div>
      </div>

      <div class="card">
        <h3>Mapa de posicionamento</h3>
        <p class="muted small">Origem: <em>informado</em> (avaliação sua), <em>relação direta</em> (sentimento das relações com a focal), <em>ocorrências</em> (fatos registrados) ou <em>inferido</em> (média da vizinhança — confirme antes de agir).</p>
        ${table('stance', [
          { key: 'name', label: 'Pessoa', sort: (r) => r.name, render: (r) => personLink(r.id) },
          { key: 'dep', label: 'Setor', sort: (r) => depName(r.departmentId), render: (r) => esc(depName(r.departmentId)) },
          { key: 'stance', label: 'Posicionamento', sort: (r) => r.stance ?? -9, render: (r) => stanceBadge(r) },
          { key: 'influence', label: 'Influência', render: (r) => `${bar(r.influence)} ${fx(r.influence)}` },
          { key: 'exposure', label: 'Exposição', title: 'Média do posicionamento dos vizinhos', render: (r) => fx(r.exposure, 1) },
          { key: 'pressure', label: 'Pressão', title: 'Influência dos resistentes ao redor', render: (r) => fx(r.pressure) },
          { key: 'inc', label: 'Ocorrências (−/+)', sort: (r) => (F.incidentsBy[r.id] || {}).negative || 0, render: (r) => { const x = F.incidentsBy[r.id]; return x ? `${x.negative} / ${x.positive}` : '—'; } },
        ], others, { key: 'stance', dir: 'asc' })}
      </div>`;
  }

  // ----------------------------------------------------------- SIMULAÇÃO
  function renderSimulation() {
    const box = $('#simulation');
    if (data().people.length < 3) {
      box.innerHTML = emptyState('Cadastre pessoas e relações para simular.');
      return;
    }
    const byDep = new Map();
    for (const p of data().people.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const k = depName(p.departmentId);
      if (!byDep.has(k)) byDep.set(k, []);
      byDep.get(k).push(p);
    }
    const picker = [...byDep.entries()]
      .map(
        ([d, ps]) => `<fieldset><legend>${esc(d)}</legend>${ps
          .map((p) => `<label class="chk"><input type="checkbox" class="sim-chk" value="${esc(p.id)}"${simSelection.has(p.id) ? ' checked' : ''}> ${esc(p.name)}</label>`)
          .join('')}</fieldset>`
      )
      .join('');

    let result = '';
    if (simResult) {
      const r = simResult;
      const b = r.breakdown;
      result = `
        <div class="card">
          <h3>Resultado: saída de ${r.removed.map((id) => esc(pname(id))).join(', ')}</h3>
          <div class="kpis">
            ${kpi('Custo operacional', `${Math.round(r.operationalCost)}<small>/100</small>`, 'conhecimento, influência, conectividade')}
            ${kpi('Redução da resistência', pct(r.resistanceReduction), `${fx(r.resistanceBefore)} → ${fx(r.resistanceAfter)}`)}
            ${kpi('Perda de eficiência da rede', pct(r.efficiencyLoss), 'comunicação entre quem fica')}
            ${kpi('Influência removida', pct(r.influenceShare))}
            ${kpi('Grupos desconectados', `${r.componentsBefore} → ${r.componentsAfter}`)}
            ${r.focalReachBefore !== null ? kpi('Alcance da focal', `${pct(r.focalReachBefore)} → ${pct(r.focalReachAfter)}`) : ''}
          </div>
          <table class="mini">
            <tr><td>Eficiência</td><td>${bar(b.efficiency, 'warn')}</td></tr>
            <tr><td>Isolamento</td><td>${bar(b.isolation, 'warn')}</td></tr>
            <tr><td>Influência</td><td>${bar(b.influence, 'warn')}</td></tr>
            <tr><td>Conhecimento</td><td>${bar(b.knowledge, 'warn')}</td></tr>
            <tr><td>Contágio</td><td>${bar(b.contagion, 'warn')}</td></tr>
          </table>
          <div class="grid2">
            <div>
              <h4>Conhecimento perdido</h4>
              <ul>${r.skillsLost.map((s) => `<li>${esc(s)}</li>`).join('') || '<li class="muted">Nenhum (há outra pessoa que domina).</li>'}</ul>
              <h4>Conhecimento que fica com uma só pessoa</h4>
              <ul>${r.skillsAtRisk.map((s) => `<li>${esc(s.skill)} — ${personLink(s.holder)}</li>`).join('') || '<li class="muted">Nenhum.</li>'}</ul>
              <h4>Pessoas que ficam isoladas da rede</h4>
              <ul>${r.isolated.map((id) => `<li>${personLink(id)}</li>`).join('') || '<li class="muted">Nenhuma.</li>'}</ul>
            </div>
            <div>
              <h4>Risco de contágio (laços fortes com quem sai)</h4>
              <p class="muted small">Podem se desengajar, se solidarizar ou sair junto. Planeje conversas com essas pessoas no mesmo dia.</p>
              <ul>${r.contagion.map((c) => `<li>${personLink(c.id)} ← ${esc(pname(c.from))} · intensidade do laço ${c.strength}${c.family ? ' <span class="badge fam">familiar</span>' : ''} <span class="badge st-${c.stance}">${esc(c.stance)}</span></li>`).join('') || '<li class="muted">Nenhum laço forte.</li>'}</ul>
              <p class="small">Laços positivos rompidos: ${r.positiveTies} · conflitos removidos: ${r.negativeTies}</p>
            </div>
          </div>
        </div>`;
    }

    const rankHtml = ranking
      ? `<div class="card"><h3>Impacto individual de saída</h3>
          <p class="muted small">Cada pessoa simulada isoladamente. Custo alto + redução de resistência alta = decisão difícil: prepare sucessão e transferência de conhecimento antes.</p>
          ${table('impact', [
            { key: 'name', label: 'Pessoa', sort: (r) => pname(r.id), render: (r) => personLink(r.id) },
            { key: 'operationalCost', label: 'Custo operacional', render: (r) => `${bar(r.operationalCost / 100, 'warn')} ${Math.round(r.operationalCost)}` },
            { key: 'resistanceReduction', label: 'Redução da resistência', render: (r) => `${bar(r.resistanceReduction, 'ok')} ${pct(r.resistanceReduction)}` },
            { key: 'skillsLost', label: 'Conhec. perdidos' },
            { key: 'isolated', label: 'Isolados' },
            { key: 'contagion', label: 'Contágio' },
          ], ranking, { key: 'operationalCost', dir: 'desc' })}</div>`
      : '';

    box.innerHTML = `
      <div class="card">
        <div class="sim-picker">${picker}</div>
        <div class="btn-row">
          <button class="primary" data-action="run-sim">Simular saída das selecionadas</button>
          <button data-action="clear-sim">Limpar seleção</button>
          <button data-action="run-ranking">Calcular ranking de impacto de todos</button>
        </div>
      </div>
      ${result}${rankHtml}`;
  }

  // --------------------------------------------------------- OCORRÊNCIAS
  function renderIncidents() {
    const rows = data().incidents;
    const cols = [
      { key: 'date', label: 'Data' },
      { key: 'type', label: 'Tipo', render: (r) => { const t = A.INCIDENT_TYPES[r.type] || { label: r.type, valence: 0 }; return `<span class="${t.valence < 0 ? 'neg-text' : t.valence > 0 ? 'ok-text' : ''}">${esc(t.label)}</span>`; } },
      { key: 'actors', label: 'Quem', sort: (r) => (r.actors || []).map(pname).join(), render: (r) => (r.actors || []).map(personLink).join(', ') },
      { key: 'targets', label: 'Afetado(s)', sort: (r) => (r.targets || []).map(pname).join(), render: (r) => (r.targets || []).map(personLink).join(', ') },
      { key: 'severity', label: 'Gravidade' },
      { key: 'description', label: 'Descrição' },
      { key: 'act', label: '', nosort: true, render: (r) => `<button class="link" data-action="edit-inc" data-id="${esc(r.id)}">editar</button>` },
    ];
    $('#inc-table').innerHTML = data().people.length
      ? table('inc', cols, rows, { key: 'date', dir: 'desc' })
      : emptyState('Cadastre pessoas antes de registrar ocorrências.');
  }

  function incidentForm(ev) {
    ev = ev || { date: new Date().toISOString().slice(0, 10), type: 'boicote', severity: 3, actors: [], targets: model.focalId ? [model.focalId] : [] };
    const multi = (name, sel) =>
      `<select name="${name}" multiple size="6">${options(
        data().people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.id, p.name]),
        null
      ).replace(/<option value="([^"]*)"/g, (m, v) => (sel.includes(v) ? `${m} selected` : m))}</select>`;
    openModal(
      ev.id ? 'Editar ocorrência' : 'Registrar ocorrência',
      `
      <div class="grid2">
        <label>Data<input name="date" type="date" value="${esc(ev.date)}"></label>
        <label>Tipo<select name="type">${options(Object.entries(A.INCIDENT_TYPES).map(([k, t]) => [k, t.label]), ev.type)}</select></label>
      </div>
      <div class="grid2">
        <label>Quem fez (Ctrl/Cmd para vários)${multi('actors', ev.actors || [])}</label>
        <label>Quem foi afetado${multi('targets', ev.targets || [])}</label>
      </div>
      <label>Gravidade (1–5)<select name="severity">${options([1, 2, 3, 4, 5].map((v) => [v, v]), ev.severity)}</select></label>
      <label>Descrição objetiva (fato, data, impacto)<textarea name="description" rows="4">${esc(ev.description)}</textarea></label>`,
      (f, form) => {
        const sel = (n) => [...form.querySelector(`[name="${n}"]`).selectedOptions].map((o) => o.value);
        S.upsert('incidents', { id: ev.id, date: f.date, type: f.type, actors: sel('actors'), targets: sel('targets'), severity: Number(f.severity), description: f.description }, 'i');
        toast('Ocorrência registrada.');
      },
      ev.id &&
        (() => {
          S.remove('incidents', ev.id);
          return true;
        })
    );
  }

  // --------------------------------------------------------------- DADOS
  // ------------------------------------------------- GITHUB (armazenamento)
  const G = window.GitHubSync;
  const SYNC_LABEL = {
    local: ['warn', 'Salvo só neste navegador'],
    loading: ['busy', 'Carregando do GitHub…'],
    dirty: ['busy', 'Alterações pendentes…'],
    saving: ['busy', 'Salvando no GitHub…'],
    saved: ['ok', 'Salvo no GitHub'],
    error: ['bad', 'Erro ao salvar no GitHub'],
  };

  function renderSyncStatus() {
    const el = $('#sync-status');
    const [tone, label] = SYNC_LABEL[G.status] || SYNC_LABEL.local;
    const time = G.status === 'saved' && G.state.savedAt ? ' · ' + new Date(G.state.savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    el.className = 'sync-status s-' + tone;
    el.innerHTML = `<i></i>${esc(label + time)}`;
    el.title = G.error || (G.connected ? `${G.cfg.owner}/${G.cfg.repo} · ${G.cfg.path}` : 'Configure o GitHub na aba Dados para salvar online');
    if (currentView === 'dados') renderGitHubCard();
  }

  function renderGitHubCard() {
    const box = $('#gh-card');
    if (!box) return;
    if (G.connected) {
      const c = G.cfg;
      box.innerHTML = `
        <h3>Armazenamento no GitHub <span class="badge st-apoiador">conectado</span></h3>
        <p>Os dados são lidos e gravados em <strong>${esc(c.owner)}/${esc(c.repo)}</strong> → <code>${esc(c.path)}</code>${c.branch ? ` (branch ${esc(c.branch)})` : ''}. Cada gravação vira uma versão no histórico.</p>
        <p class="small">Status: <strong>${esc((SYNC_LABEL[G.status] || [])[1] || '')}</strong>${G.error ? ` — <span class="neg-text">${esc(G.error)}</span>` : ''}</p>
        <div class="btn-row">
          <button class="primary" data-action="gh-save">Salvar agora</button>
          <button data-action="gh-reload">Recarregar do GitHub</button>
          <a class="button" href="${esc(G.historyUrl())}" target="_blank" rel="noopener">Ver histórico de versões</a>
        </div>
        <h4>Acesso sem login para outra pessoa</h4>
        <p class="muted small">Gere um link e envie por um canal privado (ex.: WhatsApp direto). Quem abrir o link já entra conectado, sem senha. <strong>Quem tiver o link pode ler e alterar os dados</strong> — para revogar, apague a chave no GitHub e gere outra.</p>
        <div class="btn-row"><button data-action="gh-link">Gerar link de acesso</button></div>
        <div id="gh-link-box"></div>
        <h4>Este navegador</h4>
        <div class="btn-row"><button class="danger" data-action="gh-disconnect">Desconectar este navegador</button></div>`;
      return;
    }
    box.innerHTML = `
      <h3>Armazenamento no GitHub <span class="badge warn">não configurado</span></h3>
      <p>Hoje os dados estão salvos só neste navegador. Conecte a um repositório <strong>privado</strong> do GitHub para gravar e ler os dados de qualquer computador, sem banco de dados e sem login.</p>
      <details class="steps">
        <summary>Passo a passo (5 minutos, uma única vez)</summary>
        <ol>
          <li>Crie um repositório <strong>privado</strong> só para os dados, por exemplo <code>mapa_organizacional_dados</code>: <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a> → marque <em>Private</em> → marque <em>Add a README file</em>.</li>
          <li>Crie uma chave de acesso: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token</a> → <em>Repository access: Only select repositories</em> → escolha o repositório de dados → <em>Permissions → Contents: Read and write</em> → defina uma validade → <em>Generate token</em>.</li>
          <li>Cole a chave abaixo e clique em <em>Conectar</em>.</li>
        </ol>
        <p class="muted small">A chave só dá acesso ao repositório de dados, não à sua conta. Ela fica guardada apenas neste navegador.</p>
      </details>
      <div class="grid2">
        <label>Dono (usuário ou organização)<input id="gh-owner" value="${esc((G.cfg && G.cfg.owner) || 'brunovanham')}"></label>
        <label>Repositório de dados (privado)<input id="gh-repo" value="${esc((G.cfg && G.cfg.repo) || 'mapa_organizacional_dados')}"></label>
        <label>Arquivo<input id="gh-path" value="${esc((G.cfg && G.cfg.path) || 'dados/organizacao.json')}"></label>
        <label>Branch <span class="muted">(vazio = padrão)</span><input id="gh-branch" value="${esc((G.cfg && G.cfg.branch) || '')}"></label>
      </div>
      <label>Chave de acesso (token)<input id="gh-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <div class="btn-row"><button class="primary" data-action="gh-connect">Conectar</button></div>
      ${G.error ? `<p class="neg-text small">${esc(G.error)}</p>` : ''}`;
  }

  function renderData() {
    const s = data().settings;
    $('#data-panel').innerHTML = `
      <div class="card gh" id="gh-card"></div>
      <div class="grid2">
        <div class="card">
          <h3>Configurações</h3>
          <label>Nome da empresa<input id="set-company" value="${esc(s.companyName)}"></label>
          <label>Pessoa focal (análise de resistência)<select id="set-focal">${peopleOptions(s.focalId, '—')}</select></label>
          <label title="0 ignora a hierarquia formal na rede informal">Peso do laço formal gestor–liderado (0–5)
            <select id="set-formal">${options([0, 1, 2, 3, 4, 5].map((v) => [v, v]), s.formalTieStrength)}</select></label>
          <button class="primary" data-action="save-settings">Salvar configurações</button>
        </div>
        <div class="card">
          <h3>Backup e importação</h3>
          <p class="muted small">Cópia de segurança manual em arquivo. Os dados também ficam em cache neste navegador; com o GitHub conectado, cada gravação vira uma versão no histórico.</p>
          <div class="btn-row">
            <button data-action="export">Exportar JSON</button>
            <label class="button">Importar JSON<input type="file" id="import-json" accept=".json,application/json" hidden></label>
          </div>
          <h4>Importar pessoas via CSV</h4>
          <p class="muted small">Colunas (separador <code>;</code> ou <code>,</code>): <code>nome;cargo;setor;nivel;gestor;conhecimento;desempenho;engajamento;grupos;habilidades</code> (só <code>nome</code> é obrigatória). Gestor pelo nome; grupos e habilidades separados por <code>|</code>. Setores inexistentes são criados.</p>
          <label class="button">Importar CSV<input type="file" id="import-csv" accept=".csv,text/csv" hidden></label>
          <h4>Outros</h4>
          <div class="btn-row">
            <button data-action="load-sample">Carregar exemplo fictício</button>
            <button class="danger" data-action="clear-all">Apagar todos os dados</button>
          </div>
        </div>
      </div>
      <div class="card notice">
        <h3>Uso responsável e LGPD</h3>
        <ul>
          <li>Estes são dados pessoais sensíveis sobre colaboradores. Restrinja o acesso (CEO e gerente geral), não compartilhe o arquivo e apague o que não for mais necessário.</li>
          <li>Use o mapa para <strong>entender e agir sobre comportamentos</strong> — não como prova. Decisões disciplinares devem se apoiar em fatos documentados (aba Ocorrências), feedback prévio e orientação jurídica trabalhista.</li>
          <li>Casamento ou parentesco <strong>não</strong> é motivo de desligamento. O que se trata é conduta (boicote, descumprimento) e conflito de interesses (política de parentes, linhas de reporte separadas).</li>
          <li>Posicionamentos "inferidos" são hipóteses do algoritmo. Confirme com observação e conversa antes de agir.</li>
          <li>Guarde os dados num repositório <strong>privado</strong>. Este aplicativo é público, mas sem a chave de acesso ninguém vê os dados.</li>
        </ul>
      </div>`;
    renderGitHubCard();
  }

  function importCSV(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return 0;
    const sep = lines[0].includes(';') ? ';' : ',';
    const header = lines[0].split(sep).map((h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    const col = (row, name) => {
      const i = header.indexOf(name);
      return i >= 0 ? (row[i] || '').trim() : '';
    };
    const d = JSON.parse(JSON.stringify(data()));
    const depByName = new Map(d.departments.map((x) => [x.name.toLowerCase(), x]));
    const rows = lines.slice(1).map((l) => l.split(sep));
    const created = [];
    for (const row of rows) {
      const name = col(row, 'nome');
      if (!name) continue;
      let depName_ = col(row, 'setor') || col(row, 'departamento');
      let depId = null;
      if (depName_) {
        let dd = depByName.get(depName_.toLowerCase());
        if (!dd) {
          dd = { id: 'd' + Math.random().toString(36).slice(2, 9), name: depName_, color: CLUSTER_PALETTE[d.departments.length % CLUSTER_PALETTE.length] };
          d.departments.push(dd);
          depByName.set(depName_.toLowerCase(), dd);
        }
        depId = dd.id;
      }
      const p = {
        id: 'p' + Math.random().toString(36).slice(2, 9),
        name,
        role: col(row, 'cargo'),
        departmentId: depId,
        level: Number(col(row, 'nivel')) || 2,
        knowledge: Number(col(row, 'conhecimento')) || 3,
        skills: col(row, 'habilidades').split('|').map((s) => s.trim()).filter(Boolean),
        groups: col(row, 'grupos').split('|').map((s) => s.trim()).filter(Boolean),
        performance: Number(col(row, 'desempenho')) || null,
        engagement: Number(col(row, 'engajamento')) || null,
        stance: null,
        managerId: null,
        _mgr: col(row, 'gestor'),
        notes: '',
      };
      d.people.push(p);
      created.push(p);
    }
    const byName = new Map(d.people.map((p) => [p.name.toLowerCase(), p.id]));
    for (const p of created) {
      if (p._mgr) p.managerId = byName.get(p._mgr.toLowerCase()) || null;
      delete p._mgr;
    }
    S.replace(d);
    return created.length;
  }

  // --------------------------------------------------------------- modal
  function openModal(title, body, onSubmit, onDelete) {
    const dlg = $('#modal');
    const form = $('#modal-form');
    form.innerHTML = `<h3>${esc(title)}</h3>${body}
      <div class="btn-row end">
        ${onDelete ? '<button type="button" class="danger" data-modal="delete">Excluir</button>' : ''}
        <span class="spacer"></span>
        <button type="button" data-modal="cancel">Cancelar</button>
        <button type="submit" class="primary">Salvar</button>
      </div>`;
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form).entries());
      if (onSubmit(f, form) !== false) dlg.close();
    };
    form.querySelector('[data-modal="cancel"]').onclick = () => dlg.close();
    const del = form.querySelector('[data-modal="delete"]');
    if (del) del.onclick = () => onDelete() && dlg.close();
    dlg.showModal();
    const first = form.querySelector('input,select,textarea');
    if (first) first.focus();
  }

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // -------------------------------------------------------------- ações
  const actions = {
    goto: (id) => setView(id),
    sort: (_, el) => {
      const t = el.dataset.table;
      const k = el.dataset.key;
      const cur = sortState[t];
      sortState[t] = { key: k, dir: cur && cur.key === k && cur.dir === 'desc' ? 'asc' : 'desc' };
      render();
    },
    'select-person': (id) => selectPerson(id),
    'close-detail': () => selectPerson(null),
    'edit-person': (id) => openFicha(id),
    'open-ficha': (id) => id && openFicha(id),
    'new-person': () => {
      const p = newPerson('');
      openFicha(p.id, true);
    },
    'delete-person': (id) => {
      if (!confirm(`Excluir ${pname(id)} e todos os seus vínculos?`)) return;
      if (selectedId === id) selectedId = null;
      fichaId = null;
      S.remove('people', id);
    },
    rate: (_, el) => {
      const v = el.dataset.value;
      updatePerson({ [el.dataset.field]: v === '' ? null : Number(v) }, true);
    },
    'chip-del': (value, el) => {
      const kind = el.dataset.kind;
      updatePerson({ [kind]: (person(fichaId)[kind] || []).filter((x) => x !== value) }, true);
    },
    'link-add': () => addLinkFromFicha(),
    'rel-del': (id) => {
      S.remove('relations', id, { silent: true });
      afterSilentEdit(true);
    },
    'rel-flip': (id) => {
      const r = data().relations.find((x) => x.id === id);
      S.upsert('relations', { id, source: r.target, target: r.source }, 'r', { silent: true });
      afterSilentEdit(true);
    },
    'toggle-people-table': () => {
      peopleTableMode = !peopleTableMode;
      renderColaboradores();
    },
    'paste-add': () => {
      const n = pasteList($('#paste-list').value);
      $('#paste-list').value = '';
      toast(`${n} colaborador(es) adicionado(s).`);
    },
    'gh-connect': async () => {
      const cfg = { owner: $('#gh-owner').value, repo: $('#gh-repo').value, path: $('#gh-path').value, branch: $('#gh-branch').value, token: $('#gh-token').value };
      if (!cfg.owner.trim() || !cfg.repo.trim() || !cfg.token.trim()) return toast('Preencha dono, repositório e chave de acesso.');
      toast('Conectando ao GitHub…');
      try {
        const r = await G.connect(cfg);
        toast(r === 'loaded' ? 'Conectado. Dados carregados do GitHub.' : 'Conectado. Dados enviados ao GitHub.');
      } catch (e) {
        G.setStatus('local', e.message);
        toast(e.message);
      }
      renderGitHubCard();
    },
    'gh-save': async () => {
      G.saveState({ dirty: true });
      await G.push();
      toast(G.status === 'saved' ? 'Salvo no GitHub.' : G.error || 'Não foi possível salvar.');
    },
    'gh-reload': async () => {
      if (G.state.dirty && !confirm('Há alterações ainda não enviadas. Recarregar do GitHub e descartá-las?')) return;
      await G.pull();
      toast(G.status === 'saved' ? 'Dados recarregados do GitHub.' : G.error);
    },
    'gh-link': () => {
      const link = G.accessLink();
      $('#gh-link-box').innerHTML = `<div class="link-box"><input id="gh-link-input" readonly value="${esc(link)}"><button data-action="gh-copy">Copiar</button></div>
        <p class="muted small">O link funciona no endereço onde o sistema está publicado. Envie só para quem pode ver estes dados.</p>`;
      $('#gh-link-input').select();
    },
    'gh-copy': async () => {
      const inp = $('#gh-link-input');
      try {
        await navigator.clipboard.writeText(inp.value);
      } catch (e) {
        inp.select();
        document.execCommand('copy');
      }
      toast('Link copiado.');
    },
    'gh-disconnect': () => {
      if (!confirm('Desconectar este navegador do GitHub? Os dados no GitHub continuam lá; aqui fica apenas a cópia local.')) return;
      G.disconnect();
      renderGitHubCard();
    },
    'build-board': () => {
      getBoard();
      renderPainel();
    },
    'edit-dep': (id) => depForm(dep(id)),
    'edit-rel': (id) => relationForm(data().relations.find((r) => r.id === id)),
    'new-rel-from': (id) => relationForm({ source: id, type: 'colaboracao', strength: 3, sentiment: null }),
    'edit-inc': (id) => incidentForm(data().incidents.find((x) => x.id === id)),
    'set-focal': (id) => {
      S.setSettings({ focalId: id });
      toast(`${pname(id)} definida como pessoa focal.`);
    },
    'simulate-person': (id) => {
      simSelection.clear();
      simSelection.add(id);
      setView('simulacao');
      actions['run-sim']();
    },
    'simulate-group': (ids) => {
      simSelection.clear();
      ids.split(',').forEach((x) => simSelection.add(x));
      setView('simulacao');
      actions['run-sim']();
    },
    'run-sim': () => {
      if (!simSelection.size) return toast('Selecione ao menos uma pessoa.');
      simResult = A.simulateRemoval(data(), [...simSelection], model);
      renderSimulation();
    },
    'clear-sim': () => {
      simSelection.clear();
      simResult = null;
      renderSimulation();
    },
    'run-ranking': () => {
      ranking = ranking || A.impactRanking(data(), model);
      renderSimulation();
    },
    'bulk-add': () => {
      const box = $('#bulk-form');
      const src = $('#bulk-person').value;
      const type = $('#bulk-type').value;
      const strength = Number($('#bulk-strength').value);
      const sent = $('#bulk-sent').value;
      const targets = $$('.bulk-grid input:checked', box).map((i) => i.value);
      if (!src || !targets.length) return toast('Escolha a pessoa e marque ao menos um nome.');
      const dup = new Set(data().relations.filter((r) => r.type === type).map((r) => r.source + '>' + r.target));
      const items = targets
        .filter((t) => !dup.has(src + '>' + t) && !(!(A.RELATION_TYPES[type] || {}).directed && dup.has(t + '>' + src)))
        .map((t) => ({ source: src, target: t, type, strength, sentiment: sent === '' ? null : Number(sent), notes: '' }));
      S.addMany('relations', items, 'r');
      toast(`${items.length} relação(ões) adicionada(s).`);
    },
    'save-settings': () => {
      S.setSettings({
        companyName: $('#set-company').value.trim(),
        focalId: $('#set-focal').value || null,
        formalTieStrength: Number($('#set-formal').value),
      });
      toast('Configurações salvas.');
    },
    export: () => {
      const stamp = new Date().toISOString().slice(0, 10);
      download(`mapa-organizacional-${stamp}.json`, S.exportJSON());
    },
    'load-sample': () => {
      if (data().people.length && !confirm('Substituir os dados atuais pelo exemplo fictício? Exporte antes se quiser guardar.')) return;
      selectedId = null;
      lastLayoutKey = '';
      S.replace(window.SAMPLE_DATA);
      toast('Exemplo fictício carregado.');
    },
    'clear-all': () => {
      const where = G.connected ? ' (também no GitHub — a versão anterior fica no histórico)' : '';
      if (!confirm(`Apagar TODOS os dados${where}?`)) return;
      selectedId = null;
      S.reset();
      toast('Dados apagados.');
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    e.preventDefault();
    const fn = actions[el.dataset.action];
    if (fn) fn(el.dataset.id, el, e);
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.closest('#ficha') && t.dataset.field && fichaId) {
      const f = t.dataset.field;
      let v = t.value;
      if (f === 'departmentId' && v === '__new') {
        const name = (prompt('Nome do novo setor:') || '').trim();
        if (!name) return renderFicha();
        const d = S.upsert('departments', { name, color: CLUSTER_PALETTE[data().departments.length % CLUSTER_PALETTE.length] }, 'd', { silent: true });
        return updatePerson({ departmentId: d.id }, true);
      }
      if (f === 'level') v = Number(v);
      else if (f === 'tenure') v = v === '' ? null : Number(v);
      else if (f === 'departmentId' || f === 'managerId') v = v || null;
      else v = v.trim();
      return updatePerson({ [f]: v }, f === 'departmentId');
    }
    if (t.dataset.rel) {
      const f = t.dataset.relfield;
      const v = f === 'type' ? t.value : t.value === '' ? null : Number(t.value);
      S.upsert('relations', { id: t.dataset.rel, [f]: v }, 'r', { silent: true });
      return afterSilentEdit(true);
    }
    if (t.classList.contains('sim-chk')) {
      if (t.checked) simSelection.add(t.value);
      else simSelection.delete(t.value);
    } else if (t.id === 'focal-select') {
      S.setSettings({ focalId: t.value || null });
    } else if (t.id === 'bulk-person' || t.id === 'bulk-type' || t.id === 'bulk-strength' || t.id === 'bulk-sent') {
      const box = $('#bulk-form');
      box.dataset.person = $('#bulk-person').value;
      box.dataset.type = $('#bulk-type').value;
      box.dataset.strength = $('#bulk-strength').value;
      box.dataset.sent = $('#bulk-sent').value;
      if (t.id === 'bulk-person') renderBulkForm();
    } else if (t.id === 'rel-type-filter') {
      renderRelations();
    } else if (['color-by', 'size-by', 'show-pos', 'show-neg', 'show-formal'].includes(t.id)) {
      renderMap();
    } else if (t.id === 'layout') {
      lastLayoutKey = '';
      renderMap();
    } else if (t.id === 'import-json' && t.files[0]) {
      t.files[0].text().then((txt) => {
        try {
          const d = JSON.parse(txt);
          if (!Array.isArray(d.people)) throw new Error('arquivo sem "people"');
          selectedId = null;
          lastLayoutKey = '';
          S.replace(d);
          toast('Dados importados.');
        } catch (err) {
          toast('Arquivo inválido: ' + err.message);
        }
      });
    } else if (t.id === 'import-csv' && t.files[0]) {
      t.files[0].text().then((txt) => toast(`${importCSV(txt)} pessoa(s) importada(s).`));
    }
  });

  $('#rel-filter').addEventListener('input', () => renderRelations());
  $('#cad-search').addEventListener('input', () => renderCadList());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = e.target.id;
    if (id === 'group-input' || id === 'skill-input') {
      e.preventDefault();
      addChip(id === 'group-input' ? 'groups' : 'skills', e.target.value);
    } else if (id === 'link-person') {
      e.preventDefault();
      addLinkFromFicha();
    } else if (e.target.classList.contains('ficha-name')) {
      e.target.blur();
    }
  });
  // Dica (tooltip) da matriz de decisão.
  document.addEventListener('mousemove', (e) => {
    const tip = $('.matrix-tip');
    if (!tip) return;
    const g = e.target.closest && e.target.closest('.pt');
    if (!g) {
      tip.hidden = true;
      return;
    }
    const wrap = tip.parentElement.getBoundingClientRect();
    tip.textContent = g.dataset.tip;
    tip.hidden = false;
    const x = Math.min(e.clientX - wrap.left + 14, wrap.width - tip.offsetWidth - 4);
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = e.clientY - wrap.top + 14 + 'px';
  });
  $('#map-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return highlight(selectedId);
    const p = data().people.find((x) => x.name.toLowerCase().includes(q));
    if (p) selectPerson(p.id);
  });
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
  $('#add-dep').onclick = () => depForm();
  $('#add-rel').onclick = () => relationForm();
  $('#add-inc').onclick = () => incidentForm();

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => currentView === 'mapa' && renderMap());

  S.onChange(() => {
    recompute();
    render();
  });
  recompute();
  setView(data().people.length ? 'painel' : 'colaboradores');
  G.init(S, {
    onStatus: renderSyncStatus,
    confirm: (msg) => confirm(msg),
    onRemoteLoaded: () => {
      selectedId = null;
      lastLayoutKey = '';
      if (fichaId && !person(fichaId)) fichaId = null;
    },
  });
  renderSyncStatus();
})();
