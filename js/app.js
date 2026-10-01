/*
 * app.js — interface: mapa (Cytoscape), cadastros, análises, resistência,
 * simulação de saída e registro de ocorrências.
 */
(function () {
  'use strict';
  const A = window.OrgAnalytics;
  const S = window.Store;

  // Deve ser igual ao ?v= dos arquivos e ao <meta name="app-version"> do index.html.
  const APP_VERSION = '13';
  const pageVersion = (document.querySelector('meta[name="app-version"]') || {}).content;
  if (pageVersion !== APP_VERSION) {
    // Página e scripts de versões diferentes (cache do navegador): recarrega uma vez.
    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem('mapaOrganizacional.reload') === APP_VERSION;
      sessionStorage.setItem('mapaOrganizacional.reload', APP_VERSION);
    } catch (e) {
      reloaded = true;
    }
    if (!reloaded) {
      location.reload();
      return;
    }
    console.warn(`Versão da página (${pageVersion}) diferente da dos scripts (${APP_VERSION}). Recarregue com Ctrl+Shift+R.`);
  }

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

  // Escalas em palavras, para quem não é especialista.
  const SENTIMENT_OPTIONS = [
    ['', 'Clima: normal para o tipo'],
    ['2', 'Clima muito bom'],
    ['1', 'Clima bom'],
    ['0', 'Clima neutro'],
    ['-1', 'Clima tenso'],
    ['-2', 'Clima hostil'],
  ];
  const SENTIMENT_TEXT = { 2: 'clima muito bom', 1: 'clima bom', 0: 'clima neutro', '-1': 'clima tenso', '-2': 'clima hostil' };
  const STRENGTH_OPTIONS = [
    [1, 'Raramente'],
    [2, 'Às vezes'],
    [3, 'Toda semana'],
    [4, 'Quase todo dia'],
    [5, 'Todo dia / muito próximos'],
  ];
  const STRENGTH_TEXT = Object.fromEntries(STRENGTH_OPTIONS);
  const LEVEL_WORDS = ['Muito baixa', 'Baixa', 'Média', 'Alta', 'Muito alta'];
  // Converte um índice de 0 a 1 em palavra (Baixa, Média, Alta…).
  const nivel = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : LEVEL_WORDS[Math.min(4, Math.floor(Math.max(0, v) * 5))]);
  const STANCE_SOURCE_TEXT = {
    informado: 'avaliado por você',
    'relação direta': 'pela relação com o gerente',
    ocorrências: 'pelas ocorrências registradas',
    inferido: 'estimado pelo sistema — confirme',
  };
  function stanceText(m) {
    if (!m) return '';
    if (m.stanceLabel === 'focal') return 'Gerente';
    const v = m.stance;
    if (v === null || v === undefined) return 'Sem informação';
    if (v >= 1.5) return 'Apoia';
    if (v >= 0.75) return 'Tende a apoiar';
    if (v > -0.75) return 'Neutro';
    if (v > -1.5) return 'Tende a resistir';
    return 'Resiste';
  }
  const IMPORTANCE_OPTIONS = [
    [3, 'Essencial'],
    [2, 'Importante'],
    [1, 'Desejável'],
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

  function stanceBadge(m, withSource = true) {
    if (!m) return '';
    const src = withSource && m.stanceSource ? ` <span class="muted small">${esc(STANCE_SOURCE_TEXT[m.stanceSource] || m.stanceSource)}</span>` : '';
    return `<span class="badge st-${m.stanceLabel}">${esc(stanceText(m))}</span>${src}`;
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
  // Barra + palavra (ex.: ▮▮▮▯ Alta) no lugar de números como 0,65.
  const meter = (v, cls) => `${bar(v, cls)} <span class="lvl">${nivel(v)}</span>`;
  // Ícone "?" com explicação ao passar o mouse ou tocar.
  const help = (text) => `<span class="help" tabindex="0" title="${esc(text)}" aria-label="${esc(text)}">?</span>`;
  const kpi = (label, value, hint) =>
    `<div class="kpi"><div class="kpi-v">${value}</div><div class="kpi-l">${esc(label)}</div>${hint ? `<div class="kpi-h">${esc(hint)}</div>` : ''}</div>`;

  function emptyState(msg) {
    return `<div class="empty card"><p>${msg}</p>
      <p><button class="primary" data-action="load-sample">Carregar exemplo fictício</button>
      <button data-action="goto" data-id="colaboradores">Cadastrar colaboradores</button></p></div>`;
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
      conhecimentos: renderConhecimentos,
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
      const names = { apoiador: 'apoia o gerente', neutro: 'neutro', resistente: 'resiste ao gerente', desconhecido: 'sem informação', focal: 'gerente' };
      items = Object.entries(c).map(([k, v]) => [names[k] || k, v]);
    } else if (colorBy === 'group') {
      items = allGroups().map((g, i) => [g, CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]]).concat([['sem grupo', cssVar('--unknown')]]);
    } else if (colorBy === 'community') {
      items = model.communities.map((c) => [`Turma ${c.id + 1} (de ${pname(c.leader)})`, CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length]]);
    } else {
      items = data().departments.map((d) => [d.name, d.color]);
    }
    $('#legend').innerHTML =
      items.map(([l, c]) => `<span><i style="background:${esc(c)}"></i>${esc(l)}</span>`).join('') +
      `<span><i class="ln neg"></i>conflito ou boicote</span><span><i class="ln fam"></i>parentes ou casal</span>` +
      `<span>★ gerente</span><span><i class="ring"></i>única ligação entre partes da equipe</span>` +
      `<span>tamanho do círculo = ${esc(($('#size-by').selectedOptions[0] || {}).text || '').toLowerCase()}</span>`;
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
        return `<li class="${s < 0 ? 'neg-text' : ''}">${dir} ${personLink(other)} <span class="muted small">${esc(t.label.split(' (')[0])} · ${esc((STRENGTH_TEXT[r.strength] || '').toLowerCase())} · ${esc(SENTIMENT_TEXT[s] || '')}</span>
          <button class="link small" data-action="edit-rel" data-id="${esc(r.id)}">editar</button></li>`;
      })
      .join('');
    const sub = data().people.filter((x) => x.managerId === p.id);
    box.innerHTML = `
      <button class="close" data-action="close-detail" aria-label="Fechar">×</button>
      <h3>${esc(p.name)}</h3>
      <p class="muted">${esc(p.role || '')} · ${esc(depName(p.departmentId))} · ${esc(A.LEVELS[p.level] || '')}</p>
      <p>${stanceBadge(m)} ${m.articulation ? '<span class="badge warn">única ligação entre partes da equipe</span>' : ''}</p>
      <table class="mini">
        <tr><td>Desempenho</td><td>${m.performance ? m.performance + ' de 5' : 'não avaliado'}</td></tr>
        <tr><td>Engajamento</td><td>${m.engagement ? m.engagement + ' de 5' : 'não avaliado'}</td></tr>
        <tr><td>Influência ${help('O quanto os colegas ouvem e seguem essa pessoa, pelas relações cadastradas.')}</td><td>${meter(m.influence)} <span class="muted">(${m.influenceRank}ª da empresa)</span></td></tr>
        <tr><td>Importância geral ${help('Junta influência, conhecimento que só ela tem e o cargo.')}</td><td>${meter(m.peso)}</td></tr>
        <tr><td>Faz ponte entre pessoas ${help('O quanto a comunicação entre colegas passa por essa pessoa.')}</td><td>${meter(Math.min(1, m.betweenness * 4))}</td></tr>
        <tr><td>Relações boas</td><td>${m.ties} pessoa(s)</td></tr>
        <tr><td>Conflitos</td><td>${m.negStrength ? 'sim' : 'nenhum'}</td></tr>
        <tr><td>Difícil de substituir ${help('Considera a nota de conhecimento e os conhecimentos que só ela tem.')}</td><td>${meter(m.knowledgeRisk, 'warn')}</td></tr>
        ${m.tension ? `<tr><td>No meio de conflitos ${help('Tem boa relação com duas pessoas que brigam entre si.')}</td><td>${m.tension} situação(ões)</td></tr>` : ''}
        <tr><td>Turma informal ${help('Grupo de pessoas que convivem mais entre si, descoberto pelo sistema.')}</td><td>Turma ${m.community + 1}</td></tr>
        ${inc ? `<tr><td>Ocorrências</td><td>${inc.negative} de boicote/atrito · ${inc.positive} de apoio</td></tr>` : ''}
      </table>
      ${m.uniqueSkills.length ? `<p class="small"><strong>Só esta pessoa sabe:</strong> ${m.uniqueSkills.map(esc).join(', ')}</p>` : ''}
      <p class="small"><strong>Chefe direto:</strong> ${p.managerId ? personLink(p.managerId) : '—'}
      ${sub.length ? `<br><strong>Equipe:</strong> ${sub.map((x) => personLink(x.id)).join(', ')}` : ''}</p>
      <h4>Relações (${rels.length})</h4>
      <ul class="rel-list">${relRows || '<li class="muted">Nenhuma relação cadastrada.</li>'}</ul>
      <div class="btn-row">
        <button data-action="edit-person" data-id="${esc(p.id)}">Abrir ficha</button>
        <button data-action="new-rel-from" data-id="${esc(p.id)}">+ Relação</button>
        <button data-action="simulate-person" data-id="${esc(p.id)}">E se sair?</button>
        ${model.focalId !== p.id ? `<button data-action="set-focal" data-id="${esc(p.id)}">Marcar como gerente</button>` : ''}
      </div>`;
  }

  // ------------------------------------------------------- COLABORADORES
  // Tela de cadastro rápido: lista à esquerda, ficha completa à direita.
  // As alterações da ficha são salvas automaticamente (sem botão "salvar").
  let fichaId = null;
  let peopleTableMode = false;

  const RATINGS = [
    { field: 'performance', label: 'Desempenho', help: 'Entrega resultados? 1 = bem abaixo do esperado, 5 = excelente.', values: [1, 2, 3, 4, 5], low: 'fraco', high: 'excelente' },
    { field: 'knowledge', label: 'Difícil de substituir?', help: 'Quanto tempo e esforço levaria para outra pessoa fazer o que ela faz.', values: [0, 1, 2, 3, 4, 5], low: 'fácil', high: 'muito difícil' },
    { field: 'engagement', label: 'Engajamento', help: 'Veste a camisa? 1 = desmotivado(a), 5 = muito engajado(a).', values: [1, 2, 3, 4, 5], low: 'desmotivado', high: 'engajado' },
    {
      field: 'stance',
      label: 'Postura com o gerente',
      help: 'Como essa pessoa age em relação ao novo gerente. Se não souber, deixe "?" e o sistema estima pelas relações.',
      values: [-2, -1, 0, 1, 2],
      words: { '-2': 'Resiste', '-1': 'Tende a resistir', 0: 'Neutro', 1: 'Tende a apoiar', 2: 'Apoia' },
      signed: true,
    },
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
                  <span class="cad-meta"><span class="dots" title="${g} de 4 notas preenchidas">${'●'.repeat(g)}${'○'.repeat(4 - g)}</span> ${l} relaç${l === 1 ? 'ão' : 'ões'} · ${(p.skills || []).length} conhec.</span>
                </button>`;
              })
              .join('')}</div>`
          )
          .join('')
      : `<p class="muted small pad">${data().people.length ? 'Ninguém encontrado.' : 'Nenhum colaborador ainda.'}</p>`;
  }

  const needsReason = (field, v) => v !== null && v !== '' && (A.GRADE_RULES[field] || { needsReason: [] }).needsReason.includes(Number(v));
  const gradeReason = (p, field) => ((p.gradeNotes || {})[field] || {}).text || '';

  function ratingRow(p, r) {
    const cur = p[r.field];
    const isSet = cur !== null && cur !== undefined && cur !== '';
    const reason = gradeReason(p, r.field);
    let note = '';
    if (isSet && needsReason(r.field, cur)) {
      const when = ((p.gradeNotes || {})[r.field] || {}).date;
      note = reason.trim()
        ? `<div class="grade-note"><span>Motivo: ${esc(reason)}${when ? ` <span class="muted">(${esc(new Date(when + 'T12:00').toLocaleDateString('pt-BR'))})</span>` : ''}</span> <button class="link small" data-action="edit-reason" data-id="${r.field}">editar motivo</button></div>`
        : `<div class="grade-warn">Nota sem motivo: o sistema <strong>não está usando</strong> esta nota. <button class="link small" data-action="edit-reason" data-id="${r.field}">Escrever o motivo</button></div>`;
    }
    const btn = (v) => {
      const label = r.words ? r.words[v] : String(v);
      const tone = r.signed ? (v < 0 ? ' neg' : v > 0 ? ' pos' : '') : '';
      return `<button type="button" class="rate-btn${tone}${isSet && Number(cur) === v ? ' active' : ''}" data-action="rate" data-field="${r.field}" data-value="${v}" aria-pressed="${isSet && Number(cur) === v}">${label}</button>`;
    };
    return `<div class="rating${r.words ? ' words' : ''}">
      <div class="rating-label">${esc(r.label)} ${help(r.help)}</div>
      <div class="rating-scale">
        ${r.words ? '' : `<span class="rating-end">${esc(r.low)}</span>`}
        ${r.values.map(btn).join('')}
        ${r.words ? '' : `<span class="rating-end">${esc(r.high)}</span>`}
        <button type="button" class="rate-btn clear${isSet ? '' : ' active'}" data-action="rate" data-field="${r.field}" data-value="" title="Ainda não sei / não avaliado">?</button>
      </div>
      ${note}
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
          <li><strong>Lista de conhecimentos</strong>: na aba <em>Conhecimentos</em>, monte a lista do que é importante saber na empresa (há uma lista sugerida pronta).</li>
          <li><strong>Colaboradores</strong>: clique em <em>+ Novo colaborador</em> ou cole uma lista de nomes à esquerda.</li>
          <li><strong>Notas</strong>: clique nas opções de desempenho, dificuldade de substituir, engajamento e postura com o gerente.</li>
          <li><strong>Conhecimentos</strong>: marque na lista o que a pessoa sabe fazer.</li>
          <li><strong>Relações</strong>: digite o nome de quem convive com a pessoa, diga o tipo de relação, a frequência e o clima.</li>
          <li>Abra o <strong>Painel</strong> para ver as recomendações.</li>
        </ol>
        <p class="muted small">Tudo é salvo automaticamente. As bolinhas ●○ na lista mostram quantas notas já foram dadas.</p>
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
          <td><select data-rel="${esc(r.id)}" data-relfield="strength">${options(STRENGTH_OPTIONS, r.strength)}</select></td>
          <td><select data-rel="${esc(r.id)}" data-relfield="sentiment">${options([['', 'Normal para o tipo'], ...sentOpts], r.sentiment ?? '')}</select></td>
          <td><button class="link danger-text" data-action="rel-del" data-id="${esc(r.id)}" aria-label="Remover vínculo">remover</button></td>
        </tr>`;
      })
      .join('');

    box.innerHTML = `<div class="card ficha-card">
      <div class="ficha-head">
        <input class="ficha-name" data-field="name" value="${esc(p.name)}" placeholder="Nome do colaborador" aria-label="Nome">
        <div class="ficha-badges">
          ${m ? stanceBadge(m) : ''}
          ${m ? `<span class="badge" title="Posição entre as pessoas mais ouvidas da empresa">${m.influenceRank}ª mais influente</span>` : ''}
        </div>
      </div>

      <div class="grid3">
        <label>Cargo<input data-field="role" value="${esc(p.role)}" placeholder="ex.: Supervisor de produção"></label>
        <label>Setor<select data-field="departmentId">${depOptions(p.departmentId)}<option value="__new">+ Novo setor…</option></select></label>
        <label>Nível do cargo<select data-field="level">${options(Object.entries(A.LEVELS), p.level)}</select></label>
        <label>Chefe direto<select data-field="managerId"><option value="">—</option>${options(others.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => [x.id, x.name]), p.managerId)}</select></label>
        <label>Tempo de casa (anos)<input data-field="tenure" type="number" min="0" step="0.5" value="${esc(p.tenure ?? '')}"></label>
        <div class="field">
          <span class="field-label">Grupos / equipes ${help('Turnos, projetos ou comitês de que a pessoa participa, além do setor.')}</span>
          <div class="chips">${chips(p.groups, 'groups')}<input id="group-input" list="groups-datalist" placeholder="digite e Enter" aria-label="Adicionar grupo"></div>
          <datalist id="groups-datalist">${allGroups().map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
        </div>
      </div>

      <h4>Notas ${help('Deixe "?" até ter certeza. Notas extremas (1, 2 ou 5, e "Resiste"/"Apoia") só valem com um fato escrito que as justifique.')} <span class="grade-count">${gradeCountText(p, m)}</span></h4>
      <div class="ratings">${RATINGS.map((r) => ratingRow(p, r)).join('')}</div>
      <p class="muted small">"?" = ainda não sei. Notas 1, 2 e 5 (e postura "Resiste" ou "Apoia") pedem um motivo: um fato, com o que e quando. Se a postura ficar em "?", o sistema faz uma estimativa e avisa.</p>

      <h4>O que sabe fazer ${help('Marque os conhecimentos da lista. "Só ele(a) sabe" indica um risco: se a pessoa sair, ninguém mais sabe fazer.')}</h4>
      ${knowledgeChecklist(p)}

      <h4>Relações (${links.length}) ${help('Com quem essa pessoa convive no trabalho, com que frequência e se o clima é bom ou ruim.')}</h4>
      <div class="link-add">
        <input id="link-person" list="people-datalist" placeholder="Com quem? (nome)" aria-label="Pessoa">
        <datalist id="people-datalist">${others.map((x) => `<option value="${esc(x.name)}">${esc(depName(x.departmentId))}</option>`).join('')}</datalist>
        <select id="link-type" aria-label="Tipo de relação">${typeOptions(fichaLinkDefaults.type)}</select>
        <select id="link-strength" aria-label="Frequência do contato" title="Com que frequência convivem">${options(STRENGTH_OPTIONS, fichaLinkDefaults.strength)}</select>
        <select id="link-sent" aria-label="Clima da relação">${options(SENTIMENT_OPTIONS, fichaLinkDefaults.sentiment)}</select>
        <button class="primary" data-action="link-add">Adicionar relação</button>
      </div>
      ${links.length ? `<div class="table-wrap"><table class="links"><thead><tr><th>Pessoa</th><th>Tipo de relação</th><th>Frequência</th><th>Clima</th><th></th></tr></thead><tbody>${linkRows}</tbody></table></div>` : '<p class="muted small">Nenhuma relação ainda. Digite um nome acima — se a pessoa não existir, ela é criada.</p>'}

      <label>Observações<textarea data-field="notes" rows="2">${esc(p.notes)}</textarea></label>

      <div class="btn-row">
        <button data-action="open-ficha" data-id="${esc(ids[idx - 1] || '')}" ${idx > 0 ? '' : 'disabled'}>← Anterior</button>
        <button data-action="open-ficha" data-id="${esc(ids[idx + 1] || '')}" ${idx < ids.length - 1 ? '' : 'disabled'}>Próximo →</button>
        <button data-action="new-person">+ Novo colaborador</button>
        <button data-action="duplicate-person" data-id="${esc(p.id)}" title="Criar outra pessoa com cargo, setor, grupos e conhecimentos parecidos">Duplicar</button>
        <span class="spacer"></span>
        <button data-action="select-person" data-id="${esc(p.id)}">Ver no mapa</button>
        <button class="danger" data-action="delete-person" data-id="${esc(p.id)}">Excluir</button>
      </div>
    </div>`;
  }

  // "3 de 4 notas confirmadas · postura estimada"
  function gradeCountText(p, m) {
    if (!m) return '';
    const fields = ['performance', 'engagement', 'knowledge'];
    let ok = fields.filter((f) => m[f] !== null).length;
    let extra = '';
    if (m.stanceSource && m.stanceSource !== 'inferido') ok++;
    else if (m.stanceSource === 'inferido') extra = ' · postura estimada';
    const bad = (m.unjustified || []).length ? ` · ${(m.unjustified || []).length} sem motivo` : '';
    return `<span class="badge${ok === 4 ? ' st-apoiador' : ''}">${ok} de 4 notas confirmadas${extra}${bad}</span>`;
  }

  function askReason(field, value, onDone) {
    const rule = A.GRADE_RULES[field];
    const r = RATINGS.find((x) => x.field === field);
    const label = r && r.words ? r.words[value] : `nota ${value}`;
    const p = person(fichaId);
    openModal(
      `Por que "${label}" em ${rule.label}?`,
      `<p class="muted small">Escreva o fato que justifica a nota: o que aconteceu, quando e qual o resultado. Ex.: "Não bateu a meta em julho, agosto e setembro". Sem motivo, o sistema não usa esta nota.</p>
       <label>Motivo<textarea name="reason" rows="3" required minlength="10">${esc(gradeReason(p, field))}</textarea></label>`,
      (f) => {
        const text = (f.reason || '').trim();
        if (text.length < 10) {
          toast('Escreva um motivo com pelo menos 10 caracteres.');
          return false;
        }
        onDone(text);
      }
    );
  }

  // Relações que fazem sentido copiar: as de trabalho. Amizade, parentes,
  // conflitos e boicotes são pessoais e nunca são copiados.
  const COPYABLE_REL = (r) => !['familiar', 'amizade'].includes(r.type) && A.sentimentOf(r) >= 0;

  function duplicateForm(src) {
    const rels = linksOf(src.id).filter(COPYABLE_REL);
    const skipped = linksOf(src.id).length - rels.length;
    const nSkills = (src.skills || []).length;
    const nGroups = (src.groups || []).length;
    openModal(
      `Duplicar ${src.name || 'colaborador'}`,
      `<p class="muted small">Cria uma nova pessoa a partir da ficha de <strong>${esc(src.name)}</strong>. Depois é só ajustar o que for diferente.</p>
       <label>Nome do novo colaborador<input name="name" required placeholder="Nome completo"></label>
       <fieldset class="dup-opts"><legend>O que copiar</legend>
         <label class="chk"><input type="checkbox" name="job" checked> Cargo, setor, nível e chefe direto <span class="muted small">(${esc(src.role || 'sem cargo')} · ${esc(depName(src.departmentId))})</span></label>
         <label class="chk"><input type="checkbox" name="groups" ${nGroups ? 'checked' : 'disabled'}> Grupos / equipes <span class="muted small">(${nGroups})</span></label>
         <label class="chk"><input type="checkbox" name="skills" ${nSkills ? 'checked' : 'disabled'}> Conhecimentos marcados <span class="muted small">(${nSkills})</span></label>
         <label class="chk"><input type="checkbox" name="rels" ${rels.length ? '' : 'disabled'}> Relações de trabalho com as mesmas pessoas <span class="muted small">(${rels.length})</span></label>
       </fieldset>
       <p class="muted small"><strong>Não são copiados:</strong> as notas (desempenho, engajamento, postura e difícil de substituir), porque são avaliações individuais e devem ser dadas só com certeza; as observações${skipped ? `; e ${skipped} relação(ões) pessoal(is) — amizades, parentes, conflitos ou boicotes` : ''}.</p>`,
      (f) => {
        const name = (f.name || '').trim();
        if (!name) {
          toast('Digite o nome do novo colaborador.');
          return false;
        }
        if (findPersonByName(name) && findPersonByName(name).name.toLowerCase() === name.toLowerCase() && !confirm(`Já existe "${name}". Criar mesmo assim?`)) return false;
        const p = S.upsert(
          'people',
          {
            name,
            role: f.job ? src.role || '' : '',
            departmentId: f.job ? src.departmentId || null : null,
            level: f.job ? src.level || 2 : 2,
            managerId: f.job ? src.managerId || null : null,
            tenure: null,
            knowledge: null,
            performance: null,
            engagement: null,
            stance: null,
            gradeNotes: {},
            skills: f.skills ? [...(src.skills || [])] : [],
            groups: f.groups ? [...(src.groups || [])] : [],
            notes: '',
          },
          'p',
          { silent: true }
        );
        if (f.rels) {
          const items = rels.map((r) => ({
            source: r.source === src.id ? p.id : r.source,
            target: r.target === src.id ? p.id : r.target,
            type: r.type,
            strength: r.strength,
            sentiment: r.sentiment ?? null,
            notes: '',
          }));
          S.addMany('relations', items, 'r', { silent: true });
        }
        recompute();
        openFicha(p.id);
        toast(`${name} criado(a) a partir de ${src.name}. Dê as notas só quando tiver certeza.`);
      }
    );
    const inp = $('#modal-form [name="name"]');
    if (inp) inp.focus();
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
      { name: name || '', role: '', departmentId: cur ? cur.departmentId : null, level: 2, managerId: null, knowledge: null, performance: null, engagement: null, stance: null, skills: [], groups: [], notes: '' },
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
    if (dup) return toast('Essa relação já existe — ajuste-a na lista abaixo.');
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
    toast(`Relação com ${other.name} adicionada.`);
  }

  function addChip(kind, value) {
    const v = value.trim();
    if (!v) return;
    const p = person(fichaId);
    const list = (p[kind] || []).slice();
    if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
    updatePerson({ [kind]: list }, true);
    const inp = $('#group-input');
    if (inp) inp.focus();
  }

  // ---------------------------------------------- conhecimentos (checklist)
  let knFilter = '';
  const knowledge = () => data().knowledge || [];
  const knHolders = (id) => data().people.filter((x) => (x.skills || []).includes(id));
  const IMPORTANCE_TEXT = Object.fromEntries(IMPORTANCE_OPTIONS);
  const knCategories = () =>
    [...new Set([...knowledge().map((k) => k.category || 'Outros'), ...Object.keys(window.KNOWLEDGE_SUGGESTIONS || {}), 'Outros'])].sort((a, b) => a.localeCompare(b));
  const byCategory = (list) => {
    const map = new Map();
    for (const k of list.slice().sort((a, b) => (b.importance || 2) - (a.importance || 2) || a.name.localeCompare(b.name))) {
      const c = k.category || 'Outros';
      if (!map.has(c)) map.set(c, []);
      map.get(c).push(k);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  function knowledgeChecklist(p) {
    const list = knowledge();
    if (!list.length) {
      return `<div class="kn-empty">A lista de conhecimentos ainda está vazia.
        <button class="primary" data-action="kn-suggest">Usar a lista sugerida</button>
        <button data-action="goto" data-id="conhecimentos">Montar minha lista</button></div>`;
    }
    const mine = new Set(p.skills || []);
    const groups = byCategory(list)
      .map(
        ([cat, items]) => `<fieldset class="kn-cat"><legend>${esc(cat)}</legend>${items
          .map((k) => {
            const n = knHolders(k.id).length;
            const has = mine.has(k.id);
            const flag = has && n === 1 ? '<span class="kn-flag only">só ele(a) sabe</span>' : n && !has ? `<span class="kn-flag">${n} sabe${n > 1 ? 'm' : ''}</span>` : has && n > 1 ? `<span class="kn-flag">+${n - 1}</span>` : '';
            const hidden = knFilter && !k.name.toLowerCase().includes(knFilter) ? ' hidden' : '';
            return `<label class="kn-item imp-${k.importance || 2}"${hidden}><input type="checkbox" data-kn="${esc(k.id)}"${has ? ' checked' : ''}>
              <span class="kn-name">${esc(k.name)}</span>${k.importance === 3 ? '<span class="kn-ess" title="Conhecimento essencial">essencial</span>' : ''}${flag}</label>`;
          })
          .join('')}</fieldset>`
      )
      .join('');
    return `<div class="kn-box">
      <div class="kn-tools">
        <input id="kn-filter" type="search" placeholder="Procurar conhecimento…" value="${esc(knFilter)}" aria-label="Procurar conhecimento">
        <span class="muted small">${mine.size} marcado(s) de ${list.length}</span>
      </div>
      <div class="kn-grid">${groups}</div>
      <div class="kn-add">
        <input id="kn-new-name" placeholder="Não está na lista? Digite o conhecimento…" aria-label="Novo conhecimento">
        <select id="kn-new-cat" aria-label="Categoria">${options(knCategories().map((c) => [c, c]), 'Outros')}</select>
        <button data-action="kn-add-ficha">Incluir na lista e marcar</button>
      </div>
    </div>`;
  }

  function addKnowledge(name, category, importance) {
    const n = name.trim();
    if (!n) return null;
    const found = knowledge().find((k) => k.name.trim().toLowerCase() === n.toLowerCase());
    if (found) return found;
    return S.upsert('knowledge', { name: n, category: category || 'Outros', importance: Number(importance) || 2 }, 'k', { silent: true });
  }

  function addSuggestedKnowledge() {
    let added = 0;
    for (const [cat, names] of Object.entries(window.KNOWLEDGE_SUGGESTIONS || {})) {
      for (const n of names) {
        if (!knowledge().some((k) => k.name.toLowerCase() === n.toLowerCase())) {
          addKnowledge(n, cat, 2);
          added++;
        }
      }
    }
    return added;
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
        knowledge: null,
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
      { key: 'performance', label: 'Desempenho', sort: (r) => Number(r.p.performance) || 0, render: (r) => grade(r.p.performance) },
      { key: 'knowledge', label: 'Difícil substituir', sort: (r) => Number(r.p.knowledge) || 0, render: (r) => grade(r.p.knowledge) },
      { key: 'engagement', label: 'Engajamento', sort: (r) => Number(r.p.engagement) || 0, render: (r) => grade(r.p.engagement) },
      { key: 'skills', label: 'Conhecimentos', sort: (r) => (r.p.skills || []).length, render: (r) => (r.p.skills || []).length },
      { key: 'stance', label: 'Postura', sort: (r) => r.m.stance ?? -9, render: (r) => stanceBadge(r.m, false) },
      { key: 'links', label: 'Relações', sort: (r) => linksOf(r.p.id).length, render: (r) => linksOf(r.p.id).length },
      { key: 'influence', label: 'Influência', sort: (r) => r.m.influence, render: (r) => meter(r.m.influence) },
      { key: 'peso', label: 'Importância geral', sort: (r) => r.m.peso, render: (r) => meter(r.m.peso) },
    ];
    $('#people-table').innerHTML = data().people.length
      ? table('people', cols, rows, { key: 'peso', dir: 'desc' })
      : emptyState('Nenhum colaborador cadastrado.');
  }

  // ------------------------------------------------------- CONHECIMENTOS
  function renderConhecimentos() {
    const box = $('#knowledge-panel');
    const list = knowledge();
    const counts = new Map(list.map((k) => [k.id, knHolders(k.id)]));
    const nobody = list.filter((k) => counts.get(k.id).length === 0).length;
    const onlyOne = list.filter((k) => counts.get(k.id).length === 1).length;
    const essRisk = list.filter((k) => k.importance === 3 && counts.get(k.id).length <= 1).length;
    const coverage = (n) =>
      n === 0 ? '<span class="cov cov-0">ninguém sabe</span>' : n === 1 ? '<span class="cov cov-1">só 1 pessoa</span>' : n === 2 ? '<span class="cov cov-2">2 pessoas</span>' : `<span class="cov cov-3">${n} pessoas</span>`;
    const rows = byCategory(list)
      .map(
        ([cat, items]) => `<tbody><tr class="kn-cat-row"><th colspan="5">${esc(cat)} <span class="muted">(${items.length})</span></th></tr>${items
          .map((k) => {
            const hs = counts.get(k.id);
            return `<tr>
              <td><input class="kn-edit" data-kid="${esc(k.id)}" data-kfield="name" value="${esc(k.name)}" aria-label="Nome do conhecimento"></td>
              <td><select data-kid="${esc(k.id)}" data-kfield="importance" aria-label="Importância">${options(IMPORTANCE_OPTIONS, k.importance || 2)}</select></td>
              <td>${coverage(hs.length)}</td>
              <td class="small">${hs.map((p) => `<a href="#" data-action="open-ficha" data-id="${esc(p.id)}">${esc(p.name)}</a>`).join(', ') || '<span class="muted">—</span>'}</td>
              <td><select data-kid="${esc(k.id)}" data-kfield="category" aria-label="Categoria">${options(knCategories().map((c) => [c, c]), k.category || 'Outros')}</select>
                <button class="link danger-text" data-action="kn-del" data-id="${esc(k.id)}">excluir</button></td>
            </tr>`;
          })
          .join('')}</tbody>`
      )
      .join('');
    box.innerHTML = `
      <div class="card">
        <h3>Montar a lista</h3>
        <p class="muted small">Cadastre aqui o que é importante saber na empresa (sistemas, clientes, processos, máquinas…). Depois, na ficha de cada colaborador, basta marcar o que ele sabe.</p>
        <div class="kn-new">
          <input id="kn-cat-name" placeholder="Nome do conhecimento (ex.: Operar a injetora 2)" aria-label="Nome do conhecimento">
          <select id="kn-cat-category" aria-label="Categoria">${options(knCategories().map((c) => [c, c]), 'Outros')}</select>
          <select id="kn-cat-importance" aria-label="Importância">${options(IMPORTANCE_OPTIONS, 2)}</select>
          <button class="primary" data-action="kn-add">Adicionar</button>
        </div>
        <div class="btn-row">
          <button data-action="kn-suggest">${list.length ? 'Completar com a lista sugerida' : 'Usar a lista sugerida (pronta para começar)'}</button>
          <button data-action="kn-newcat">+ Nova categoria</button>
        </div>
        <p class="muted small"><strong>Importância:</strong> <em>Essencial</em> = sem isso a empresa para ou perde dinheiro; <em>Importante</em> = faz falta, mas dá para contornar; <em>Desejável</em> = ajuda, mas não é crítico.</p>
      </div>
      ${
        list.length
          ? `<div class="kpis">
              ${kpi('Conhecimentos na lista', list.length)}
              ${kpi('Só 1 pessoa sabe', onlyOne, 'se ela sair, a empresa perde')}
              ${kpi('Ninguém marcou', nobody, 'ou ninguém sabe, ou falta marcar nas fichas')}
              ${kpi('Essenciais em risco', essRisk, 'essenciais com 1 pessoa ou nenhuma')}
            </div>
            <div class="card"><h3>Quem sabe o quê</h3>
              <div class="table-wrap"><table class="kn-table"><thead><tr><th>Conhecimento</th><th>Importância</th><th>Quantos sabem</th><th>Quem sabe</th><th>Categoria</th></tr></thead>${rows}</table></div>
            </div>`
          : ''
      }`;
  }

  // --------------------------------------------------------------- PAINEL
  let board = null;
  const BOARD_ORDER = ['cuidado', 'trazer', 'influente', 'reter', 'cortar', 'aliado'];
  const TONE_LABEL = {
    critico: 'Risco alto',
    cuidado: 'Atenção',
    cortar: 'Dá para cortar',
    trazer: 'Conquistar',
    reter: 'Não perder',
    aliado: 'Aliado',
    normal: 'Sem alerta',
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
      box.innerHTML = emptyState('Cadastre ao menos 3 colaboradores com suas relações para ver o painel.');
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
      : '<p class="notice-inline">Escolha ao lado <strong>quem é o gerente</strong>. Sem isso, o sistema não sabe quem apoia e quem resiste.</p>';

    const item = (cat, p) => {
      const reasons = p.reasons[cat];
      const pp = person(p.id);
      return `<li>
        <div class="row-top">${personLink(p.id)} <span class="muted small">${esc(pp.role || '')}${pp.role ? ' · ' : ''}${esc(depName(pp.departmentId))}</span></div>
        <div class="small">${esc(reasons[0])}</div>
        ${basisLine(p.basis)}
        ${reasons.length > 1 ? `<details class="more"><summary>mais ${reasons.length - 1} motivo${reasons.length > 2 ? 's' : ''}</summary><ul>${reasons.slice(1).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      </li>`;
    };
    const conf = b.lists.confirmar || [];
    const confirmStrip = conf.length
      ? `<div class="card confirm-strip">
          <h3>Confirmar postura <span class="count">${conf.length}</span> ${help(A.DECISION_CATEGORIES.confirmar.hint)}</h3>
          <p class="muted small">O sistema só <strong>estimou</strong> a postura destas pessoas, a partir de quem convive com elas. Por isso elas não aparecem em "Atenção" nem em "Aliados". Observe e, quando tiver certeza, marque a postura na ficha.</p>
          <ul class="confirm-list">${conf.map((p) => `<li><a href="#" data-action="open-ficha" data-id="${esc(p.id)}">${esc(pname(p.id))}</a> <span class="muted small">— ${esc(p.reasons.confirmar[0])}</span></li>`).join('')}</ul>
        </div>`
      : '';
    const gaps = [];
    if (b.missingPerformance) gaps.push(`${b.missingPerformance} sem nota de desempenho`);
    if (b.estimatedStance) gaps.push(`${b.estimatedStance} com postura só estimada`);
    if (b.unjustifiedCount) gaps.push(`${b.unjustifiedCount} com nota extrema sem motivo (ignorada)`);
    const gapsNote = gaps.length
      ? `<p class="notice-inline small">Base das recomendações: ${esc(gaps.join(' · '))}. Quanto mais notas confirmadas, mais confiável o painel. Em cada pessoa aparece em quantas notas a recomendação se apoia.</p>`
      : '';
    const cards = BOARD_ORDER.map((cat) => {
      const info = A.DECISION_CATEGORIES[cat];
      const list = b.lists[cat];
      let extra = '';
      if (cat === 'cortar') {
        if (b.missingPerformance) extra += `<p class="small warn-text">${b.missingPerformance} pessoa(s) ainda sem nota de desempenho. Dê as notas na ficha para este quadro ficar confiável.</p>`;
        if (b.lowImpactWithoutGrades.length) extra += `<p class="small muted">A saída teria pouco impacto, mas faltam notas: ${b.lowImpactWithoutGrades.map(personLink).join(', ')}</p>`;
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
        { key: 'tone', label: 'Situação', sort: (r) => BOARD_TONES.indexOf(r.tone), render: (r) => `<span class="tone tone-${r.tone}">${esc(TONE_LABEL[r.tone])}</span>` },
        { key: 'action', label: 'O que fazer', nosort: true, render: (r) => `<span class="small">${esc(r.action)}</span>` },
        { key: 'influence', label: 'Influência', render: (r) => meter(r.influence) },
        { key: 'exitCost', label: 'Impacto se sair', render: (r) => `<span class="nowrap">${bar(r.exitCost / 100, 'warn')} ${Math.round(r.exitCost)} de 100</span>` },
        { key: 'performance', label: 'Desempenho', sort: (r) => r.performance ?? -1, render: (r) => (r.performance ? r.performance + ' de 5' : '—') },
        { key: 'stance', label: 'Postura', sort: (r) => r.stance ?? -9, render: (r) => stanceBadge(model.byId.get(r.id)) },
        { key: 'basis', label: 'Base', title: 'Quantas das 4 notas sustentam a recomendação', sort: (r) => r.basis.confirmed.length, render: (r) => basisLine(r.basis, true) },
      ],
      b.people,
      { key: 'tone', dir: 'asc' }
    );

    box.innerHTML = `
      <div class="card painel-top">
        <label class="inline">Quem é o gerente?
          <select id="focal-select">${peopleOptions(model.focalId, 'Selecione…')}</select></label>
        ${focalNote}
      </div>
      ${HOW_TO_READ}
      ${gapsNote}
      ${confirmStrip}
      <div class="board">${cards}</div>
      <div class="card">
        <h3>Mapa de decisão ${help('Cada bolinha é uma pessoa. Quanto mais à direita, maior o impacto se ela sair. Quanto mais para baixo, mais ela resiste ao gerente. Bolinhas grandes são pessoas muito ouvidas.')}</h3>
        <p class="muted small">→ quanto mais à direita, mais a empresa sente se a pessoa sair. ↓ quanto mais para baixo, mais resiste ao gerente. Bolinha grande = pessoa muito ouvida. Passe o mouse para ver detalhes; clique para abrir no mapa.</p>
        ${matrixSvg(b)}
      </div>
      <div class="card">
        <h3>O que fazer com cada pessoa</h3>
        ${tableHtml}
      </div>
      <p class="muted small">As recomendações ajudam a decidir, mas não substituem a conversa e o bom senso. Antes de qualquer desligamento: retorno claro à pessoa, metas com prazo e orientação jurídica. Ser parente ou casado com alguém nunca é motivo de demissão.</p>`;
  }
  // "base: 3 notas confirmadas · 1 estimada · faltam: Desempenho"
  function basisLine(basis, compact) {
    if (!basis) return '';
    const c = basis.confirmed.length;
    const tip = [
      basis.confirmed.length ? 'Confirmadas: ' + basis.confirmed.join(', ') : '',
      basis.estimated.length ? 'Estimadas: ' + basis.estimated.join(', ') : '',
      basis.missing.length ? 'Faltam: ' + basis.missing.join(', ') : '',
      basis.unjustified.length ? 'Sem motivo (ignoradas): ' + basis.unjustified.join(', ') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const tone = c >= 3 ? 'ok' : c >= 2 ? 'mid' : 'low';
    const text = compact ? `${c} de 4` : `base: ${c} de 4 notas confirmadas${basis.estimated.length ? ' · postura estimada' : ''}`;
    return `<div class="basis basis-${tone}" title="${esc(tip)}">${esc(text)}</div>`;
  }

  const BOARD_TONES = ['critico', 'cuidado', 'cortar', 'trazer', 'reter', 'aliado', 'normal'];

  // Explicação em linguagem simples, mostrada no topo do painel.
  const HOW_TO_READ = `<details class="card how-to" open>
    <summary><strong>Como ler este painel</strong> <span class="muted small">(clique para esconder)</span></summary>
    <div class="how-grid">
      <div><strong>Influência</strong><p>O quanto os colegas ouvem e seguem a pessoa. Vem das relações cadastradas, não do cargo.</p></div>
      <div><strong>Impacto se sair</strong><p>De 0 a 100: o quanto a empresa sentiria a saída. Considera o que só ela sabe, quantas pessoas dependem dela, se ela liga equipes e se colegas próximos podem sair junto.</p></div>
      <div><strong>Postura com o gerente</strong><p>Apoia, neutro ou resiste. Vem da sua avaliação, das relações com o gerente ou das ocorrências registradas. Quando aparece "estimado pelo sistema", é um palpite: confirme antes de agir.</p></div>
      <div><strong>Grupo de resistência</strong><p>Pessoas que resistem ao gerente e são próximas entre si. Juntas, elas têm mais força para atrapalhar.</p></div>
    </div>
  </details>`;

  function matrixSvg(b) {
    const W = 860;
    const H = 440;
    const m = { l: 118, r: 24, t: 40, b: 66 };
    const maxCost = Math.max(40, ...b.people.map((p) => p.exitCost)) * 1.08;
    const X = (v) => m.l + (v / maxCost) * (W - m.l - m.r);
    // Margem de 0,3 acima e abaixo para os círculos nos extremos não serem cortados.
    const Y = (v) => m.t + ((2.3 - v) / 4.6) * (H - m.t - m.b);
    const cut = b.thresholds.hiCost;
    const xt = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].filter((v) => v <= maxCost);
    const yt = [
      [2, 'Apoia'],
      [1, 'Tende a apoiar'],
      [0, 'Neutro'],
      [-1, 'Tende a resistir'],
      [-2, 'Resiste'],
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
          `${pname(p.id)} · ${depName(person(p.id).departmentId)}\nImpacto se sair: ${Math.round(p.exitCost)} de 100 · Postura: ${stanceText(model.byId.get(p.id))} · Influência: ${nivel(p.influence).toLowerCase()}\n${p.action}`
        )}">
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" class="dot-${p.stanceLabel}${p.stance === null ? ' hollow' : ''}"></circle>
          <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(r, 12).toFixed(1)}" class="hit"></circle>
          ${labelled.has(p.id) ? `<text x="${(cx + r + 4).toFixed(1)}" y="${(cy + 4).toFixed(1)}" class="pt-label">${esc(first)}</text>` : ''}
        </g>`;
      })
      .join('');
    const legend = [
      ['apoiador', 'apoia o gerente'],
      ['neutro', 'neutro'],
      ['resistente', 'resiste ao gerente'],
    ]
      .map(([k, l]) => `<span><i class="lg-dot dot-${k}"></i>${l}</span>`)
      .join('');
    return `<div class="matrix-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="matrix" role="img" aria-label="Mapa de decisão: impacto se a pessoa sair por postura com o gerente">
        <rect x="${X(cut)}" y="${Y(0)}" width="${X(maxCost) - X(cut)}" height="${Y(-2.3) - Y(0)}" class="zone-risk"></rect>
        ${xt.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="${Y(2.3)}" y2="${H - m.b}" class="grid"></line><text x="${X(v)}" y="${H - m.b + 16}" class="tick" text-anchor="middle">${v}</text>`).join('')}
        ${yt.map(([v, l]) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid${v === 0 ? ' zero' : ''}"></line><text x="${m.l - 6}" y="${Y(v) + 4}" class="tick" text-anchor="end">${l}</text>`).join('')}
        <line x1="${X(cut)}" x2="${X(cut)}" y1="${m.t}" y2="${H - m.b}" class="cut"></line>
        <text x="${W - m.r}" y="${m.t - 12}" class="quad" text-anchor="end">↗ Pilares: manter e valorizar</text>
        <text x="${m.l}" y="${m.t - 12}" class="quad">↖ Apoiam e são mais fáceis de repor</text>
        <text x="${W - m.r}" y="${H - 6}" class="quad" text-anchor="end">Risco alto: resistem e fazem falta ↘</text>
        <text x="${m.l}" y="${H - 6}" class="quad">↙ Resistem, mas fazem pouca falta</text>
        <text x="${(m.l + W - m.r) / 2}" y="${H - m.b + 36}" class="axis" text-anchor="middle">Impacto se a pessoa sair (0 = nenhum · 100 = enorme)</text>
        ${pts}
      </svg>
      <div class="matrix-tip" hidden></div>
      <div class="legend">${legend}<span>bolinha maior = pessoa mais ouvida</span><span><i class="lg-dot hollow-lg"></i>postura desconhecida</span><span><i class="ln-cut"></i>a partir da linha tracejada, o impacto é alto</span></div>
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
      { key: 'density', label: 'União da equipe', title: 'Quantos colegas do setor convivem entre si (100% = todos com todos)', render: (r) => `${bar(r.density)} ${pct(r.density)}` },
      { key: 'openness', label: 'Contato com outras áreas', title: 'Parte das relações do setor que é com outras áreas', render: (r) => `${bar(r.openness)} ${pct(r.openness)}` },
      { key: 'negativeTies', label: 'Conflitos' },
      { key: 'avgPerformance', label: 'Desempenho médio', render: (r) => (r.avgPerformance === null ? '—' : fx(r.avgPerformance, 1) + ' de 5') },
      { key: 'avgStance', label: 'Postura média', render: (r) => esc(stanceText({ stance: r.avgStance })) },
      { key: 'conn', label: 'Quem liga às outras áreas', nosort: true, render: (r) => r.connectors.map((c) => personLink(c.id)).join(', ') || '—' },
      { key: 'act', label: '', nosort: true, render: (r) => `<button class="link" data-action="edit-dep" data-id="${esc(r.id)}">editar</button>` },
    ];
    $('#dep-table').innerHTML = data().departments.length
      ? table('deps', cols, rows, { key: 'size', dir: 'desc' })
      : emptyState('Crie os setores (ex.: Operações, Comercial, Financeiro).');
    const gcols = [
      { key: 'name', label: 'Grupo / equipe' },
      { key: 'size', label: 'Pessoas' },
      { key: 'members', label: 'Membros', nosort: true, render: (r) => r.members.map(personLink).join(', ') },
      { key: 'density', label: 'União da equipe', render: (r) => `${bar(r.density)} ${pct(r.density)}` },
      { key: 'negativeTies', label: 'Conflitos' },
      { key: 'avgPerformance', label: 'Desempenho médio', render: (r) => (r.avgPerformance === null ? '—' : fx(r.avgPerformance, 1) + ' de 5') },
      { key: 'avgStance', label: 'Postura média', render: (r) => esc(stanceText({ stance: r.avgStance })) },
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
      { key: 'source', label: 'Pessoa', sort: (r) => pname(r.source), render: (r) => personLink(r.source) },
      { key: 'type', label: 'Relação', sort: (r) => r.type, render: (r) => esc((A.RELATION_TYPES[r.type] || { label: r.type }).label) },
      { key: 'target', label: 'Com quem', sort: (r) => pname(r.target), render: (r) => personLink(r.target) },
      { key: 'strength', label: 'Frequência', sort: (r) => Number(r.strength), render: (r) => esc(STRENGTH_TEXT[r.strength] || '') },
      {
        key: 'sentiment', label: 'Clima', sort: (r) => A.sentimentOf(r),
        render: (r) => {
          const s = A.sentimentOf(r);
          return `<span class="${s < 0 ? 'neg-text' : ''}">${esc(SENTIMENT_TEXT[s] || '')}</span>`;
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
        <label>Tipo de relação<select id="bulk-type">${typeOptions(box.dataset.type || 'colaboracao')}</select></label>
        <label>Frequência<select id="bulk-strength">${options(STRENGTH_OPTIONS, box.dataset.strength || 3)}</select></label>
        <label>Clima<select id="bulk-sent">${options(SENTIMENT_OPTIONS, box.dataset.sent || '')}</select></label>
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
             <p class="muted small">Em "influencia", "ensina", "passa informações" e "boicota", a pessoa escolhida acima é quem faz a ação.</p>
             <button class="primary" data-action="bulk-add">Adicionar relações marcadas</button>`
          : '<p class="muted">Escolha uma pessoa e marque, de uma vez, com quem ela trabalha, de quem é amiga, com quem tem conflito…</p>'
      }`;
  }

  function relationForm(r) {
    r = r || { type: 'colaboracao', strength: 3, sentiment: null };
    openModal(
      r.id ? 'Editar relação' : 'Nova relação',
      `
      <div class="grid2">
        <label>Pessoa<select name="source" required>${peopleOptions(r.source, 'Selecione…')}</select></label>
        <label>Com quem<select name="target" required>${peopleOptions(r.target, 'Selecione…')}</select></label>
      </div>
      <label>Tipo de relação<select name="type">${typeOptions(r.type)}</select></label>
      <div class="grid2">
        <label>Frequência<select name="strength">${options(STRENGTH_OPTIONS, r.strength)}</select></label>
        <label>Clima<select name="sentiment">${options(SENTIMENT_OPTIONS, r.sentiment ?? '')}</select></label>
      </div>
      <label>Observações (o que você viu)<textarea name="notes" rows="2">${esc(r.notes)}</textarea></label>`,
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
  const PAIR_TAGS = {
    'ponte única': 'única ligação',
    'entre departamentos': 'liga setores',
    'vínculo familiar': 'parentes/casal',
    'núcleo de resistência': 'grupo de resistência',
    'acesso à pessoa focal': 'acesso ao gerente',
  };
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
      { key: 'influence', label: 'Influência', title: 'O quanto os colegas ouvem e seguem a pessoa', render: (r) => meter(r.influence) },
      { key: 'peso', label: 'Importância geral', title: 'Influência + conhecimento que só ela tem + cargo', render: (r) => meter(r.peso) },
      { key: 'betweenness', label: 'Faz ponte', title: 'O quanto a comunicação entre colegas passa por ela', render: (r) => meter(Math.min(1, r.betweenness * 4)) },
      { key: 'ties', label: 'Relações boas' },
      { key: 'knowledgeRisk', label: 'Difícil de substituir', render: (r) => meter(r.knowledgeRisk, 'warn') },
      { key: 'tension', label: 'No meio de conflitos', render: (r) => (r.tension ? r.tension : '—') },
      { key: 'community', label: 'Turma', render: (r) => r.community + 1 },
      { key: 'stance', label: 'Postura', sort: (r) => r.stance ?? -9, render: (r) => stanceBadge(r, false) },
    ];

    box.innerHTML = `
      <div class="kpis">
        ${kpi('Pessoas', model.n)}
        ${kpi('Relações cadastradas', data().relations.length)}
        ${kpi('Nível de convivência', pct(model.density), 'das duplas possíveis se relacionam')}
        ${kpi('Turmas informais', model.communities.length, 'grupos que convivem mais entre si')}
        ${kpi('Divisão em panelas', model.modularity > 0.4 ? 'Forte' : model.modularity > 0.25 ? 'Moderada' : 'Fraca', 'quanto as turmas são separadas')}
        ${kpi('Grupos isolados', model.components - 1, model.components > 1 ? 'sem nenhuma relação com o resto' : 'todos estão conectados')}
      </div>

      <div class="card">
        <h3>Recomendações</h3>
        ${recs.length ? `<ul class="recs">${recs.map((r) => `<li class="lvl-${esc(r.level)}"><span class="badge">${esc(r.area)}</span> ${esc(r.text)}</li>`).join('')}</ul>` : '<p class="muted">Sem alertas no momento.</p>'}
      </div>

      <div class="card">
        <h3>Quem é quem ${help('Clique no título de uma coluna para ordenar.')}</h3>
        ${table('ranking', rankingCols, M, { key: 'peso', dir: 'desc' })}
      </div>

      <div class="card">
        <h3>Turmas informais (as "panelas")</h3>
        <p class="muted small">Grupos de pessoas que convivem mais entre si do que com o resto, descobertos pelo sistema a partir das relações. Turmas que misturam setores mostram onde o trabalho realmente acontece. Uma turma com postura média de resistência é um foco de oposição.</p>
        <div class="cards">${model.communities
          .map(
            (c) => `<div class="mini-card" style="border-left-color:${CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length]}">
              <strong>Turma ${c.id + 1}</strong> · quem lidera: ${personLink(c.leader)}<br>
              <span class="small muted">${c.members.length} pessoas · ${c.departments} setor(es) · postura média: ${esc(stanceText({ stance: c.avgStance }).toLowerCase())}</span>
              <div class="small">${c.members.map(personLink).join(', ')}</div></div>`
          )
          .join('')}</div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>Duplas importantes</h3>
          <p class="muted small">Relações por onde passa muita comunicação, entre pessoas ouvidas. Se uma dessas duplas brigar ou uma pessoa sair, a informação deixa de circular.</p>
          ${table('pairs', [
            { key: 'pair', label: 'Dupla', nosort: true, render: (r) => `${personLink(r.a)} ↔ ${personLink(r.b)}` },
            { key: 'score', label: 'Importância', render: (r) => meter(r.score) },
            { key: 'tags', label: 'Observações', nosort: true, render: (r) => r.tags.map((t) => `<span class="badge small">${esc(PAIR_TAGS[t] || t)}</span>`).join(' ') },
          ], model.keyPairs.slice(0, 15), { key: 'score', dir: 'desc' })}
        </div>
        <div class="card">
          <h3>Conflitos mais sérios</h3>
          <p class="muted small">Brigas mais intensas entre pessoas mais ouvidas aparecem primeiro.</p>
          ${table('conflicts', [
            { key: 'pair', label: 'Dupla', nosort: true, render: (r) => `${personLink(r.a)} ✕ ${personLink(r.b)}` },
            { key: 'score', label: 'Gravidade', render: (r) => meter(Math.min(1, r.score / Math.max(1e-9, model.conflicts[0].score)), 'bad') },
            { key: 'f', label: '', nosort: true, render: (r) => (r.involvesFocal ? '<span class="badge st-focal">envolve o gerente</span>' : '') },
          ], model.conflicts.slice(0, 15), { key: 'score', dir: 'desc' })}
        </div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>Cargo × influência real</h3>
          <p class="muted small">Nem sempre quem tem o cargo mais alto é quem os colegas mais ouvem.</p>
          <h4>Líderes informais: ouvidos além do cargo</h4>
          <ul>${informal.map((s) => `<li>${personLink(s.id)} — é a ${s.influenceRank}ª pessoa mais ouvida, mas o cargo está em ${s.formalRank}º lugar</li>`).join('') || '<li class="muted">Nenhum destaque.</li>'}</ul>
          <h4>Cargo alto, pouca influência</h4>
          <ul>${formalOnly.map((s) => `<li>${personLink(s.id)} — cargo em ${s.formalRank}º lugar, mas é só a ${s.influenceRank}ª mais ouvida</li>`).join('') || '<li class="muted">Nenhum destaque.</li>'}</ul>
        </div>
        <div class="card">
          <h3>Dependências perigosas</h3>
          <h4>Únicas ligações entre partes da equipe</h4>
          <p class="muted small">Se estas pessoas saírem, alguns colegas ficam sem contato com o resto da empresa.</p>
          <p>${model.articulationPoints.map(personLink).join(', ') || '<span class="muted">Nenhuma — a rede tem caminhos alternativos.</span>'}</p>
          <h4>Conhecimentos que só uma pessoa sabe</h4>
          <ul class="cols">${model.skills.filter((s) => s.holders.length === 1).map((s) => `<li>${esc(s.skill)} — ${personLink(s.holders[0])}</li>`).join('') || '<li class="muted">Nenhum.</li>'}</ul>
        </div>
      </div>

      <div class="card">
        <h3>Pessoas no meio de conflitos</h3>
        <p class="muted small">Quando alguém se dá bem com duas pessoas que brigam entre si, essa pessoa fica dividida e é pressionada a escolher um lado. Vale tirá-la do meio.</p>
        <ul>${model.triads.slice(0, 20).map((t) => (t.torn ? `<li><strong>${esc(pname(t.torn))}</strong> está no meio de ${t.members.filter((x) => x !== t.torn).map(personLink).join(' e ')}</li>` : `<li>${t.members.map(personLink).join(', ')} — os três estão em conflito</li>`)).join('') || '<li class="muted">Nenhuma situação assim.</li>'}</ul>
      </div>`;
  }

  // --------------------------------------------------------- RESISTÊNCIA
  function renderResistance() {
    const box = $('#resistance');
    if (data().people.length < 2) {
      box.innerHTML = emptyState('Cadastre pessoas e relações primeiro.');
      return;
    }
    const focalSel = `<label class="inline">Quem é o gerente (quem lidera a mudança e sofre o boicote)?
      <select id="focal-select">${peopleOptions(model.focalId, 'Selecione…')}</select></label>`;
    const F = model.focal;
    if (!F) {
      box.innerHTML = `<div class="card">${focalSel}<p class="muted">Escolha o gerente para o sistema mostrar quem apoia, quem resiste, os grupos de resistência e por quem passa a comunicação dele.</p></div>`;
      return;
    }
    const recs = A.recommendations(data(), model).filter((r) => ['Resistência', 'Regra para parentes', 'Comunicação', 'Conquistar', 'Aliados', 'Contato direto'].includes(r.area));
    const others = model.metrics.filter((m) => m.id !== model.focalId);
    box.innerHTML = `
      <div class="card">${focalSel}</div>
      <div class="kpis">
        ${kpi('Apoiam', F.count.apoiador || 0)}
        ${kpi('Neutros', F.count.neutro || 0)}
        ${kpi('Resistem', F.count.resistente || 0)}
        ${kpi('Quem está mais forte?', F.resistancePower > F.supportPower * 1.1 ? 'Resistência' : F.supportPower > F.resistancePower * 1.1 ? 'Apoio' : 'Empate', 'soma da influência de quem apoia × de quem resiste')}
        ${kpi('Alcance do gerente', pct(F.reach2Share), 'da empresa que ele alcança direto ou por um colega')}
      </div>

      <div class="card">
        <h3>Plano de ação sugerido</h3>
        ${recs.length ? `<ul class="recs">${recs.map((r) => `<li class="lvl-${esc(r.level)}"><span class="badge">${esc(r.area)}</span> ${esc(r.text)}</li>`).join('')}</ul>` : '<p class="muted">Sem alertas.</p>'}
      </div>

      <div class="card">
        <h3>Grupos de resistência</h3>
        <p class="muted small">Pessoas que resistem ao gerente e são próximas entre si. "Podem influenciar" = colegas que ainda não resistem, mas convivem diretamente com o grupo.</p>
        <div class="cards">${F.nuclei
          .map(
            (nu, i) => `<div class="mini-card bad">
              <strong>Grupo ${i + 1}</strong> · ${nu.members.length} pessoa(s) · ${nu.departments} setor(es)<br>
              <div>${nu.members.map((id) => personLink(id) + ((model.byId.get(id) || {}).stanceSource === 'inferido' ? ' <span class="muted small">(postura estimada)</span>' : '')).join(', ')}</div>
              ${nu.familyPairs.length ? `<div class="small"><span class="badge fam">parentes/casal</span> ${nu.familyPairs.map(([a, b]) => `${esc(pname(a))} e ${esc(pname(b))}`).join('; ')}</div>` : ''}
              <div class="small muted">Podem influenciar ${nu.audience.length} colegas (${pct(nu.audienceShare)} da empresa): ${nu.audience.map((id) => esc(pname(id))).join(', ')}</div>
              <button class="small" data-action="simulate-group" data-id="${esc(nu.members.join(','))}">E se o grupo sair?</button>
            </div>`
          )
          .join('') || '<p class="muted">Ninguém resistindo no momento.</p>'}</div>
      </div>

      <div class="grid2">
        <div class="card">
          <h3>Por quem passa a comunicação do gerente</h3>
          <p class="muted small">Para chegar às equipes, o recado do gerente passa por estas pessoas. Se uma delas resiste, a mensagem pode chegar filtrada, atrasada ou distorcida.</p>
          ${table('gate', [
            { key: 'name', label: 'Pessoa', sort: (r) => pname(r.id), render: (r) => personLink(r.id) },
            { key: 'dependency', label: 'Parte da empresa', render: (r) => `${bar(r.dependency, r.stance === 'resistente' ? 'bad' : '')} ${pct(r.dependency)}` },
            { key: 'stance', label: 'Postura', render: (r) => stanceBadge(model.byId.get(r.id), false) },
          ], F.gatekeepers.slice(0, 10), { key: 'dependency', dir: 'desc' })}
        </div>
        <div class="card">
          <h3>Quem conquistar primeiro</h3>
          <p class="muted small">Pessoas neutras, ouvidas pelos colegas e que convivem com quem resiste. Se o gerente não as conquistar, o grupo de resistência pode conquistar.</p>
          ${table('engage', [
            { key: 'name', label: 'Pessoa', sort: (r) => pname(r.id), render: (r) => personLink(r.id) },
            { key: 'score', label: 'Urgência', render: (r) => meter(Math.min(1, r.score / Math.max(1e-9, F.engagement[0].score))) },
            { key: 'pressure', label: 'Pressão de quem resiste', render: (r) => meter(r.pressure, 'bad') },
          ], F.engagement.slice(0, 10), { key: 'score', dir: 'desc' })}
        </div>
      </div>

      <div class="card">
        <h3>Postura de cada pessoa</h3>
        <p class="muted small">De onde vem a postura: <em>avaliado por você</em> (o que você marcou na ficha), <em>pela relação com o gerente</em> (clima das relações cadastradas), <em>pelas ocorrências</em> (fatos registrados) ou <em>estimado pelo sistema</em> (pelas pessoas próximas — é um palpite, confirme antes de agir).</p>
        ${table('stance', [
          { key: 'name', label: 'Pessoa', sort: (r) => r.name, render: (r) => personLink(r.id) },
          { key: 'dep', label: 'Setor', sort: (r) => depName(r.departmentId), render: (r) => esc(depName(r.departmentId)) },
          { key: 'stance', label: 'Postura', sort: (r) => r.stance ?? -9, render: (r) => stanceBadge(r) },
          { key: 'influence', label: 'Influência', render: (r) => meter(r.influence) },
          { key: 'exposure', label: 'Ambiente ao redor', title: 'Como é a postura das pessoas próximas a ela', sort: (r) => r.exposure ?? -9, render: (r) => esc(r.exposure === null || r.exposure === undefined ? '—' : stanceText({ stance: r.exposure }).toLowerCase()) },
          { key: 'inc', label: 'Boicotes / apoios registrados', sort: (r) => (F.incidentsBy[r.id] || {}).negative || 0, render: (r) => { const x = F.incidentsBy[r.id]; return x ? `${x.negative} / ${x.positive}` : '—'; } },
        ], others, { key: 'stance', dir: 'asc' })}
      </div>`;
  }

  // ----------------------------------------------------------- SIMULAÇÃO
  function renderSimulation() {
    const box = $('#simulation');
    if (data().people.length < 3) {
      box.innerHTML = emptyState('Cadastre pessoas e relações para fazer simulações.');
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
          <h3>E se sair: ${r.removed.map((id) => esc(pname(id))).join(', ')}</h3>
          <p class="verdict ${r.operationalCost >= 30 ? 'bad' : r.operationalCost >= 15 ? 'warn' : 'ok'}">${simVerdict(r)}</p>
          <div class="kpis">
            ${kpi('Impacto na empresa', `${Math.round(r.operationalCost)}<small> de 100</small>`, r.operationalCost >= 30 ? 'alto' : r.operationalCost >= 15 ? 'médio' : 'baixo')}
            ${kpi('Resistência ao gerente', r.resistanceReduction > 0 ? `cai ${pct(r.resistanceReduction)}` : 'não muda')}
            ${kpi('Comunicação entre quem fica', r.efficiencyLoss > 0.005 ? `piora ${pct(r.efficiencyLoss)}` : 'não muda')}
            ${kpi('Influência que sai junto', pct(r.influenceShare), 'da influência total da empresa')}
            ${r.focalReachBefore !== null ? kpi('Alcance do gerente', `${pct(r.focalReachBefore)} → ${pct(r.focalReachAfter)}`) : ''}
          </div>
          <h4>De onde vem o impacto</h4>
          <table class="mini">
            <tr><td>Conhecimento que se perde</td><td>${meter(b.knowledge, 'warn')}</td></tr>
            <tr><td>Influência que sai</td><td>${meter(b.influence, 'warn')}</td></tr>
            <tr><td>Desempenho de quem sai</td><td>${b.performance === null ? '<span class="muted">sem nota — fica fora da conta</span>' : meter(b.performance, 'warn')}</td></tr>
            <tr><td>Comunicação que piora</td><td>${meter(b.efficiency, 'warn')}</td></tr>
            <tr><td>Colegas que podem sair junto</td><td>${meter(b.contagion, 'warn')}</td></tr>
            <tr><td>Pessoas que ficam isoladas</td><td>${meter(b.isolation, 'warn')}</td></tr>
          </table>
          <div class="grid2">
            <div>
              <h4>Conhecimento que a empresa perde</h4>
              <ul>${r.skillsLost.map((s) => `<li>${esc(s)}</li>`).join('') || '<li class="muted">Nenhum: há outra pessoa que sabe.</li>'}</ul>
              <h4>Conhecimento que passa a depender de uma só pessoa</h4>
              <ul>${r.skillsAtRisk.map((s) => `<li>${esc(s.skill)} — ${personLink(s.holder)}</li>`).join('') || '<li class="muted">Nenhum.</li>'}</ul>
              <h4>Pessoas que ficam sem contato com o resto</h4>
              <ul>${r.isolated.map((id) => `<li>${personLink(id)}</li>`).join('') || '<li class="muted">Nenhuma.</li>'}</ul>
            </div>
            <div>
              <h4>Colegas que podem sair junto ou se desmotivar</h4>
              <p class="muted small">São muito próximos de quem sai. Converse com eles no mesmo dia do desligamento.</p>
              <ul>${r.contagion.map((c) => `<li>${personLink(c.id)} — próximo(a) de ${esc(pname(c.from))}${c.family ? ' <span class="badge fam">parente/casal</span>' : ''} ${stanceBadge(model.byId.get(c.id), false)}</li>`).join('') || '<li class="muted">Ninguém muito próximo.</li>'}</ul>
            </div>
          </div>
        </div>`;
    }

    const rankHtml = ranking
      ? `<div class="card"><h3>Impacto da saída de cada pessoa</h3>
          <p class="muted small">Cada pessoa simulada sozinha. Quando o impacto é alto e a resistência também cai muito, a decisão é difícil: treine um substituto antes de qualquer passo.</p>
          ${table('impact', [
            { key: 'name', label: 'Pessoa', sort: (r) => pname(r.id), render: (r) => personLink(r.id) },
            { key: 'operationalCost', label: 'Impacto na empresa', render: (r) => `<span class="nowrap">${bar(r.operationalCost / 100, 'warn')} ${Math.round(r.operationalCost)} de 100</span>` },
            { key: 'resistanceReduction', label: 'Quanto a resistência cai', render: (r) => `${bar(r.resistanceReduction, 'ok')} ${pct(r.resistanceReduction)}` },
            { key: 'skillsLost', label: 'Conhecimentos perdidos' },
            { key: 'contagion', label: 'Colegas que podem sair junto' },
          ], ranking, { key: 'operationalCost', dir: 'desc' })}</div>`
      : '';

    box.innerHTML = `
      <div class="card">
        <div class="sim-picker">${picker}</div>
        <div class="btn-row">
          <button class="primary" data-action="run-sim">E se as marcadas saírem?</button>
          <button data-action="clear-sim">Desmarcar todas</button>
          <button data-action="run-ranking">Ver o impacto de cada pessoa</button>
        </div>
      </div>
      ${result}${rankHtml}`;
  }

  // Frase-resumo da simulação, para quem não quer ler os números.
  function simVerdict(r) {
    const names = r.removed.map(pname).join(', ');
    const imp = r.operationalCost >= 30 ? 'faria muita falta' : r.operationalCost >= 15 ? 'faria alguma falta' : 'faria pouca falta';
    const parts = [`A saída de ${names} ${imp} para a empresa`];
    if (r.skillsLost.length) parts.push(`a empresa perderia ${r.skillsLost.length} conhecimento(s) que só ${r.removed.length > 1 ? 'eles sabem' : 'essa pessoa sabe'}`);
    if (r.contagion.length) parts.push(`${r.contagion.length} colega(s) próximo(s) podem se desmotivar ou sair junto`);
    if (r.resistanceReduction >= 0.2) parts.push(`a resistência ao gerente cairia ${pct(r.resistanceReduction)}`);
    return esc(parts.join('; ') + '.');
  }

  // --------------------------------------------------------- OCORRÊNCIAS
  function renderIncidents() {
    const rows = data().incidents;
    const cols = [
      { key: 'date', label: 'Data' },
      { key: 'type', label: 'Tipo', render: (r) => { const t = A.INCIDENT_TYPES[r.type] || { label: r.type, valence: 0 }; return `<span class="${t.valence < 0 ? 'neg-text' : t.valence > 0 ? 'ok-text' : ''}">${esc(t.label)}</span>`; } },
      { key: 'actors', label: 'Quem fez', sort: (r) => (r.actors || []).map(pname).join(), render: (r) => (r.actors || []).map(personLink).join(', ') },
      { key: 'targets', label: 'Quem foi afetado', sort: (r) => (r.targets || []).map(pname).join(), render: (r) => (r.targets || []).map(personLink).join(', ') },
      { key: 'severity', label: 'Gravidade', render: (r) => esc(['', 'Muito leve', 'Leve', 'Média', 'Grave', 'Muito grave'][r.severity] || '') },
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
        <label>Quem fez (segure Ctrl para escolher vários)${multi('actors', ev.actors || [])}</label>
        <label>Quem foi afetado${multi('targets', ev.targets || [])}</label>
      </div>
      <label>Gravidade<select name="severity">${options([[1, 'Muito leve'], [2, 'Leve'], [3, 'Média'], [4, 'Grave'], [5, 'Muito grave']], ev.severity)}</select></label>
      <label>O que aconteceu (fato, quando e qual o prejuízo)<textarea name="description" rows="4">${esc(ev.description)}</textarea></label>`,
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
    loading: ['busy', 'Carregando…'],
    dirty: ['busy', 'Alterações pendentes…'],
    saving: ['busy', 'Salvando…'],
    saved: ['ok', 'Salvo online'],
    error: ['bad', 'Erro ao salvar online'],
  };
  const API_URL = String((window.MAPA_CONFIG || {}).apiUrl || '').trim();
  // Por onde as empresas são gravadas: servidor (API) ou convite recebido.
  const backend = () => G.companyBackend(API_URL);
  const NO_COMPANY_KEY = 'mapaOrganizacional.semEmpresa';
  const sessionFlag = (v) => {
    try {
      if (v === undefined) return sessionStorage.getItem(NO_COMPANY_KEY) === '1';
      if (v) sessionStorage.setItem(NO_COMPANY_KEY, '1');
      else sessionStorage.removeItem(NO_COMPANY_KEY);
    } catch (e) {
      return false;
    }
  };

  // ------------------------------------------------ tela de entrada (empresa)
  function showGate(show) {
    const gate = $('#gate');
    gate.hidden = !show;
    document.body.classList.toggle('gated', show);
    if (show) {
      $$('#gate .gate-msg').forEach((m) => (m.textContent = ''));
      const where = $('#gate-where');
      const k = backend().kind;
      if (where)
        where.innerHTML =
          k === 'local'
            ? '🔒 Sua empresa já está online? <strong>Basta digitar o código</strong>, de qualquer computador. Para <strong>criar</strong> uma empresa online, use o link de convite do administrador; sem ele, uma empresa nova fica salva só neste computador.'
            : '🔒 Os dados ficam <strong>criptografados e salvos online</strong>. Você acessa de qualquer computador com o mesmo código.';
      const first = $('#gate-enter [name="code"]');
      if (first) first.focus();
    }
  }

  function gateNeeded() {
    return !G.connected && !sessionFlag();
  }

  async function gateSubmit(form, create) {
    const msg = $('.gate-msg', form);
    const f = Object.fromEntries(new FormData(form).entries());
    const code = f.code || '';
    msg.className = 'gate-msg';
    if (create) {
      if (!(f.name || '').trim()) return (msg.textContent = 'Digite o nome da empresa.');
      const chk = window.Vault.checkCode(code);
      if (!chk.ok) return (msg.textContent = chk.msg);
      if (code.trim().length < 10) return (msg.textContent = 'Para empresas novas, use pelo menos 10 caracteres (ex.: uma frase como padaria-centro-azul).');
      if (code !== f.code2) return (msg.textContent = 'Os dois códigos não são iguais.');
    }
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    msg.classList.add('muted');
    msg.textContent = create ? 'Criando a empresa…' : 'Abrindo…';
    try {
      const initial = S.empty();
      initial.settings.companyName = (f.name || '').trim();
      await G.enterCompany({ backend: backend(), code, remember: !!f.remember, create, initialData: initial });
      form.reset();
      sessionFlag(false);
      showGate(false);
      fichaId = null;
      selectedId = null;
      lastLayoutKey = '';
      setView(create ? 'colaboradores' : 'painel');
      toast(create ? 'Empresa criada. Guarde bem o código de acesso!' : `Bem-vindo(a) à ${data().settings.companyName || 'empresa'}.`);
    } catch (e) {
      msg.className = 'gate-msg neg-text';
      msg.textContent = e.message;
    } finally {
      btn.disabled = false;
      renderSyncStatus();
    }
  }

  function renderSyncStatus() {
    const el = $('#sync-status');
    const [tone, label] = SYNC_LABEL[G.status] || SYNC_LABEL.local;
    const time = G.status === 'saved' && G.state.savedAt ? ' · ' + new Date(G.state.savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    el.className = 'sync-status s-' + tone;
    el.innerHTML = `<i></i>${esc(label + time)}`;
    el.title = G.error || (G.isCompany ? 'Dados da empresa, criptografados' : G.connected ? `${G.cfg.owner}/${G.cfg.repo} · ${G.cfg.path}` : 'Os dados estão só neste navegador');
    $('#leave-btn').hidden = !G.isCompany;
    $('#share-btn').hidden = !(G.isCompany && G.invite);
    $('#gate-btn').hidden = G.connected;
    if (G.isCompany && G.cfg.via === 'local' && G.status === 'saved') {
      el.innerHTML = '<i></i>Salvo neste computador';
      el.title = 'Dados da empresa criptografados neste computador';
    }
    if (currentView === 'dados') renderGitHubCard();
  }

  function renderGitHubCard() {
    const box = $('#gh-card');
    if (!box) return;
    if (G.isCompany) {
      box.innerHTML = `
        <h3>Empresa: ${esc(data().settings.companyName || '(sem nome)')} <span class="badge st-apoiador">conectada</span></h3>
        <p>Os dados desta empresa ficam ${G.cfg.via === 'local' ? '<strong>só neste computador</strong>' : '<strong>salvos online</strong>'}, <strong>criptografados com o código de acesso</strong>. Ninguém sem o código consegue lê-los.</p>
        <p class="small">Situação: <strong>${esc((SYNC_LABEL[G.status] || [])[1] || '')}</strong>${G.error ? ` — <span class="neg-text">${esc(G.error)}</span>` : ''}</p>
        <p class="small muted">Para outra pessoa acessar esta empresa, ela precisa do <strong>link de convite</strong> e do <strong>código</strong>. Ao terminar num computador compartilhado, clique em <em>Sair da empresa</em>.</p>
        <div class="btn-row">
          ${G.invite ? '<button class="primary" data-action="share-invite">Compartilhar acesso</button>' : ''}
          <button class="primary" data-action="gh-save">Salvar agora</button>
          <button data-action="gh-reload">Recarregar</button>
          <button class="danger" data-action="leave-company">Sair da empresa</button>
        </div>`;
      return;
    }
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
    const companyIntro = backend()
      ? `<div class="company-intro"><h3>Empresas com código</h3>
          <p>Você está usando o sistema <strong>sem empresa</strong>: os dados ficam só neste navegador.</p>
          <div class="btn-row"><button class="primary" data-action="open-gate">Entrar ou criar uma empresa</button></div></div>`
      : `<div class="company-intro"><h3>Empresas com código</h3>
          <p>Este navegador ainda não recebeu um <strong>link de convite</strong>. Para criar ou entrar numa empresa, abra o link que o administrador enviou.</p></div>`;
    const inv = G.invite || {};
    const inviteAdmin = `
      <h3>Convidar pessoas (administrador)</h3>
      <p>Gere um <strong>link de convite</strong>. Quem abrir o link poderá criar a própria empresa ou entrar numa existente com o código dela. Cada empresa fica <strong>criptografada com o próprio código</strong> no seu repositório privado de dados.</p>
      <details class="steps">
        <summary>Antes de gerar (uma única vez)</summary>
        <ol>
          <li>Crie o repositório de dados <code>mapa_organizacional_dados</code>: <a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a> → <em>Public</em> → <em>Add a README file</em>. Ele precisa ser <strong>público</strong> para o dono entrar de qualquer lugar só com o código; o conteúdo fica todo criptografado.</li>
          <li>Crie a chave: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token</a> → <em>Only select repositories</em> → o repositório de dados → <em>Contents: Read and write</em> → validade → <em>Generate token</em>.</li>
        </ol>
      </details>
      <div class="grid2">
        <label>Dono do repositório<input id="inv-owner" value="${esc(inv.owner || 'brunovanham')}"></label>
 <label>Repositório de dados<input id="inv-repo" value="${esc(inv.repo || 'mapa_organizacional_dados')}"></label>
      </div>
      <label>Chave de acesso (token)<input id="inv-token" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <label class="chk"><input type="checkbox" id="inv-here" checked> Usar o convite também neste navegador</label>
      <div class="btn-row"><button class="primary" data-action="inv-make">Gerar link de convite</button></div>
      <div id="inv-box"></div>
      <p class="muted small"><strong>Importante:</strong> o link leva a chave do GitHub (na parte depois do <code>#</code>, que não é enviada a nenhum servidor nem fica no código). Envie só para quem você conhece, por mensagem privada. Quem tiver o link consegue gravar no repositório de dados, mas <strong>não consegue ler nenhuma empresa sem o código dela</strong>. Para cortar o acesso de todos, apague a chave no GitHub e gere um convite novo.</p>`;
    box.innerHTML = companyIntro + `<details class="admin" id="admin-box"><summary>Administrador: gerar link de convite</summary>` + inviteAdmin +
      `<details class="admin"><summary>Outro modo: um único arquivo de dados com a sua chave (sem empresas)</summary>` + `
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
      </details></details>
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
          <label>Quem é o gerente (quem lidera a mudança)<select id="set-focal">${peopleOptions(s.focalId, '—')}</select></label>
          <label>Chefe e equipe contam como relação? ${help('Quando não há relação cadastrada entre chefe e subordinado, o sistema pode supor que eles conversam. Use "Não" se quiser analisar só as relações cadastradas.')}
            <select id="set-formal">${options([[0, 'Não'], [1, 'Sim, como contato raro'], [2, 'Sim, como contato às vezes (padrão)'], [3, 'Sim, como contato semanal']], s.formalTieStrength)}</select></label>
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
        knowledge: col(row, 'conhecimento') === '' ? null : Number(col(row, 'conhecimento')),
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
  function openModal(title, body, onSubmit, onDelete, labels) {
    labels = labels || {};
    const dlg = $('#modal');
    const form = $('#modal-form');
    form.innerHTML = `<h3>${esc(title)}</h3>${body}
      <div class="btn-row end">
        ${onDelete ? '<button type="button" class="danger" data-modal="delete">Excluir</button>' : ''}
        <span class="spacer"></span>
        <button type="button" data-modal="cancel">${esc(labels.cancel || 'Cancelar')}</button>
        <button type="submit" class="primary">${esc(labels.submit || 'Salvar')}</button>
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

  async function copyText(text, input) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      if (input) {
        input.select();
        document.execCommand('copy');
      }
    }
  }

  function shareInviteForm() {
    const link = G.invite ? G.inviteLink(G.invite) : '';
    if (!link) return toast('Este navegador não tem link de convite para compartilhar.');
    const name = data().settings.companyName || 'a empresa';
    openModal(
      'Compartilhar acesso',
      `<p>Para outra pessoa entrar em <strong>${esc(name)}</strong>, ela precisa de duas coisas:</p>
       <ol class="share-steps">
         <li><strong>Este link de convite</strong>: ela abre uma vez em cada navegador ou computador.
           <div class="link-box"><input id="share-link" readonly value="${esc(link)}"><button type="button" data-action="share-copy">Copiar link</button></div></li>
         <li><strong>O código da empresa</strong>: ela digita na tela de entrada.</li>
       </ol>
       <p class="notice-inline small">Envie o link e o código <strong>separados</strong> (por exemplo, o link por WhatsApp e o código por ligação). Assim, se uma mensagem vazar, a outra metade continua protegida. Envie só para quem pode ver os dados desta empresa.</p>`,
      () => {
        copyText(link, $('#share-link'));
        toast('Link de convite copiado.');
      },
      null,
      { submit: 'Copiar link e fechar', cancel: 'Fechar' }
    );
    const inp = $('#share-link');
    if (inp) inp.select();
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
    'duplicate-person': (id) => duplicateForm(person(id)),
    'delete-person': (id) => {
      if (!confirm(`Excluir ${pname(id)} e todos os seus vínculos?`)) return;
      if (selectedId === id) selectedId = null;
      fichaId = null;
      S.remove('people', id);
    },
    rate: (_, el) => {
      const field = el.dataset.field;
      const v = el.dataset.value === '' ? null : Number(el.dataset.value);
      const p = person(fichaId);
      const notes = { ...(p.gradeNotes || {}) };
      if (v !== null && needsReason(field, v)) {
        // Nota extrema: só grava com o motivo escrito.
        return askReason(field, v, (text) => {
          notes[field] = { text, date: new Date().toISOString().slice(0, 10) };
          updatePerson({ [field]: v, gradeNotes: notes }, true);
        });
      }
      delete notes[field];
      updatePerson({ [field]: v, gradeNotes: notes }, true);
    },
    'edit-reason': (field) => {
      const p = person(fichaId);
      askReason(field, Number(p[field]), (text) => {
        updatePerson({ gradeNotes: { ...(p.gradeNotes || {}), [field]: { text, date: new Date().toISOString().slice(0, 10) } } }, true);
      });
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
    'open-gate': () => showGate(true),
    'inv-make': async () => {
      const inv = { owner: $('#inv-owner').value.trim(), repo: $('#inv-repo').value.trim(), branch: '', token: $('#inv-token').value.trim() };
      if (!inv.owner || !inv.repo || !inv.token) return toast('Preencha dono, repositório e chave.');
      const box = $('#inv-box');
      box.innerHTML = '<p class="muted small">Conferindo a chave no GitHub…</p>';
      try {
        const info = await G.checkInvite(inv);
        if (info.private && !confirm(`O repositório ${inv.owner}/${inv.repo} é PRIVADO. Assim, cada navegador novo precisará abrir o link de convite antes de entrar com o código.\n\nPara o dono entrar de qualquer lugar SÓ com o código, deixe o repositório PÚBLICO (os dados ficam criptografados).\n\nGerar o convite mesmo assim?`)) {
          box.innerHTML = '';
          return;
        }
      } catch (e) {
        box.innerHTML = `<p class="neg-text small">${esc(e.message)}</p>`;
        return;
      }
      if ($('#inv-here').checked) G.setInvite(inv);
      const link = G.inviteLink(inv);
      box.innerHTML = `<div class="link-box"><input id="gh-link-input" readonly value="${esc(link)}"><button data-action="gh-copy">Copiar</button></div>
        <p class="ok-text small">Convite pronto. Envie este link só para quem você conhece.</p>`;
      $('#gh-link-input').select();
      $('#gate-btn').hidden = G.connected;
      const intro = $('.company-intro');
      if (intro && backend())
        intro.innerHTML = `<h3>Empresas com código</h3><p>Convite ativo neste navegador.</p>
          <div class="btn-row"><button class="primary" data-action="open-gate">Entrar ou criar uma empresa</button></div>`;
    },
    // Atalho da tela de entrada para a área do administrador (gerar convite).
    'share-invite': () => shareInviteForm(),
    'share-copy': () => {
      const inp = $('#share-link');
      copyText(inp.value, inp);
      toast('Link de convite copiado.');
    },
    'gate-admin': () => {
      sessionFlag(true);
      showGate(false);
      setView('dados');
      const box = $('#admin-box');
      if (box) {
        box.open = true;
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const owner = $('#inv-token');
        if (owner) owner.focus();
      }
    },
    'gate-demo': () => {
      sessionFlag(true);
      showGate(false);
      if (!data().people.length) S.replace(window.SAMPLE_DATA);
      setView('painel');
      toast('Exemplo fictício: os dados ficam só neste navegador.');
    },
    'leave-company': async () => {
      if (G.state.dirty) await G.push();
      if (G.state.dirty && !confirm('Algumas alterações ainda não foram salvas online. Sair mesmo assim?')) return;
      G.leave(S.empty());
      sessionFlag(false);
      fichaId = null;
      selectedId = null;
      lastLayoutKey = '';
      renderSyncStatus();
      showGate(true);
      toast('Você saiu da empresa. Os dados foram apagados deste navegador.');
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
    'kn-suggest': () => {
      const n = addSuggestedKnowledge();
      afterSilentEdit(currentView === 'colaboradores');
      if (currentView === 'conhecimentos') renderConhecimentos();
      toast(n ? `${n} conhecimento(s) adicionados à lista. Ajuste a importância de cada um.` : 'A lista sugerida já está toda incluída.');
    },
    'kn-add': () => {
      const name = $('#kn-cat-name').value;
      if (!name.trim()) return toast('Digite o nome do conhecimento.');
      addKnowledge(name, $('#kn-cat-category').value, $('#kn-cat-importance').value);
      afterSilentEdit(false);
      renderConhecimentos();
      const inp = $('#kn-cat-name');
      if (inp) inp.focus();
    },
    'kn-newcat': () => {
      const name = (prompt('Nome da nova categoria (ex.: Máquinas, Clientes, Qualidade):') || '').trim();
      if (!name) return;
      renderConhecimentos();
      const sel = $('#kn-cat-category');
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(name)}">${esc(name)}</option>`);
      sel.value = name;
      $('#kn-cat-name').focus();
    },
    'kn-del': (id) => {
      const k = knowledge().find((x) => x.id === id);
      const n = knHolders(id).length;
      if (!confirm(`Excluir "${k.name}" da lista?${n ? ` Ele será desmarcado de ${n} pessoa(s).` : ''}`)) return;
      S.remove('knowledge', id, { silent: true });
      afterSilentEdit(false);
      renderConhecimentos();
    },
    'kn-add-ficha': () => {
      const name = $('#kn-new-name').value;
      if (!name.trim()) return toast('Digite o conhecimento.');
      const k = addKnowledge(name, $('#kn-new-cat').value, 2);
      const p = person(fichaId);
      updatePerson({ skills: [...new Set([...(p.skills || []), k.id])] }, true);
      toast(`"${k.name}" incluído na lista e marcado.`);
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
      toast(`${pname(id)} marcado(a) como gerente.`);
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
      const online = G.connected ? ' Atenção: isto substitui também os dados salvos online desta empresa (a versão anterior fica no histórico).' : '';
      if (data().people.length && !confirm(`Substituir os dados atuais pelo exemplo fictício?${online}`)) return;
      selectedId = null;
      lastLayoutKey = '';
      fichaId = null;
      S.replace(window.SAMPLE_DATA);
      setView('painel');
      toast('Exemplo fictício carregado: veja o painel de decisão.');
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
    if (t.dataset.kn && fichaId) {
      const p = person(fichaId);
      const set = new Set(p.skills || []);
      if (t.checked) set.add(t.dataset.kn);
      else set.delete(t.dataset.kn);
      return updatePerson({ skills: [...set] }, true);
    }
    if (t.dataset.kid) {
      const f = t.dataset.kfield;
      const v = f === 'importance' ? Number(t.value) : t.value.trim();
      if (f === 'name' && !v) return renderConhecimentos();
      S.upsert('knowledge', { id: t.dataset.kid, [f]: v }, 'k', { silent: true });
      afterSilentEdit(false);
      return renderConhecimentos();
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

  S.onChange(() => {
    recompute();
    render();
  });

  // Liga um evento só se o elemento existir: uma página em cache de outra
  // versão não pode derrubar o aplicativo inteiro.
  const on = (sel, ev, fn) => {
    const el = $(sel);
    if (el) el.addEventListener(ev, fn);
    else console.warn('Elemento ausente na página:', sel);
  };
  on('#rel-filter', 'input', () => renderRelations());
  on('#cad-search', 'input', () => renderCadList());
  // Filtro do checklist: esconde itens sem redesenhar a ficha (mantém o foco).
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'kn-filter') return;
    knFilter = e.target.value.trim().toLowerCase();
    $$('#ficha .kn-item').forEach((el) => {
      el.hidden = !!knFilter && !el.querySelector('.kn-name').textContent.toLowerCase().includes(knFilter);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = e.target.id;
    if (id === 'group-input' || id === 'skill-input') {
      e.preventDefault();
      addChip(id === 'group-input' ? 'groups' : 'skills', e.target.value);
    } else if (id === 'kn-new-name') {
      e.preventDefault();
      actions['kn-add-ficha']();
    } else if (id === 'kn-cat-name') {
      e.preventDefault();
      actions['kn-add']();
    } else if (e.target.classList.contains('kn-edit')) {
      e.target.blur();
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
  on('#map-search', 'input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return highlight(selectedId);
    const p = data().people.find((x) => x.name.toLowerCase().includes(q));
    if (p) selectPerson(p.id);
  });
  on('#tabs', 'click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
  on('#add-dep', 'click', () => depForm());
  on('#add-rel', 'click', () => relationForm());
  on('#add-inc', 'click', () => incidentForm());

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => currentView === 'mapa' && renderMap());

  recompute();
  setView(data().people.length ? 'painel' : 'colaboradores');
  on('#gate-enter', 'submit', (e) => {
    e.preventDefault();
    gateSubmit(e.target, false);
  });
  on('#gate-create', 'submit', (e) => {
    e.preventDefault();
    gateSubmit(e.target, true);
  });
  // Dica de força do código enquanto digita.
  on('#gate-create [name="code"]', 'input', (e) => {
    const hint = $('#gate-create .code-hint');
    const c = window.Vault.checkCode(e.target.value);
    const short = e.target.value.trim().length < 10;
    hint.textContent = !e.target.value ? 'Mínimo de 10 caracteres. Letras maiúsculas e minúsculas fazem diferença.' : short ? 'Use pelo menos 10 caracteres.' : c.msg;
    hint.className = 'small code-hint ' + (short ? 'neg-text' : c.level === 'forte' ? 'ok-text' : 'warn-text');
  });
  G.consumeInviteLink(); // link "#convite=…" ativa as empresas neste navegador
  if (gateNeeded()) showGate(true);
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
