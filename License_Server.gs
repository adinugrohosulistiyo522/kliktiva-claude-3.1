/**
 * PROJECT BIO AFFILIATE / TOKO — LICENSE VERIFICATION SERVICE
 * Deploy this file as a separate Web App, owned by the seller/publisher.
 * It reads a PRIVATE license spreadsheet and only returns validity/date/reason.
 * It never returns customer names, phone numbers, or the full license database.
 * No shared secret is used, per product owner's request.
 */
const LICENSE_SERVER = {
  SPREADSHEET_ID_PROPERTY: 'LICENSE_SPREADSHEET_ID',
  SHEET_NAME_PROPERTY: 'LICENSE_SHEET_NAME',
  DEFAULT_SHEET_NAME: 'Licenses',
  TIME_ZONE: 'Asia/Jakarta',
  CACHE_SECONDS: 5,
  CTA_HEADER: 'Tampilkan CTA Pemesanan Website',
  HEADERS: ['Kode Aktivasi', 'Status', 'Tanggal Aktif', 'Tanggal Expired', 'Nama Pengguna', 'No Hape Pengguna']
};

function doGet() {
  return licenseJson_({ ok: true, service: 'Project Bio Affiliate / Toko License Verification', message: 'License service active.' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '{}');
    if (String(req.action || '') !== 'verifyLicense') throw new Error('Action tidak diizinkan.');
    const code = normalizeCode_(req.code);
    if (code.length < 10) return licenseJson_({ ok: true, data: { valid: false, reason: 'NOT_FOUND' } });
    return licenseJson_({ ok: true, data: verifyLicenseCode_(code) });
  } catch (err) {
    return licenseJson_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function setupLicenseHeaders() {
  const ss = openLicenseSpreadsheet_();
  const name = getLicenseSheetName_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const currentWidth = Math.max(sh.getLastColumn(), LICENSE_SERVER.HEADERS.length);
  const current = sh.getLastRow() ? sh.getRange(1, 1, 1, currentWidth).getDisplayValues()[0].map(v => String(v || '').trim()) : [];
  const hasCoreHeaders = LICENSE_SERVER.HEADERS.every((h, i) => current[i] === h);
  if (!hasCoreHeaders) {
    if (sh.getLastRow() > 1) throw new Error('Header inti Lisensi berbeda dan sheet sudah berisi data. Buat backup dan sesuaikan enam kolom inti secara manual sebelum menjalankan setupLicenseHeaders().');
    sh.clearContents();
    sh.getRange(1, 1, 1, LICENSE_SERVER.HEADERS.length).setValues([LICENSE_SERVER.HEADERS]);
  }
  const freshWidth = Math.max(sh.getLastColumn(), LICENSE_SERVER.HEADERS.length);
  const headerNow = sh.getRange(1, 1, 1, freshWidth).getDisplayValues()[0].map(v => String(v || '').trim());
  if (!headerNow.includes(LICENSE_SERVER.CTA_HEADER)) {
    const newCol = freshWidth + 1;
    sh.getRange(1, newCol).setValue(LICENSE_SERVER.CTA_HEADER);
    // Existing licenses intentionally default to blank (= hidden); the seller fills YA/TIDAK manually.
  }
  const totalWidth = Math.max(sh.getLastColumn(), LICENSE_SERVER.HEADERS.length + 1);
  const finalHeaders = sh.getRange(1, 1, 1, totalWidth).getDisplayValues()[0].map(v => String(v || '').trim());
  sh.getRange(1, 1, 1, totalWidth).setFontWeight('bold').setBackground('#79563f').setFontColor('#ffffff').setWrap(true);
  // Seller-maintained feature switch: valid values only, blanks remain hidden by default until the seller fills them.
  const ctaColumn = finalHeaders.indexOf(LICENSE_SERVER.CTA_HEADER) + 1 || totalWidth;
  const validation = SpreadsheetApp.newDataValidation().requireValueInList(['YA', 'TIDAK'], true).setAllowInvalid(false).build();
  sh.getRange(2, ctaColumn, Math.max(1, sh.getMaxRows() - 1), 1).setDataValidation(validation);
  sh.setFrozenRows(1);
  return { ok: true, spreadsheetId: ss.getId(), sheetName: sh.getName(), headers: sh.getRange(1, 1, 1, totalWidth).getDisplayValues()[0] };
}

function verifyLicenseCode_(code) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'license:' + sha256_(code);
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (_) {} }

  const sh = openLicenseSpreadsheet_().getSheetByName(getLicenseSheetName_());
  if (!sh || sh.getLastRow() < 2) return { valid: false, reason: 'NOT_FOUND' };
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(v => String(v || '').trim());
  const col = {};
  headers.forEach((h, i) => { col[h] = i; });
  const required = LICENSE_SERVER.HEADERS;
  required.forEach(h => { if (col[h] === undefined) throw new Error('Kolom wajib tidak ditemukan pada sheet Lisensi: ' + h); });
  // CTA is a feature flag maintained manually by the license owner. Missing/blank defaults to hidden.
  const ctaIndex = col[LICENSE_SERVER.CTA_HEADER];
  const matches = values.slice(1).filter(r => normalizeCode_(r[col['Kode Aktivasi']]) === code);
  if (!matches.length) {
    const missing = { valid: false, reason: 'NOT_FOUND' };
    cache.put(cacheKey, JSON.stringify(missing), LICENSE_SERVER.CACHE_SECONDS);
    return missing;
  }
  if (matches.length > 1) {
    const duplicate = { valid: false, reason: 'DUPLICATE_CODE' };
    cache.put(cacheKey, JSON.stringify(duplicate), LICENSE_SERVER.CACHE_SECONDS);
    return duplicate;
  }
  const row = matches[0];

  const status = String(row[col.Status] || '').trim().toLowerCase();
  const activeDate = dateKey_(row[col['Tanggal Aktif']]);
  const expiryDate = dateKey_(row[col['Tanggal Expired']]);
  const today = Utilities.formatDate(new Date(), LICENSE_SERVER.TIME_ZONE, 'yyyy-MM-dd');
  let result;
  if (status !== 'aktif') result = { valid: false, reason: 'NOT_ACTIVE' };
  else if (!activeDate || !expiryDate || activeDate > expiryDate) result = { valid: false, reason: 'INVALID_DATES' };
  else if (today < activeDate) result = { valid: false, reason: 'NOT_STARTED', activeDate, expiryDate };
  else if (today > expiryDate) result = { valid: false, reason: 'EXPIRED', activeDate, expiryDate };
  else result = { valid: true, reason: 'ACTIVE', activeDate, expiryDate, showWebsiteCta: ctaIndex !== undefined && String(row[ctaIndex] || '').trim().toUpperCase() === 'YA' };
  if (!Object.prototype.hasOwnProperty.call(result, 'showWebsiteCta')) result.showWebsiteCta = false;
  cache.put(cacheKey, JSON.stringify(result), LICENSE_SERVER.CACHE_SECONDS);
  return result;
}

function openLicenseSpreadsheet_() {
  const id = String(PropertiesService.getScriptProperties().getProperty(LICENSE_SERVER.SPREADSHEET_ID_PROPERTY) || '').trim();
  if (!id) throw new Error('LICENSE_SPREADSHEET_ID belum diatur pada Script Properties License Server.');
  return SpreadsheetApp.openById(id);
}
function getLicenseSheetName_() {
  return String(PropertiesService.getScriptProperties().getProperty(LICENSE_SERVER.SHEET_NAME_PROPERTY) || LICENSE_SERVER.DEFAULT_SHEET_NAME).trim();
}
function normalizeCode_(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
function dateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, LICENSE_SERVER.TIME_ZONE, 'yyyy-MM-dd');
  const s = String(value || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  const d = new Date(s); if (!isNaN(d.getTime())) return Utilities.formatDate(d, LICENSE_SERVER.TIME_ZONE, 'yyyy-MM-dd');
  return '';
}
function sha256_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8).map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join(''); }
function licenseJson_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }
