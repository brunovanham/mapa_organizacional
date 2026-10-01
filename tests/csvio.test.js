// Exportar e importar o CSV estruturado (planilha para Excel).
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/analytics.js');
const CsvIO = require('../js/csvio.js');
const SAMPLE = require('../js/sample-data.js');

const byName = (d) => new Map(d.people.map((p) => [p.name, p]));
const relKey = (d, r) => {
  const n = new Map(d.people.map((p) => [p.id, p.name]));
  return `${n.get(r.source)}|${r.type}|${n.get(r.target)}|${r.strength}|${r.sentiment ?? ''}`;
};

test('ida e volta: exportar e importar não perde nada', () => {
  const csv = CsvIO.toCSV(SAMPLE, A);
  assert.ok(csv.startsWith('﻿'), 'BOM para o Excel reconhecer acentos');
  assert.ok(csv.includes('#COLABORADORES') && csv.includes(';'));
  const { data, warnings, counts } = CsvIO.fromCSV(csv, A);
  assert.deepEqual(warnings, []);
  assert.equal(counts.colaboradores, SAMPLE.people.length);
  assert.equal(counts.relacoes, SAMPLE.relations.length);
  assert.equal(counts.ocorrencias, SAMPLE.incidents.length);
  assert.equal(counts.conhecimentos, SAMPLE.knowledge.length);
  const a = byName(SAMPLE);
  const b = byName(data);
  const kn = (d, p) => p.skills.map((id) => d.knowledge.find((k) => k.id === id).name).sort();
  const dep = (d, p) => (d.departments.find((x) => x.id === p.departmentId) || {}).name;
  for (const [name, p] of a) {
    const q = b.get(name);
    assert.ok(q, name);
    for (const f of ['role', 'level', 'performance', 'engagement', 'knowledge', 'stance', 'notes']) assert.equal(q[f] ?? null, p[f] ?? null, `${name}.${f}`);
    assert.deepEqual(q.groups, p.groups);
    assert.equal(dep(data, q), dep(SAMPLE, p));
    assert.deepEqual(kn(data, q), kn(SAMPLE, p));
    assert.equal(q.managerId ? data.people.find((x) => x.id === q.managerId).name : null, p.managerId ? a.get([...a.values()].find((x) => x.id === p.managerId).name).name : null);
    for (const f of Object.keys(p.gradeNotes || {})) assert.equal(q.gradeNotes[f].text, p.gradeNotes[f].text);
    assert.equal(q.id, p.id, 'id preservado');
  }
  assert.deepEqual(SAMPLE.relations.map((r) => relKey(SAMPLE, r)).sort(), data.relations.map((r) => relKey(data, r)).sort());
  assert.equal(data.settings.focalId, SAMPLE.settings.focalId);
  assert.equal(data.settings.companyName, SAMPLE.settings.companyName);
  // A análise dá o mesmo resultado depois da ida e volta.
  const m1 = A.analyze(SAMPLE);
  const m2 = A.analyze(data);
  assert.deepEqual(m2.metrics.map((m) => [m.name, m.influence.toFixed(6)]), m1.metrics.map((m) => [m.name, m.influence.toFixed(6)]));
});

test('aceita edições feitas no Excel: linhas novas, palavras, vírgula e avisos', () => {
  const csv = [
    '#CONFIGURACOES;;',
    'campo;valor',
    'empresa;Loja Teste',
    'gerente;Ana Lima',
    '',
    '#COLABORADORES;;;;;;;',
    'nome;cargo;setor;nivel;chefe;desempenho_1a5;postura_com_gerente;motivo_postura;conhecimentos',
    'Ana Lima;Gerente;Diretoria;Gerência;;5;;;Excel avançado',
    '"Bruno ""Beto"" Reis";Vendedor;Comercial;2;Ana Lima;3;Tende a resistir;;Negociação | Excel avançado',
    'Carla;Analista;Comercial;Analista inexistente;Fulano;9;-2;Boicote em 10/09;',
    ';sem nome;;;;;;;',
    '',
    '#RELACOES',
    'pessoa;relacao;com_quem;frequencia;clima;observacoes',
    'Ana Lima;Trabalham juntos;Bruno "Beto" Reis;Quase todo dia;Bom;',
    'Bruno "Beto" Reis;boicote;Ana Lima;4;Hostil;atraso proposital',
    'Carla;Amizade;Desconhecido;3;;',
    'Carla;Tipo estranho;Ana Lima;3;;',
  ].join('\r\n');
  const { data, warnings } = CsvIO.fromCSV(csv, A, {});
  const p = byName(data);
  assert.equal(data.settings.companyName, 'Loja Teste');
  assert.equal(data.settings.focalId, p.get('Ana Lima').id);
  assert.equal(p.get('Bruno "Beto" Reis').stance, -1);
  assert.equal(p.get('Bruno "Beto" Reis').managerId, p.get('Ana Lima').id);
  assert.equal(p.get('Ana Lima').level, 4);
  assert.equal(p.get('Carla').performance, 5, 'nota fora da escala é ajustada ao limite');
  assert.equal(p.get('Carla').stance, -2);
  assert.equal(p.get('Carla').gradeNotes.stance.text, 'Boicote em 10/09');
  assert.equal(data.knowledge.length, 2, 'conhecimento repetido vira um só');
  assert.equal(data.relations.length, 2);
  assert.equal(data.relations[1].type, 'boicote');
  assert.equal(data.relations[1].sentiment, -2);
  const joined = warnings.join('\n');
  assert.match(joined, /nível "Analista inexistente"/);
  assert.match(joined, /chefe "Fulano"/);
  assert.match(joined, /sem nome/);
  assert.match(joined, /"Desconhecido" não encontrada/);
  assert.match(joined, /"Tipo estranho" não reconhecido/);
});

test('arquivo sem bloco de colaboradores é recusado', () => {
  assert.throws(() => CsvIO.fromCSV('nome;cargo\nAna;Gerente', A), /#COLABORADORES/);
  assert.equal(CsvIO.isStructured('nome;cargo\nAna;Gerente'), false);
  assert.equal(CsvIO.isStructured('﻿#CONFIGURACOES\n#COLABORADORES;;\n'), true);
});

test('Excel salvando com vírgula como separador também funciona', () => {
  const csv = CsvIO.toCSV(SAMPLE, A).replace(/^﻿/, '');
  const rows = CsvIO.parseCSV(csv, ';');
  const withComma = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\n');
  const { counts } = CsvIO.fromCSV(withComma, A);
  assert.equal(counts.colaboradores, SAMPLE.people.length);
  assert.equal(counts.relacoes, SAMPLE.relations.length);
});
