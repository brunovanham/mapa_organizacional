/*
 * csvio.js — exporta e importa a empresa inteira num CSV estruturado,
 * pensado para abrir e editar no Excel (pt-BR).
 *
 * Formato: um único arquivo, separador ";" e UTF-8 com BOM, dividido em
 * blocos. Cada bloco começa com uma linha "#NOME" e tem o seu cabeçalho:
 *   #CONFIGURACOES  campo;valor
 *   #SETORES        setor;cor
 *   #CONHECIMENTOS  conhecimento;categoria;importancia
 *   #COLABORADORES  nome;cargo;setor;nivel;chefe;...;conhecimentos;observacoes;id
 *   #RELACOES       pessoa;relacao;com_quem;frequencia;clima;observacoes
 *   #OCORRENCIAS    data;tipo;quem_fez;afetados;gravidade;descricao
 * Pessoas, setores e conhecimentos são referenciados pelo NOME. Listas
 * dentro de uma célula usam "|". Valores aparecem em palavras ("Tende a
 * apoiar", "Toda semana"), mas números também são aceitos na importação.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CsvIO = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEP = ';';
  const STANCE_WORDS = { '-2': 'Resiste', '-1': 'Tende a resistir', 0: 'Neutro', 1: 'Tende a apoiar', 2: 'Apoia' };
  const STRENGTH_WORDS = { 1: 'Raramente', 2: 'Às vezes', 3: 'Toda semana', 4: 'Quase todo dia', 5: 'Todo dia / muito próximos' };
  const SENTIMENT_WORDS = { 2: 'Muito bom', 1: 'Bom', 0: 'Neutro', '-1': 'Tenso', '-2': 'Hostil' };
  const IMPORTANCE_WORDS = { 3: 'Essencial', 2: 'Importante', 1: 'Desejável' };
  const SEVERITY_WORDS = { 1: 'Muito leve', 2: 'Leve', 3: 'Média', 4: 'Grave', 5: 'Muito grave' };
  const FORMAL_WORDS = { 0: 'Não', 1: 'Sim, contato raro', 2: 'Sim, às vezes', 3: 'Sim, semanal' };

  const PEOPLE_COLS = [
    'nome', 'cargo', 'setor', 'nivel', 'chefe', 'tempo_de_casa_anos', 'grupos',
    'desempenho_1a5', 'motivo_desempenho', 'engajamento_1a5', 'motivo_engajamento',
    'dificil_substituir_0a5', 'motivo_dificil_substituir', 'postura_com_gerente', 'motivo_postura',
    'conhecimentos', 'observacoes', 'id',
  ];

  // ------------------------------------------------------------ utilidades
  const norm = (s) =>
    String(s === null || s === undefined ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const line = (arr) => arr.map(cell).join(SEP);
  const list = (arr) => (arr || []).filter(Boolean).join(' | ');
  const splitList = (s) =>
    String(s || '')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
  // Procura o valor numérico a partir de palavra ou número.
  function fromWords(value, words, { min, max } = {}) {
    const v = String(value === null || value === undefined ? '' : value).trim();
    if (!v) return null;
    const num = Number(v.replace(',', '.').replace(/^\+/, ''));
    if (Number.isFinite(num)) return min !== undefined ? Math.max(min, Math.min(max, Math.round(num))) : num;
    const n = norm(v);
    for (const [k, w] of Object.entries(words)) if (norm(w) === n) return Number(k);
    for (const [k, w] of Object.entries(words)) if (norm(w).startsWith(n) || n.startsWith(norm(w))) return Number(k);
    return undefined; // não reconhecido
  }

  // ------------------------------------------------------------ exportação
  function toCSV(data, A) {
    const people = data.people || [];
    const pname = new Map(people.map((p) => [p.id, p.name || '']));
    const depName = new Map((data.departments || []).map((d) => [d.id, d.name]));
    const kName = new Map((data.knowledge || []).map((k) => [k.id, k.name]));
    const relLabel = (t) => ((A.RELATION_TYPES[t] || {}).label || t).split(' (')[0];
    const incLabel = (t) => (A.INCIDENT_TYPES[t] || {}).label || t;
    const note = (p, f) => (((p.gradeNotes || {})[f] || {}).text || '');
    const out = [];
    const block = (name, header, rows) => {
      out.push('#' + name);
      out.push(line(header));
      rows.forEach((r) => out.push(line(r)));
      out.push('');
    };
    const s = data.settings || {};
    block('CONFIGURACOES', ['campo', 'valor'], [
      ['empresa', s.companyName || ''],
      ['gerente', s.focalId ? pname.get(s.focalId) || '' : ''],
      ['chefe_e_equipe_contam_como_relacao', FORMAL_WORDS[s.formalTieStrength ?? 2] || 'Sim, às vezes'],
      ['formato', 'mapa-organizacional-csv-v1'],
    ]);
    block('SETORES', ['setor', 'cor'], (data.departments || []).map((d) => [d.name, d.color || '']));
    block('CONHECIMENTOS', ['conhecimento', 'categoria', 'importancia'], (data.knowledge || []).map((k) => [k.name, k.category || 'Outros', IMPORTANCE_WORDS[k.importance || 2]]));
    block(
      'COLABORADORES',
      PEOPLE_COLS,
      people.map((p) => [
        p.name || '',
        p.role || '',
        depName.get(p.departmentId) || '',
        A.LEVELS[p.level] || '',
        p.managerId ? pname.get(p.managerId) || '' : '',
        p.tenure ?? '',
        list(p.groups),
        p.performance ?? '',
        note(p, 'performance'),
        p.engagement ?? '',
        note(p, 'engagement'),
        p.knowledge ?? '',
        note(p, 'knowledge'),
        p.stance === null || p.stance === undefined || p.stance === '' ? '' : STANCE_WORDS[p.stance] || p.stance,
        note(p, 'stance'),
        list((p.skills || []).map((k) => kName.get(k) || k)),
        p.notes || '',
        p.id,
      ])
    );
    block(
      'RELACOES',
      ['pessoa', 'relacao', 'com_quem', 'frequencia', 'clima', 'observacoes'],
      (data.relations || []).map((r) => [
        pname.get(r.source) || '',
        relLabel(r.type),
        pname.get(r.target) || '',
        STRENGTH_WORDS[r.strength] || r.strength,
        r.sentiment === null || r.sentiment === undefined || r.sentiment === '' ? '' : SENTIMENT_WORDS[r.sentiment] || r.sentiment,
        r.notes || '',
      ])
    );
    block(
      'OCORRENCIAS',
      ['data', 'tipo', 'quem_fez', 'afetados', 'gravidade', 'descricao'],
      (data.incidents || []).map((ev) => [
        ev.date || '',
        incLabel(ev.type),
        list((ev.actors || []).map((id) => pname.get(id))),
        list((ev.targets || []).map((id) => pname.get(id))),
        SEVERITY_WORDS[ev.severity] || ev.severity || '',
        ev.description || '',
      ])
    );
    return '﻿' + out.join('\r\n');
  }

  // ------------------------------------------------------------ leitura CSV
  function detectSep(text) {
    const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
    let semi = 0;
    let comma = 0;
    let q = false;
    for (const ch of sample) {
      if (ch === '"') q = !q;
      else if (!q && ch === ';') semi++;
      else if (!q && ch === ',') comma++;
    }
    return semi >= comma ? ';' : ',';
  }

  /** Lê CSV com aspas, aspas duplicadas e quebras de linha dentro de células. */
  function parseCSV(text, sep) {
    text = String(text).replace(/^﻿/, '');
    sep = sep || detectSep(text);
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else q = false;
        } else field += ch;
      } else if (ch === '"' && field === '') q = true; // aspas só abrem no início da célula
      else if (ch === sep) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  const isStructured = (text) => /(^|\n)\s*"?#COLABORADORES/i.test(String(text).replace(/^﻿/, ''));

  // ------------------------------------------------------------ importação
  /**
   * Converte o CSV estruturado no formato de dados do sistema.
   * Retorna { data, warnings, counts }. Linhas com problema são puladas e
   * descritas em warnings; nada é gravado aqui.
   */
  function fromCSV(text, A, opts) {
    const uid = (opts && opts.uid) || ((p) => p + Math.random().toString(36).slice(2, 10));
    const palette = (opts && opts.palette) || ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];
    const rows = parseCSV(text);
    const blocks = {};
    let cur = null;
    rows.forEach((r, i) => {
      const first = (r[0] || '').trim();
      if (first.startsWith('#')) {
        cur = { name: norm(first.slice(1)).replace(/[^a-z]/g, ''), header: null, rows: [] };
        blocks[cur.name] = cur;
        return;
      }
      if (!cur || r.every((c) => !String(c).trim())) return;
      if (!cur.header) cur.header = r.map((h) => norm(h).replace(/\s+/g, '_'));
      else cur.rows.push({ line: i + 1, cells: r });
    });
    const warnings = [];
    const warn = (b, line, msg) => warnings.push(`${b}, linha ${line}: ${msg}`);
    const get = (blk, row, col) => {
      const i = blk.header.indexOf(col);
      return i >= 0 ? String(row.cells[i] ?? '').trim() : '';
    };
    if (!blocks.colaboradores) throw new Error('O arquivo não tem o bloco #COLABORADORES. Use um arquivo exportado pelo sistema como modelo.');

    const data = { version: 1, settings: { companyName: '', focalId: null, formalTieStrength: 2 }, departments: [], people: [], relations: [], incidents: [], knowledge: [] };

    // Setores
    const depByName = new Map();
    const ensureDep = (name, color) => {
      const n = String(name || '').trim();
      if (!n) return null;
      let d = depByName.get(norm(n));
      if (!d) {
        d = { id: uid('d'), name: n, color: color || palette[data.departments.length % palette.length] };
        data.departments.push(d);
        depByName.set(norm(n), d);
      }
      return d.id;
    };
    for (const r of (blocks.setores || { rows: [] }).rows) ensureDep(get(blocks.setores, r, 'setor'), get(blocks.setores, r, 'cor') || null);

    // Conhecimentos
    const kByName = new Map();
    const ensureK = (name, category, importance) => {
      const n = String(name || '').trim();
      if (!n) return null;
      let k = kByName.get(norm(n));
      if (!k) {
        k = { id: uid('k'), name: n, category: (category || 'Outros').trim() || 'Outros', importance: importance || 2 };
        data.knowledge.push(k);
        kByName.set(norm(n), k);
      }
      return k.id;
    };
    for (const r of (blocks.conhecimentos || { rows: [] }).rows) {
      const b = blocks.conhecimentos;
      let imp = fromWords(get(b, r, 'importancia'), IMPORTANCE_WORDS, { min: 1, max: 3 });
      if (imp === undefined) {
        warn('CONHECIMENTOS', r.line, `importância "${get(b, r, 'importancia')}" não reconhecida; usei "Importante".`);
        imp = 2;
      }
      ensureK(get(b, r, 'conhecimento'), get(b, r, 'categoria'), imp ?? 2);
    }

    // Colaboradores (primeira passada: cria todos; segunda: chefes)
    const P = blocks.colaboradores;
    const byName = new Map();
    const levelWords = Object.fromEntries(Object.entries(A.LEVELS));
    const pending = [];
    for (const r of P.rows) {
      const name = get(P, r, 'nome');
      if (!name) {
        warn('COLABORADORES', r.line, 'sem nome; linha ignorada.');
        continue;
      }
      if (byName.has(norm(name))) {
        warn('COLABORADORES', r.line, `"${name}" aparece duas vezes; mantive a primeira.`);
        continue;
      }
      const grade = (col, field, words, min, max) => {
        const raw = get(P, r, col);
        const v = fromWords(raw, words || {}, { min, max });
        if (v === undefined) {
          warn('COLABORADORES', r.line, `${field} "${raw}" não reconhecido; ficou "?".`);
          return null;
        }
        return v;
      };
      const notes = {};
      for (const [f, col] of [['performance', 'motivo_desempenho'], ['engagement', 'motivo_engajamento'], ['knowledge', 'motivo_dificil_substituir'], ['stance', 'motivo_postura']]) {
        const t = get(P, r, col);
        if (t) notes[f] = { text: t, date: new Date().toISOString().slice(0, 10) };
      }
      let level = fromWords(get(P, r, 'nivel'), levelWords, { min: 1, max: 5 });
      if (level === undefined) {
        warn('COLABORADORES', r.line, `nível "${get(P, r, 'nivel')}" não reconhecido; usei "Técnico / Analista".`);
        level = 2;
      }
      const tenureRaw = get(P, r, 'tempo_de_casa_anos');
      const p = {
        id: get(P, r, 'id') || uid('p'),
        name,
        role: get(P, r, 'cargo'),
        departmentId: ensureDep(get(P, r, 'setor')),
        level: level ?? 2,
        managerId: null,
        tenure: tenureRaw === '' || !Number.isFinite(Number(tenureRaw.replace(',', '.'))) ? null : Number(tenureRaw.replace(',', '.')),
        groups: splitList(get(P, r, 'grupos')),
        performance: grade('desempenho_1a5', 'desempenho', {}, 1, 5),
        engagement: grade('engajamento_1a5', 'engajamento', {}, 1, 5),
        knowledge: grade('dificil_substituir_0a5', 'difícil de substituir', {}, 0, 5),
        stance: grade('postura_com_gerente', 'postura', STANCE_WORDS, -2, 2),
        gradeNotes: notes,
        skills: splitList(get(P, r, 'conhecimentos')).map((k) => ensureK(k, 'Outros', 2)),
        notes: get(P, r, 'observacoes'),
      };
      if (data.people.some((x) => x.id === p.id)) p.id = uid('p');
      data.people.push(p);
      byName.set(norm(name), p);
      pending.push([p, get(P, r, 'chefe'), r.line]);
    }
    const findPerson = (name) => byName.get(norm(name));
    for (const [p, boss, ln] of pending) {
      if (!boss) continue;
      const b = findPerson(boss);
      if (!b) warn('COLABORADORES', ln, `chefe "${boss}" não encontrado entre os colaboradores.`);
      else if (b !== p) p.managerId = b.id;
    }

    // Relações
    const relByLabel = new Map();
    for (const [k, t] of Object.entries(A.RELATION_TYPES)) {
      relByLabel.set(norm(k), k);
      relByLabel.set(norm(t.label), k);
      relByLabel.set(norm(t.label.split(' (')[0]), k);
    }
    const R = blocks.relacoes;
    for (const r of R ? R.rows : []) {
      const a = findPerson(get(R, r, 'pessoa'));
      const b = findPerson(get(R, r, 'com_quem'));
      const typeRaw = get(R, r, 'relacao');
      const type = relByLabel.get(norm(typeRaw));
      if (!a || !b) {
        warn('RELACOES', r.line, `pessoa "${!a ? get(R, r, 'pessoa') : get(R, r, 'com_quem')}" não encontrada; relação ignorada.`);
        continue;
      }
      if (a === b) {
        warn('RELACOES', r.line, 'relação de uma pessoa com ela mesma; ignorada.');
        continue;
      }
      if (!type) {
        warn('RELACOES', r.line, `tipo de relação "${typeRaw}" não reconhecido; relação ignorada.`);
        continue;
      }
      let strength = fromWords(get(R, r, 'frequencia'), STRENGTH_WORDS, { min: 1, max: 5 });
      if (strength === undefined || strength === null) {
        if (strength === undefined) warn('RELACOES', r.line, `frequência "${get(R, r, 'frequencia')}" não reconhecida; usei "Toda semana".`);
        strength = 3;
      }
      let sentiment = fromWords(get(R, r, 'clima'), SENTIMENT_WORDS, { min: -2, max: 2 });
      if (sentiment === undefined) {
        warn('RELACOES', r.line, `clima "${get(R, r, 'clima')}" não reconhecido; usei o normal do tipo.`);
        sentiment = null;
      }
      data.relations.push({ id: uid('r'), source: a.id, target: b.id, type, strength, sentiment, notes: get(R, r, 'observacoes') });
    }

    // Ocorrências
    const incByLabel = new Map();
    for (const [k, t] of Object.entries(A.INCIDENT_TYPES)) {
      incByLabel.set(norm(k), k);
      incByLabel.set(norm(t.label), k);
    }
    const O = blocks.ocorrencias;
    for (const r of O ? O.rows : []) {
      const people = (col) =>
        splitList(get(O, r, col))
          .map((n) => {
            const p = findPerson(n);
            if (!p) warn('OCORRENCIAS', r.line, `pessoa "${n}" não encontrada.`);
            return p && p.id;
          })
          .filter(Boolean);
      const typeRaw = get(O, r, 'tipo');
      const type = incByLabel.get(norm(typeRaw)) || 'outro';
      if (!incByLabel.get(norm(typeRaw))) warn('OCORRENCIAS', r.line, `tipo "${typeRaw}" não reconhecido; usei "Outro".`);
      const sev = fromWords(get(O, r, 'gravidade'), SEVERITY_WORDS, { min: 1, max: 5 });
      data.incidents.push({
        id: uid('i'),
        date: get(O, r, 'data'),
        type,
        actors: people('quem_fez'),
        targets: people('afetados'),
        severity: sev === undefined || sev === null ? 3 : sev,
        description: get(O, r, 'descricao'),
      });
    }

    // Configurações
    const C = blocks.configuracoes;
    for (const r of C ? C.rows : []) {
      const field = norm(get(C, r, 'campo'));
      const value = get(C, r, 'valor');
      if (field === 'empresa') data.settings.companyName = value;
      else if (field === 'gerente' && value) {
        const g = findPerson(value);
        if (g) data.settings.focalId = g.id;
        else warn('CONFIGURACOES', r.line, `gerente "${value}" não encontrado entre os colaboradores.`);
      } else if (field.startsWith('chefe_e_equipe')) {
        const v = fromWords(value, FORMAL_WORDS, { min: 0, max: 3 });
        if (v !== undefined && v !== null) data.settings.formalTieStrength = v;
      }
    }

    return {
      data,
      warnings,
      counts: {
        colaboradores: data.people.length,
        setores: data.departments.length,
        conhecimentos: data.knowledge.length,
        relacoes: data.relations.length,
        ocorrencias: data.incidents.length,
      },
    };
  }

  return { toCSV, fromCSV, parseCSV, isStructured };
});
