# Mapa Organizacional

Sistema de **Análise de Redes Organizacionais (ONA)** para apoiar as decisões da diretoria e do gerente geral.
Ele mostra com quem ter cuidado, quem trazer para o seu lado, quem é influente, onde uma demissão é um risco
e onde é possível cortar. Para isso, usa o cadastro de colaboradores, notas e vínculos entre as pessoas.

- **Interface gráfica** publicada de graça no GitHub Pages, sem instalação.
- **Os dados ficam no próprio GitHub**, num arquivo JSON dentro de um repositório **privado**. Não há banco de dados.
  Cada gravação vira uma versão no histórico, com auditoria e a possibilidade de voltar atrás.
- **Sem login**: a chave de acesso é configurada uma vez por navegador, ou recebida por um *link de acesso*.

## Arquitetura

```
 Navegador (GitHub Pages, público)                  GitHub (repositório PRIVADO)
 ┌───────────────────────────────┐   API GitHub    ┌──────────────────────────────┐
 │ index.html + js/ (interface)  │ ──── lê ──────▶ │ dados/organizacao.json       │
 │ análise roda no navegador     │ ◀─── grava ──── │ (cada gravação = 1 commit)   │
 │ cache local (localStorage)    │                 └──────────────────────────────┘
 └───────────────────────────────┘
```

Este repositório (`mapa_organizacional`) é **público** e contém só o código. **Nunca** coloque dados de
colaboradores aqui: use o repositório privado de dados.

## Empresas com código de acesso (várias visões)

Qualquer pessoa pode **criar a empresa dela** e acessá-la depois só com o **código que escolheu**.
Cada empresa é um arquivo `empresas/<id>.json` no repositório de dados, **criptografado com o código**:
ninguém abre uma empresa sem o código dela, nem o administrador. Isso exige um pequeno servidor gratuito
(Cloudflare Worker, pasta `worker/`) que guarda a chave do GitHub fora do site público.
Passo a passo em [`docs/SERVIDOR.md`](docs/SERVIDOR.md).

## Colocar no ar (uma única vez, ~10 minutos)

1. **Publicar a interface**: em *Settings → Pages* deste repositório, escolha *Source: GitHub Actions*.
   Depois rode o workflow *Publicar interface* (aba *Actions → Run workflow*). O endereço fica parecido com
   `https://brunovanham.github.io/mapa_organizacional/`.
2. **Criar o repositório de dados** (privado): em <https://github.com/new>, crie por exemplo `mapa_organizacional_dados`,
   marque **Private** e marque *Add a README file*.
3. **Criar a chave de acesso**: em <https://github.com/settings/personal-access-tokens/new> (*fine-grained token*),
   escolha *Only select repositories* → o repositório de dados → *Permissions → Contents: Read and write*,
   defina uma validade e gere a chave.
4. Abra o sistema e vá em **Dados → Armazenamento no GitHub**. Preencha dono, repositório e chave e clique em **Conectar**.
5. Para o gerente geral usar sem login: **Dados → Gerar link de acesso**. Envie o link por um canal privado.
   Quem abrir o link já entra conectado.

> Quem tem o link ou a chave pode ler e alterar os dados. Para revogar o acesso, apague a chave no GitHub e gere outra.

Também funciona sem GitHub: basta abrir `index.html` no navegador, e os dados ficam só naquele computador.

## Como usar

| Aba | Para quê |
|---|---|
| **Painel** | As respostas para o gerente: *atenção: ter cuidado*, *conquistar para o seu lado*, *quem tem voz*, *não pode perder*, *onde dá para cortar* e *aliados*, cada uma com o motivo em uma frase. Tem também o *mapa de decisão* (impacto se sair × postura com o gerente) e o que fazer com cada pessoa. |
| **Colaboradores** | Ficha de cadastro, salva sozinha: setor, grupos, notas por clique (desempenho, se é difícil de substituir, engajamento, postura com o gerente), **checklist de conhecimentos** e relações (tipo, frequência e clima). |
| **Conhecimentos** | A lista do que é importante saber na empresa, por categoria e importância (essencial, importante, desejável). Tem uma lista sugerida pronta e mostra **quem sabe o quê** e o que só uma pessoa sabe. |
| Mapa | Desenho das relações, colorido por setor, postura, grupo ou turma informal. |
| Setores e grupos | União da equipe, contato com outras áreas, conflitos, desempenho e postura média. |
| Relações | Lista de todas as relações e cadastro rápido em lote. |
| Resistência | Grupos de resistência, por quem passa a comunicação do gerente e quem conquistar primeiro. |
| E se sair? | Simula a saída de uma ou mais pessoas: impacto (0 a 100), conhecimento perdido, colegas que podem sair junto e quanto cai a resistência. Inclui uma frase-resumo. |
| Análise detalhada | Rankings, turmas informais, duplas importantes, conflitos, cargo × influência real e dependências perigosas. |
| Ocorrências | Registro de fatos (boicote, retenção de informação…) que embasam conversas e decisões. |
| Dados | GitHub, link de acesso, backup, importação CSV e exemplo fictício. |

A linguagem é pensada para quem não é especialista: os índices aparecem como *Muito baixa … Muito alta* em vez de
números soltos, a postura aparece em palavras (*Apoia*, *Tende a resistir*…), e cada termo tem um **?** com a explicação.

Ordem recomendada: **Conhecimentos** (montar a lista) → **Colaboradores** (cadastro, notas, conhecimentos e relações) → escolher o gerente no **Painel**.

A metodologia, as fórmulas e o plano de ação estão em [`docs/GUIA.md`](docs/GUIA.md).

## Estrutura

```
index.html               interface
css/style.css            estilos (tema claro/escuro, celular)
js/analytics.js          motor de análise e painel de decisão (funções puras, testadas no Node)
js/store.js              estado e cache local
js/github-sync.js        leitura/gravação no GitHub, link de acesso e conflitos
js/app.js                telas
js/sample-data.js        dados fictícios de exemplo
vendor/                  Cytoscape.js (MIT), embutido
tests/                   testes (npm test)
.github/workflows/       testes + publicação no GitHub Pages
```

## Desenvolvimento

```bash
npm start    # servidor local em http://localhost:8080
npm test     # testes do motor de análise
```

## Privacidade (LGPD)

São dados pessoais e avaliações sobre colaboradores. Guarde-os **só** no repositório privado, restrinja quem
recebe o link de acesso e use as análises como **apoio à gestão**, nunca como prova isolada.
Vínculo familiar nunca é motivo de demissão; decisões se baseiam em conduta e desempenho documentados,
com orientação jurídica. Veja `docs/GUIA.md`.
