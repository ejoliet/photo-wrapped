const FREE_CAP = 500;
const DUCK_THRESHOLD = 10000;
const DB_NAME = 'photo-wrapped-local-v1';
const STORE = 'library';

const $ = (id) => document.getElementById(id);
const state = { rows: [], files: new Map(), markers: [], pro: false, db: null, duckConn: null };

let map, markerLayer;
init();

async function init() {
  $('folderInput').addEventListener('change', onFolderPick);
  $('resumeBtn').addEventListener('click', resumeCached);
  $('clearBtn').addEventListener('click', clearCache);
  $('unlockBtn').addEventListener('click', unlockPro);
  $('duckBtn').addEventListener('click', initDuckDB);
  $('runSqlBtn').addEventListener('click', runSql);
  $('semanticBtn').addEventListener('click', semanticSearch);
  $('dupeBtn').addEventListener('click', findDuplicates);
  $('burstBtn').addEventListener('click', scoreBursts);
  $('resumeBtn').disabled = !(await hasCache());
  initMap();
  drawEmptyCharts();
}

function initMap() {
  map = L.map('map', { preferCanvas: true }).setView([20, 0], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

async function onFolderPick(event) {
  const all = [...event.target.files].filter(isImage);
  if (!all.length) return setStatus('No supported images found.');
  const limited = state.pro ? all : all.slice(0, FREE_CAP);
  state.files = new Map(limited.map(f => [filePath(f), f]));
  setStatus(`Indexing ${limited.length.toLocaleString()} of ${all.length.toLocaleString()} selected files locally...`);
  state.rows = await parseInWorker(limited);
  await saveCache(state.rows);
  renderAll();
  $('resumeBtn').disabled = false;
  if (all.length > DUCK_THRESHOLD) initDuckDB();
  if (!state.pro && all.length > FREE_CAP) setStatus(`Indexed free cap of ${FREE_CAP}. ${all.length - FREE_CAP} more photos available in Pro mode.`);
}

function parseInWorker(files) {
  return new Promise((resolve) => {
    const worker = new Worker('./exif-worker.js');
    const rows = [];
    let done = 0;
    const total = files.length;
    worker.onmessage = (event) => {
      const { item } = event.data;
      if (item) rows.push(item);
      done++;
      updateProgress(done, total);
      if (done % 25 === 0 || done === total) setStatus(`Parsed ${done.toLocaleString()} / ${total.toLocaleString()} photos...`);
      if (done === total) { worker.terminate(); resolve(rows); }
    };
    files.forEach((file, id) => worker.postMessage({ id, file, path: filePath(file) }));
  });
}

function renderAll() {
  const rows = state.rows;
  $('totalPhotos').textContent = rows.length.toLocaleString();
  $('geoPhotos').textContent = rows.filter(r => r.latitude != null && r.longitude != null).length.toLocaleString();
  $('missingDates').textContent = rows.filter(r => !r.date).length.toLocaleString();
  $('totalSize').textContent = formatBytes(sum(rows, r => r.size));
  renderMap(rows);
  renderTimeline(rows);
  renderGear(rows);
  renderHygiene(rows);
  updateProgress(1, 1);
}

function renderMap(rows) {
  markerLayer.clearLayers();
  const points = rows.filter(r => r.latitude != null && r.longitude != null);
  const bounds = [];
  for (const r of points.slice(0, 5000)) {
    const latlng = [r.latitude, r.longitude];
    bounds.push(latlng);
    L.circleMarker(latlng, { radius: 5, weight: 1, fillOpacity: .65 })
      .bindPopup(`<b>${escapeHtml(r.name)}</b><br>${r.date ? new Date(r.date).toLocaleString() : 'No date'}<br>${escapeHtml([r.make,r.model].filter(Boolean).join(' '))}`)
      .addTo(markerLayer);
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [20, 20] });
}

function renderTimeline(rows) {
  const monthCounts = new Map();
  for (const r of rows) if (r.year && r.month) monthCounts.set(`${r.year}-${String(r.month).padStart(2,'0')}`, (monthCounts.get(`${r.year}-${String(r.month).padStart(2,'0')}`) || 0) + 1);
  drawBars($('timelineCanvas'), [...monthCounts.entries()].sort(), 'Photos per month');
  const hours = Array(24).fill(0);
  for (const r of rows) if (r.hour != null) hours[r.hour]++;
  drawHourHeat($('hourCanvas'), hours);
}

function renderGear(rows) {
  const gear = $('gearStats'); gear.innerHTML = '';
  addList(gear, 'Top cameras', top(rows, r => [r.make, r.model].filter(Boolean).join(' ') || 'Unknown').slice(0, 8));
  addList(gear, 'Top lenses', top(rows, r => r.lens || 'Unknown').slice(0, 8));
  addList(gear, 'Top focal lengths', top(rows, r => r.focalLength ? `${Math.round(r.focalLength)}mm` : 'Unknown').slice(0, 8));
  const isoBuckets = bucketNumbers(rows.map(r => r.iso).filter(Boolean), [100,200,400,800,1600,3200,6400,12800]);
  drawBars($('isoCanvas'), isoBuckets.map(([k,v]) => [String(k), v]), 'ISO histogram');
}

function renderHygiene(rows) {
  const el = $('hygieneStats'); el.innerHTML = '';
  const screenshots = rows.filter(r => r.isScreenshot);
  const missingDate = rows.filter(r => !r.date);
  const missingGps = rows.filter(r => r.latitude == null || r.longitude == null);
  const biggest = [...rows].sort((a,b) => b.size - a.size).slice(0, 10);
  addMetric(el, 'Screenshots vs photos', `${screenshots.length.toLocaleString()} screenshots / ${(rows.length - screenshots.length).toLocaleString()} photos`);
  addMetric(el, 'Missing date', missingDate.length.toLocaleString());
  addMetric(el, 'Missing GPS', missingGps.length.toLocaleString());
  addMetric(el, 'Potential reclaim from screenshots', formatBytes(sum(screenshots, r => r.size)));
  addList(el, 'Biggest files', biggest.map(r => [r.name, formatBytes(r.size)]));
}

function addList(parent, title, items) { addMetric(parent, title, ''); for (const [k,v] of items) addMetric(parent, k, v); }
function addMetric(parent, label, value) { const row = document.importNode($('rowTemplate').content, true); row.querySelector('span').textContent = label; row.querySelector('b').textContent = value; parent.appendChild(row); }

function drawEmptyCharts() { drawBars($('timelineCanvas'), [], 'Photos per month'); drawHourHeat($('hourCanvas'), Array(24).fill(0)); drawBars($('isoCanvas'), [], 'ISO histogram'); }
function drawBars(canvas, entries, title) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h); ctx.fillStyle = '#11141a'; ctx.fillRect(0,0,w,h); ctx.fillStyle = '#dce6f0'; ctx.font = '20px system-ui'; ctx.fillText(title, 18, 30);
  if (!entries.length) { ctx.fillStyle = '#7f8996'; ctx.fillText('No data yet', 18, 72); return; }
  const max = Math.max(...entries.map(e => e[1])); const pad = 42; const bw = Math.max(2, (w - pad * 2) / entries.length - 2);
  entries.forEach(([label, value], i) => { const x = pad + i * (bw + 2); const bh = (h - 90) * value / max; ctx.fillStyle = '#9ddcff'; ctx.fillRect(x, h - 38 - bh, bw, bh); if (entries.length < 26 || i % Math.ceil(entries.length/24) === 0) { ctx.save(); ctx.translate(x, h-18); ctx.rotate(-Math.PI/5); ctx.fillStyle = '#aeb7c4'; ctx.font = '11px system-ui'; ctx.fillText(label, 0, 0); ctx.restore(); } });
}
function drawHourHeat(canvas, hours) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height; ctx.clearRect(0,0,w,h); ctx.fillStyle = '#11141a'; ctx.fillRect(0,0,w,h); ctx.fillStyle = '#dce6f0'; ctx.font = '18px system-ui'; ctx.fillText('Photos by hour', 18, 28);
  const max = Math.max(1, ...hours); const cell = (w - 48) / 24;
  hours.forEach((v,i) => { const alpha = .12 + .88 * v / max; ctx.fillStyle = `rgba(157,220,255,${alpha})`; ctx.fillRect(24 + i*cell, 48, cell-3, 48); ctx.fillStyle = '#aeb7c4'; ctx.font = '10px system-ui'; ctx.fillText(String(i), 25+i*cell, 112); });
}

async function initDuckDB() {
  if (state.duckConn) return;
  setStatus('Loading DuckDB-WASM locally...');
  const duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm');
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  state.db = new duckdb.AsyncDuckDB(logger, worker);
  await state.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  state.duckConn = await state.db.connect();
  await reloadDuckTable();
  $('runSqlBtn').disabled = false;
  setStatus('DuckDB ready. Query the local EXIF table.');
}
async function reloadDuckTable() {
  if (!state.db || !state.duckConn) return;
  const rows = state.rows.map(({ id,name,path,type,size,date,year,month,hour,latitude,longitude,make,model,lens,iso,focalLength,isScreenshot,hasExif }) => ({ id,name,path,type,size,date,year,month,hour,latitude,longitude,make,model,lens,iso,focalLength,isScreenshot,hasExif }));
  await state.db.registerFileText('photos.json', JSON.stringify(rows));
  await state.duckConn.query('DROP TABLE IF EXISTS photos');
  await state.duckConn.insertJSONFromPath('photos.json', { name: 'photos' });
}
async function runSql() {
  try { const res = await state.duckConn.query($('sqlBox').value); $('sqlOut').textContent = JSON.stringify(res.toArray().map(r => r.toJSON()), null, 2); }
  catch (err) { $('sqlOut').textContent = err?.message || String(err); }
}

function unlockPro() {
  state.pro = true; $('proState').textContent = 'Local Pro demo'; $('proBanner').style.display = 'none';
  $('semanticBtn').disabled = false; $('dupeBtn').disabled = false; $('burstBtn').disabled = false;
  setStatus('Pro demo unlocked locally. Re-pick the folder to index beyond the free cap.');
}
async function semanticSearch() {
  const q = $('semanticQuery').value.trim(); if (!q) return;
  $('semanticResults').textContent = 'Prototype hook: this loads CLIP locally and compares cached vectors. Embed a small batch first in production.';
  const worker = new Worker('./ml-worker.js', { type: 'module' });
  worker.onmessage = (e) => { if (e.data.type === 'textEmbedding') $('semanticResults').textContent = `Text vector ready: ${e.data.vector.length} dims. Next step: compare against IndexedDB image vectors.`; if (e.data.type === 'error') $('semanticResults').textContent = e.data.error; };
  worker.postMessage({ type: 'embedText', id: crypto.randomUUID(), payload: { text: q } });
}
function findDuplicates() {
  const groups = new Map();
  for (const r of state.rows) groups.set(`${r.size}|${r.width}|${r.height}`, [...(groups.get(`${r.size}|${r.width}|${r.height}`) || []), r]);
  const dupes = [...groups.values()].filter(g => g.length > 1).sort((a,b) => sum(b,r=>r.size)-sum(a,r=>r.size));
  $('dupeOut').textContent = dupes.length ? dupes.slice(0,20).map(g => `${g.length} similar exact-metadata files, ${formatBytes(sum(g.slice(1),r=>r.size))} reclaimable\n${g.map(x=>'  '+x.path).join('\n')}`).join('\n\n') : 'No exact metadata duplicates found. Embedding cosine pass is the Pro production path.';
}
function scoreBursts() {
  const sorted = [...state.rows].filter(r => r.date).sort((a,b) => new Date(a.date)-new Date(b.date));
  const bursts = []; let cur = [];
  for (const r of sorted) { const prev = cur.at(-1); if (!prev || new Date(r.date)-new Date(prev.date) <= 3000) cur.push(r); else { if (cur.length >= 3) bursts.push(cur); cur = [r]; } }
  if (cur.length >= 3) bursts.push(cur);
  $('burstOut').textContent = bursts.length ? bursts.slice(0,10).map(b => `Burst ${b.length} shots: keep candidate ${b[Math.floor(b.length/2)].name}`).join('\n') : 'No bursts detected by timestamp. Production adds Laplacian sharpness + embedding clusters.';
}

async function saveCache(rows) { const db = await openDb(); const tx = db.transaction(STORE, 'readwrite'); await req(tx.objectStore(STORE).put({ id: 'latest', rows, savedAt: Date.now() })); await done(tx); }
async function resumeCached() { const db = await openDb(); const rec = await req(db.transaction(STORE).objectStore(STORE).get('latest')); state.rows = rec?.rows || []; renderAll(); setStatus(`Loaded cached metadata from ${rec ? new Date(rec.savedAt).toLocaleString() : 'cache'}. Re-pick folder for image previews/embeddings.`); }
async function hasCache() { const db = await openDb(); return !!(await req(db.transaction(STORE).objectStore(STORE).get('latest'))); }
async function clearCache() { const db = await openDb(); const tx = db.transaction(STORE, 'readwrite'); await req(tx.objectStore(STORE).clear()); await done(tx); state.rows=[]; renderAll(); $('resumeBtn').disabled=true; setStatus('Local cache cleared.'); }
function openDb() { return req(indexedDB.open(DB_NAME, 1), db => { if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); }); }
function req(r, upgrade) { return new Promise((resolve,reject) => { r.onupgradeneeded = () => upgrade?.(r.result); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function done(tx) { return new Promise((resolve,reject) => { tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); }); }

function isImage(f) { return /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp|avif|tiff?)$/i.test(f.name); }
function filePath(f) { return f.webkitRelativePath || f.name; }
function setStatus(s) { $('status').textContent = s; }
function updateProgress(done,total) { $('progressBar').style.width = `${Math.round(100*done/Math.max(1,total))}%`; }
function sum(arr, fn) { return arr.reduce((a,x)=>a+(Number(fn(x))||0),0); }
function top(rows, fn) { const m = new Map(); for (const r of rows) { const k = fn(r); m.set(k,(m.get(k)||0)+1); } return [...m.entries()].sort((a,b)=>b[1]-a[1]); }
function bucketNumbers(nums, edges) { const out = new Map(edges.map(e=>[`<=${e}`,0]).concat([['>'+edges.at(-1),0]])); for (const n of nums) { const e = edges.find(x => n <= x); const k = e ? `<=${e}` : `>${edges.at(-1)}`; out.set(k,out.get(k)+1); } return [...out.entries()]; }
function formatBytes(bytes) { const units=['B','KB','MB','GB','TB']; let n=bytes,i=0; while(n>=1024&&i<units.length-1){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${units[i]}`; }
function escapeHtml(s) { return String(s||'').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
