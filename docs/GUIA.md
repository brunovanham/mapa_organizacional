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

1. **Questionário ONA integrado**: link por colaborador, com respostas que geram relações automaticamente.
2. **Snapshots no tempo**: comparar rodadas (tendência do poder de resistência, do alcance do GG e da migração dos neutros).
3. **Backend multiusuário** (ex.: Supabase/PostgreSQL) com login, perfis de acesso e trilha de auditoria.
4. **Integração com metadados** de calendário, e-mail e chat (Google Workspace / Microsoft 365), com consentimento.
5. **Pesos ajustáveis** dos índices pela interface e análise de sensibilidade.
6. **Relatório em PDF** para reuniões de diretoria.
7. **Plano de ação rastreável**: cada recomendação vira uma tarefa com responsável, prazo e status.
