/*
 * Dados FICTÍCIOS de exemplo — empresa inventada, nomes inventados.
 * Reproduzem o cenário típico: gerente geral externo recém-contratado,
 * gerente interno preterido e cônjuge também gerente formando um núcleo de resistência.
 */
(function (root) {
  const D = (id, name, color) => ({ id, name, color });
  const P = (id, name, role, departmentId, level, managerId, knowledge, skills, stance, tenure) => ({
    id, name, role, departmentId, level, managerId, knowledge, skills, stance, tenure, notes: '',
  });
  let rid = 0;
  const R = (source, target, type, strength, sentiment, notes) => ({
    id: 'r' + ++rid, source, target, type, strength,
    sentiment: sentiment === undefined ? null : sentiment, notes: notes || '',
  });

  const SAMPLE_DATA = {
    version: 1,
    settings: { companyName: 'Empresa Exemplo (fictícia)', focalId: 'gg', formalTieStrength: 2 },
    departments: [
      D('dir', 'Diretoria', '#5b6ee1'),
      D('ops', 'Operações', '#e07a3f'),
      D('com', 'Comercial', '#2fa37a'),
      D('fin', 'Financeiro', '#b0569e'),
      D('log', 'Logística', '#c9a227'),
      D('rh', 'RH / Administrativo', '#3f9fc4'),
    ],
    people: [
      P('ceo', 'Carlos Mendes', 'CEO', 'dir', 5, null, 5, ['estratégia', 'relacionamento com bancos'], 2, 15),
      P('gg', 'Marina Alves', 'Gerente Geral (novo, externo)', 'dir', 5, 'ceo', 4, ['gestão de indicadores', 'lean'], null, 0.3),
      P('rs', 'Ricardo Souza', 'Gerente de Operações', 'ops', 4, 'gg', 5, ['planejamento de produção', 'erp - módulo produção', 'fornecedores-chave'], -2, 9),
      P('js', 'Juliana Souza', 'Gerente Comercial', 'com', 4, 'gg', 4, ['carteira de grandes clientes', 'precificação'], -2, 7),
      P('pl', 'Paulo Lima', 'Gerente Financeiro', 'fin', 4, 'gg', 4, ['fluxo de caixa', 'fiscal'], 0, 6),
      P('fr', 'Fernanda Rocha', 'Coordenadora de RH', 'rh', 3, 'gg', 3, ['folha de pagamento', 'trabalhista'], 2, 4),
      P('an', 'Anderson Pires', 'Supervisor de Produção', 'ops', 3, 'rs', 4, ['manutenção de máquinas', 'planejamento de produção'], null, 8),
      P('bc', 'Bruna Costa', 'Supervisora de Qualidade', 'ops', 3, 'rs', 4, ['qualidade iso', 'auditoria'], null, 5),
      P('dg', 'Diego Martins', 'Operador', 'ops', 1, 'an', 2, [], null, 3),
      P('ed', 'Eduarda Nunes', 'Operadora', 'ops', 1, 'an', 2, [], null, 2),
      P('fe', 'Felipe Ramos', 'Técnico de Manutenção', 'ops', 2, 'an', 4, ['manutenção de máquinas', 'elétrica industrial'], null, 6),
      P('gu', 'Gustavo Teixeira', 'Analista de Sistemas', 'ops', 2, 'rs', 5, ['erp - módulo produção', 'erp - integrações', 'banco de dados'], null, 7),
      P('mt', 'Mateus Barros', 'Coordenador Comercial', 'com', 3, 'js', 3, ['carteira de grandes clientes', 'crm'], null, 5),
      P('he', 'Helena Duarte', 'Vendedora Sênior', 'com', 2, 'mt', 4, ['carteira regional sul', 'negociação'], null, 6),
      P('ig', 'Igor Freitas', 'Vendedor', 'com', 2, 'mt', 2, ['negociação'], null, 1),
      P('la', 'Larissa Moura', 'Assistente Comercial', 'com', 1, 'mt', 2, ['crm'], null, 2),
      P('na', 'Natália Campos', 'Analista Financeira', 'fin', 2, 'pl', 3, ['fluxo de caixa', 'cobrança'], null, 3),
      P('ot', 'Otávio Reis', 'Contador', 'fin', 2, 'pl', 4, ['fiscal', 'contabilidade'], null, 10),
      P('pr', 'Priscila Andrade', 'Coordenadora de Logística', 'log', 3, 'gg', 4, ['roteirização', 'fornecedores-chave'], null, 6),
      P('rf', 'Rafael Gomes', 'Analista de Logística', 'log', 2, 'pr', 2, ['roteirização'], null, 2),
      P('se', 'Sérgio Vieira', 'Motorista / Expedição', 'log', 1, 'pr', 2, [], null, 8),
      P('tc', 'Tânia Correia', 'Assistente Administrativa', 'rh', 1, 'fr', 2, ['compras'], null, 3),
    ],
    relations: [
      // Casal e núcleo de resistência
      R('rs', 'js', 'familiar', 5, 2, 'Casados'),
      R('rs', 'gg', 'boicote', 4, -2, 'Não repassa informações de produção ao GG'),
      R('js', 'gg', 'conflito', 4, -2, 'Contradiz decisões do GG nas reuniões'),
      R('rs', 'an', 'amizade', 5, 2, 'Trabalham juntos há 8 anos'),
      R('rs', 'an', 'influencia', 5),
      R('rs', 'gu', 'colaboracao', 4),
      R('rs', 'bc', 'colaboracao', 3),
      R('rs', 'pr', 'colaboracao', 3),
      R('rs', 'ceo', 'colaboracao', 3, 1, 'Relação antiga com o CEO'),
      R('js', 'mt', 'amizade', 4),
      R('js', 'mt', 'influencia', 5),
      R('js', 'he', 'colaboracao', 4),
      R('js', 'pl', 'colaboracao', 2),
      R('an', 'dg', 'influencia', 4),
      R('an', 'ed', 'influencia', 4),
      R('an', 'fe', 'colaboracao', 4),
      R('an', 'gg', 'conflito', 2, -1, 'Ignorou orientação do GG uma vez'),
      R('mt', 'ig', 'mentoria', 3),
      R('mt', 'la', 'colaboracao', 4),
      R('mt', 'he', 'colaboracao', 3),
      // Gerente geral
      R('gg', 'ceo', 'colaboracao', 5, 2),
      R('gg', 'fr', 'colaboracao', 4, 2),
      R('gg', 'pl', 'colaboracao', 3, 1),
      R('gg', 'pr', 'colaboracao', 3, 1),
      R('gg', 'bc', 'colaboracao', 2, 1),
      // Restante da rede
      R('ceo', 'pl', 'colaboracao', 4),
      R('ceo', 'fr', 'colaboracao', 2),
      R('pl', 'na', 'colaboracao', 4),
      R('pl', 'ot', 'colaboracao', 4),
      R('na', 'he', 'informacao', 2),
      R('na', 'la', 'amizade', 3),
      R('ot', 'tc', 'colaboracao', 2),
      R('fr', 'tc', 'colaboracao', 4),
      R('fr', 'bc', 'amizade', 3),
      R('bc', 'fe', 'colaboracao', 2),
      R('bc', 'gu', 'colaboracao', 3),
      R('gu', 'pl', 'informacao', 3),
      R('gu', 'na', 'informacao', 2),
      R('gu', 'fe', 'colaboracao', 2),
      R('pr', 'rf', 'colaboracao', 4),
      R('pr', 'se', 'colaboracao', 3),
      R('pr', 'he', 'colaboracao', 3),
      R('pr', 'an', 'colaboracao', 2),
      R('rf', 'se', 'amizade', 3),
      R('se', 'dg', 'amizade', 4),
      R('ig', 'la', 'amizade', 3),
      R('he', 'ig', 'mentoria', 4),
      R('ed', 'dg', 'amizade', 3),
      R('tc', 'la', 'amizade', 2),
    ],
    incidents: [
      {
        id: 'i1', date: '2026-08-12', type: 'retencao_info', actors: ['rs'], targets: ['gg'], severity: 4,
        description: 'Relatório de produção semanal entregue ao GG com 3 dias de atraso, sem os indicadores pedidos.',
      },
      {
        id: 'i2', date: '2026-08-20', type: 'desautorizacao', actors: ['js'], targets: ['gg'], severity: 3,
        description: 'Em reunião comercial, disse à equipe que a nova política de descontos "não vai durar".',
      },
      {
        id: 'i3', date: '2026-09-03', type: 'descumprimento', actors: ['an'], targets: ['gg'], severity: 2,
        description: 'Escala de turno definida pelo GG não foi aplicada; manteve a escala antiga.',
      },
      {
        id: 'i4', date: '2026-09-10', type: 'apoio', actors: ['fr', 'pr'], targets: ['gg'], severity: 3,
        description: 'Ajudaram a implantar o novo ritual de indicadores semanais.',
      },
    ],
  };

  // Notas (desempenho, engajamento — 1 a 5) e grupos/equipes de cada pessoa.
  const GRADES = {
    ceo: [5, 5, []],
    gg: [4, 5, ['Comitê de gestão']],
    rs: [4, 2, ['Comitê de gestão', 'Projeto ERP']],
    js: [4, 2, ['Comitê de gestão', 'Contas-chave']],
    pl: [4, 3, ['Comitê de gestão', 'Projeto ERP']],
    fr: [4, 5, ['Comitê de gestão', 'Comitê de qualidade']],
    an: [3, 2, ['Turno A']],
    bc: [4, 4, ['Comitê de qualidade']],
    dg: [2, 2, ['Turno A']],
    ed: [3, 3, ['Turno A']],
    fe: [4, 3, ['Comitê de qualidade']],
    gu: [5, 3, ['Projeto ERP', 'Comitê de qualidade']],
    mt: [3, 3, ['Contas-chave']],
    he: [5, 4, ['Contas-chave']],
    ig: [2, 2, []],
    la: [3, 3, []],
    na: [3, 4, ['Projeto ERP']],
    ot: [3, 3, []],
    pr: [4, 4, ['Comitê de gestão']],
    rf: [3, 4, []],
    se: [3, 3, []],
    tc: [2, 3, []],
  };
  for (const p of SAMPLE_DATA.people) {
    const [performance, engagement, groups] = GRADES[p.id] || [null, null, []];
    Object.assign(p, { performance, engagement, groups });
  }

  // Catálogo de conhecimentos (a ficha marca itens desta lista, como um checklist).
  // importance: 3 = essencial, 2 = importante, 1 = desejável.
  const K = (id, name, category, importance, legacy) => ({ id, name, category, importance, legacy });
  const CATALOG = [
    K('k_estrategia', 'Estratégia do negócio', 'Gestão', 3, 'estratégia'),
    K('k_bancos', 'Relacionamento com bancos', 'Gestão', 3, 'relacionamento com bancos'),
    K('k_indicadores', 'Gestão por indicadores', 'Gestão', 2, 'gestão de indicadores'),
    K('k_lean', 'Lean / melhoria contínua', 'Gestão', 1, 'lean'),
    K('k_pcp', 'Planejamento da produção', 'Operações e produção', 3, 'planejamento de produção'),
    K('k_manut', 'Manutenção de máquinas', 'Operações e produção', 3, 'manutenção de máquinas'),
    K('k_eletrica', 'Elétrica industrial', 'Operações e produção', 2, 'elétrica industrial'),
    K('k_iso', 'Qualidade (ISO)', 'Operações e produção', 2, 'qualidade iso'),
    K('k_auditoria', 'Auditoria interna', 'Operações e produção', 2, 'auditoria'),
    K('k_erp_prod', 'Sistema ERP – produção', 'Sistemas e tecnologia', 3, 'erp - módulo produção'),
    K('k_erp_integ', 'Sistema ERP – integrações', 'Sistemas e tecnologia', 3, 'erp - integrações'),
    K('k_bd', 'Banco de dados e relatórios', 'Sistemas e tecnologia', 2, 'banco de dados'),
    K('k_crm', 'CRM (cadastro de clientes)', 'Sistemas e tecnologia', 1, 'crm'),
    K('k_grandes', 'Carteira de grandes clientes', 'Comercial', 3, 'carteira de grandes clientes'),
    K('k_sul', 'Carteira de clientes do Sul', 'Comercial', 2, 'carteira regional sul'),
    K('k_preco', 'Formação de preços', 'Comercial', 3, 'precificação'),
    K('k_negoc', 'Negociação', 'Comercial', 1, 'negociação'),
    K('k_fornec', 'Fornecedores-chave', 'Logística e compras', 3, 'fornecedores-chave'),
    K('k_rotas', 'Roteiros de entrega', 'Logística e compras', 2, 'roteirização'),
    K('k_compras', 'Compras', 'Logística e compras', 1, 'compras'),
    K('k_caixa', 'Fluxo de caixa', 'Financeiro e administrativo', 2, 'fluxo de caixa'),
    K('k_fiscal', 'Fiscal / impostos', 'Financeiro e administrativo', 3, 'fiscal'),
    K('k_contab', 'Contabilidade', 'Financeiro e administrativo', 2, 'contabilidade'),
    K('k_cobranca', 'Cobrança', 'Financeiro e administrativo', 1, 'cobrança'),
    K('k_folha', 'Folha de pagamento', 'Financeiro e administrativo', 2, 'folha de pagamento'),
    K('k_trab', 'Legislação trabalhista', 'Financeiro e administrativo', 2, 'trabalhista'),
  ];
  const byLegacy = new Map(CATALOG.map((k) => [k.legacy, k.id]));
  SAMPLE_DATA.knowledge = CATALOG.map(({ legacy, ...k }) => k);
  for (const p of SAMPLE_DATA.people) p.skills = p.skills.map((s) => byLegacy.get(s) || s);

  // Lista sugerida para quem está começando: aparece no catálogo de conhecimentos.
  const KNOWLEDGE_SUGGESTIONS = {
    Gestão: ['Gestão de equipes', 'Planejamento estratégico', 'Gestão por indicadores', 'Orçamento e custos', 'Gestão de projetos'],
    Comercial: ['Carteira de clientes-chave', 'Negociação', 'Formação de preços', 'Prospecção de novos clientes', 'Pós-venda e atendimento'],
    'Operações e produção': ['Planejamento da produção', 'Operação de máquinas', 'Manutenção de máquinas', 'Controle de qualidade', 'Segurança do trabalho', 'Lean / melhoria contínua'],
    'Logística e compras': ['Compras e fornecedores-chave', 'Controle de estoque', 'Roteiros de entrega', 'Comércio exterior'],
    'Financeiro e administrativo': ['Contas a pagar e receber', 'Fluxo de caixa', 'Fiscal / impostos', 'Contabilidade', 'Folha de pagamento', 'Legislação trabalhista', 'Recrutamento e seleção'],
    'Sistemas e tecnologia': ['Sistema ERP / de gestão', 'Excel avançado', 'Relatórios e indicadores (BI)', 'Suporte de informática'],
  };

  if (typeof module === 'object' && module.exports) module.exports = SAMPLE_DATA;
  else {
    root.SAMPLE_DATA = SAMPLE_DATA;
    root.KNOWLEDGE_SUGGESTIONS = KNOWLEDGE_SUGGESTIONS;
  }
})(typeof self !== 'undefined' ? self : this);
