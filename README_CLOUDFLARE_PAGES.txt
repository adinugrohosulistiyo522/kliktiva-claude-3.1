KLIKTIVA — PAKET CLOUDFLARE PAGES (v3)

KENAPA PAGES, BUKAN WORKER
- Worker custom domain hanya bisa dipasang di domain yang DNS-nya aktif di Cloudflare.
- Pages bisa dipasangi subdomain lewat CNAME dari penyedia DNS mana pun (mis. Netlify DNS).
- Frontend dan proxy ke Apps Script TIDAK berubah; hanya wadahnya.

ISI
- public/            -> halaman (index.html, admin.html, _headers)
- functions/api.js   -> proxy ke Apps Script, route /api
- Code.gs, License_Server.gs, *.xlsx -> backend & database (tidak berubah)
- legacy/            -> validator lama versi Netlify (tidak dipakai)

SETUP (Pages, dari GitHub)
1. Ganti isi repo GitHub dengan isi paket ini (file langsung di ROOT repo, bukan di dalam folder).
   Hapus wrangler.jsonc dan folder src/ dari repo lama kalau masih ada.
2. Cloudflare > Workers & Pages > Create > tab "Pages" (cari tautan "Looking to deploy Pages?")
   > Connect to Git > pilih repo.
3. Pengaturan build:
   Framework preset : None
   Build command    : (kosongkan)
   Build output dir : public
4. Settings > Variables and Secrets > tambah (Production):
   APPS_SCRIPT_URL = URL Web App Apps Script berakhiran /exec
   LALU deploy ulang (Retry deployment). Variabel baru hanya terbaca setelah deploy berikutnya.

UJI BERTAHAP (jangan lompat)
A. Buka https://NAMA-PROYEK.pages.dev/        -> halaman harus tampil
B. Buka https://NAMA-PROYEK.pages.dev/api      -> harus tampil {"ok":true,...,"appsScriptUrlConfigured":true}
   - false  : variabel belum terbaca (cek langkah 4 dan deploy ulang)
C. Buka https://NAMA-PROYEK.pages.dev/admin    -> halaman admin harus tampil
D. Baru pasang domain:
   Pages > Custom domains > tambah subdomain.
   Di DNS (zona kliktiva.my.id) buat CNAME subdomain -> NAMA-PROYEK.pages.dev
   Tunggu verifikasi dan HTTPS.

PEMERIKSAAN LOKAL
  npm run check:all

----------------------------------------------------------------
JIKA PROYEK DIBUAT LEWAT ALUR "WORKERS" (alamat *.workers.dev)
----------------------------------------------------------------
Paket ini juga memuat wrangler.jsonc + src/index.js untuk Worker.
- Ubah "name" di wrangler.jsonc agar SAMA PERSIS dengan nama Worker di dashboard
  (default di paket ini: kliktiva-bio-claude).
- Isi APPS_SCRIPT_URL di Settings > Variables and Secrets milik Worker itu, lalu deploy ulang.
- Uji: buka https://NAMA.AKUN.workers.dev/api  -> harus tampil JSON {"ok":true,...}
- Catatan: domain kustom (mis. subdomain.kliktiva.my.id) di Worker butuh zona DNS aktif di Cloudflare.
  Dengan DNS di Netlify, pakai alur Pages. Jika memakai Pages, hapus wrangler.jsonc dan folder src/.
