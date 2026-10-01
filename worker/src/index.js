/*
 * API das empresas — Cloudflare Worker (gratuito).
 *
 * Guarda a chave do GitHub em segredo (variável GITHUB_TOKEN) e só permite
 * ler e gravar arquivos  <DATA_DIR>/<id>.json  no repositório de dados.
 * O conteúdo chega CIFRADO pelo navegador (js/vault.js): este servidor não
 * conhece o código das empresas e não consegue ler os dados.
 *
 * Rotas:
 *   GET  /api/saude                 → { ok: true }
 *   GET  /api/empresas/:id          → { existe, sha, envelope }  (404 se não existe)
 *   PUT  /api/empresas/:id          ← { envelope, sha?, criar? } → { sha }
 * Não há rota de listagem nem de exclusão.
 */
const ID_RE = /^[a-f0-9]{32}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BYTES = 3_000_000;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0] || '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function validEnvelope(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  const keys = Object.keys(e);
  if (keys.some((k) => !['v', 'alg', 'iv', 'data'].includes(k))) return false;
  return (
    e.v === 1 &&
    (e.alg === undefined || e.alg === 'AES-256-GCM') &&
    typeof e.iv === 'string' && e.iv.length <= 32 && B64_RE.test(e.iv) &&
    typeof e.data === 'string' && e.data.length > 0 && B64_RE.test(e.data)
  );
}

function github(env) {
  const base = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mapa-organizacional-api',
  };
  const ref = env.GITHUB_BRANCH ? `?ref=${encodeURIComponent(env.GITHUB_BRANCH)}` : '';
  return {
    get: (path) => fetch(`${base}/contents/${path}${ref}`, { headers }),
    blob: (sha) => fetch(`${base}/git/blobs/${sha}`, { headers }),
    put: (path, body) =>
      fetch(`${base}/contents/${path}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(env.GITHUB_BRANCH ? { ...body, branch: env.GITHUB_BRANCH } : body),
      }),
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const json = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/api/saude') {
      const configured = !!(env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO);
      return json(configured ? 200 : 500, { ok: configured, erro: configured ? undefined : 'Servidor sem configuração do GitHub.' });
    }
    const m = /^\/api\/empresas\/([^/]+)$/.exec(url.pathname);
    if (!m) return json(404, { erro: 'Rota não encontrada.' });
    const id = m[1];
    if (!ID_RE.test(id)) return json(400, { erro: 'Identificador inválido.' });

    const gh = github(env);
    const path = `${env.DATA_DIR || 'empresas'}/${id}.json`;

    if (request.method === 'GET') {
      const r = await gh.get(path);
      if (r.status === 404) return json(404, { existe: false });
      if (!r.ok) return json(502, { erro: `Falha ao ler no GitHub (${r.status}).` });
      const j = await r.json();
      let content = j.content;
      if (!content && j.sha) {
        const b = await gh.blob(j.sha); // arquivos acima de 1 MB
        if (!b.ok) return json(502, { erro: 'Falha ao ler o arquivo grande no GitHub.' });
        content = (await b.json()).content;
      }
      let envelope;
      try {
        envelope = JSON.parse(atob(String(content).replace(/\s/g, '')));
      } catch (e) {
        return json(500, { erro: 'Arquivo da empresa está danificado.' });
      }
      return json(200, { existe: true, sha: j.sha, envelope });
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BYTES) return json(413, { erro: 'Dados grandes demais.' });
      let body;
      try {
        body = JSON.parse(text);
      } catch (e) {
        return json(400, { erro: 'JSON inválido.' });
      }
      if (!validEnvelope(body.envelope)) return json(400, { erro: 'Os dados precisam chegar criptografados.' });
      if (body.sha !== undefined && body.sha !== null && !/^[a-f0-9]{40}$/.test(body.sha)) return json(400, { erro: 'Versão inválida.' });
      const r = await gh.put(path, {
        message: `${body.sha ? 'Atualiza' : 'Cria'} empresa ${id.slice(0, 8)}`,
        content: btoa(JSON.stringify(body.envelope)),
        ...(body.sha ? { sha: body.sha } : {}),
      });
      if (r.status === 409 || r.status === 422) {
        return json(409, {
          conflito: true,
          erro: body.sha ? 'Outra pessoa salvou antes de você.' : 'Já existe uma empresa com este código.',
        });
      }
      if (!r.ok) return json(502, { erro: `Falha ao gravar no GitHub (${r.status}).` });
      const pj = await r.json();
      return json(200, { sha: pj.content.sha });
    }
    return json(405, { erro: 'Método não permitido.' });
  },
};
