PROJECT BIO AFFILIATE / TOKO v3.4.0 — SETUP DAN OPERASIONAL

Release ini dibangun di atas baseline v3.3.0 yang dilaporkan pengguna sudah WORK. Koreksi baru #1–#10 sudah digabungkan. Website tetap memakai Netlify sebagai hosting static frontend + Functions, Google Apps Script sebagai backend, Google Sheets terpisah untuk operational DB, Accounts, Analytics, dan License, serta Drive untuk file gambar.

STRUKTUR PAKET
- public/index.html: website publik, startup shell-first, koleksi sebagai tab default, CTA berbasis License, heartbeat, fallback gambar dan mobile behavior.
- public/admin.html: Admin yang ada dengan desktop live preview/mobile preview, urutan koleksi, filter Analytics, notifikasi non-blocking dan tabel scroll internal.
- Code.gs: backend utama Apps Script.
- License_Server.gs: backend pemeriksa lisensi dan flag CTA.
- netlify/functions/api.mjs: proxy frontend ke Apps Script.
- scripts/validate.mjs: validator lokal/GitHub Actions.
- empat file XLSX: template operasional, akun, Analytics dan lisensi. Template bukan pengganti spreadsheet produksi.

KONFIGURASI YANG HARUS TETAP
Apps Script Script Properties: MAIN_SPREADSHEET_ID, ACCOUNTS_SPREADSHEET_ID, ANALYTICS_SPREADSHEET_ID, DRIVE_UPLOAD_FOLDER_ID, LICENSE_API_URL. License Server: LICENSE_SPREADSHEET_ID dan opsional LICENSE_SHEET_NAME. Netlify environment: APPS_SCRIPT_URL.

LICENSE CTA
Kolom `Tampilkan CTA Pemesanan Website` di License sheet diisi manual oleh pemilik sistem dengan `YA` atau `TIDAK`. YA memperlihatkan CTA pemesanan ke WhatsApp pemilik `6289693123544`, TIDAK atau kosong menyembunyikannya. Pengaturan ini tidak tersedia di Admin pelanggan.

ANALYTICS
Dashboard menghitung event dari Analytics_Events dalam rentang tanggal yang dipilih, menggunakan EventDate dan EventType. Format UI DD/MM/YYYY, rentang inklusif. Pengunjung unik adalah jumlah VisitorID berbeda per hari dalam zona waktu Asia/Jakarta; pengunjung sama yang kembali hari berbeda dihitung lagi. Event baru menyimpan TargetID stabil untuk produk/koleksi jika tersedia; event lama dengan nama tanpa ID dipetakan hanya bila tidak ambigu.

KETERBATASAN YANG JUJUR
- Jangan menjanjikan nol bug sebelum menjalankan uji produksi; validasi otomatis bukan pengganti pengujian akun sebenarnya.
- Thumbnail marketplace bersifat best-effort karena host dapat membatasi metadata. Gambar manual dan placeholder menjadi fallback.
- Status lisensi yang benar-benar tidak aktif/kedaluwarsa tetap ditegakkan. Network failure sementara harus ditangani sebagai retry, bukan dianggap expiry.
- Analytics visitor ID berbasis browser/device storage hanyalah estimasi. Orang yang mengganti perangkat/browser atau menghapus storage mungkin dihitung sebagai pengunjung berbeda.
- Analytics spreadsheet terpisah, tetapi execution/quota Apps Script tetap mengikuti akun/backend yang sama.
- Password Accounts disimpan plaintext sesuai schema yang diminta; batasi izin spreadsheet dengan ketat dan jangan menyebarkan aksesnya.

DEPLOYMENT
Ikuti `DEPLOY_BROWSER_ONLY_ID.txt` untuk pembaruan License Server, Main Apps Script dan satu kali commit GitHub/Netlify. Jangan menimpa appsscript.json yang sudah benar, jangan membuat site Netlify baru, dan jangan menjalankan ulang setup pada database produksi tanpa backup.
