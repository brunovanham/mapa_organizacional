/*
 * config.js — configuração do site publicado.
 *
 * apiUrl: endereço da API das empresas (pasta worker/, publicada no
 * Cloudflare). Com ele preenchido, o site abre na tela "Entrar na minha
 * empresa / Criar nova empresa". Vazio = sem acesso por código (o sistema
 * funciona só no navegador ou com a chave do GitHub do administrador).
 * Exemplo: 'https://mapa-organizacional-api.SEU-USUARIO.workers.dev'
 */
window.MAPA_CONFIG = {
  apiUrl: '',
};
