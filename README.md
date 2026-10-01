# Mapa Organizacional

Ferramenta de **Análise de Redes Organizacionais (ONA)** para apoiar a tomada de decisão da diretoria:
quem influencia quem, quais são os grupos informais (clusters), onde está o conhecimento crítico,
quem está resistindo ou boicotando uma mudança e qual seria o impacto de uma saída ou demissão.

Roda **100% no navegador**, sem servidor e sem internet: os dados ficam no `localStorage` da máquina
e só saem dela se você exportar o arquivo JSON.

## Como usar

```bash
# opção 1: abrir direto
abra o arquivo index.html no navegador

# opção 2: servidor local (recomendado)
npm start            # equivale a: python3 -m http.server 8080
# acesse http://localhost:8080
```

1. **Dados → Carregar exemplo fictício** para conhecer a ferramenta (empresa e nomes inventados).
2. **Departamentos**: crie as áreas.
3. **Pessoas**: cadastre cada colaborador com cargo, nível, gestor, conhecimento crítico (0–5),
   habilidades e, se souber, o posicionamento em relação à mudança. Também dá para importar um CSV na aba Dados.
4. **Relações**: use o *cadastro rápido* para marcar com quem cada pessoa trabalha, quem influencia,
   amizades, vínculos familiares, conflitos e boicotes, com força (1–5) e sentimento (−2 a +2).
5. **Ocorrências**: registre fatos (data, quem, o quê, gravidade). Eles alimentam a análise e servem de
   base documental para feedbacks e decisões.
6. Defina a **pessoa focal** (ex.: o novo gerente geral) em *Resistência* ou *Dados*.
7. Explore **Mapa**, **Análise**, **Resistência** e **Simulação**.

## O que o sistema calcula

| Aba | O que mostra |
|---|---|
| Mapa | Grafo interativo. Cor por departamento, cluster ou posicionamento. Tamanho por influência, peso, intermediação, risco de conhecimento ou nível. Layout pela rede informal, concêntrico por influência ou pela hierarquia formal. |
| Análise | Ranking (influência, peso, PageRank, intermediação, proximidade, risco de conhecimento), clusters de Louvain, pares-chave, conflitos críticos, organização "sombra" (influência × cargo), pontos únicos de falha, tríades em tensão e recomendações. |
| Resistência | Apoiadores, neutros e resistentes; núcleos de resistência (coalizões) e sua audiência; vínculos familiares dentro do núcleo; "porteiros" de quem a pessoa focal depende; prioridade de engajamento dos neutros; plano de ação. |
| Simulação | Saída de uma ou várias pessoas: custo operacional (0–100), redução da resistência, perda de eficiência da rede, conhecimento perdido, pessoas isoladas e risco de contágio. Também gera o ranking de impacto de todas as pessoas. |

A metodologia completa, as fórmulas e um guia de ação para o cenário de boicote estão em
[`docs/GUIA.md`](docs/GUIA.md).

## Estrutura

```
index.html            interface
css/style.css         estilos (tema claro/escuro)
js/analytics.js       motor de análise (funções puras, testável no Node)
js/store.js           persistência local, importação e exportação
js/app.js             telas, mapa e formulários
js/sample-data.js     dados fictícios de exemplo
vendor/               Cytoscape.js (MIT) embutido para funcionar offline
tests/                testes do motor de análise (npm test)
```

## Testes

```bash
npm test
```

## Privacidade (LGPD)

Este sistema guarda dados pessoais e percepções sobre colaboradores. Restrinja o acesso,
exporte backups para um local protegido, não compartilhe o arquivo e use as análises como
**apoio à gestão**, nunca como prova isolada para punição. Veja a seção de cuidados em `docs/GUIA.md`.
