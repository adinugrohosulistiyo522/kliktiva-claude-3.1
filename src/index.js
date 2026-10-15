// Entry Cloudflare Worker (hanya dipakai bila proyek dibuat lewat alur "Workers").
// Halaman statis (/, /admin) disajikan otomatis dari folder public.
// Worker hanya menangani /api, memakai proxy yang sama dengan functions/api.js (Pages).
import { onRequestGet, onRequestPost, onRequest } from '../functions/api.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (request.method === 'GET') return onRequestGet({ request, env });
      if (request.method === 'POST') return onRequestPost({ request, env });
      return onRequest({ request, env });
    }
    return env.ASSETS.fetch(request);
  }
};
