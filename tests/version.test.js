// Garante que index.html e os scripts declaram a mesma versão. Sem isso, o
// cache do navegador (GitHub Pages guarda arquivos por 10 min) pode misturar
// página nova com script antigo e o aplicativo para de responder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

test('todos os arquivos locais do index.html usam o mesmo ?v= da versão do app', () => {
  const meta = /<meta name="app-version" content="([^"]+)">/.exec(html);
  assert.ok(meta, 'index.html precisa de <meta name="app-version">');
  const appVersion = /const APP_VERSION = '([^']+)'/.exec(app);
  assert.ok(appVersion, 'js/app.js precisa de APP_VERSION');
  assert.equal(appVersion[1], meta[1], 'APP_VERSION (app.js) diferente do meta app-version (index.html)');
  const refs = [...html.matchAll(/(?:src|href)="((?:js|css|vendor)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 6);
  for (const ref of refs) assert.ok(ref.endsWith(`?v=${meta[1]}`), `${ref} deveria terminar com ?v=${meta[1]}`);
});
