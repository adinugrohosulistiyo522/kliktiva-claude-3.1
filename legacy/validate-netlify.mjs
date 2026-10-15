import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
function pass(message) { checks.push(`PASS ${message}`); }
function compile(name, source) {
  try { new Function(source); pass(`syntax: ${name}`); }
  catch (e) { throw new Error(`Syntax error in ${name}: ${e.message}`); }
}
function inlineScripts(name, html) {
  const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(x => x.trim());
  assert.ok(blocks.length, `No inline <script> found in ${name}`);
  blocks.forEach((block, i) => compile(`${name} inline script ${i + 1}`, block));
}
function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Cannot locate source section: ${startMarker}`);
  return source.slice(start, end);
}

const code = read('Code.gs');
const license = read('License_Server.gs');
const admin = read('public/admin.html');
const pub = read('public/index.html');
const fn = read('netlify/functions/api.mjs');
const packageJson = JSON.parse(read('package.json'));

compile('Code.gs', code);
compile('License_Server.gs', license);
inlineScripts('public/admin.html', admin);
inlineScripts('public/index.html', pub);
execFileSync(process.execPath, ['--check', path.join(root, 'netlify/functions/api.mjs')], { stdio: 'pipe' });
pass('syntax: netlify/functions/api.mjs');

// Backend/Netlify/UI API contract.
const handlerBlock = code.match(/const handlers\s*=\s*\{([\s\S]*?)\n\s*\};/);
assert.ok(handlerBlock, 'Apps Script action handler map missing');
const backendActions = new Set([...handlerBlock[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map(m => m[1]));
const allowBlock = fn.match(/const ALLOWED_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\);/);
assert.ok(allowBlock, 'Netlify function allowlist missing');
const allowedActions = new Set([...allowBlock[1].matchAll(/'([A-Za-z_$][\w$]*)'/g)].map(m => m[1]));
for (const action of backendActions) assert.ok(allowedActions.has(action), `Backend action not allowed in Netlify Function: ${action}`);
for (const action of allowedActions) assert.ok(backendActions.has(action), `Netlify action missing in Apps Script: ${action}`);
pass(`API contract: ${backendActions.size} actions aligned between Apps Script and Netlify Function`);
const uiActions = new Set([...(`${admin}\n${pub}`).matchAll(/\bAPI\(\s*['"]([A-Za-z_$][\w$]*)['"]/g)].map(m => m[1]));
for (const action of uiActions) assert.ok(allowedActions.has(action), `UI action not allowed by Netlify Function: ${action}`);
pass(`UI contract: ${uiActions.size} UI actions are in allowlist`);

// Product catalog editor improvements and selectable public UI templates.
const templateMap = admin.match(/const UI_TEMPLATES=\{([\s\S]*?)\n\};/);
assert.ok(templateMap, 'Public UI template selector map missing');
const templateKeys = [...templateMap[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$-]*)):\{id:/gm)].map(m => m[1] || m[2]);
assert.equal(templateKeys.length, 20, `Expected exactly 20 selectable public UI templates, found ${templateKeys.length}`);
assert.equal(new Set(templateKeys).size, 20, 'Public UI template IDs must be unique');
for (const key of templateKeys) {
  assert.ok(pub.includes(`data-ui-template=\"${key}\"`) || key === 'classic', `Public UI CSS/layout missing template: ${key}`);
  assert.ok(code.includes(`'${key}'`) || code.includes(`\"${key}\"`), `Backend does not allow UI template: ${key}`);
}
assert.ok(admin.includes('id="uiTemplate"') && admin.includes("p.uiTemplate=$('uiTemplate').value") && admin.includes("uiTemplate:$('uiTemplate').value"), 'UI template selector must participate in preview and profile persistence');
assert.ok(pub.includes('function applyUiTemplate(key)') && pub.includes('applyUiTemplate(p.uiTemplate)'), 'Public website must apply saved UI template');
assert.ok(admin.includes('id="productCollectionFilter"') && admin.includes('id="newProductFormPanel"') && admin.includes('id="newProductBody"'), 'Product collection filter and separate product form are required');
assert.ok(admin.includes('function renderProductCollectionFilter()') && admin.includes('function renderNewProductForm()') && admin.includes('function productMatchesCollectionFilter(p)'), 'Product list filtering and separate create form handlers are missing');
pass('20 public UI templates are selectable, persisted, previewed, allowlisted, and product create/filter UI is separate');

// Data schema, permissions, and upload behavior.
assert.ok(code.includes("DRIVE_FOLDER_PROPERTY: 'DRIVE_UPLOAD_FOLDER_ID'"), 'Drive Folder ID property name mismatch');
assert.ok(code.includes('function maxNumericId_('), 'Missing numeric ID helper');
assert.ok(code.includes('function adminSaveDisplayOrder('), 'Missing display order handler');
assert.ok(code.includes('function adminDeleteCollection('), 'Missing collection deletion handler');
assert.ok(code.includes("const ACCOUNT_HEADERS = ['Username', 'Password', 'Role', 'Dibuat pada', 'Diubah pada']"), 'Separate plaintext account schema missing');
assert.ok(code.includes('function setupAccountsDatabase()') && code.includes('ACCOUNTS_SPREADSHEET_ID'), 'Separate Accounts spreadsheet setup missing');
assert.ok(code.includes('function setupAnalyticsDatabase()') && code.includes('ANALYTICS_SPREADSHEET_ID') && code.includes("ANALYTICS_PRODUCT_ALIASES_SHEET: 'Analytics_Product_Aliases'"), 'Separate Analytics spreadsheet and rename-alias schema missing');
assert.ok(code.includes("assertAdmin_(token, 'SYSTEM_ADMIN')") && /function\s+adminGetAnalytics\(token,\s*fromDate,\s*toDate\)/.test(code), 'Analytics/admin backend authorization or date-range signature missing');
assert.ok(code.includes('function adminRemoveProfilePhoto(token)') && backendActions.has('adminRemoveProfilePhoto'), 'Saved profile-photo removal API missing');
assert.ok(code.includes('function fetchAffiliateThumbnail_') && code.includes('Thumbnail Otomatis'), 'Automatic thumbnail fallback/cache missing');
assert.ok(!/new\s+URL\s*\(/.test(code), 'Apps Script backend must not rely on the browser URL constructor');
const thumbnailHelperSource = section(code, 'function extractHttpsHost_(', 'function fetchAffiliateThumbnail_');
assert.ok(thumbnailHelperSource.includes('function supportedThumbnailHost_') && thumbnailHelperSource.includes('function resolveThumbnailRedirect_'), 'Thumbnail URL safety helpers missing');
const thumbnailHelpers = new Function(thumbnailHelperSource + `return {extractHttpsHost_, supportedThumbnailHost_, resolveThumbnailRedirect_};`)();
assert.equal(thumbnailHelpers.supportedThumbnailHost_('https://s.shopee.co.id/1qcijizLJH'), true, 'Shopee short URL should be allowed');
assert.equal(thumbnailHelpers.supportedThumbnailHost_('https://shopee.co.id.attacker.example/item'), false, 'Lookalike marketplace host must be blocked');
assert.equal(thumbnailHelpers.supportedThumbnailHost_('http://shopee.co.id/item'), false, 'Non-HTTPS thumbnail source must be blocked');
assert.equal(thumbnailHelpers.resolveThumbnailRedirect_('/product/123', 'https://s.shopee.co.id/short'), 'https://s.shopee.co.id/product/123', 'Root-relative redirect should resolve');
assert.equal(thumbnailHelpers.resolveThumbnailRedirect_('https://example.com/image', 'https://s.shopee.co.id/short'), 'https://example.com/image', 'Redirect host must be validated separately before following');
const thumbnailFetchSource = section(code, 'function extractHttpsHost_(', 'function trackAnalyticsEvent(');
const isHttpUrlStub = `function isHttpUrl_(value){const s=String(value||'').trim();return s.startsWith('https://')||s.startsWith('http://');}`;
function mockResponse(status, headers, text) { return {getResponseCode:()=>status,getHeaders:()=>headers||{},getContentText:()=>text||''}; }
const mockFetchCalls=[];
const mockUrlFetch={fetch(url,options){mockFetchCalls.push({url,options});if(url==='https://s.shopee.co.id/short')return mockResponse(302,{Location:'https://shopee.co.id/product/1'},'');if(url==='https://shopee.co.id/product/1')return mockResponse(200,{'Content-Type':'text/html'},'<meta property="og:image" content="/cdn/photo.jpg">');throw new Error('unexpected test URL');}};
const thumbnailFetchHelpers = new Function('UrlFetchApp', thumbnailFetchSource + isHttpUrlStub + `return {fetchAffiliateThumbnail_};`)(mockUrlFetch);
assert.equal(thumbnailFetchHelpers.fetchAffiliateThumbnail_('https://s.shopee.co.id/short'),'https://shopee.co.id/cdn/photo.jpg','Redirected relative og:image should resolve against the final product URL');
assert.equal(mockFetchCalls.length,2,'Only the allowed short URL and allowed final marketplace URL should be requested');
pass('thumbnail marketplace allowlist, safe redirect checks, metadata extraction and relative-image resolution');

// Analytics: stable IDs, current names, daily visitor-day metric and date range.
assert.ok(code.includes('function trackAnalyticsEvent(event)'), 'Public analytics event recorder missing');
assert.ok(code.includes('function sumUniqueVisitorDays_(visitorsByDay)'), 'Visitor-day aggregation helper missing');
assert.ok(code.includes("Utilities.formatDate(now, APP.TIME_ZONE, 'yyyy-MM-dd')"), 'Analytics event date must use site timezone');
assert.ok(code.includes("TIME_ZONE: 'Asia/Jakarta'"), 'Analytics timezone must be Asia/Jakarta');
assert.ok(code.includes("dateOnlyLabel_(start)") && code.includes("dateOnlyLabel_(end)"), 'Date-range labels not returned in the expected short format');
assert.ok(code.includes('productById.get(id)') && code.includes('findUniqueProductByLegacyName_') && code.includes('getAnalyticsProductAliasMap_') && code.includes('recordProductNameAlias_'), 'Product analytics must resolve stable ProductID to current title and preserve legacy names on renames');
assert.ok(code.includes('findUniqueCollectionByLegacyName_'), 'Collection analytics should use stable CollectionID and map unambiguous legacy labels');
assert.ok(code.includes("add('unique_visitor_day', -1, '', '', dayVisitors.size)") && code.includes("add('unique_visitor_hour', hour, '', '', set.size)"), 'Visitor-day/hour rollups must preserve unique visitor definitions');
assert.ok(admin.includes('id="analyticsFromDate"') && admin.includes('id="analyticsToDate"') && admin.includes("API('adminGetAnalytics',TOKEN,from,to)"), 'Analytics date-range filter UI/API missing');
assert.ok(admin.includes('T(\'dateRangeInvalid\')') && admin.includes('id="resetAnalyticsFilter"'), 'Analytics date-range validation/reset missing');
assert.ok(!/id="refreshAnalyticsButton"/.test(admin) && !/id="refreshAnalytics"/.test(admin), 'Separate Refresh Analytics button should be removed');
assert.ok(/const refreshAnalytics=options\.refreshAnalytics!==undefined\?options\.refreshAnalytics:\(!\$\('analyticsSection'\)\.classList\.contains\('hidden'\)&&ROLE==='SYSTEM_ADMIN'\)/.test(admin), 'Global refresh should include Analytics only when relevant');
const analyticsHelpers = new Function(section(code, 'function sumUniqueVisitorDays_(', 'function normalizeSocialTargetKey_') + section(code, 'function normalizeAnalyticsName_(', 'function syncDailyUniqueVisitorCounts_') + `return {sumUniqueVisitorDays_, normalizeAnalyticsName_, findUniqueProductByLegacyName_, findUniqueCollectionByLegacyName_};`)();
const visitorDays = new Map([['2026-10-12', new Set(['v1'])], ['2026-10-13', new Set(['v1'])]]);
assert.equal(analyticsHelpers.sumUniqueVisitorDays_(visitorDays), 2, 'Same browser must count again on a different date');
assert.equal(analyticsHelpers.normalizeAnalyticsName_('  Azkana  Batik  '), 'azkana batik');
const productLegacy = analyticsHelpers.findUniqueProductByLegacyName_('Azkana Batik', '', [{ProductID:7,'Judul Produk':'Azkana Batik'}]);
assert.equal(productLegacy.ProductID, 7, 'Unambiguous historical product name should map to the current ProductID');
pass('analytics stable IDs, per-day visitor counting, date filtering and current-title lookup');

// Exercise the real dashboard aggregator against sheet-shaped fixture rows (not just source-string checks).
const analyticsDateKeySource = section(code, 'function analyticsDateKey_(', 'function updateAnalyticsDaily_');
const analyticsDateKey = new Function('Utilities', analyticsDateKeySource + 'return analyticsDateKey_;')({
  formatDate: (value, tz, format) => {
    const d = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const x = {}; parts.forEach(p => { if (p.type !== 'literal') x[p.type] = p.value; });
    return `${x.year}-${x.month}-${x.day}`;
  }
});
const fixtureEvents = [
  [1, new Date('2026-10-12T02:00:00Z'), '2026-10-12', 'page_view', '', 'Test Store', 'visitor-A', 'session-1', '/'],
  [2, new Date('2026-10-12T02:01:00Z'), '2026-10-12', 'page_view', '', 'Test Store', 'visitor-A', 'session-1', '/'],
  [3, new Date('2026-10-12T02:02:00Z'), '2026-10-12', 'collection_view', '1', 'Sarung BHS', 'visitor-A', 'session-1', '/'],
  [4, new Date('2026-10-12T02:03:00Z'), '2026-10-12', 'product_click', '1', 'Old Product Name', 'visitor-A', 'session-1', '/'],
  [5, new Date('2026-10-13T02:00:00Z'), '2026-10-13', 'page_view', '', 'Test Store', 'visitor-A', 'session-2', '/'],
  [6, new Date('2026-10-13T02:01:00Z'), '2026-10-13', 'social_click', 'shopee', 'Shopee', 'visitor-A', 'session-2', '/']
];
const fakeEventSheet = {
  getLastRow: () => fixtureEvents.length + 1,
  getLastColumn: () => 9,
  getRange: () => ({ getValues: () => fixtureEvents })
};
const fakeCollections = [{ CollectionID: 1, 'Nama Koleksi': 'Sarung BHS' }];
const fakeProducts = [{ ProductID: 1, 'Judul Produk': 'Sarung BHS Premium' }];
const fakeAnalyticsTop = (map, id, name) => {
  const key = String(id || name || 'Unknown');
  const item = map.get(key) || { id: key, name: String(name || key), clicks: 0 };
  item.clicks++; map.set(key, item);
};
const fakeTopArray = map => [...map.values()].sort((a,b) => b.clicks-a.clicks || a.name.localeCompare(b.name)).slice(0,10);
const fakeAnalyticsFunction = new Function(
  'assertAdmin_', 'defaultAnalyticsRange_', 'isValidIsoDate_', 'getAnalyticsProductAliasMap_',
  'getAnalyticsSheet_', 'ANALYTICS_EVENT_HEADERS', 'analyticsDateKey_', 'APP', 'Utilities',
  'getProducts_', 'getCollections_', 'readSettings_', 'findUniqueCollectionByLegacyName_',
  'findUniqueProductByLegacyName_', 'normalizeAnalyticsName_', 'normalizeSocialTargetKey_',
  'currentSocialLabel_', 'addAnalyticsTop_', 'analyticsTopArray_', 'consolidateAnalyticsDailyRows_',
  'syncDailyUniqueVisitorCounts_', 'sumUniqueVisitorDays_', 'dateOnlyLabel_', 'emptyAnalyticsDashboard_',
  section(code, 'function adminGetAnalyticsFromRawEvents_(start, end) {', '\nfunction addAnalyticsTop_') + 'return adminGetAnalyticsFromRawEvents_;'
)(
  () => {},
  () => ({ fromDate: '2026-10-12', toDate: '2026-11-10' }),
  value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')),
  () => new Map(),
  () => fakeEventSheet,
  ['EventID','Timestamp','EventDate','EventType','TargetID','TargetName','VisitorID','SessionID','Path'],
  analyticsDateKey,
  { TIME_ZONE: 'Asia/Jakarta' },
  { formatDate: (value, tz, format) => analyticsDateKey(value) },
  () => fakeProducts,
  () => fakeCollections,
  () => ({}),
  () => null,
  () => null,
  value => String(value || '').toLowerCase().trim(),
  id => String(id || '').toLowerCase(),
  (id, fallback) => fallback || id,
  fakeAnalyticsTop,
  fakeTopArray,
  () => {},
  () => {},
  analyticsHelpers.sumUniqueVisitorDays_,
  value => String(value).slice(8,10)+'/'+String(value).slice(5,7)+'/'+String(value).slice(0,4),
  (from,to) => ({ range: { fromDate: from, toDate: to }, summary: { pageViews:0, uniqueVisitors:0, collectionViews:0, productClicks:0, socialClicks:0, ctr:0 }, daily:[], topProducts:[], topCollections:[], topSocial:[] })
);
const rangeAnalytics = fakeAnalyticsFunction('2026-10-12', '2026-10-13');
assert.deepEqual(rangeAnalytics.summary, { pageViews:3, uniqueVisitors:2, collectionViews:1, productClicks:1, socialClicks:1, ctr:33.33 }, 'Analytics aggregation should count fixtures within inclusive range and visitor-day uniqueness');
assert.deepEqual(rangeAnalytics.daily.map(r => r.date), ['12/10/2026','13/10/2026'], 'Analytics trend dates should be DD/MM/YYYY and include both endpoints');
assert.equal(rangeAnalytics.topProducts[0].name, 'Sarung BHS Premium', 'Product analytics should use the current title for a stable ProductID');
const oneDayAnalytics = fakeAnalyticsFunction('2026-10-12', '2026-10-12');
assert.equal(oneDayAnalytics.summary.pageViews, 2, 'Single-day filter should include every matching page view');
assert.equal(oneDayAnalytics.summary.uniqueVisitors, 1, 'Same visitor on multiple page views in one day should count once');
assert.equal(oneDayAnalytics.summary.productClicks, 1, 'Single-day filter should retain product click');
pass('analytics raw-event fallback fixture: inclusive range, unique visitor-day, current product title and DD/MM/YYYY trend');

const aggregateDayFn = new Function('analyticsDateKey_', section(code, 'function buildAnalyticsAggregateRowsForDate_(day, eventRows) {', '\nfunction replaceAnalyticsAggregateDates_') + 'return buildAnalyticsAggregateRowsForDate_;')(analyticsDateKey);
const day12Buckets = aggregateDayFn('2026-10-12', fixtureEvents);
const day13Buckets = aggregateDayFn('2026-10-13', fixtureEvents);
const bucket = (rows, metric, hour, id='') => rows.find(r => r[2] === metric && Number(r[1]) === hour && String(r[3] || '') === id);
assert.equal(bucket(day12Buckets, 'page_view', 9)[5], 2, 'Rollup should count all page views for the WIB hour');
assert.equal(bucket(day12Buckets, 'unique_visitor_day', -1)[5], 1, 'Rollup should deduplicate visitors per local date');
assert.equal(bucket(day12Buckets, 'unique_visitor_hour', 9)[5], 1, 'Rollup should deduplicate visitors per local date and hour');
assert.equal(bucket(day12Buckets, 'product_click', 9, '1')[5], 1, 'Rollup should preserve product-click dimensions');
assert.equal(bucket(day13Buckets, 'social_click', 9, 'shopee')[5], 1, 'Rollup should preserve social-click dimensions on the correct date/hour');
pass('analytics rollup fixture: WIB hourly buckets, visitor de-duplication and target-level click dimensions');
const dailyTotalsFn = new Function(section(code, 'function analyticsDailyTotalsFromAggregateRows_(day, rows) {', '\n/** Keep the legacy daily sheet accurate') + 'return analyticsDailyTotalsFromAggregateRows_;')();
assert.deepEqual(dailyTotalsFn('2026-10-12', day12Buckets), {day:'2026-10-12',pageViews:2,uniqueVisitors:1,collectionViews:1,productClicks:1,socialClicks:0}, 'Scheduled rollup should preserve Analytics_Daily metrics for affected dates');

const rollupRows = [...day12Buckets, ...day13Buckets];
const aggregateMonthSheet = {
  getLastRow: () => rollupRows.length + 1,
  getRange: () => ({ getValues: () => rollupRows })
};
const aggregateSpreadsheet = {
  getSheetByName: name => name === 'Analytics_Agg_2026_10' ? aggregateMonthSheet : null
};
const aggregateDashboardFn = new Function(
  'getAnalyticsSpreadsheet_', 'analyticsMonthKeysInRange_', 'analyticsAggregateMonthSheetName_',
  'ANALYTICS_AGGREGATE_HEADERS', 'analyticsDateKey_', 'emptyAnalyticsDashboard_', 'getProducts_',
  'getCollections_', 'readSettings_', 'getAnalyticsProductAliasMap_', 'findUniqueCollectionByLegacyName_',
  'normalizeAnalyticsName_', 'findUniqueProductByLegacyName_', 'normalizeSocialTargetKey_',
  'currentSocialLabel_', 'addAnalyticsTopCount_', 'analyticsTopArray_', 'dateOnlyLabel_',
  section(code, 'function adminGetAnalyticsFromAggregates_(start, end) {', '\n/* ----------------------------- SETTINGS / DATA') + 'return adminGetAnalyticsFromAggregates_;'
)(
  () => aggregateSpreadsheet,
  (start, end) => ['2026-10'],
  month => 'Analytics_Agg_' + month.replace('-', '_'),
  ['EventDate','Hour','Metric','TargetID','TargetName','Count','UpdatedAt'],
  analyticsDateKey,
  (from, to) => ({ range:{fromDate:from,toDate:to}, summary:{pageViews:0,uniqueVisitors:0,collectionViews:0,productClicks:0,socialClicks:0,ctr:0}, daily:[], hourlyClicks:[], hourlyVisitors:[], topProducts:[], topCollections:[], topSocial:[] }),
  () => fakeProducts,
  () => fakeCollections,
  () => ({}),
  () => new Map(),
  () => null,
  value => String(value || '').toLowerCase().trim(),
  () => null,
  (id, fallback) => String(id || fallback || '').toLowerCase(),
  (id, fallback) => fallback || id,
  (map, id, name, count) => { const key=String(id||name||'Unknown'); const item=map.get(key)||{id:key,name:String(name||key),clicks:0}; item.clicks+=Number(count)||0; map.set(key,item); },
  map => [...map.values()].sort((a,b)=>b.clicks-a.clicks||a.name.localeCompare(b.name)).slice(0,10),
  value => String(value).slice(8,10)+'/'+String(value).slice(5,7)+'/'+String(value).slice(0,4)
);
const rolledDashboard = aggregateDashboardFn('2026-10-12', '2026-10-13');
assert.deepEqual(rolledDashboard.summary, { pageViews:3, uniqueVisitors:2, collectionViews:1, productClicks:1, socialClicks:1, ctr:33.33 }, 'Aggregated dashboard must match raw-event totals');
assert.equal(rolledDashboard.hourlyClicks[9].totalClicks, 2, 'Aggregated hourly clicks should retain WIB hour and totals');
assert.equal(rolledDashboard.hourlyVisitors[9].visitors, 2, 'Hourly visitors should be deduplicated per date/hour then summed across days');
assert.equal(rolledDashboard.topProducts[0].name, 'Sarung BHS Premium', 'Aggregated product click should use current product title');
pass('analytics rollup dashboard fixture matches raw-event summary and hourly chart metrics');

let fakeMonthlyRows = [
  ['EventDate','Hour','Metric','TargetID','TargetName','Count','UpdatedAt'],
  ['2026-10-12',9,'product_click','1','Product A',5,new Date('2026-10-13T00:00:00Z')],
  ['2026-10-13',9,'page_view','','',10,new Date('2026-10-13T00:00:00Z')]
];
const fakeMonthlySheet = {
  getLastRow: () => fakeMonthlyRows.length,
  getRange: (row, col, rows=1, cols=1) => ({
    getValues: () => fakeMonthlyRows.slice(row-1, row-1+rows).map(r => r.slice(col-1, col-1+cols)),
    clearContent: () => { for (let i=row-1; i<row-1+rows; i++) { if (!fakeMonthlyRows[i]) fakeMonthlyRows[i]=[]; for (let j=col-1; j<col-1+cols; j++) fakeMonthlyRows[i][j]=''; } },
    setValues: values => { values.forEach((r,i) => { const idx=row-1+i; if (!fakeMonthlyRows[idx]) fakeMonthlyRows[idx]=[]; for (let j=0;j<r.length;j++) fakeMonthlyRows[idx][col-1+j]=r[j]; }); }
  })
};
const replaceAggregateDatesFn = new Function('getOrCreateAnalyticsAggregateMonthSheet_', 'ANALYTICS_AGGREGATE_HEADERS', 'analyticsDateKey_', section(code, 'function replaceAnalyticsAggregateDates_(month, daysToReplace, desiredRows) {', '\nfunction analyticsMonthKeysInRange_') + 'return replaceAnalyticsAggregateDates_;')(
  () => fakeMonthlySheet,
  ['EventDate','Hour','Metric','TargetID','TargetName','Count','UpdatedAt'],
  (value, fallback) => value instanceof Date ? value.toISOString().slice(0,10) : String(value || '')
);
const replacementRows = [['2026-10-12',9,'product_click','1','Product A',5,new Date('2026-10-13T00:00:00Z')]];
replaceAggregateDatesFn('2026-10', new Set(['2026-10-12']), replacementRows);
replaceAggregateDatesFn('2026-10', new Set(['2026-10-12']), replacementRows);
const outputDateRows = fakeMonthlyRows.slice(1).filter(r => r[0]);
assert.equal(outputDateRows.length, 2, 'Retrying date replacement must not duplicate aggregate buckets');
assert.equal(outputDateRows.filter(r => r[0] === '2026-10-12')[0][5], 5, 'Rebuilt bucket count must replace instead of increment');
assert.equal(outputDateRows.filter(r => r[0] === '2026-10-13')[0][5], 10, 'Replacement must preserve aggregates for unaffected dates');
pass('analytics rollup retry/idempotency fixture: replacing affected date does not double-count or overwrite other dates');

// Public experience: correct tab labels/default view, counts, thumbnail fallback and CTA.
assert.ok(pub.includes("links:'Social Media & Kontak'") && pub.includes("links:'Social Media & Contact'"), 'Links tab label not localized as requested');
assert.ok(pub.includes("setTab('collection');closeCollection();"), 'Collection must be the initial public tab');
assert.ok(pub.includes("collectionsCount:n=>n+' koleksi'") && pub.includes("collectionsCount:n=>n===1?'1 collection':n+' collections'"), 'Collection-count labels not localized');
assert.ok(pub.includes("t('collectionsCount',display.length)"), 'Public count must count collections rather than products');
assert.ok(pub.includes("previewImages") && code.includes('previewImages: previewSources_(entries)'), 'Collection cover images must derive from products inside the collection');
assert.ok(pub.includes('function imageCandidates(raw)') && pub.includes('lh3.googleusercontent.com/d/') && pub.includes('function setImageSource'), 'Public image URL normalization/fallback logic missing');
assert.ok(pub.includes("im.replaceWith(imagePlaceholder(p.title||''))"), 'Broken product images should be replaced with a placeholder');
const imageHelpersSource = section(pub, 'const $=id=>', 'const API=async') + section(pub, 'function safeUrl(v)', 'function getVisitorIds');
const previewWindow = {}; previewWindow.parent = previewWindow;
const previewLocation = { search: '', origin: 'https://test.local', pathname: '/' };
const imageHelpers = new Function('window', 'location', imageHelpersSource + 'return {safeUrl,imageCandidates,setImageSource};')(previewWindow, previewLocation);
const fakeImage = {}; const imageAttempts = []; Object.defineProperty(fakeImage, 'src', {set(value){imageAttempts.push(value);}}); let imageFallbackCalled = 0;
imageHelpers.setImageSource(fakeImage, ['https://drive.google.com/uc?export=view&id=abcdefghijklmnopqrst'], () => { imageFallbackCalled++; });
let imageErrors = 0; while (fakeImage.onerror && imageFallbackCalled === 0 && imageErrors < 10) { fakeImage.onerror(); imageErrors++; }
assert.equal(imageAttempts.length, 4, 'Drive image fallback should try all four unique candidates: thumbnail, googleusercontent, view, and download');
assert.equal(imageFallbackCalled, 1, 'Fallback should be called once after every Drive image candidate fails');
assert.ok(pub.includes('sourceIndex>=sources.length') && pub.includes('validCount<3'), 'Collection cards should continue trying later product images until up to three valid thumbnails load');
assert.ok(pub.includes('.collection-card:hover,.collection-card:focus-visible{transform:translateY(-3px) scale(1.01)'), 'Collection cards should have subtle hover animation');
assert.ok(pub.includes('id="websiteCta"') && pub.includes('websiteCtaWhatsapp') && pub.includes('wa.me/'), 'Small WhatsApp order CTA missing');
assert.ok(!admin.includes('id="websiteCtaEnabled"') && !admin.includes('id="websiteCtaWhatsapp"') && !admin.includes('Tautan Pemesanan Website'), 'CTA settings must not be editable in customer Admin');
assert.ok(code.includes('verified.showWebsiteCta === true') && license.includes("CTA_HEADER: 'Tampilkan CTA Pemesanan Website'") && license.includes("=== 'YA'"), 'CTA visibility must be driven by the manually maintained License database flag');
assert.ok(pub.includes("const DEFAULT_ADMIN_WA='6289693123544'") && pub.includes('websiteCta') && pub.includes('left:12px;right:auto'), 'CTA must use the seller WhatsApp and move to bottom-left on mobile');
assert.ok(admin.includes('id="cancelPhotoChoice"') && admin.includes('id="removeSavedPhoto"'), 'Profile photo cancel/delete controls missing');
assert.ok(admin.includes("API('adminRemoveProfilePhoto',TOKEN)"), 'Saved profile photo delete must clear settings');
assert.ok(!/youtube-music-player|renderMusicPlayer|youtubeEmbedUrl|youtubeMusicEnabled|youtubeMusicUrl/i.test(admin), 'Music player/settings must be removed from Admin UI');
assert.ok(!/youtube-music-player|renderMusicPlayer|youtubeEmbedUrl|youtubeMusicEnabled|youtubeMusicUrl/i.test(pub), 'Music player/autoplay code must be removed from public UI');
pass('public Collection-first navigation, localized labels/counts, clean image fallback, hover and configurable CTA');

// UX: API failures are handled without alerts; only destructive actions/real dirty refresh can confirm.
assert.ok(admin.includes('function showMessage(text,type)') && admin.includes('setTimeout('), 'Non-blocking toast message mechanism missing');
assert.ok(admin.includes('function hasUnsavedChanges()') && admin.includes('if(hasUnsavedChanges()&&!force&&!confirm(T(\'refreshConfirm\')))'), 'Refresh confirmation must depend on real draft differences');
assert.ok(!/alert\s*\(/.test(admin), 'Admin routine error paths must not use blocking alert popups');
assert.ok(admin.includes('console.warn(\'[Project Bio API]'), 'Technical API failure details should be logged for diagnosis');
pass('non-blocking messages, graceful API error handling and unsaved-edit fingerprinting');

// Display-order UX and internal table scrolling (#16–#17).
assert.ok(backendActions.has('adminGetDisplayProducts') && allowedActions.has('adminGetDisplayProducts'), 'Explicit display-products loader API must be wired through backend and Netlify');
assert.ok(admin.includes('id="showDisplayProducts"') && admin.includes("$('showDisplayProducts').addEventListener('click',loadDisplayProducts)"), 'Display order must load only after clicking Show Products');
assert.ok(admin.includes('displayProductsLoaded') && admin.includes('displayLoading') && admin.includes('displayLoadError') && admin.includes('displayNoProducts'), 'Display order loader needs loading/error/empty states');
assert.equal((admin.match(/saveDisplayOrder'\)\.addEventListener/g) || []).length, 1, 'There must be exactly one save-order event listener');
assert.ok(!admin.includes('displayCollection:$(') && admin.includes('displayOrder:displayOrderDirty?'), 'Changing collection alone must not count as unsaved reorder');
for (const sectionId of ['productsSection','collectionsSection','displaySection','accountsSection']) {
  const start = admin.indexOf(`<section id="${sectionId}"`);
  const end = admin.indexOf('</section>', start);
  assert.ok(start >= 0 && end > start && admin.slice(start, end).includes('admin-scroll-table'), `Internal scroll missing from ${sectionId}`);
}
assert.ok(admin.includes('max-height:min(56vh,480px)') && admin.includes('position:sticky;top:0;z-index:6'), 'Admin table area needs bounded internal scroll and sticky headers');
const displayBackendSource = section(code, 'function adminGetDisplayProducts(', 'function adminSaveDisplayOrder(');
let displayAuthCalls = 0;
const getDisplay = new Function('assertAdmin_', 'validId_', 'getCollections_', 'getProducts_', displayBackendSource + 'return adminGetDisplayProducts;')(
  () => { displayAuthCalls++; },
  (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; },
  () => [{CollectionID:1},{CollectionID:2}],
  () => [
    {ProductID:4,KoleksiID:2,UrutanTampilan:3},
    {ProductID:1,KoleksiID:2,UrutanTampilan:1},
    {ProductID:3,KoleksiID:1,UrutanTampilan:1},
    {ProductID:2,KoleksiID:'',UrutanTampilan:1},
    {ProductID:5,KoleksiID:2,UrutanTampilan:2}
  ]
);
assert.deepEqual(getDisplay('valid-token',2).map(p=>p.ProductID),[1,5,4], 'Display products must only return selected collection and sort by order');
assert.deepEqual(getDisplay('valid-token','').map(p=>p.ProductID),[2], 'Unassigned display collection must only return unassigned products');
assert.equal(displayAuthCalls,2,'Every display-products API call must check admin access');
pass('explicit product-list load flow, collection filtering/order, and internal scroll/sticky table headers for the four Admin tabs');

assert.ok(!fn.includes('APPS_SCRIPT_API_SECRET'), 'Removed shared secret is still present in Netlify Function');
assert.ok(code.includes('function createInitialSystemAdmin()'), 'Initial SYSTEM_ADMIN bootstrap missing');
pass('separate databases, SYSTEM_ADMIN enforcement, thumbnail caching, and API proxy');

for (const f of ['Database_Project_Bio_Affiliate_Toko.xlsx', 'Database_Accounts_Project_Bio_Affiliate_Toko.xlsx', 'Database_Analytics_Project_Bio_Affiliate_Toko.xlsx', 'Database_Lisensi_Aktivasi_Project_Bio_Affiliate_Toko.xlsx']) {
  assert.ok(fs.existsSync(path.join(root, f)), `Missing workbook: ${f}`);
}
for (const f of ['netlify.toml', 'public/index.html', 'public/admin.html', '.github/workflows/validate.yml', 'DEPLOY_BROWSER_ONLY_ID.txt', 'README_FINAL_SETUP.txt']) assert.ok(fs.existsSync(path.join(root, f)), `Missing file: ${f}`);
assert.equal(packageJson.private, true, 'package.json should remain private');
assert.equal(packageJson.version, '3.4.0', 'package version should match the final correction release');
assert.ok(read('DEPLOY_BROWSER_ONLY_ID.txt').includes('SATU KALI') && read('README_FINAL_SETUP.txt').includes('v3.4.0'), 'Browser deployment docs should identify the single-commit final update');
const analyticsWorkbook = fs.readFileSync(path.join(root, 'Database_Analytics_Project_Bio_Affiliate_Toko.xlsx'));
assert.ok(analyticsWorkbook.length > 5000, 'Analytics workbook template is unexpectedly small/empty');
pass('release package, database workbook templates, deployment guide and GitHub workflow present');


// New v3.4.0 correction checks: license heartbeat handling, Analytics date locale/aggregation and fast saves.
assert.ok(code.includes('LICENSE_VALID_CACHE_SECONDS: 240'), 'License cache should align with the 5-minute site heartbeat');
assert.ok(code.includes("requestLicense = assertLicensedForRequest_(false)"), 'Public data must reuse the just-validated status cache instead of a second forced License Server request');
assert.ok(pub.includes('setInterval(recheckPublicLicense,5*60*1000)') && pub.includes("if(state.active!==true){showCatalogStatus(t('connectionRetry'), 'error', true);return false;}"), 'Public license/data heartbeat must retry transient failures without false locking');
assert.ok(pub.includes("if(definitiveInactiveLicense(state)){licenseGate"), 'Explicit inactive/expired licenses must still be enforced');
assert.ok(pub.includes("showScreen('publicApp')") && pub.includes('showCatalogSkeleton()') && pub.includes("showCatalogStatus(t('loadingCatalog'))"), 'Public boot should reveal shell and restrict loading to the catalog panel');
assert.ok(code.includes('function setSettingsBatch_(updates)') && code.includes('setSettingsBatch_(settingUpdates)'), 'Profile saves must batch Settings writes');
assert.ok(code.includes('Drive upload can take time. Do it before taking the global Sheets lock') && code.includes('Alias bookkeeping touches the separate Analytics spreadsheet; keep it outside the operational DB lock'), 'Slow image upload and alias work must stay outside the main sheet lock');
assert.ok(code.includes('if (orders.length) sh.getRange(2, 5, orders.length, 1).setValues(orders)'), 'Collection-order save should batch write the order column');
assert.ok(code.includes('sh.getRange(2, 7, rows.length, 1).setValues(orderColumn)') && code.includes('sh.getRange(2, 11, rows.length, 1).setValues(changedAtColumn)'), 'Product-order save should batch write columns');
assert.ok(admin.includes('const wasNew=!!p._isNew') && admin.includes('result.needsThumbnailLookup') && admin.includes('resolveProductThumbnailInBackground(id,payload[\'Link Affiliate\'])'), 'Thumbnail auto-discovery should also start for new products and affiliate-link edits');
assert.ok(admin.includes("p.websiteCtaEnabled=String(DATA.profile.websiteCtaEnabled||'false')") && !admin.includes("p.websiteCtaEnabled='false'"), 'Live preview must reflect the License-gated CTA flag');
assert.ok(admin.includes('adminSaveAccount') && admin.includes('accountsCache=accountsCache.filter') && !/API\('adminSaveAccount',[\s\S]{0,300}await loadAccounts\(\)/.test(admin), 'Account save should update its row locally rather than reload all data');
assert.ok(code.includes('function adminGetAnalytics(token, fromDate, toDate)') && code.includes('day >= start && day <= end'), 'Analytics must normalize and include both endpoints of the ISO date range');
assert.ok(code.includes('function setupAnalyticsAggregation()') && code.includes("everyMinutes(5)") && code.includes('function refreshAnalyticsAggregation()'), 'Analytics must support a scheduled 5-minute incremental rollup refresh');
assert.ok(code.includes('ANALYTICS_AGGREGATION_CURSOR_ROW') && code.includes('ANALYTICS_AGGREGATION_BOOTSTRAP_TARGET_ROW'), 'Incremental aggregation must persist a resumable source-row cursor');
assert.ok(code.includes('ANALYTICS_DASHBOARD_CACHE_SECONDS: 180') && code.includes('adminGetAnalyticsFromAggregates_'), 'Analytics dashboard should use cached results and aggregated monthly partitions');
assert.ok(code.includes('function getAnalyticsAggregationStatus()') && code.includes('ANALYTICS_AGGREGATION_VERSION'), 'Analytics aggregation should expose a manual setup status and versioned cache invalidation');
assert.ok(code.includes('syncAnalyticsDailyFromAggregates_(dailyTotalsByDate)') && code.includes('ANALYTICS_AGGREGATION_IN_PROGRESS'), 'Scheduled refresh must keep daily compatibility metrics accurate and prevent reads during partial rollup writes');
assert.ok(!/consolidateAnalyticsDailyRows_\(\);/.test(section(code, 'function adminGetAnalyticsFromRawEvents_(start, end) {', '\nfunction addAnalyticsTop_')), 'Analytics read fallback must not consolidate or write database rows during filter requests');
assert.ok(!/b\.values\[2\]\s*=\s*0/.test(section(code,'function consolidateAnalyticsDailyRows_()','function updateAnalyticsSummary_')), 'Daily consolidation must not erase the computed unique visitor-day value');
assert.ok(admin.includes('type="text" inputmode="numeric"') && admin.includes('placeholder="DD/MM/YYYY"') && admin.includes('function dateDisplayToIso'), 'Analytics date fields must enforce the explicit Indonesian date display');
const dateHelpers = new Function(section(admin, 'function jakartaDateString(', 'function renderAnalyticsLast()') + 'return {dateDisplayToIso,isoToDateDisplay};')();
assert.equal(dateHelpers.dateDisplayToIso('12/10/2026'), '2026-10-12', 'DD/MM/YYYY should map 12 October to ISO');
assert.equal(dateHelpers.dateDisplayToIso('31/02/2026'), '', 'Invalid dates should be rejected');
assert.equal(dateHelpers.isoToDateDisplay('2026-10-12'), '12/10/2026', 'ISO date should display in Indonesian format');
assert.ok(admin.includes("apply.classList.add('analytics-filter-loading')") && admin.includes("el('span','button-spinner')") && admin.includes("T('analyticsProcessing')"), 'Analytics filtering needs a smooth button-local loading state');
assert.ok(admin.includes('id="openPublicSite"') && admin.includes("open.href=location.origin+'/'") && admin.includes('id="publicPreviewFrame"') && admin.includes('width:390px'), 'Admin needs same-origin public link and mobile-sized live preview');
pass('v3.4.0: 5-minute heartbeat, resilient licensing, Analytics date locale/repair, License CTA, mobile preview, auto thumbnails, batch save and local row updates');

// Verify manual license CTA flag behavior directly against the actual License Server verifier.
const licenseVerifySource = section(license, 'function verifyLicenseCode_(code) {', '\nfunction openLicenseSpreadsheet_');
const makeLicenseSheet = cta => ({
  getLastRow: () => 2,
  getDataRange: () => ({ getValues: () => [
    ['Kode Aktivasi','Status','Tanggal Aktif','Tanggal Expired','Nama Pengguna','No Hape Pengguna','Tampilkan CTA Pemesanan Website'],
    ['PBAT-2026-TEST-1234','Aktif',new Date('2026-01-01T00:00:00Z'),new Date('2027-01-01T00:00:00Z'),'Test User','6289693123544',cta]
  ] })
});
const valueOfDateKey = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value || '').slice(0,10);
const runLicenseVerifier = cta => {
  const cacheMap = new Map();
  const fakeCache = { get:k=>cacheMap.get(k)||null, put:(k,v)=>cacheMap.set(k,v) };
  const verifier = new Function('CacheService','openLicenseSpreadsheet_','getLicenseSheetName_','Utilities','LICENSE_SERVER','normalizeCode_','dateKey_','sha256_',licenseVerifySource+'return verifyLicenseCode_;')(
    {getScriptCache:()=>fakeCache}, () => ({getSheetByName:()=>makeLicenseSheet(cta)}), ()=>'Licenses',
    {formatDate:(d,tz,fmt)=>'2026-10-12'},
    {CACHE_SECONDS:5, CTA_HEADER:'Tampilkan CTA Pemesanan Website', HEADERS:['Kode Aktivasi','Status','Tanggal Aktif','Tanggal Expired','Nama Pengguna','No Hape Pengguna'], TIME_ZONE:'Asia/Jakarta'},
    v=>String(v||'').trim().toUpperCase().replace(/\s+/g,''), v=>valueOfDateKey(v), v=>String(v)
  );
  return verifier('PBAT-2026-TEST-1234');
};
assert.equal(runLicenseVerifier('YA').showWebsiteCta,true,'License value YA should enable website CTA');
assert.equal(runLicenseVerifier('TIDAK').showWebsiteCta,false,'License value TIDAK should hide website CTA');
assert.equal(runLicenseVerifier('').showWebsiteCta,false,'Blank License CTA flag should be hidden by default');
pass('License Server reads the manual YA/TIDAK CTA flag correctly, with blank defaulting to hidden');

// Verify collection order writes persist to the collection-order column in the expected sequence.
const collectionRows = [
  [1,'Sarung BHS',new Date(),new Date(),1],
  [2,'Sarung ATLAS',new Date(),new Date(),2],
  [3,'ATLAS HIJAB',new Date(),new Date(),3]
];
let savedCollectionOrder = null;
const fakeCollectionSheet = {
  getLastRow: () => collectionRows.length + 1,
  getRange: (row,col,numRows,numCols) => ({
    getValues: () => col===1 ? collectionRows.map(r=>r.slice(0,numCols)) : collectionRows.map(r=>r.slice(col-1,col-1+numCols)),
    setValues: values => { if(row===2&&col===5) savedCollectionOrder=values.map(r=>r[0]); }
  })
};
const collectionOrderSource = section(code, 'function adminSaveCollectionOrder(token, collectionIds) {', '\nfunction adminDeleteCollection(');
const saveOrderFunction = new Function('assertAdmin_','validId_','LockService','getDb_','APP','ensureCollectionOrderColumn_','COLLECTION_HEADERS','appError_',collectionOrderSource+'return adminSaveCollectionOrder;')(
  () => {}, v=>{const n=Number(v);return Number.isInteger(n)&&n>0?n:null;},
  {getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
  ()=>({getSheetByName:()=>fakeCollectionSheet}), {COLLECTIONS_SHEET:'Collections'}, () => {},
  ['CollectionID','Nama Koleksi','Dibuat Pada','Diubah Pada','UrutanTampilan'],
  (code,message)=>{const e=new Error(message);e.appCode=code;return e;}
);
const orderResult = saveOrderFunction('token',[3,1,2]);
assert.equal(orderResult.ok,true);
assert.deepEqual(savedCollectionOrder,[2,3,1],'Collection display order should persist the admin-selected sequence to the database');
pass('collection ordering function persists the selected order in a single range write');

console.log(checks.join('\n'));
console.log(`\nAll ${checks.length} validation checks passed.`);
