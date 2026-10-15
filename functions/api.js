// Cloudflare Pages Function: proxy tipis ke Google Apps Script.
// Route: /api  (file functions/api.js)
// Environment variable yang dibutuhkan: APPS_SCRIPT_URL (URL Web App berakhiran /exec)

const ALLOWED_ACTIONS = new Set([
  'getLicenseStatus', 'activateLicense', 'adminLogin', 'getPublicData', 'adminGetData',
  'adminSaveProfile', 'adminRemoveProfilePhoto', 'adminSaveProduct', 'adminRefreshProductThumbnail', 'adminDeleteProduct', 'adminSaveCollection',
  'adminDeleteCollection', 'adminSaveCollectionOrder', 'adminSaveDisplayOrder', 'adminGetAccounts', 'adminSaveAccount',
  'adminDeleteAccount', 'adminGetDisplayProducts', 'trackAnalyticsEvent', 'adminGetAnalytics', 'uploadImageToDrive', 'cekKonfigurasiDrive'
]);

const SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[^\s]+\/exec(?:\?.*)?$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff'
    }
  });
}

function scriptUrlOf(env) {
  return String((env && env.APPS_SCRIPT_URL) || '').trim();
}

// GET /api  -> cek cepat tanpa membuka rahasia: hanya menampilkan apakah variabel sudah terbaca.
export async function onRequestGet({ env }) {
  return json({ ok: true, service: 'kliktiva-api', appsScriptUrlConfigured: SCRIPT_URL_RE.test(scriptUrlOf(env)) });
}

export async function onRequestPost({ request, env }) {
  const scriptUrl = scriptUrlOf(env);
  if (!SCRIPT_URL_RE.test(scriptUrl)) {
    return json({ ok: false, code: 'APPS_SCRIPT_URL_NOT_CONFIGURED', error: 'APPS_SCRIPT_URL belum terbaca. Isi di Settings > Variables and Secrets (Production) lalu deploy ulang.' }, 500);
  }

  let input;
  try { input = await request.json(); }
  catch { return json({ ok: false, code: 'INVALID_JSON', error: 'Body request harus berupa JSON.' }, 400); }

  const action = String((input && input.action) || '');
  const args = Array.isArray(input && input.args) ? input.args : [];
  if (!ALLOWED_ACTIONS.has(action)) return json({ ok: false, code: 'ACTION_NOT_ALLOWED', error: 'API action tidak dikenal atau tidak diizinkan.' }, 400);

  try {
    const upstream = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8', 'accept': 'application/json' },
      body: JSON.stringify({ action, args }),
      redirect: 'follow'
    });
    const text = await upstream.text();
    let result;
    try { result = JSON.parse(text); }
    catch {
      return json({ ok: false, code: 'APPS_SCRIPT_BAD_RESPONSE', error: `Apps Script tidak mengembalikan JSON (HTTP ${upstream.status}). Pastikan Web App di-deploy dengan akses "Anyone" dan URL berakhiran /exec.` }, 502);
    }
    if (!upstream.ok) return json({ ok: false, code: (result && result.code) || 'APPS_SCRIPT_HTTP_ERROR', error: (result && result.error) || `Apps Script merespons HTTP ${upstream.status}.` }, 502);
    if (!result || result.ok !== true) return json({ ok: false, code: (result && result.code) || 'BACKEND_ERROR', error: (result && result.error) || 'Backend Apps Script mengembalikan kesalahan.' }, 400);
    return json({ ok: true, data: result.data });
  } catch (error) {
    return json({ ok: false, code: 'APPS_SCRIPT_UNREACHABLE', error: `Gagal menghubungi Apps Script: ${(error && error.message) || String(error)}` }, 502);
  }
}

// Metode lain (PUT, DELETE, dst.)
export async function onRequest() {
  return json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Gunakan metode POST.' }, 405);
}
