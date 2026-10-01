// Testes do motor de análise. Rodar com: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/analytics.js');
const SAMPLE = require('../js/sample-data.js');

const person = (id, extra) => ({ id, name: id.toUpperCase(), level: 2, knowledge: 3, skills: [], stance: null, ...extra });
const rel = (source, target, type = 'colaboracao', strength = 3, sentiment = null) => ({ id: source + target + type, source, target, type, strength, sentiment });
const base = (people, relations, settings = {}) => ({
  people,
  relations,
  incidents: [],
  departments: [],
  settings: { formalTieStrength: 0, ...settings },
});

test('intermediação: o centro de uma estrela é o maior intermediador', () => {
  const d = base(['c', 'a', 'b', 'x', 'y'].map((id) => person(id)), ['a', 'b', 'x', 'y'].map((l) => rel('c', l)));
  const m = A.analyze(d);
  const c = m.byId.get('c');
  assert.equal(c.betweenness.toFixed(6), (1).toFixed(6));
  assert.equal(m.byId.get('a').betweenness, 0);
  assert.ok(c.articulation, 'centro é ponto de articulação');
  assert.equal(c.influenceRank, 1);
});

test('Louvain separa dois grupos ligados por uma única ponte', () => {
  const ids = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'];
  const rels = [];
  for (const g of ['a', 'b'])
    for (let i = 1; i <= 4; i++) for (let j = i + 1; j <= 4; j++) rels.push(rel(g + i, g + j, 'colaboracao', 5));
  rels.push(rel('a1', 'b1', 'colaboracao', 1));
  const m = A.analyze(base(ids.map((id) => person(id)), rels));
  assert.equal(m.communities.length, 2);
  const ca = m.byId.get('a2').community;
  assert.ok(['a1', 'a3', 'a4'].every((id) => m.byId.get(id).community === ca));
  assert.ok(m.modularity > 0.3);
  assert.equal(m.keyPairs[0].tags.includes('ponte única'), true);
});

test('PageRank: quem é influenciado aponta para o influenciador', () => {
  const d = base(['l', 'f1', 'f2', 'f3'].map((id) => person(id)), ['f1', 'f2', 'f3'].map((f) => rel('l', f, 'influencia', 4)));
  const m = A.analyze(d);
  const l = m.byId.get('l');
  assert.ok(['f1', 'f2', 'f3'].every((id) => l.pagerank > m.byId.get(id).pagerank));
});

test('relações negativas não entram na rede positiva', () => {
  const d = base([person('a'), person('b')], [rel('a', 'b', 'conflito', 4, -2)]);
  const m = A.analyze(d);
  assert.equal(m.byId.get('a').ties, 0);
  assert.equal(m.conflicts.length, 1);
  assert.equal(m.components, 2);
});

test('hierarquia formal vira laço fraco quando configurada', () => {
  const d = base([person('g'), person('s', { managerId: 'g' })], [], { formalTieStrength: 2 });
  assert.equal(A.analyze(d).byId.get('s').ties, 1);
  d.settings.formalTieStrength = 0;
  assert.equal(A.analyze(d).byId.get('s').ties, 0);
});

test('posicionamento: informado > relação direta > ocorrências > inferido', () => {
  const people = ['f', 'a', 'b', 'c', 'd'].map((id) => person(id));
  people[1].stance = 2;
  const d = base(people, [rel('b', 'f', 'boicote', 4), rel('c', 'd', 'amizade', 5)], { focalId: 'f' });
  d.incidents = [{ id: 'i', type: 'retencao_info', actors: ['c'], targets: ['f'], severity: 5 }];
  const m = A.analyze(d);
  assert.equal(m.byId.get('a').stanceSource, 'informado');
  assert.equal(m.byId.get('b').stanceSource, 'relação direta');
  assert.equal(m.byId.get('b').stanceLabel, 'resistente');
  assert.equal(m.byId.get('c').stanceSource, 'ocorrências');
  assert.equal(m.byId.get('d').stanceSource, 'inferido');
  assert.ok(m.byId.get('d').stance < 0, 'amigo de quem boicota tende ao negativo');
  assert.equal(m.byId.get('f').stanceLabel, 'focal');
});

test('exemplo: casal forma núcleo de resistência com vínculo familiar', () => {
  const m = A.analyze(SAMPLE);
  const nucleus = m.focal.nuclei[0];
  assert.ok(nucleus.members.includes('rs') && nucleus.members.includes('js'));
  assert.deepEqual(nucleus.familyPairs.map((p) => p.slice().sort()), [['js', 'rs']]);
  assert.ok(m.focal.gatekeepers.some((g) => g.id === 'rs' && g.stance === 'resistente'));
  const recs = A.recommendations(SAMPLE, m);
  assert.ok(recs.some((r) => r.area === 'Regra para parentes'));
});

test('simulação: retirar o centro de uma estrela isola as pontas e perde conhecimento exclusivo', () => {
  const people = ['c', 'a', 'b', 'x'].map((id) => person(id));
  people[0].skills = ['erp'];
  people[0].knowledge = 5;
  const d = base(people, ['a', 'b', 'x'].map((l) => rel('c', l, 'colaboracao', 5)));
  const s = A.simulateRemoval(d, ['c']);
  assert.deepEqual(s.skillsLost, ['erp']);
  assert.equal(s.efficiencyAfter, 0);
  assert.equal(s.efficiencyLoss, 1);
  assert.equal(s.contagion.length, 3);
  assert.ok(s.operationalCost > 50);
});

test('simulação: remover resistentes reduz o poder de resistência', () => {
  const s = A.simulateRemoval(SAMPLE, ['rs', 'js']);
  assert.ok(s.resistanceReduction > 0.5);
  assert.ok(s.resistanceAfter < s.resistanceBefore);
  assert.ok(s.contagion.some((c) => c.id === 'an'));
});

test('ranking de impacto cobre todos menos a pessoa focal', () => {
  const r = A.impactRanking(SAMPLE);
  assert.equal(r.length, SAMPLE.people.length - 1);
  assert.ok(!r.some((x) => x.id === SAMPLE.settings.focalId));
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].operationalCost >= r[i].operationalCost);
});

test('rede vazia não quebra', () => {
  const m = A.analyze(base([], []));
  assert.equal(m.n, 0);
  assert.equal(m.focal, null);
});

test('painel de decisão: classifica cuidado, reter e cortar no exemplo', () => {
  const m = A.analyze(SAMPLE);
  const b = A.decisionBoard(SAMPLE, m);
  const ids = (cat) => b.lists[cat].map((p) => p.id);
  assert.ok(ids('cuidado').includes('rs') && ids('cuidado').includes('js'));
  assert.ok(ids('reter').includes('gu'), 'analista com ERP exclusivo é risco de demissão');
  assert.deepEqual(ids('cortar'), ['ig']);
  assert.ok(ids('aliado').includes('fr'));
  assert.equal(b.people.find((p) => p.id === 'rs').tone, 'critico');
  assert.ok(!b.people.some((p) => p.id === SAMPLE.settings.focalId), 'a pessoa focal não é classificada');
});

test('painel de decisão: sem nota de desempenho ninguém é sugerido para corte', () => {
  const people = ['f', 'a', 'b', 'c', 'd'].map((id) => person(id));
  const rels = [rel('f', 'a'), rel('a', 'b'), rel('b', 'c'), rel('c', 'd'), rel('d', 'f')];
  const d = base(people, rels, { focalId: 'f' });
  const b = A.decisionBoard(d, A.analyze(d));
  assert.equal(b.lists.cortar.length, 0);
  assert.equal(b.missingPerformance, 4);
  d.people[2].performance = 1;
  d.people[2].engagement = 1;
  const b2 = A.decisionBoard(d, A.analyze(d));
  assert.ok(b2.people.find((p) => p.id === 'b').reasons.cortar || b2.people.find((p) => p.id === 'b').reasons.reter);
});

test('desempenho alto aumenta o custo de saída', () => {
  const mk = (perf) => {
    const people = ['a', 'b', 'c'].map((id) => person(id));
    people[0].performance = perf;
    return base(people, [rel('a', 'b'), rel('b', 'c'), rel('a', 'c')]);
  };
  assert.ok(A.simulateRemoval(mk(5), ['a']).operationalCost > A.simulateRemoval(mk(1), ['a']).operationalCost);
});

test('grupos transversais aparecem nas estatísticas', () => {
  const m = A.analyze(SAMPLE);
  const erp = m.groups.find((g) => g.name === 'Projeto ERP');
  assert.ok(erp && erp.members.includes('gu') && erp.size === 4);
});

test('catálogo de conhecimentos: nomes, importância e conhecimento exclusivo essencial', () => {
  const people = ['a', 'b', 'c'].map((id) => person(id, { knowledge: 2 }));
  people[0].skills = ['k1', 'k2'];
  people[1].skills = ['k2'];
  const d = base(people, [rel('a', 'b'), rel('b', 'c'), rel('a', 'c')]);
  d.knowledge = [
    { id: 'k1', name: 'Torno CNC', category: 'Máquinas', importance: 3 },
    { id: 'k2', name: 'Excel', category: 'Sistemas', importance: 1 },
  ];
  const m = A.analyze(d);
  assert.deepEqual(m.byId.get('a').uniqueSkills, ['Torno CNC']);
  assert.deepEqual(m.byId.get('a').uniqueEssential, ['Torno CNC']);
  assert.equal(m.skills.find((s) => s.id === 'k1').importance, 3);
  // Mesmo com nota de conhecimento baixa, ser o único com algo essencial pesa em "não pode perder".
  const b = A.decisionBoard(d, m);
  assert.ok(b.people.find((p) => p.id === 'a').reasons.reter.some((r) => r.includes('Torno CNC')));
  // Exclusivo essencial pesa mais que exclusivo desejável.
  d.knowledge[0].importance = 1;
  assert.ok(A.analyze(d).byId.get('a').knowledgeRisk < m.byId.get('a').knowledgeRisk);
});
