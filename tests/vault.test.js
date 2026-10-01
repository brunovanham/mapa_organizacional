// Testes da criptografia por código de acesso (js/vault.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const Vault = require('../js/vault.js');

test('o mesmo código gera sempre o mesmo arquivo e a mesma chave', async () => {
  const a = await Vault.open('Empresa-Teste-2026');
  const b = await Vault.open('Empresa-Teste-2026');
  assert.equal(a.id, b.id);
  assert.equal(a.keyB64, b.keyB64);
  assert.match(a.id, /^[a-f0-9]{32}$/);
  const c = await Vault.open('empresa-teste-2026');
  assert.notEqual(a.id, c.id, 'maiúsculas e minúsculas fazem diferença');
});

test('cifra e decifra; código errado não abre', async () => {
  const dados = { settings: { companyName: 'Padaria São João' }, people: [{ id: 'p1', name: 'Ana' }] };
  const certo = await Vault.open('codigo-certo-123');
  const env = await Vault.seal(dados, certo.keyB64);
  assert.equal(env.v, 1);
  assert.ok(!JSON.stringify(env).includes('Padaria'), 'nada legível no arquivo');
  assert.deepEqual(await Vault.unseal(env, certo.keyB64), dados);
  const errado = await Vault.open('codigo-errado-123');
  await assert.rejects(Vault.unseal(env, errado.keyB64), /Código incorreto/);
});

test('código curto é recusado', async () => {
  assert.equal(Vault.checkCode('1234567').ok, false);
  assert.equal(Vault.checkCode('Abc-12345-xyz').level, 'forte');
  await assert.rejects(Vault.open('curto'), /pelo menos 8/);
});
