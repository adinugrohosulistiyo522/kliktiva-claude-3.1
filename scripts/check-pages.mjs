// Pemeriksaan statis untuk paket Cloudflare Pages.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const must = ['public/index.html', 'public/admin.html', 'functions/api.js', 'public/_headers'];
for (const f of must) assert.ok(existsSync(f), `File wajib tidak ada: ${f}`);

const api = readFileSync('functions/api.js', 'utf8');
const syntax = spawnSync(process.execPath, ['--check', 'functions/api.js'], { encoding: 'utf8' });
assert.equal(syntax.status, 0, `Sintaks functions/api.js salah:\n${syntax.stderr}`);

const allowed = new Set([...api.split('const SCRIPT_URL_RE')[0].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]));
for (const f of ['public/index.html', 'public/admin.html']) {
  const html = readFileSync(f, 'utf8');
  assert.ok(html.includes("fetch('/api'"), `${f} harus memanggil fetch('/api')`);
  assert.ok(!html.includes('/.netlify/functions'), `${f} masih memanggil jalur Netlify`);
  const used = new Set([...html.matchAll(/API\(\s*['"]([A-Za-z]+)['"]/g)].map(m => m[1]));
  for (const a of used) assert.ok(allowed.has(a), `${f} memakai action "${a}" yang tidak ada di allowlist functions/api.js`);
}
assert.ok(!existsSync('netlify.toml'), 'netlify.toml tidak dipakai di Cloudflare');
if (existsSync('wrangler.jsonc')) {
  const w = readFileSync('wrangler.jsonc', 'utf8');
  assert.ok(/"name"\s*:\s*"[a-z0-9-]+"/.test(w), 'wrangler.jsonc harus punya "name"');
  assert.ok(w.includes('"main": "src/index.js"') && existsSync('src/index.js'), 'wrangler.jsonc menunjuk src/index.js yang harus ada');
  assert.ok(w.includes('"/api"'), 'run_worker_first harus memuat /api');
}
console.log('OK: paket Cloudflare Pages lolos pemeriksaan statis.');
