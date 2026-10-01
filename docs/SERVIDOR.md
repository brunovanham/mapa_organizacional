# Empresas com código de acesso: como colocar no ar

Com isto, qualquer pessoa que abrir o site pode **criar a empresa dela** e acessá-la depois com o
**código que escolheu**. Cada empresa vira um arquivo JSON no seu repositório de dados, e cada
pessoa só abre a empresa do código que tem.

## Entrar de qualquer lugar só com o código

Quando uma empresa é criada (ou aberta) com o link de convite, o sistema grava também
`acessos/<id>.json`: a chave do GitHub **criptografada com o código da empresa**. Assim, num navegador
novo, sem convite, basta digitar o código. O sistema lê esse arquivo, destrava a chave com o código e
abre a empresa.

Para isso o repositório de dados precisa ser **público**. Ninguém consegue ler nada sem o código:
nem os dados, nem a chave. Cuidados:
- Use códigos longos. Empresas novas exigem pelo menos 10 caracteres; frases funcionam bem
  (ex.: `padaria-centro-azul`).
- Quem descobrir o código de **uma** empresa obtém a chave de gravação. Mesmo assim, não lê as outras
  empresas, porque cada uma tem o seu código.
- Empresas criadas antes desta versão: abra-as **uma vez** no navegador que tem o convite. O arquivo
  de acesso é criado nesse momento.

Para manter o repositório privado, use o servidor (seção mais abaixo).

## Jeito mais simples: link de convite (sem servidor)

Se você só vai passar o link para pessoas que conhece, **não precisa do Cloudflare**:

1. Crie o repositório **privado** `mapa_organizacional_dados` (com *Add a README file*).
2. Crie uma chave *fine-grained* só para esse repositório, com **Contents: Read and write**.
3. No site, vá em **Dados → Administrador: convites e armazenamento**, preencha dono, repositório e chave
   e clique em **Gerar link de convite**.
4. Envie o link por mensagem privada. Quem abrir o link vê **Entrar na minha empresa / Criar nova empresa**.

A chave vai na parte do link depois do `#`. Essa parte não é enviada a nenhum servidor (nem ao GitHub Pages)
e não fica no código público. Ela fica guardada no navegador de quem abriu o link. As empresas continuam
**criptografadas com o código de cada uma**, em `empresas/<id>.json`.

Riscos, e por que são aceitáveis num grupo de confiança:
- Quem tem o link pode **gravar** no repositório de dados. Poderia, por exemplo, estragar um arquivo, mas
  o histórico do GitHub permite voltar a versão.
- Quem tem o link **não consegue ler** nenhuma empresa sem o código dela.
- Se o link vazar, apague a chave no GitHub (o acesso de todos é cortado na hora), crie outra e gere um
  convite novo.

O servidor (seção abaixo) só é necessário se você quiser abrir o sistema para desconhecidos.

## Como funciona (com servidor)

```
 Navegador do visitante                 Servidor (Cloudflare Worker)          GitHub (repositório PRIVADO)
 ┌──────────────────────────┐  cifrado  ┌──────────────────────────┐  chave  ┌──────────────────────────────┐
 │ código → id do arquivo   │ ────────▶ │ guarda a chave do GitHub │ ──────▶ │ empresas/3f9a…c1.json        │
 │ código → chave AES-256   │ ◀──────── │ só aceita dados cifrados │ ◀────── │ empresas/b07e…42.json        │
 └──────────────────────────┘           └──────────────────────────┘         └──────────────────────────────┘
```

- O **código nunca sai do navegador**. Dele saem duas coisas: o nome do arquivo (`empresas/<id>.json`)
  e a chave que **criptografa** os dados (AES-256-GCM, derivada com PBKDF2 em 210 mil rodadas).
- O servidor e o repositório só guardam dados ilegíveis. Nem o administrador lê uma empresa sem o código.
- O servidor existe porque gravar no GitHub exige uma chave, e essa chave não pode ficar no site público.
- Não existe rota para listar nem para apagar empresas.

**Esqueceu o código, perdeu os dados.** Não há como recuperar, e isso é proposital. Oriente as pessoas
a anotar o código.

## Passo a passo (uma única vez, cerca de 15 minutos)

### 1. Repositório privado de dados
Em <https://github.com/new>, crie `mapa_organizacional_dados`, marque **Private** e **Add a README file**.

### 2. Chave do GitHub para o servidor
Em <https://github.com/settings/personal-access-tokens/new> (*fine-grained*):
- *Repository access*: **Only select repositories** → `mapa_organizacional_dados`
- *Permissions → Repository permissions → Contents*: **Read and write**
- Defina uma validade e clique em *Generate token*. Copie a chave.

### 3. Servidor no Cloudflare (grátis)
**Pelo painel, sem instalar nada:**
1. Crie uma conta em <https://dash.cloudflare.com>.
2. *Workers & Pages* → *Create* → *Create Worker* → dê o nome `mapa-organizacional-api` → *Deploy*.
3. *Edit code*: apague o conteúdo e cole o arquivo [`worker/src/index.js`](../worker/src/index.js) → *Deploy*.
4. *Settings → Variables and Secrets*, adicione:

   | Nome | Tipo | Valor |
   |---|---|---|
   | `GITHUB_TOKEN` | **Secret** | a chave do passo 2 |
   | `GITHUB_OWNER` | Text | `brunovanham` |
   | `GITHUB_REPO` | Text | `mapa_organizacional_dados` |
   | `DATA_DIR` | Text | `empresas` |
   | `ALLOWED_ORIGINS` | Text | `https://brunovanham.github.io` |

5. Copie o endereço do Worker (algo como `https://mapa-organizacional-api.SEU-USUARIO.workers.dev`).
   Teste abrindo `…/api/saude` no navegador: deve aparecer `{"ok":true}`.

**Ou pela linha de comando:** dentro da pasta `worker/`, rode `npx wrangler deploy` e depois
`npx wrangler secret put GITHUB_TOKEN`. As outras variáveis já estão em `worker/wrangler.toml`.

### 4. Ligar o site ao servidor
Edite [`js/config.js`](../js/config.js) e coloque o endereço do passo 3:

```js
window.MAPA_CONFIG = {
  apiUrl: 'https://mapa-organizacional-api.SEU-USUARIO.workers.dev',
};
```

Faça o commit. Ao publicar, o site abre na tela **Entrar na minha empresa / Criar nova empresa**.

## Uso

- **Criar empresa**: nome + código (mínimo de 8 caracteres; maiúsculas e minúsculas fazem diferença).
- **Entrar**: só o código. Marque *Lembrar neste computador* apenas em computador pessoal. Sem essa
  opção, o acesso termina ao fechar a aba.
- **Várias visões**: crie quantas empresas quiser, cada uma com um código diferente.
- **Sair da empresa** apaga a cópia local daquele navegador.
- **Histórico**: cada gravação é um commit no repositório de dados. Dá para voltar uma versão pelo
  GitHub, mas o conteúdo continua cifrado com o código daquela empresa.

## Segurança e limites

- Use **códigos longos** (frases como `padaria-centro-2026-azul`). Como o algoritmo é público, um código
  curto e óbvio pode ser adivinhado por tentativa e erro.
- Quem tem o código pode ler e alterar tudo da empresa. Para "trocar o código", crie uma empresa nova
  com o código novo e importe os dados (*Dados → Exportar/Importar JSON*).
- O servidor recusa qualquer conteúdo que não esteja cifrado e limita cada arquivo a 3 MB.
- Para evitar abuso (alguém criando milhares de empresas), ative no Cloudflare uma regra de
  *Rate limiting* para o Worker.
- O plano gratuito do Cloudflare permite 100 mil requisições por dia, e a API do GitHub cerca de
  5 mil gravações por hora. Isso é suficiente para dezenas de empresas usando ao mesmo tempo.
