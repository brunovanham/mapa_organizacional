/*
 * vault.js — criptografia dos dados de cada empresa com o código de acesso.
 *
 * O código escolhido pela empresa nunca sai do navegador. Dele derivamos
 * (PBKDF2-SHA256, 210 mil iterações), com "sais" diferentes:
 *   - o identificador do arquivo (32 caracteres hexadecimais): é o nome do
 *     arquivo no repositório, sem revelar o nome da empresa;
 *   - a chave AES-256-GCM que cifra o JSON.
 * Assim, o servidor e o repositório só guardam dados ilegíveis.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Vault = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ITERATIONS = 210000;
  const MIN_LENGTH = 8;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const subtle = () => {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (!c || !c.subtle) throw new Error('Este navegador não oferece criptografia segura (use HTTPS e um navegador atualizado).');
    return c.subtle;
  };

  const toB64 = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const normalize = (code) => String(code || '').normalize('NFC').trim();

  async function derive(code, purpose) {
    const base = await subtle().importKey('raw', enc.encode(normalize(code)), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle().deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('mapa-organizacional/v1/' + purpose), iterations: ITERATIONS },
      base,
      256
    );
    return new Uint8Array(bits);
  }

  /** Verifica se o código é aceitável e dá uma dica de força. */
  function checkCode(code) {
    const c = normalize(code);
    if (c.length < MIN_LENGTH) return { ok: false, msg: `Use pelo menos ${MIN_LENGTH} caracteres.` };
    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(c)).length;
    if (c.length >= 14 || (c.length >= 10 && kinds >= 3)) return { ok: true, level: 'forte', msg: 'Código forte.' };
    return { ok: true, level: 'medio', msg: 'Aceito, mas um código maior (ou com números e símbolos) é mais seguro.' };
  }

  /** Do código, obtém o identificador do arquivo e a chave (em base64). */
  async function open(code) {
    if (!checkCode(code).ok) throw new Error(checkCode(code).msg);
    const [idBytes, keyBytes] = await Promise.all([derive(code, 'id'), derive(code, 'key')]);
    return { id: toHex(idBytes.slice(0, 16)), keyB64: toB64(keyBytes) };
  }

  const importKey = (keyB64) => subtle().importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);

  /** Cifra um objeto. O JSON é gerado de forma síncrona, no momento da chamada. */
  async function seal(obj, keyB64) {
    const plain = enc.encode(JSON.stringify(obj));
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const key = await importKey(keyB64);
    const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain));
    return { v: 1, alg: 'AES-256-GCM', iv: toB64(iv), data: toB64(cipher) };
  }

  async function unseal(envelope, keyB64) {
    if (!envelope || envelope.v !== 1 || !envelope.iv || !envelope.data) throw new Error('Arquivo de empresa em formato desconhecido.');
    const key = await importKey(keyB64);
    let plain;
    try {
      plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(envelope.iv) }, key, fromB64(envelope.data));
    } catch (e) {
      throw new Error('Código incorreto ou arquivo danificado.');
    }
    return JSON.parse(dec.decode(plain));
  }

  return { open, seal, unseal, checkCode, MIN_LENGTH };
});
