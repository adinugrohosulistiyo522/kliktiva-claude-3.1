import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost, onRequest } from '../functions/api.js';

const URL_OK = 'https://script.google.com/macros/s/ABC123/exec';
const post = (body, raw) => new Request('https://x.test/api', { method: 'POST', body: raw ?? JSON.stringify(body) });
const withFetch = async (impl, fn) => { const old = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = old; } };

test('GET /api melaporkan status variabel tanpa membocorkan URL', async () => {
  const r = await onRequestGet({ env: { APPS_SCRIPT_URL: URL_OK } });
  const j = await r.json();
  assert.equal(j.appsScriptUrlConfigured, true);
  assert.ok(!JSON.stringify(j).includes('ABC123'));
  const r2 = await onRequestGet({ env: {} });
  assert.equal((await r2.json()).appsScriptUrlConfigured, false);
});

test('metode selain GET/POST ditolak 405', async () => {
  assert.equal((await onRequest()).status, 405);
});

test('variabel belum diisi -> 500 dengan kode jelas', async () => {
  const r = await onRequestPost({ request: post({ action: 'getPublicData', args: [] }), env: {} });
  assert.equal(r.status, 500);
  assert.equal((await r.json()).code, 'APPS_SCRIPT_URL_NOT_CONFIGURED');
});

test('JSON rusak -> 400', async () => {
  const r = await onRequestPost({ request: post(null, '{bukan json'), env: { APPS_SCRIPT_URL: URL_OK } });
  assert.equal(r.status, 400);
});

test('action tidak dikenal -> 400', async () => {
  const r = await onRequestPost({ request: post({ action: 'hapusSemua', args: [] }), env: { APPS_SCRIPT_URL: URL_OK } });
  assert.equal((await r.json()).code, 'ACTION_NOT_ALLOWED');
});

test('sukses: meneruskan {action,args} dan mengembalikan data', async () => {
  let seen;
  const fakeFetch = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ ok: true, data: { hello: 'dunia' } }), { status: 200 }); };
  const r = await withFetch(fakeFetch, () => onRequestPost({ request: post({ action: 'getPublicData', args: [1] }), env: { APPS_SCRIPT_URL: URL_OK } }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, data: { hello: 'dunia' } });
  assert.equal(seen.url, URL_OK);
  assert.equal(seen.init.method, 'POST');
  assert.deepEqual(JSON.parse(seen.init.body), { action: 'getPublicData', args: [1] });
  assert.equal(seen.init.redirect, 'follow');
});

test('Apps Script membalas HTML (deployment salah) -> 502 dengan petunjuk', async () => {
  const r = await withFetch(async () => new Response('<html>login</html>', { status: 200 }), () => onRequestPost({ request: post({ action: 'getPublicData', args: [] }), env: { APPS_SCRIPT_URL: URL_OK } }));
  const j = await r.json();
  assert.equal(r.status, 502);
  assert.equal(j.code, 'APPS_SCRIPT_BAD_RESPONSE');
});

test('backend mengembalikan ok:false -> 400 membawa kode backend', async () => {
  const r = await withFetch(async () => new Response(JSON.stringify({ ok: false, code: 'LICENSE_BLOCKED', error: 'Lisensi nonaktif' }), { status: 200 }), () => onRequestPost({ request: post({ action: 'getPublicData', args: [] }), env: { APPS_SCRIPT_URL: URL_OK } }));
  const j = await r.json();
  assert.equal(r.status, 400);
  assert.equal(j.code, 'LICENSE_BLOCKED');
});

test('jaringan gagal -> 502 APPS_SCRIPT_UNREACHABLE', async () => {
  const r = await withFetch(async () => { throw new Error('boom'); }, () => onRequestPost({ request: post({ action: 'getPublicData', args: [] }), env: { APPS_SCRIPT_URL: URL_OK } }));
  assert.equal((await r.json()).code, 'APPS_SCRIPT_UNREACHABLE');
});
