import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const URL_OK = 'https://script.google.com/macros/s/ABC123/exec';
const env = (extra = {}) => ({ ASSETS: { fetch: async (req) => new Response('ASET:' + new URL(req.url).pathname) }, ...extra });

test('Worker: GET /api mengembalikan JSON status', async () => {
  const r = await worker.fetch(new Request('https://h.test/api'), env({ APPS_SCRIPT_URL: URL_OK }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).appsScriptUrlConfigured, true);
});

test('Worker: POST /api diteruskan ke Apps Script', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, data: { a: 1 } }));
  try {
    const r = await worker.fetch(new Request('https://h.test/api', { method: 'POST', body: JSON.stringify({ action: 'getPublicData', args: [] }) }), env({ APPS_SCRIPT_URL: URL_OK }));
    assert.deepEqual(await r.json(), { ok: true, data: { a: 1 } });
  } finally { globalThis.fetch = old; }
});

test('Worker: selain /api diserahkan ke aset statis', async () => {
  for (const p of ['/', '/admin', '/index.html']) {
    const r = await worker.fetch(new Request('https://h.test' + p), env());
    assert.equal(await r.text(), 'ASET:' + p);
  }
});
