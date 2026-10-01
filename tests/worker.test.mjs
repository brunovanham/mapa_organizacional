// Testes da API das empresas (worker/src/index.js) com um GitHub simulado.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validEnvelope } from '../worker/src/index.js';

const env = { GITHUB_TOKEN: 't', GITHUB_OWNER: 'dono', GITHUB_REPO: 'dados', DATA_DIR: 'empresas', ALLOWED_ORIGINS: 'https://site.exemplo' };
const ID = 'a'.repeat(32);
const ENV1 = { v: 1, alg: 'AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', data: 'Y2lmcmFkbw==' };

// GitHub falso: guarda arquivos em memória e confere o "sha" como o GitHub.
function fakeGitHub() {
  const files = new Map();
  let n = 0;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const m = /\/contents\/(.+?)(\?|$)/.exec(url);
    const path = m && decodeURIComponent(m[1]);
    const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (!path) return res(404, {});
    if (!init.method || init.method === 'GET') {
      const f = files.get(path);
      return f ? res(200, { content: f.content, sha: f.sha }) : res(404, { message: 'Not Found' });
    }
    const body = JSON.parse(init.body);
    const cur = files.get(path);
    if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) return res(422, { message: 'sha mismatch' });
    const sha = String(++n).padStart(40, '0');
    files.set(path, { content: body.content, sha });
    return res(200, { content: { sha } });
  };
  return { files, calls };
}

const req = (method, path, body, origin = 'https://site.exemplo') =>
  new Request('https://api.exemplo' + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

test('cria, lê e atualiza uma empresa', async () => {
  const gh = fakeGitHub();
  let r = await worker.fetch(req('GET', `/api/empresas/${ID}`), env);
  assert.equal(r.status, 404);
  r = await worker.fetch(req('PUT', `/api/empresas/${ID}`, { envelope: ENV1, sha: null }), env);
  assert.equal(r.status, 200);
  const { sha } = await r.json();
  assert.ok(gh.files.has(`empresas/${ID}.json`));
  assert.equal(gh.calls.at(-1).init.headers.Authorization, 'Bearer t', 'a chave fica só no servidor');
  r = await worker.fetch(req('GET', `/api/empresas/${ID}`), env);
  const got = await r.json();
  assert.deepEqual(got.envelope, ENV1);
  assert.equal(got.sha, sha);
  r = await worker.fetch(req('PUT', `/api/empresas/${ID}`, { envelope: { ...ENV1, data: 'b3V0cm8=' }, sha }), env);
  assert.equal(r.status, 200);
});

test('não deixa criar duas empresas com o mesmo código nem sobrescrever versão antiga', async () => {
  fakeGitHub();
  await worker.fetch(req('PUT', `/api/empresas/${ID}`, { envelope: ENV1, sha: null }), env);
  let r = await worker.fetch(req('PUT', `/api/empresas/${ID}`, { envelope: ENV1, sha: null }), env);
  assert.equal(r.status, 409);
  assert.match((await r.json()).erro, /Já existe/);
  r = await worker.fetch(req('PUT', `/api/empresas/${ID}`, { envelope: ENV1, sha: '9'.repeat(40) }), env);
  assert.equal(r.status, 409);
  assert.match((await r.json()).erro, /Outra pessoa/);
});

test('recusa dados sem criptografia, nomes de arquivo inválidos e rotas desconhecidas', async () => {
  const gh = fakeGitHub();
  let r = await worker.fetch(req('PUT', `/api/empresas/${ID}`, { envelope: { people: [{ name: 'Ana' }] } }), env);
  assert.equal(r.status, 400);
  r = await worker.fetch(req('GET', '/api/empresas/../../README'), env);
  assert.equal(r.status, 404);
  r = await worker.fetch(req('GET', '/api/empresas/ABC'), env);
  assert.equal(r.status, 400);
  r = await worker.fetch(req('GET', '/api/empresas'), env);
  assert.equal(r.status, 404, 'não existe listagem de empresas');
  r = await worker.fetch(req('DELETE', `/api/empresas/${ID}`), env);
  assert.equal(r.status, 405);
  assert.equal(gh.calls.length, 0, 'nada chegou ao GitHub');
  assert.equal(validEnvelope({ ...ENV1, extra: 1 }), false);
});

test('CORS só libera o site autorizado', async () => {
  fakeGitHub();
  let r = await worker.fetch(req('OPTIONS', `/api/empresas/${ID}`), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://site.exemplo');
  r = await worker.fetch(req('OPTIONS', `/api/empresas/${ID}`, null, 'https://outro.site'), env);
  assert.notEqual(r.headers.get('Access-Control-Allow-Origin'), 'https://outro.site');
});
