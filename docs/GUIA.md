# Guia: metodologia e plano de ação

Este guia explica **como coletar os dados**, **o que cada métrica significa**, **como ler os resultados
no cenário de boicote ao novo gerente geral** e **como transformar a análise em ações**.

---

## 1. O problema, visto como rede

O organograma mostra quem manda em quem. A empresa funciona por outra estrutura, informal:
quem conversa com quem, quem pede ajuda a quem, quem é ouvido. Um boicote acontece nessa rede informal.

No cenário típico:

- um **gerente geral externo** chega com autoridade formal, mas ainda não tem laços informais;
- o **gerente interno preterido** tem anos de relacionamento, conhecimento operacional e liderados leais;
- a **cônjuge, também gerente**, amplia o alcance desse grupo para outra área;
- juntos, formam um **núcleo de resistência** que pode filtrar informação, atrasar entregas e
  desautorizar decisões. Os neutros ficam no meio, pressionados a escolher um lado.

O sistema mede essa estrutura para que as decisões se apoiem em dados e não só em percepção.

---

## Glossário: o que cada palavra da tela significa

| Na tela | Em termos simples | Nome técnico (para quem quiser pesquisar) |
|---|---|---|
| Influência | O quanto os colegas ouvem e seguem a pessoa | PageRank + intermediação + força dos laços |
| Faz ponte entre pessoas | A comunicação entre colegas passa por ela | Centralidade de intermediação (betweenness) |
| Importância geral | Influência + conhecimento que só ela tem + cargo | Índice composto ("peso") |
| Difícil de substituir | Nota de conhecimento × conhecimentos exclusivos (ponderados pela importância) | Risco de conhecimento |
| Impacto se sair (0–100) | O quanto a empresa sentiria a saída | Custo operacional da simulação |
| Postura com o gerente | Apoia, neutro ou resiste | Posicionamento (−2 a +2) |
| Grupo de resistência | Pessoas que resistem e são próximas entre si | Núcleo (componente conexo de resistentes) |
| Por quem passa a comunicação do gerente | Pessoas que podem filtrar os recados | Porteiros (dependência de Brandes) |
| Turma informal | Quem convive mais entre si | Comunidade de Louvain (cluster) |
| No meio de conflitos | Se dá bem com duas pessoas que brigam | Tríade desbalanceada |
| Única ligação entre partes da equipe | Se sair, alguns ficam sem contato com o resto | Ponto de articulação |
| Frequência | Raramente → todo dia (1 a 5) | Força do laço |
| Clima | Muito bom → hostil (+2 a −2) | Sentimento do laço |

Os níveis *Muito baixa / Baixa / Média / Alta / Muito alta* dividem cada índice (de 0 a 1) em cinco faixas iguais.

### Conhecimentos (checklist)

Os conhecimentos vêm de uma **lista única** (aba *Conhecimentos*) e não de texto livre. Assim não aparecem
duplicados como "ERP", "erp" e "sistema ERP". Cada item tem uma categoria e uma importância:

- **Essencial**: sem isso a empresa para ou perde dinheiro. Se só uma pessoa sabe, ela entra em *Não pode perder*,
  mesmo que a nota de "difícil de substituir" seja baixa.
- **Importante**: faz falta, mas dá para contornar.
- **Desejável**: ajuda, mas não é crítico.

No cálculo de "difícil de substituir", conhecimentos exclusivos pesam 1 (essencial), 0,6 (importante) e 0,3 (desejável).
Dados de versões antigas, que guardavam o conhecimento como texto livre, são convertidos automaticamente
em itens da lista, na categoria "Outros".

## 2. Como coletar os dados (do mais rápido ao mais robusto)

1. **Mapeamento pela liderança (1–2 horas)**: você e o gerente geral cadastram pessoas e relações
   que conhecem. Isso é rápido, mas enviesado pela visão de vocês. Marque as relações incertas com força baixa.
2. **Questionário ONA (recomendado)**: um formulário curto e confidencial para todos. Perguntas clássicas:
   - *A quem você recorre quando precisa de informação para fazer seu trabalho?* → `informacao`
   - *A quem você pede conselho sobre decisões difíceis?* → `influencia`
   - *Com quem você colabora diretamente toda semana?* → `colaboracao`
   - *Quem você considera referência técnica?* → `mentoria`
   - *Com quem a colaboração é difícil?* (opcional e sensível) → `conflito`

   Peça de 3 a 7 nomes por pergunta e uma frequência de 1 a 5. Com isso a força das relações deixa de ser
   opinião da diretoria.
3. **Metadados de colaboração**, com transparência e base legal: quem convida quem para reuniões e quem
   copia quem em e-mails ou chats. Use **só metadados**, nunca conteúdo.
4. **Ocorrências**: registre fatos à medida que acontecem: data, o que houve e o impacto.

> Refaça o mapeamento a cada 60–90 dias. Exporte um JSON a cada rodada para comparar a evolução
> (o núcleo cresceu? os neutros migraram? o alcance do gerente geral aumentou?).

---

## 3. Modelo de dados

**Pessoa**: departamento, cargo, nível (1 Operacional … 5 Diretoria), gestor direto, tempo de casa,
conhecimento crítico (0–5), habilidades (lista livre) e posicionamento (−2 a +2) em relação à mudança.

**Relação**: origem, destino, tipo, força (1–5) e sentimento (−2 a +2).

| Tipo | Direção | Sentimento padrão |
|---|---|---|
| Colaboração | ↔ | +1 |
| Amizade / afinidade | ↔ | +2 |
| Vínculo familiar / conjugal | ↔ | +2 (também é sinalizado à parte) |
| Influência | origem → destino | +1 |
| Mentoria | origem → destino | +1 |
| Fonte de informação | origem → destino | +1 |
| Conflito / atrito | ↔ | −1 |
| Boicote | origem → destino | −2 |

Relações com sentimento **negativo** formam a rede de conflitos. As demais formam a **rede positiva**,
por onde fluem informação e influência. A hierarquia formal entra como laço fraco (força 2, configurável)
apenas quando não existe uma relação explícita entre gestor e liderado.

---

## 4. Métricas

| Métrica | O que significa | Uso prático |
|---|---|---|
| **Laços / força** | Quantidade e intensidade das relações positivas | Popularidade, alcance direto |
| **PageRank** | Ser ouvido por quem é ouvido (direcionado: quem é influenciado "aponta" para o influenciador) | Influência real |
| **Intermediação** (betweenness) | Fração dos caminhos mais curtos que passam pela pessoa | Quem controla o fluxo de informação; os "porteiros" |
| **Proximidade** (harmônica) | Quão perto a pessoa está de todos | Velocidade para espalhar uma mensagem |
| **Influência** (composto) | 0,4·PageRank + 0,3·Intermediação + 0,3·Força (todos normalizados) | Ranking principal |
| **Risco de conhecimento** | conhecimento/5 × (0,4 + 0,6 × fração de habilidades exclusivas) | Quem é difícil de substituir |
| **Peso geral** | 0,45·Influência + 0,30·Risco de conhecimento + 0,25·Nível formal | Importância total da pessoa |
| **Cluster** (Louvain) | Grupos que interagem mais entre si do que com o resto | Subculturas e "panelas" |
| **Ponto de articulação / ponte** | Pessoa ou laço cuja saída desconecta a rede | Ponto único de falha |
| **Tríade em tensão** | Trio com número ímpar de laços negativos (equilíbrio estrutural) | Quem está dividido entre dois lados |
| **Organização sombra** | Posição no ranking de influência comparada à posição formal | Líderes informais e autoridade sem influência |

### Posicionamento em relação à pessoa focal

Para cada pessoa, o sistema usa a melhor evidência disponível, nesta ordem:

1. **Informado**: a sua avaliação no cadastro.
2. **Relação direta**: média do sentimento das relações com a pessoa focal, ponderada pela força.
3. **Ocorrências**: fatos registrados envolvendo a pessoa focal.
4. **Inferido**: média amortecida (×0,7) dos vizinhos. É uma **hipótese**, que precisa ser confirmada.

O posicionamento é classificado como apoiador (≥ 0,75), resistente (≤ −0,75) ou neutro.

### Análise de resistência

- **Núcleo de resistência**: resistentes ligados entre si por laços positivos (uma coalizão).
  O **poder** do núcleo é a soma de influência × intensidade da resistência de cada membro.
  A **audiência** são os não resistentes ligados diretamente ao núcleo, ou seja, quem ele pode contaminar.
- **Porteiros**: pessoas por onde passam os caminhos mais curtos do gerente geral até o resto da empresa
  (dependência de Brandes a partir da pessoa focal). Um porteiro resistente pode filtrar ou bloquear informação.
- **Exposição**: média do posicionamento dos vizinhos. **Pressão**: soma da influência dos resistentes ao redor.
- **Prioridade de engajamento**: neutros influentes e sob pressão, que devem ser conquistados primeiro.

### Simulação de saída

Compara a rede antes e depois, **considerando apenas quem fica**:

- **Custo operacional (0–100)** = 25% perda de eficiência da rede + 15% pessoas isoladas +
  25% influência removida + 25% conhecimento perdido + 10% risco de contágio.
- **Redução da resistência**: queda do poder de resistência após recalcular toda a rede.
- **Contágio**: quem tem laço forte (≥ 4) ou familiar com quem sai. Essas pessoas podem se desengajar,
  se solidarizar ou pedir demissão também.

Os dois eixos ficam **separados** de propósito. A decisão mais difícil é justamente a de quem tem
alto custo operacional e alta resistência ao mesmo tempo.

---

### Painel de decisão (regras)

O custo de saída de cada pessoa vem da simulação individual. "Alto" significa estar entre os 30% mais caros
da empresa, e "baixo" estar entre os 35% mais baratos.

| Categoria | Entra quando… |
|---|---|
| **Com quem ter cuidado** | é resistente com influência acima da mediana, faz parte de um núcleo de resistência, é porteiro do gerente (≥ 10% da rede), tem ocorrência negativa registrada ou está em 3 ou mais tríades de tensão |
| **Trazer para o seu lado** | é neutro, influente e está sob pressão dos resistentes; ou tem resistência leve, inferida e sem ocorrências (recuperável); ou apoia mas tem engajamento ≤ 2 |
| **Pessoas influentes** | está entre os 25% mais influentes (índice ≥ 0,35) |
| **Aliados** | apoia a gestão e tem influência acima da mediana |
| **Demissão é risco** | tem custo de saída alto, é o único que domina um conhecimento (com conhecimento ≥ 3), é ponto único de conexão, tem 3 ou mais pessoas com laço forte que podem sair junto, ou tem desempenho 5 |
| **Onde é possível cortar** | tem custo de saída baixo, sem conhecimento exclusivo, não é ponto de conexão, tem no máximo 1 laço forte **e** desempenho ≤ 2, engajamento ≤ 2 ou 2 ou mais ocorrências negativas documentadas |

Sem nota de desempenho, ninguém é sugerido para corte: o painel avisa quantas pessoas ainda não foram avaliadas.
O posicionamento inferido nunca leva alguém, sozinho, para a categoria de corte.

O custo de saída combina: 20% perda de eficiência da rede, 10% pessoas isoladas, 20% influência,
25% conhecimento, 10% contágio e 15% desempenho.

## 5. Como ler os resultados no cenário de boicote

| O que o sistema mostra | Leitura | Ação |
|---|---|---|
| Núcleo com o casal + liderados leais | Coalizão com alcance em duas áreas | Conversas **individuais e separadas**; nunca em grupo |
| Vínculo familiar dentro do núcleo | Conflito de interesses | Política de parentes (veja abaixo) |
| Gerente interno é porteiro do GG | O GG depende dele para chegar à operação | Canais diretos: reuniões de equipe, 1:1 com supervisores, gemba |
| Neutros com alta pressão | Estão sendo "puxados" | Engajar já: incluir em decisões, dar visibilidade e reconhecimento |
| Apoiadores influentes | Multiplicadores | Apadrinhar iniciativas do GG, fazer comunicação em cascata |
| Alto risco de conhecimento em resistente | Dependência perigosa | Documentar processos, nomear backup e treinar sucessor **antes** de qualquer decisão |
| Contágio alto na simulação | Saída arrasta outros | Preparar conversas com os afetados no mesmo dia; reforçar retenção |
| Tríade em tensão | Pessoa dividida | Tirar essa pessoa do meio do conflito; não pedir que escolha lados |

---

## 6. Plano de ação em fases

**Fase 0: diagnóstico (semanas 1–2)**
- Cadastre a rede, aplique o questionário ONA e registre as ocorrências já conhecidas.
- Rode Análise, Resistência e Simulação. Liste núcleos, porteiros, neutros prioritários e dependências de conhecimento.

**Fase 1: blindar a operação (semanas 2–6)**
- Documente os conhecimentos com um único detentor e nomeie backups.
- Abra canais diretos do GG com as equipes, para reduzir a dependência de porteiros.
- Deixe explícitos os acordos de entrega: indicadores, prazos e rituais semanais com registro.

**Fase 2: conversas e governança (semanas 2–8)**
- **CEO + GG com o gerente preterido**: reconheça a contribuição e a frustração. Seja claro que a decisão
  está tomada e não será revista. Apresente expectativas objetivas e por escrito e ofereça um caminho
  (projeto de destaque, plano de desenvolvimento). Dê prazo para mudança de comportamento.
- **Mesma conversa, separada, com a gerente cônjuge**: sobre a conduta dela, não sobre o casamento.
- **Política de parentes**: um não aprova, avalia, remunera nem decide sobre a área do outro.
  As linhas de reporte ficam independentes e as decisões que cruzam as duas áreas sobem ao GG.
- Feedback documentado a cada nova ocorrência.

**Fase 3: reconquistar a rede (semanas 4–12)**
- Envolva neutros influentes em projetos do GG, com vitórias rápidas e visíveis.
- Use os apoiadores como multiplicadores.
- Mapeie de novo e compare: o alcance do GG deve subir e o poder de resistência deve cair.

**Fase 4: decisão (se o comportamento persistir)**
- Rode a simulação da saída individual e da saída do núcleo inteiro.
- Execute a transição de conhecimento **antes** da saída.
- Decida com histórico documentado e orientação jurídica trabalhista. Planeje a comunicação para as
  pessoas com risco de contágio.

---

## 7. Cuidados éticos e legais (importante)

- **LGPD**: são dados pessoais e, em parte, opiniões sobre pessoas. Use-os só para gestão, limite o acesso
  ao CEO e ao GG, guarde os backups com segurança e apague o que não for necessário. Se houver questionário,
  informe o objetivo e garanta confidencialidade.
- **Parentesco ou casamento não é motivo de demissão.** Decisões se baseiam em **conduta e desempenho
  documentados**. Desligar alguém "pelo casal" cria risco de ação trabalhista por discriminação.
- **Posicionamento inferido é hipótese.** Nunca puna com base em inferência do algoritmo.
- **Evite caça às bruxas.** Se as pessoas souberem que estão sendo "rotuladas", a resistência aumenta.
  Use o mapa para direcionar **conversas e estrutura**, não para expor pessoas.
- Antes de desligamentos, consulte um advogado trabalhista.

---

## 8. Evolução sugerida (roadmap)

1. ~~Armazenamento online sem banco de dados~~ (feito: arquivo JSON num repositório privado do GitHub).
2. **Questionário ONA integrado**: link por colaborador, com respostas que geram relações automaticamente.
3. **Snapshots no tempo**: comparar rodadas (tendência do poder de resistência, do alcance do GG e da migração dos neutros).
4. **Controle de acesso por pessoa** (login individual e perfis), caso um dia seja necessário restringir quem vê o quê.
5. **Integração com metadados** de calendário, e-mail e chat (Google Workspace / Microsoft 365), com consentimento.
6. **Pesos ajustáveis** dos índices pela interface e análise de sensibilidade.
7. **Relatório em PDF** para reuniões de diretoria.
8. **Plano de ação rastreável**: cada recomendação vira uma tarefa com responsável, prazo e status.
