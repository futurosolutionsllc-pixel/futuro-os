/* =========================================================================
   FuturoOS Operator — solo owner/operator delivery platform
   Modules: dispatch day-board, route optimization, ETAs, drive mode,
   proof of delivery, customer SMS, GPS tracking, analytics, data/webhooks,
   plus the original Biz pipeline (freight/GovCon).
   All data lives in localStorage; external calls (Nominatim geocoding,
   OSRM routing, SAM.gov) degrade gracefully when offline.
   ========================================================================= */
'use strict';

/* ---------------- helpers ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt$ = n => '$' + (Math.round(n * 100) / 100).toLocaleString();
const pad = n => String(n).padStart(2, '0');
const toISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = d => d.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
const fmtMi = m => (m / 1609.34).toFixed(1) + ' mi';
const uid = () => 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------------- storage ---------------- */
const DEFAULT_SETTINGS = {
  company: 'Futuro Solutions', phone: '', homeAddress: '', homeLat: null, homeLng: null,
  avgSpeed: 28, serviceMin: 5, navApp: 'google',
  tmplWay: "Hi {name}, this is {company}. I'm on my way with your delivery — ETA {eta}.",
  tmplArr: "Hi {name}, this is {company}. I've arrived at {address}.",
  tmplDone: "Hi {name}, your delivery is complete. Thank you for choosing {company}!",
  webhookUrl: '', samKey: ''
};

const S = {
  jobs: JSON.parse(localStorage.getItem('fos.jobs') || '[]'),
  deals: JSON.parse(localStorage.getItem('deals') || '[]'),
  settings: Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('fos.settings') || '{}')),
  date: toISODate(new Date()),
  pos: null,            // {lat,lng,t}
  watchId: null,
  legs: {},             // date -> [seconds per leg] from last optimize (OSRM)
  routeGeom: {},        // date -> [[lat,lng],...] polyline
  editingId: null,
  podJobId: null,
  scanStream: null,
  view: 'today'
};

const saveJobs = () => { localStorage.setItem('fos.jobs', JSON.stringify(S.jobs)); queueCloudSave(); };
const saveDeals = () => { localStorage.setItem('deals', JSON.stringify(S.deals)); queueCloudSave(); };
const saveSettings = () => { localStorage.setItem('fos.settings', JSON.stringify(S.settings)); queueCloudSave(); };

const jobsOn = date => S.jobs.filter(j => j.date === date).sort((a, b) => (a.seq || 0) - (b.seq || 0));
const openJobsOn = date => jobsOn(date).filter(j => j.status !== 'done' && j.status !== 'failed');
const currentStop = () => {
  const open = openJobsOn(S.date);
  return open.find(j => j.status === 'arrived') || open.find(j => j.status === 'enroute') || open[0] || null;
};

/* ---------------- geo: distance, geocoding, routing ---------------- */
const RAD = Math.PI / 180;
function haversine(a, b) { // meters
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}
const ROAD_FACTOR = 1.3; // crow-flies -> road distance estimate
const estDriveSec = (a, b) => haversine(a, b) * ROAD_FACTOR / (S.settings.avgSpeed * 0.44704);

function parseLatLng(q) {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? {lat, lng, label: q.trim()} : null;
}

async function geocode(q) {
  const direct = parseLatLng(q);
  if (direct) return direct;
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q);
  const res = await fetch(url, {headers: {'Accept': 'application/json'}});
  if (!res.ok) throw new Error('geocoder ' + res.status);
  const data = await res.json();
  if (!data.length) throw new Error('not found');
  return {lat: +data[0].lat, lng: +data[0].lon, label: data[0].display_name};
}

async function osrm(path) {
  const res = await fetch('https://router.project-osrm.org' + path);
  if (!res.ok) throw new Error('osrm ' + res.status);
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error('osrm ' + data.code);
  return data;
}
const coordStr = pts => pts.map(p => `${p.lng},${p.lat}`).join(';');

// duration matrix (seconds) between points; OSRM with haversine fallback
async function durationMatrix(pts) {
  try {
    const data = await osrm(`/table/v1/driving/${coordStr(pts)}?annotations=duration`);
    if (data.durations) return {m: data.durations, real: true};
  } catch (e) { /* offline / rate limited — fall through */ }
  const m = pts.map(a => pts.map(b => a === b ? 0 : estDriveSec(a, b)));
  return {m, real: false};
}

async function drivingRoute(pts) {
  const data = await osrm(`/route/v1/driving/${coordStr(pts)}?overview=full&geometries=geojson`);
  const r = data.routes[0];
  return {
    geom: r.geometry.coordinates.map(c => [c[1], c[0]]),
    legs: r.legs.map(l => l.duration),
    meters: r.distance
  };
}

/* ---------------- route optimizer (NN + 2-opt, window-aware) ---------------- */
function routeCost(order, m, jobs, startAt) {
  // travel seconds + heavy penalty per second late past a stop's window end
  let t = startAt, cost = 0, prev = 0; // index 0 = start point in matrix
  for (const oi of order) {
    const leg = m[prev][oi + 1];
    t += leg + S.settings.serviceMin * 60;
    cost += leg;
    const j = jobs[oi];
    if (j.winE) {
      const end = timeOn(S.date, j.winE).getTime() / 1000;
      if (t > end) cost += (t - end) * 4;
    }
    prev = oi + 1;
  }
  return cost;
}

function optimizeOrder(jobs, m, startAt) {
  const n = jobs.length;
  // nearest neighbor seed
  const left = new Set(jobs.map((_, i) => i));
  const order = [];
  let prev = 0;
  while (left.size) {
    let best = null, bestD = Infinity;
    for (const i of left) {
      const d = m[prev][i + 1];
      if (d < bestD) { bestD = d; best = i; }
    }
    order.push(best); left.delete(best); prev = best + 1;
  }
  // 2-opt improvement against window-aware cost
  let improved = true, cost = routeCost(order, m, jobs, startAt);
  let guard = 0;
  while (improved && guard++ < 40) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const cand = order.slice(0, i).concat(order.slice(i, k + 1).reverse(), order.slice(k + 1));
        const c = routeCost(cand, m, jobs, startAt);
        if (c < cost - 1) { order.splice(0, n, ...cand); cost = c; improved = true; }
      }
    }
  }
  return order;
}

function timeOn(dateStr, hhmm) {
  const [h, mn] = hhmm.split(':').map(Number);
  const d = new Date(dateStr + 'T00:00:00');
  d.setHours(h, mn, 0, 0);
  return d;
}

function startPoint() {
  if (S.pos && S.date === toISODate(new Date())) return {lat: S.pos.lat, lng: S.pos.lng};
  if (S.settings.homeLat != null) return {lat: S.settings.homeLat, lng: S.settings.homeLng};
  return null;
}

async function optimizeToday() {
  const open = openJobsOn(S.date).filter(j => j.lat != null);
  const status = $('optimizeStatus');
  if (open.length < 1) { status.textContent = 'Nothing to optimize — add geocoded stops first.'; return; }
  const skipped = openJobsOn(S.date).length - open.length;
  status.textContent = 'Optimizing…';
  const start = startPoint() || {lat: open[0].lat, lng: open[0].lng};
  const pts = [start, ...open.map(j => ({lat: j.lat, lng: j.lng}))];
  const {m, real} = await durationMatrix(pts);
  const startAt = Date.now() / 1000;
  const order = optimizeOrder(open, m, startAt);
  // write seq back: completed stops keep their order first
  const doneSeqs = jobsOn(S.date).filter(j => j.status === 'done' || j.status === 'failed').length;
  order.forEach((oi, idx) => { open[oi].seq = doneSeqs + idx + 1; });
  saveJobs();
  // fetch real geometry + legs for map/ETA (best effort)
  try {
    const ordered = [start, ...order.map(oi => ({lat: open[oi].lat, lng: open[oi].lng}))];
    const route = await drivingRoute(ordered);
    S.routeGeom[S.date] = route.geom;
    S.legs[S.date] = route.legs;
    status.textContent = `Optimized ${open.length} stops · ${fmtMi(route.meters)} · ${real ? 'live road data' : 'estimated'}${skipped ? ` · ${skipped} skipped (no location)` : ''}`;
  } catch (e) {
    S.routeGeom[S.date] = null;
    S.legs[S.date] = null;
    status.textContent = `Optimized ${open.length} stops (estimated distances)${skipped ? ` · ${skipped} skipped (no location)` : ''}`;
  }
  render();
}

/* ---------------- ETA engine ---------------- */
function computeEtas() {
  const open = openJobsOn(S.date);
  const etas = new Map();
  let from = startPoint();
  let t = Date.now();
  // OSRM legs from the last optimize are stop-to-stop; the leg to the FIRST
  // stop is re-estimated live from the current position so ETAs track the truck.
  const legs = S.legs[S.date] && S.legs[S.date].length === open.length ? S.legs[S.date] : null;
  open.forEach((j, i) => {
    if (j.lat == null) return;
    let legSec = 0;
    if (i === 0 || !legs) legSec = from ? estDriveSec(from, j) : (legs ? legs[0] : 0);
    else legSec = legs[i];
    t += legSec * 1000;
    const arrive = new Date(t);
    const late = j.winE ? arrive > timeOn(j.date, j.winE) : false;
    etas.set(j.id, {arrive, late});
    t += S.settings.serviceMin * 60000;
    from = {lat: j.lat, lng: j.lng};
  });
  return etas;
}

/* ---------------- GPS tracking ---------------- */
function startGps() {
  if (S.watchId != null || !navigator.geolocation) return;
  S.watchId = navigator.geolocation.watchPosition(p => {
    const cur = {lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now()};
    S.pos = cur;
    $('gpsDot').classList.remove('off');
    logBreadcrumb(cur);
    if (S.view === 'drive') renderDrive();
    if (S.view === 'map') updateMyMarker();
  }, () => { $('gpsDot').classList.add('off'); }, {enableHighAccuracy: true, maximumAge: 15000});
}
function stopGps() {
  if (S.watchId != null) { navigator.geolocation.clearWatch(S.watchId); S.watchId = null; }
  $('gpsDot').classList.add('off');
}

function trackKey(d) { return 'fos.track.' + d; }
function logBreadcrumb(cur) {
  const key = trackKey(toISODate(new Date()));
  const track = JSON.parse(localStorage.getItem(key) || '[]');
  const last = track[track.length - 1];
  if (!last || haversine(last, cur) > 30) {
    track.push({t: cur.t, lat: +cur.lat.toFixed(5), lng: +cur.lng.toFixed(5)});
    if (track.length > 4000) track.splice(0, track.length - 4000);
    try { localStorage.setItem(key, JSON.stringify(track)); } catch (e) { /* storage full — skip */ }
  }
}
function milesOn(date) {
  const track = JSON.parse(localStorage.getItem(trackKey(date)) || '[]');
  let m = 0;
  for (let i = 1; i < track.length; i++) m += haversine(track[i - 1], track[i]);
  return m;
}

/* ---------------- customer messaging ---------------- */
function fillTemplate(tmpl, job) {
  const eta = computeEtas().get(job.id);
  return tmpl
    .replaceAll('{name}', job.customer || 'there')
    .replaceAll('{company}', S.settings.company)
    .replaceAll('{address}', job.address || '')
    .replaceAll('{eta}', eta ? fmtTime(eta.arrive) : 'soon');
}
function smsLink(job, tmpl) {
  const body = encodeURIComponent(fillTemplate(tmpl, job));
  return `sms:${encodeURIComponent(job.phone || '')}?&body=${body}`;
}
function logEvent(job, type, extra) {
  (job.events = job.events || []).push(Object.assign({type, t: new Date().toISOString()},
    S.pos ? {lat: S.pos.lat, lng: S.pos.lng} : {}, extra || {}));
}
function sendSms(job, tmpl, label) {
  if (!job.phone) { toast('No phone number on this job'); return; }
  logEvent(job, 'sms', {label});
  saveJobs();
  location.href = smsLink(job, tmpl);
}

/* ---------------- webhook + export ---------------- */
function fireWebhook(event, job) {
  const url = S.settings.webhookUrl;
  if (!url) return;
  try {
    fetch(url, {
      method: 'POST', mode: 'no-cors',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({event, at: new Date().toISOString(), job: {
        id: job.id, customer: job.customer, address: job.address, date: job.date,
        status: job.status, type: job.type, rate: job.rate,
        completedAt: job.pod?.t || null, failReason: job.pod?.reason || null
      }})
    }).catch(() => {});
  } catch (e) { /* ignore */ }
}

function download(name, text, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type: mime}));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportJson() {
  const tracks = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('fos.track.')) tracks[k] = JSON.parse(localStorage.getItem(k));
  }
  download('futuroos-backup-' + toISODate(new Date()) + '.json',
    JSON.stringify({jobs: S.jobs, deals: S.deals, settings: S.settings, tracks}, null, 1), 'application/json');
}
function importJson(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.jobs)) throw new Error('bad file');
      S.jobs = d.jobs; saveJobs();
      if (Array.isArray(d.deals)) { S.deals = d.deals; saveDeals(); }
      if (d.settings) { S.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings); saveSettings(); }
      if (d.tracks) for (const k in d.tracks) localStorage.setItem(k, JSON.stringify(d.tracks[k]));
      render(); loadSettingsForm();
      toast('Backup restored');
    } catch (e) { toast('Import failed: ' + e.message); }
  };
  r.readAsText(file);
}
function exportCsv() {
  const cols = ['id', 'date', 'type', 'customer', 'phone', 'address', 'winStart', 'winEnd', 'rate', 'status', 'completedAt', 'failReason', 'notes'];
  const rows = S.jobs.map(j => [j.id, j.date, j.type, j.customer, j.phone, j.address, j.winS, j.winE, j.rate,
    j.status, j.pod?.t || '', j.pod?.reason || '', j.notes]
    .map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','));
  download('futuroos-jobs.csv', cols.join(',') + '\n' + rows.join('\n'), 'text/csv');
}

/* ---------------- view switching ---------------- */
function show(view) {
  S.view = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + view).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  if (view === 'map') initMap();
  if (view === 'drive') startGps();
  render();
}

function render() {
  if (S.view === 'today') renderToday();
  if (S.view === 'drive') renderDrive();
  if (S.view === 'map') renderMap();
  if (S.view === 'jobs') renderJobs();
  if (S.view === 'stats') renderStats();
  if (S.view === 'biz') renderBiz();
}

/* ---------------- TODAY ---------------- */
function statusBadge(j) {
  const names = {pending: 'Pending', enroute: 'En route', arrived: 'Arrived', done: '✓ Done', failed: '✕ Failed'};
  return `<span class="badge status-${j.status}">${names[j.status]}</span>`;
}
function stopCard(j, i, etas) {
  const eta = etas && etas.get(j.id);
  const win = (j.winS || j.winE) ? `${j.winS || '…'}–${j.winE || '…'}` : '';
  const cur = currentStop();
  return `<div class="stop ${j.status === 'done' || j.status === 'failed' ? 'done' : ''}" data-id="${j.id}">
    <div class="stop-seq ${cur && cur.id === j.id ? 'active-stop' : ''}">${i}</div>
    <div class="stop-body">
      <div class="stop-name">${esc(j.customer || 'Unnamed')} ${j.type === 'pickup' ? '<span class="badge type-pickup">Pickup</span>' : ''}</div>
      <div class="stop-addr">${esc(j.address || 'No address')}</div>
      <div class="stop-meta">
        ${statusBadge(j)}
        ${win ? `<span><i class="ti ti-clock"></i> ${win}</span>` : ''}
        ${eta ? `<span class="badge ${eta.late ? 'late' : 'ontime'}">${eta.late ? '▲ Late' : '● On time'} · ETA ${fmtTime(eta.arrive)}</span>` : ''}
        ${j.rate ? `<span>${fmt$(j.rate)}</span>` : ''}
        ${j.lat == null ? '<span class="badge late"><i class="ti ti-alert-triangle"></i> no location</span>' : ''}
      </div>
    </div>
  </div>`;
}
function renderToday() {
  $('dayPick').value = S.date;
  const jobs = jobsOn(S.date);
  const open = jobs.filter(j => j.status !== 'done' && j.status !== 'failed');
  const done = jobs.filter(j => j.status === 'done');
  const rev = jobs.filter(j => j.status === 'done').reduce((s, j) => s + (+j.rate || 0), 0);
  const etas = computeEtas();
  const lateCount = [...etas.values()].filter(e => e.late).length;
  $('todaySummary').innerHTML = `
    <div><div class="sum-num">${open.length}</div><div class="sum-lbl">Open</div></div>
    <div><div class="sum-num">${done.length}</div><div class="sum-lbl">Done</div></div>
    <div><div class="sum-num">${lateCount}</div><div class="sum-lbl">At risk</div></div>
    <div><div class="sum-num">${fmt$(rev)}</div><div class="sum-lbl">Earned</div></div>`;
  $('todayList').innerHTML = jobs.map((j, i) => stopCard(j, i + 1, etas)).join('');
  $('todayEmpty').hidden = jobs.length > 0;
  document.querySelectorAll('#todayList .stop').forEach(el =>
    el.addEventListener('click', () => openDetail(el.dataset.id)));
}

/* ---------------- DRIVE ---------------- */
function navLink(j) {
  const dest = j.lat != null ? `${j.lat},${j.lng}` : encodeURIComponent(j.address || '');
  const app = S.settings.navApp;
  if (app === 'waze') return `https://waze.com/ul?ll=${dest}&navigate=yes`;
  if (app === 'apple') return `maps://?daddr=${dest}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}
function renderDrive() {
  const c = $('driveContent');
  const jobs = jobsOn(S.date);
  const j = currentStop();
  if (!jobs.length) {
    c.innerHTML = `<div class="drive-done"><div class="big-emoji"><i class="ti ti-calendar"></i></div><p>No stops scheduled for ${S.date}.</p>
      <button class="btn primary" onclick="openJobSheet()">+ Add a job</button></div>`;
    return;
  }
  if (!j) {
    const done = jobs.filter(x => x.status === 'done');
    const failed = jobs.filter(x => x.status === 'failed');
    const rev = done.reduce((s, x) => s + (+x.rate || 0), 0);
    c.innerHTML = `<div class="drive-done"><div class="big-emoji"><i class="ti ti-flag-checkered"></i></div>
      <h2>Day complete</h2>
      <p>${done.length} delivered · ${failed.length} failed · ${fmt$(rev)} earned · ${fmtMi(milesOn(S.date))} driven</p>
      <button class="btn" onclick="show('stats')">View stats</button></div>`;
    return;
  }
  const etas = computeEtas();
  const eta = etas.get(j.id);
  const open = openJobsOn(S.date);
  const next = open[open.indexOf(j) + 1];
  const stopNo = jobs.indexOf(j) + 1;
  const win = (j.winS || j.winE) ? ` · window ${j.winS || '…'}–${j.winE || '…'}` : '';
  let action;
  if (j.status === 'pending') action = `<button class="drive-btn primary big" data-act="start"><i class="ti ti-player-play ico"></i>Start stop</button>`;
  else if (j.status === 'enroute') action = `<button class="drive-btn primary big" data-act="arrived"><i class="ti ti-map-pin ico"></i>I've arrived</button>`;
  else action = `<button class="drive-btn success big" data-act="pod"><i class="ti ti-checklist ico"></i>Proof of delivery</button>`;
  c.innerHTML = `<div class="drive-card">
    <div class="drive-kicker">Stop ${stopNo} of ${jobs.length} · ${j.type}${win}</div>
    <div class="drive-name">${esc(j.customer || 'Unnamed')}</div>
    <div class="drive-addr">${esc(j.address || '')}</div>
    <div class="drive-eta">${eta ? `ETA <b>${fmtTime(eta.arrive)}</b> ${eta.late ? '<span class="badge late">▲ Late risk</span>' : '<span class="badge ontime">● On time</span>'}` : ''}
      ${j.notes ? `<br>📝 ${esc(j.notes)}` : ''}</div>
    <div class="drive-grid">
      <button class="drive-btn" data-act="nav"><i class="ti ti-navigation ico"></i>Navigate</button>
      <button class="drive-btn" data-act="call"><i class="ti ti-phone ico"></i>Call</button>
      <button class="drive-btn" data-act="sms-way"><i class="ti ti-message-circle ico"></i>Text ETA</button>
      <button class="drive-btn" data-act="sms-arr"><i class="ti ti-home ico"></i>Text arrived</button>
      ${action}
    </div>
    ${next ? `<div class="drive-next">Next: ${esc(next.customer || '')} — ${esc(next.address || '')}</div>` : '<div class="drive-next">Last stop of the day</div>'}
  </div>`;
  c.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => driveAction(b.dataset.act, j)));
}
function driveAction(act, j) {
  if (act === 'nav') { logEvent(j, 'navigate'); saveJobs(); window.open(navLink(j), '_blank'); }
  if (act === 'call') { if (!j.phone) return toast('No phone on this job'); location.href = 'tel:' + j.phone; }
  if (act === 'sms-way') sendSms(j, S.settings.tmplWay, 'on my way');
  if (act === 'sms-arr') sendSms(j, S.settings.tmplArr, 'arrived');
  if (act === 'start') { j.status = 'enroute'; logEvent(j, 'enroute'); saveJobs(); renderDrive(); }
  if (act === 'arrived') { j.status = 'arrived'; logEvent(j, 'arrived'); saveJobs(); renderDrive(); }
  if (act === 'pod') openPod(j.id);
}

/* ---------------- MAP ---------------- */
let map, mapLayer, myMarker;
function initMap() {
  if (map || typeof L === 'undefined') { if (map) setTimeout(() => map.invalidateSize(), 60); return; }
  map = L.map('map', {zoomControl: true}).setView([39.5, -98.35], 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {maxZoom: 19, attribution: '© OpenStreetMap'}).addTo(map);
  mapLayer = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 60);
}
function updateMyMarker() {
  if (!map || !S.pos) return;
  if (!myMarker) {
    myMarker = L.circleMarker([S.pos.lat, S.pos.lng], {radius: 8, color: '#86a6ff', fillColor: '#3b72ff', fillOpacity: .9}).addTo(map);
  } else myMarker.setLatLng([S.pos.lat, S.pos.lng]);
}
function renderMap() {
  if (!map) { $('mapLegend').textContent = typeof L === 'undefined' ? 'Map library unavailable offline.' : ''; return; }
  mapLayer.clearLayers();
  const jobs = jobsOn(S.date).filter(j => j.lat != null);
  const pts = [];
  jobs.forEach((j, i) => {
    const done = j.status === 'done' || j.status === 'failed';
    const ico = L.divIcon({className: '', html:
      `<div style="width:26px;height:26px;border-radius:50%;background:${done ? '#46546b' : 'linear-gradient(135deg,#2ee6a4,#0da173)'};color:${done ? '#eaf0fb' : '#032a1d'};display:grid;place-items:center;font:700 12px 'Syne',sans-serif;border:2px solid #06080f;box-shadow:0 0 10px rgba(34,211,155,.4)">${i + 1}</div>`});
    L.marker([j.lat, j.lng], {icon: ico}).addTo(mapLayer)
      .bindPopup(`<b>${esc(j.customer || '')}</b><br>${esc(j.address || '')}<br>${j.status}`);
    pts.push([j.lat, j.lng]);
  });
  const geom = S.routeGeom[S.date];
  const openPts = openJobsOn(S.date).filter(j => j.lat != null).map(j => [j.lat, j.lng]);
  if (geom) L.polyline(geom, {color: '#22d39b', weight: 3, opacity: .8}).addTo(mapLayer);
  else if (openPts.length > 1) L.polyline(openPts, {color: '#22d39b', weight: 2, dashArray: '6 6', opacity: .6}).addTo(mapLayer);
  updateMyMarker();
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2));
  $('mapLegend').innerHTML = jobs.length
    ? `${jobs.length} stops on ${S.date}${geom ? ' · optimized road route' : ' · straight-line preview (run Optimize for road route)'}`
    : 'No geocoded stops for this day.';
}

/* ---------------- JOBS list + editor ---------------- */
function renderJobs() {
  const f = $('jobsFilter').value;
  let list = [...S.jobs].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.seq || 0) - (b.seq || 0));
  if (f === 'open') list = list.filter(j => j.status !== 'done' && j.status !== 'failed');
  if (f === 'done') list = list.filter(j => j.status === 'done');
  if (f === 'failed') list = list.filter(j => j.status === 'failed');
  $('jobsList').innerHTML = list.length ? list.map(j => `
    <div class="stop" data-id="${j.id}">
      <div class="stop-body">
        <div class="stop-name">${esc(j.customer || 'Unnamed')} <span class="hint">${j.date}</span></div>
        <div class="stop-addr">${esc(j.address || '')}</div>
        <div class="stop-meta">${statusBadge(j)}${j.rate ? `<span>${fmt$(j.rate)}</span>` : ''}</div>
      </div>
    </div>`).join('') : '<div class="empty"><p>No jobs yet.</p></div>';
  document.querySelectorAll('#jobsList .stop').forEach(el =>
    el.addEventListener('click', () => openDetail(el.dataset.id)));
}

function openJobSheet(id, prefill) {
  S.editingId = id || null;
  const j = id ? S.jobs.find(x => x.id === id) : null;
  $('jobSheetTitle').textContent = id ? 'Edit job' : 'New job';
  $('jType').value = j?.type || 'delivery';
  $('jName').value = j?.customer || prefill?.customer || '';
  $('jPhone').value = j?.phone || '';
  $('jAddress').value = j?.address || '';
  $('jDate').value = j?.date || S.date;
  $('jWinS').value = j?.winS || '';
  $('jWinE').value = j?.winE || '';
  $('jRate').value = j?.rate ?? (prefill?.rate ?? '');
  $('jBarcode').value = j?.barcodeRequired || '';
  $('jNotes').value = j?.notes || '';
  $('geoStatus').textContent = j?.lat != null ? `📍 ${j.lat.toFixed(5)}, ${j.lng.toFixed(5)}` : '';
  $('btnDeleteJob').hidden = !id;
  $('jobSheet').hidden = false;
  window._pendingGeo = j ? {lat: j.lat, lng: j.lng} : null;
  window._pendingDeal = prefill?.dealId || null;
}
async function geocodeJobField() {
  const q = $('jAddress').value.trim();
  if (!q) return;
  $('geoStatus').textContent = 'Looking up…';
  try {
    const g = await geocode(q);
    window._pendingGeo = {lat: g.lat, lng: g.lng};
    $('geoStatus').textContent = `📍 ${g.label}`;
  } catch (e) {
    window._pendingGeo = null;
    $('geoStatus').textContent = '⚠ Not found — you can still save and use "lat,lng" later.';
  }
}
async function saveJob() {
  const isNew = !S.editingId;
  const j = isNew ? {id: uid(), status: 'pending', events: [], pod: null} : S.jobs.find(x => x.id === S.editingId);
  j.type = $('jType').value;
  j.customer = $('jName').value.trim();
  j.phone = $('jPhone').value.trim();
  const addrChanged = j.address !== $('jAddress').value.trim();
  j.address = $('jAddress').value.trim();
  j.date = $('jDate').value || S.date;
  j.winS = $('jWinS').value;
  j.winE = $('jWinE').value;
  j.rate = +$('jRate').value || 0;
  j.barcodeRequired = $('jBarcode').value.trim();
  j.notes = $('jNotes').value.trim();
  if (window._pendingGeo) { j.lat = window._pendingGeo.lat; j.lng = window._pendingGeo.lng; }
  else if (addrChanged && j.address) {
    try { const g = await geocode(j.address); j.lat = g.lat; j.lng = g.lng; }
    catch (e) { j.lat = null; j.lng = null; }
  }
  if (isNew) {
    j.seq = jobsOn(j.date).length + 1;
    logEvent(j, 'created');
    S.jobs.push(j);
    if (window._pendingDeal) j.sourceDealId = window._pendingDeal;
  }
  saveJobs();
  $('jobSheet').hidden = true;
  toast(isNew ? 'Job added' : 'Job saved');
  render();
}

/* ---------------- job detail ---------------- */
function openDetail(id) {
  const j = S.jobs.find(x => x.id === id);
  if (!j) return;
  const rows = [
    ['Status', j.status], ['Type', j.type], ['Date', j.date],
    ['Window', (j.winS || j.winE) ? `${j.winS || '…'}–${j.winE || '…'}` : '—'],
    ['Phone', j.phone || '—'], ['Rate', j.rate ? fmt$(j.rate) : '—'],
    ['Notes', j.notes || '—']
  ];
  const events = (j.events || []).slice(-8).reverse().map(e =>
    `<div class="detail-row"><span>${e.type}${e.label ? ' · ' + esc(e.label) : ''}</span><span>${new Date(e.t).toLocaleString([], {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}</span></div>`).join('');
  const pod = j.pod ? `
    <h3 style="margin-top:14px">Proof of ${j.status === 'failed' ? 'attempt' : 'delivery'}</h3>
    ${j.pod.reason ? `<div class="detail-row"><span>Fail reason</span><span>${esc(j.pod.reason)}</span></div>` : ''}
    ${j.pod.note ? `<div class="detail-row"><span>Note</span><span>${esc(j.pod.note)}</span></div>` : ''}
    ${j.pod.barcodes?.length ? `<div class="detail-row"><span>Barcodes</span><span>${j.pod.barcodes.map(esc).join(', ')}</span></div>` : ''}
    ${j.pod.lat ? `<div class="detail-row"><span>Location</span><span>${j.pod.lat.toFixed(5)}, ${j.pod.lng.toFixed(5)}</span></div>` : ''}
    <div class="detail-photos">${(j.pod.photos || []).map(p => `<img src="${p}" alt="POD photo">`).join('')}</div>
    ${j.pod.signature ? `<img class="detail-sig" src="${j.pod.signature}" alt="Signature">` : ''}` : '';
  $('detailContent').innerHTML = `
    <div class="stop-name" style="font-size:18px">${esc(j.customer || 'Unnamed')}</div>
    <div class="stop-addr" style="white-space:normal">${esc(j.address || '')}</div>
    <div style="margin:10px 0" class="row gap8">
      <button class="btn small" id="dEdit"><i class="ti ti-pencil"></i> Edit</button>
      <button class="btn small" id="dNav"><i class="ti ti-navigation"></i> Navigate</button>
      ${j.status !== 'done' && j.status !== 'failed' ? '<button class="btn small success" id="dPod"><i class="ti ti-checklist"></i> POD</button>' : ''}
      ${j.status === 'done' || j.status === 'failed' ? '<button class="btn small" id="dReopen"><i class="ti ti-arrow-back-up"></i> Reopen</button>' : ''}
    </div>
    ${rows.map(r => `<div class="detail-row"><span>${r[0]}</span><span>${esc(r[1])}</span></div>`).join('')}
    ${pod}
    ${events ? `<h3 style="margin-top:14px">Activity</h3>${events}` : ''}`;
  $('detailSheet').hidden = false;
  $('dEdit').onclick = () => { $('detailSheet').hidden = true; openJobSheet(id); };
  $('dNav').onclick = () => window.open(navLink(j), '_blank');
  const dPod = $('dPod'); if (dPod) dPod.onclick = () => { $('detailSheet').hidden = true; openPod(id); };
  const dRe = $('dReopen'); if (dRe) dRe.onclick = () => { j.status = 'pending'; j.pod = null; saveJobs(); $('detailSheet').hidden = true; render(); };
}

/* ---------------- POD ---------------- */
const pod = {photos: [], signature: null, barcodes: [], drawn: false};
function openPod(id) {
  const j = S.jobs.find(x => x.id === id);
  if (!j) return;
  S.podJobId = id;
  pod.photos = []; pod.signature = null; pod.barcodes = []; pod.drawn = false;
  $('podJobLine').textContent = `${j.customer || ''} — ${j.address || ''}`;
  $('podPhotos').innerHTML = '';
  $('podPhotoCount').textContent = '';
  $('podBarcodes').textContent = '';
  $('podBarcodeIn').value = '';
  $('podNote').value = '';
  $('podStatus').textContent = '';
  $('scanStatus').textContent = ('BarcodeDetector' in window) ? '' : 'Live scan not supported here — type the code.';
  $('podBarcodeReq').textContent = j.barcodeRequired ? `required: ${j.barcodeRequired}` : '';
  $('sigStatus').textContent = '';
  initSigPad();
  $('podSheet').hidden = false;
}
function addPodPhoto(file) {
  if (pod.photos.length >= 3) { toast('Max 3 photos'); return; }
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 900 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    pod.photos.push(cv.toDataURL('image/jpeg', 0.55));
    URL.revokeObjectURL(img.src);
    $('podPhotos').innerHTML = pod.photos.map(p => `<img src="${p}" alt="POD">`).join('');
    $('podPhotoCount').textContent = `(${pod.photos.length}/3)`;
  };
  img.src = URL.createObjectURL(file);
}
let sigCtx, sigInit = false;
function initSigPad() {
  const cv = $('sigPad');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 600;
  cv.width = w * dpr; cv.height = 140 * dpr;
  sigCtx = cv.getContext('2d');
  sigCtx.scale(dpr, dpr);
  sigCtx.fillStyle = '#f8fafc'; sigCtx.fillRect(0, 0, w, 140);
  sigCtx.strokeStyle = '#111827'; sigCtx.lineWidth = 2; sigCtx.lineCap = 'round';
  if (!sigInit) {
    sigInit = true;
    let drawing = false;
    const posOf = e => {
      const r = cv.getBoundingClientRect();
      return {x: e.clientX - r.left, y: e.clientY - r.top};
    };
    cv.addEventListener('pointerdown', e => { drawing = true; pod.drawn = true; const p = posOf(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!drawing) return; const p = posOf(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); });
    cv.addEventListener('pointerup', () => { drawing = false; $('sigStatus').textContent = '✓ captured'; });
  }
}
async function startScan() {
  if (!('BarcodeDetector' in window)) { $('scanStatus').textContent = 'Live scan unsupported — type the code instead.'; return; }
  const video = $('scanVideo');
  try {
    S.scanStream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
    video.srcObject = S.scanStream;
    video.hidden = false;
    await video.play();
    const detector = new BarcodeDetector();
    $('scanStatus').textContent = 'Point camera at barcode…';
    const tick = async () => {
      if (!S.scanStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) { registerBarcode(codes[0].rawValue); stopScan(); return; }
      } catch (e) { /* keep trying */ }
      requestAnimationFrame(tick);
    };
    tick();
  } catch (e) { $('scanStatus').textContent = 'Camera unavailable — type the code instead.'; }
}
function stopScan() {
  if (S.scanStream) { S.scanStream.getTracks().forEach(t => t.stop()); S.scanStream = null; }
  $('scanVideo').hidden = true;
}
function registerBarcode(code) {
  if (!code) return;
  pod.barcodes.push(code);
  $('podBarcodes').textContent = 'Scanned: ' + pod.barcodes.join(', ');
  $('scanStatus').textContent = '✓ ' + code;
  $('podBarcodeIn').value = '';
}
function finishPod(failed) {
  const j = S.jobs.find(x => x.id === S.podJobId);
  if (!j) return;
  const typed = $('podBarcodeIn').value.trim();
  if (typed) registerBarcode(typed);
  if (!failed && j.barcodeRequired && !pod.barcodes.includes(j.barcodeRequired)) {
    if (!confirm(`Required barcode ${j.barcodeRequired} not scanned. Complete anyway?`)) return;
  }
  let reason = '';
  if (failed) {
    reason = prompt('Reason (no answer / refused / wrong address / other):', 'no answer') || 'unspecified';
  }
  const cv = $('sigPad');
  j.pod = {
    photos: pod.photos,
    signature: pod.drawn ? cv.toDataURL('image/jpeg', 0.6) : null,
    barcodes: pod.barcodes,
    note: $('podNote').value.trim(),
    reason,
    t: new Date().toISOString(),
    lat: S.pos?.lat ?? null, lng: S.pos?.lng ?? null
  };
  j.status = failed ? 'failed' : 'done';
  logEvent(j, failed ? 'failed' : 'completed');
  try { saveJobs(); }
  catch (e) { // storage full: drop photos rather than lose the completion
    j.pod.photos = []; saveJobs(); toast('Storage full — photos not saved');
  }
  fireWebhook(failed ? 'job.failed' : 'job.completed', j);
  stopScan();
  $('podSheet').hidden = true;
  toast(failed ? 'Marked failed' : '✓ Delivered');
  if (!failed && j.phone && confirm('Send "delivery complete" text to customer?')) {
    sendSms(j, S.settings.tmplDone, 'completed');
  }
  render();
}

/* ---------------- STATS (analytics) ---------------- */
let statsDays = 7;
function barPath(x, y, w, h, r) { // rounded top corners, square base
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}
function barChart({title, data, color, fmt, id}) {
  // data: [{label, value}] — single series, so no legend (title names it)
  if (!data.some(d => d.value > 0)) return `<div class="chart-card"><div class="chart-title">${title}</div><div class="hint">No data in this range yet.</div></div>`;
  const W = 680, H = 200, padL = 8, padB = 22, padT = 18;
  const max = Math.max(...data.map(d => d.value));
  const iw = (W - padL * 2) / data.length;
  const bw = Math.max(4, Math.min(38, iw - 2)); // ≥2px surface gap between bars
  const maxIdx = data.findIndex(d => d.value === max);
  const bars = data.map((d, i) => {
    const h = max ? (d.value / max) * (H - padB - padT) : 0;
    const x = padL + i * iw + (iw - bw) / 2;
    const y = H - padB - h;
    const labeled = i === maxIdx || i === data.length - 1; // selective direct labels
    return `<path d="${barPath(x, y, bw, Math.max(h, d.value ? 2 : 0), 4)}" fill="${color}"
        data-tip="${esc(d.label)}: ${esc(fmt(d.value))}"></path>
      ${labeled && d.value ? `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" fill="#9fb1cc" font-size="11">${esc(fmt(d.value))}</text>` : ''}`;
  }).join('');
  const ticks = data.map((d, i) => (data.length <= 9 || i % Math.ceil(data.length / 7) === 0)
    ? `<text x="${padL + i * iw + iw / 2}" y="${H - 6}" text-anchor="middle" fill="#6f7f99" font-size="10">${esc(d.label)}</text>` : '').join('');
  const grid = [0.5, 1].map(f =>
    `<line x1="${padL}" x2="${W - padL}" y1="${H - padB - f * (H - padB - padT)}" y2="${H - padB - f * (H - padB - padT)}" stroke="rgba(124,156,214,0.14)" stroke-width="1"/>`).join('');
  return `<div class="chart-card">
    <div class="chart-title">${title}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}" data-chart="${id}">
      ${grid}
      <line x1="${padL}" x2="${W - padL}" y1="${H - padB}" y2="${H - padB}" stroke="rgba(124,156,214,0.3)" stroke-width="1"/>
      ${bars}${ticks}
    </svg>
    <details class="table-view"><summary>View as table</summary>
      <table class="stat-table"><tr><th>Day</th><th>Value</th></tr>
      ${data.map(d => `<tr><td>${esc(d.label)}</td><td>${esc(fmt(d.value))}</td></tr>`).join('')}</table>
    </details>
  </div>`;
}
function renderStats() {
  const since = new Date(); since.setDate(since.getDate() - statsDays + 1); since.setHours(0, 0, 0, 0);
  const finished = S.jobs.filter(j => j.pod?.t && new Date(j.pod.t) >= since);
  const done = finished.filter(j => j.status === 'done');
  const failed = finished.filter(j => j.status === 'failed');
  const rev = done.reduce((s, j) => s + (+j.rate || 0), 0);
  const withWin = done.filter(j => j.winE);
  const onTime = withWin.filter(j => new Date(j.pod.t) <= timeOn(j.date, j.winE));
  const onTimeRate = withWin.length ? Math.round(onTime.length / withWin.length * 100) : null;
  // avg service time: arrived -> completed
  const svc = done.map(j => {
    const arr = (j.events || []).find(e => e.type === 'arrived');
    return arr ? (new Date(j.pod.t) - new Date(arr.t)) / 60000 : null;
  }).filter(v => v != null && v >= 0 && v < 240);
  const avgSvc = svc.length ? (svc.reduce((a, b) => a + b, 0) / svc.length).toFixed(1) : null;
  // miles across range
  let miles = 0;
  for (let i = 0; i < statsDays; i++) {
    const d = new Date(since); d.setDate(d.getDate() + i);
    miles += milesOn(toISODate(d));
  }
  const mi = miles / 1609.34;
  // per-day series
  const days = [];
  for (let i = 0; i < statsDays; i++) {
    const d = new Date(since); d.setDate(d.getDate() + i);
    const key = toISODate(d);
    const dd = done.filter(j => j.pod.t.slice(0, 10) === key);
    days.push({
      label: statsDays > 30 ? `${d.getMonth() + 1}/${d.getDate()}` : d.toLocaleDateString([], {weekday: 'short', day: 'numeric'}).replace(',', ''),
      jobs: dd.length,
      rev: dd.reduce((s, j) => s + (+j.rate || 0), 0)
    });
  }
  // per-customer rollup
  const byCust = {};
  done.forEach(j => {
    const k = j.customer || '—';
    byCust[k] = byCust[k] || {n: 0, rev: 0};
    byCust[k].n++; byCust[k].rev += +j.rate || 0;
  });
  const custRows = Object.entries(byCust).sort((a, b) => b[1].rev - a[1].rev).slice(0, 8);

  $('statsContent').innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="tile-val">${done.length}</div><div class="tile-lbl">Completed</div>
        <div class="tile-sub">${failed.length ? `<span style="color:var(--crit)">✕ ${failed.length} failed</span>` : '<span class="up">✓ no failures</span>'}</div></div>
      <div class="tile"><div class="tile-val">${onTimeRate == null ? '—' : onTimeRate + '%'}</div><div class="tile-lbl">On-time rate</div>
        <div class="tile-sub">${withWin.length ? `${onTime.length}/${withWin.length} windowed stops` : 'no time windows set'}</div></div>
      <div class="tile"><div class="tile-val">${fmt$(rev)}</div><div class="tile-lbl">Revenue</div>
        <div class="tile-sub">${mi > 0.2 ? (rev / mi > 0 ? fmt$(rev / mi) + '/mi' : '') : ''}</div></div>
      <div class="tile"><div class="tile-val">${mi > 0.2 ? mi.toFixed(0) : '—'}</div><div class="tile-lbl">Miles driven</div>
        <div class="tile-sub">${avgSvc ? avgSvc + ' min avg stop' : ''}</div></div>
    </div>
    ${barChart({title: `Deliveries per day (last ${statsDays})`, data: days.map(d => ({label: d.label, value: d.jobs})), color: 'var(--series-1)', fmt: v => String(v), id: 'jobs'})}
    ${barChart({title: `Revenue per day (last ${statsDays})`, data: days.map(d => ({label: d.label, value: d.rev})), color: 'var(--series-2)', fmt: v => fmt$(v), id: 'rev'})}
    ${custRows.length ? `<div class="chart-card"><div class="chart-title">Top customers</div>
      <table class="stat-table"><tr><th>Customer</th><th>Jobs</th><th>Revenue</th></tr>
      ${custRows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.n}</td><td>${fmt$(v.rev)}</td></tr>`).join('')}</table></div>` : ''}`;
  attachTips($('statsContent'));
}
let tipEl;
function attachTips(root) {
  root.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('pointerenter', e => {
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'viz-tip'; document.body.appendChild(tipEl); }
      tipEl.textContent = el.dataset.tip;
      tipEl.style.display = 'block';
      tipEl.style.left = Math.min(e.clientX + 10, innerWidth - 140) + 'px';
      tipEl.style.top = (e.clientY - 34) + 'px';
    });
    el.addEventListener('pointerleave', () => { if (tipEl) tipEl.style.display = 'none'; });
  });
}

/* ---------------- BIZ (pipeline + SAM.gov) ---------------- */
function renderBiz() {
  ['lead', 'active', 'closed'].forEach(st => { $(st).innerHTML = ''; });
  if ($('apiKey').value === '' && S.settings.samKey) $('apiKey').value = S.settings.samKey;
  S.deals.forEach(d => {
    const el = document.createElement('div');
    el.className = 'deal';
    el.innerHTML = `<div>${esc(d.title)}</div><div class="deal-val">${fmt$(+d.value || 0)} <span class="badge">${esc(d.type || 'deal')}</span></div>
      <div class="row">
        ${d.stage !== 'closed' ? '<button class="btn" data-a="next">Next ›</button>' : '<button class="btn" data-a="job">→ Job</button>'}
        <button class="btn" data-a="del">✕</button>
      </div>`;
    el.querySelector('[data-a="next"]')?.addEventListener('click', () => {
      d.stage = d.stage === 'lead' ? 'active' : 'closed'; saveDeals(); renderBiz();
    });
    el.querySelector('[data-a="job"]')?.addEventListener('click', () => {
      openJobSheet(null, {customer: d.title, rate: +d.value || 0, dealId: d.id});
    });
    el.querySelector('[data-a="del"]').addEventListener('click', () => {
      S.deals = S.deals.filter(x => x.id !== d.id); saveDeals(); renderBiz();
    });
    const col = $(d.stage);
    if (col) col.appendChild(el);
  });
}
async function loadGov() {
  const key = $('apiKey').value.trim();
  const st = $('bizStatus');
  if (!key) { st.textContent = 'Missing API key'; return; }
  S.settings.samKey = key; saveSettings();
  st.textContent = 'Fetching SAM.gov…';
  try {
    const res = await fetch(`https://api.sam.gov/opportunities/v2/search?api_key=${encodeURIComponent(key)}&limit=5`);
    const data = await res.json();
    if (!data.opportunitiesData) { st.textContent = 'No data returned'; return; }
    data.opportunitiesData.forEach(op => S.deals.push({
      id: Date.now() + Math.random(), type: 'govcon',
      title: op.title || 'Untitled', value: op.award?.amount || 0, stage: 'lead'
    }));
    saveDeals(); renderBiz();
    st.textContent = `Loaded ${data.opportunitiesData.length} opportunities`;
  } catch (e) { st.textContent = 'API error (check key)'; }
}

/* ---------------- settings ---------------- */
function loadSettingsForm() {
  const s = S.settings;
  $('sCompany').value = s.company; $('sPhone').value = s.phone;
  $('sHome').value = s.homeAddress;
  $('homeGeoStatus').textContent = s.homeLat != null ? `📍 ${s.homeLat.toFixed(4)}, ${s.homeLng.toFixed(4)}` : '';
  $('sSpeed').value = s.avgSpeed; $('sService').value = s.serviceMin;
  $('sNav').value = s.navApp;
  $('sTmplWay').value = s.tmplWay; $('sTmplArr').value = s.tmplArr; $('sTmplDone').value = s.tmplDone;
  $('sWebhook').value = s.webhookUrl; $('sSamKey').value = s.samKey;
}
async function saveSettingsForm() {
  const s = S.settings;
  s.company = $('sCompany').value.trim() || 'FuturoOS';
  s.phone = $('sPhone').value.trim();
  const homeChanged = s.homeAddress !== $('sHome').value.trim();
  s.homeAddress = $('sHome').value.trim();
  s.avgSpeed = Math.max(5, +$('sSpeed').value || 28);
  s.serviceMin = Math.max(0, +$('sService').value || 5);
  s.navApp = $('sNav').value;
  s.tmplWay = $('sTmplWay').value; s.tmplArr = $('sTmplArr').value; s.tmplDone = $('sTmplDone').value;
  s.webhookUrl = $('sWebhook').value.trim(); s.samKey = $('sSamKey').value.trim();
  if (homeChanged && s.homeAddress) {
    try { const g = await geocode(s.homeAddress); s.homeLat = g.lat; s.homeLng = g.lng;
      $('homeGeoStatus').textContent = `📍 ${g.label}`; }
    catch (e) { s.homeLat = null; s.homeLng = null; $('homeGeoStatus').textContent = '⚠ address not found'; }
  }
  saveSettings();
  $('brandSub').textContent = s.company;
  $('settingsStatus').textContent = '✓ Saved';
  toast('Settings saved');
}
async function geocodeHome() {
  const q = $('sHome').value.trim();
  if (!q) return;
  $('homeGeoStatus').textContent = 'Looking up…';
  try {
    const g = await geocode(q);
    S.settings.homeAddress = q; S.settings.homeLat = g.lat; S.settings.homeLng = g.lng;
    saveSettings();
    $('homeGeoStatus').textContent = `📍 ${g.label}`;
  } catch (e) { $('homeGeoStatus').textContent = '⚠ not found'; }
}

/* ---------------- cloud sync (same Supabase project + account as Futuro OS desktop)
   Desktop saves its CRM state to the `snapshot` table (one row per user).
   Mobile uses its own `mobile_snapshot` table with the same owner/RLS shape,
   so the two apps share a login but can never overwrite each other.
   localStorage stays the source of truth offline; cloud is the backup/carry. */
const FF_SUPABASE_URL = 'https://plsimvwufpqquuipkysi.supabase.co';
const FF_SUPABASE_KEY = 'sb_publishable_nXrPTG_v935fahzd7q_ZWQ_0A7t8s3J';
let supa = null, cloudUser = null, _cloudTimer = null, _cloudApplying = false;

function initCloud() {
  if (!window.supabase) { updateCloudUi(); return; } // CDN unreachable → local-only mode
  supa = window.supabase.createClient(FF_SUPABASE_URL, FF_SUPABASE_KEY);
  supa.auth.getSession().then(({data}) => {
    if (data && data.session) { cloudUser = data.session.user; updateCloudUi(); pullCloud(); }
    else updateCloudUi();
  }).catch(() => updateCloudUi());
}
const cloudState = () => ({schema: 1, jobs: S.jobs, deals: S.deals, settings: S.settings, savedAt: Date.now()});
function applyCloudState(d) {
  if (!d || !Array.isArray(d.jobs)) return false;
  _cloudApplying = true;
  try {
    S.jobs = d.jobs; saveJobs();
    if (Array.isArray(d.deals)) { S.deals = d.deals; saveDeals(); }
    if (d.settings) { S.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings); saveSettings(); }
    if (d.savedAt) localStorage.setItem('fos.savedAt', String(d.savedAt));
  } finally { _cloudApplying = false; }
  return true;
}
async function pullCloud() {
  if (!supa || !cloudUser) return;
  try {
    const {data: row, error} = await supa.from('mobile_snapshot')
      .select('data').eq('owner', cloudUser.id).maybeSingle();
    if (error) { updateCloudUi('cloud error: ' + error.message); return; }
    const localAt = +(localStorage.getItem('fos.savedAt') || 0);
    if (row && row.data && (row.data.savedAt || 0) > localAt) {
      applyCloudState(row.data);
      render(); loadSettingsForm();
      toast('Cloud data loaded');
      updateCloudUi();
    } else {
      pushCloud(); // no cloud row yet, or this phone is newer
    }
  } catch (e) { updateCloudUi('offline — local only'); }
}
async function pushCloud() {
  if (!supa || !cloudUser) return;
  const data = cloudState();
  localStorage.setItem('fos.savedAt', String(data.savedAt));
  try {
    const {error} = await supa.from('mobile_snapshot')
      .upsert({owner: cloudUser.id, data, updated_at: new Date().toISOString()}, {onConflict: 'owner'});
    updateCloudUi(error ? 'cloud error: ' + error.message : null);
  } catch (e) { updateCloudUi('offline — will retry on next save'); }
}
function queueCloudSave() {
  if (_cloudApplying) return;
  localStorage.setItem('fos.savedAt', String(Date.now()));
  if (!supa || !cloudUser) return;
  clearTimeout(_cloudTimer);
  _cloudTimer = setTimeout(pushCloud, 800);
}
function updateCloudUi(err) {
  const dot = $('cloudDot'), st = $('cloudStatus'), auth = $('btnCloudAuth'), push = $('btnCloudPush');
  const on = !!(supa && cloudUser);
  dot.className = 'ti cloud-dot ' + (on ? 'ti-cloud-check on' : 'ti-cloud-off');
  dot.title = on ? 'Cloud sync on' : 'Cloud sync off';
  if (err && on) { dot.className = 'ti ti-cloud-exclamation cloud-dot'; }
  if (st) {
    if (!window.supabase) st.textContent = 'Cloud library unavailable (offline?) — data stays on this phone.';
    else if (!on) st.textContent = 'Not signed in — data stays on this phone.';
    else st.textContent = err || `Synced as ${cloudUser.email} — jobs back up automatically.`;
  }
  if (auth) auth.innerHTML = on ? '<i class="ti ti-logout"></i> Sign out' : '<i class="ti ti-cloud"></i> Sign in';
  if (push) push.hidden = !on;
}
async function cloudAuthClick() {
  if (!window.supabase) { toast('Cloud unavailable — check connection'); return; }
  if (cloudUser) {
    await supa.auth.signOut().catch(() => {});
    cloudUser = null;
    updateCloudUi();
    toast('Signed out — data stays on this phone');
    return;
  }
  $('authStatus').textContent = '';
  $('authSheet').hidden = false;
}
async function doAuth(signup) {
  const email = $('authEmail').value.trim(), pass = $('authPass').value;
  const st = $('authStatus');
  if (!email || !pass) { st.textContent = 'Enter email and password.'; return; }
  st.textContent = signup ? 'Creating account…' : 'Signing in…';
  try {
    const {data, error} = signup
      ? await supa.auth.signUp({email, password: pass})
      : await supa.auth.signInWithPassword({email, password: pass});
    if (error) { st.textContent = error.message; return; }
    if (data.session || data.user && !signup) {
      cloudUser = (data.session && data.session.user) || data.user;
      $('authSheet').hidden = true;
      updateCloudUi();
      pullCloud();
      toast('Signed in — cloud sync on');
    } else {
      st.textContent = 'Account created. If email confirmation is on, check your inbox, then Sign in.';
    }
  } catch (e) { st.textContent = 'Network error — try again.'; }
}

/* ---------------- install (Android one-tap prompt / iOS Share instructions) ---------------- */
let deferredInstall = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; updateInstallUi(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; updateInstallUi(); toast('Installed — find Futuro OS on your home screen'); });
function updateInstallUi() {
  const b = $('installBanner');
  if (isStandalone() || localStorage.getItem('fos.installDismissed')) { b.hidden = true; return; }
  if (deferredInstall) {
    $('installText').textContent = 'Install Futuro OS on this phone — full screen, works offline.';
    $('btnInstall').hidden = false;
    b.hidden = false;
  } else if (isIos()) {
    $('installText').innerHTML = 'Install on iPhone: tap <b>Share</b> <i class="ti ti-share-2"></i> then <b>Add to Home Screen</b>.';
    $('btnInstall').hidden = true;
    b.hidden = false;
  } else b.hidden = true;
}
async function doInstall() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  updateInstallUi();
}

/* ---------------- wiring ---------------- */
function wire() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.view)));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
    $(b.dataset.close).hidden = true;
    if (b.dataset.close === 'podSheet') stopScan();
  }));
  // Today
  $('dayPick').addEventListener('change', e => { S.date = e.target.value; render(); });
  $('dayPrev').addEventListener('click', () => shiftDay(-1));
  $('dayNext').addEventListener('click', () => shiftDay(1));
  $('btnOptimize').addEventListener('click', () => optimizeToday().catch(e => { $('optimizeStatus').textContent = 'Optimize failed: ' + e.message; }));
  $('btnStartDay').addEventListener('click', () => { startGps(); show('drive'); });
  $('btnAddFirst').addEventListener('click', () => openJobSheet());
  // Drive
  $('safetyOk').addEventListener('click', () => { $('driveSafety').style.display = 'none'; sessionStorage.setItem('fos.safety', '1'); });
  if (sessionStorage.getItem('fos.safety')) $('driveSafety').style.display = 'none';
  // Jobs
  $('btnNewJob').addEventListener('click', () => openJobSheet());
  $('jobsFilter').addEventListener('change', renderJobs);
  $('btnGeocode').addEventListener('click', geocodeJobField);
  $('btnSaveJob').addEventListener('click', () => saveJob().catch(e => toast('Save failed: ' + e.message)));
  $('btnDeleteJob').addEventListener('click', () => {
    if (!confirm('Delete this job?')) return;
    S.jobs = S.jobs.filter(j => j.id !== S.editingId);
    saveJobs(); $('jobSheet').hidden = true; render();
  });
  // POD
  $('podPhoto').addEventListener('change', e => { if (e.target.files[0]) addPodPhoto(e.target.files[0]); e.target.value = ''; });
  $('sigClear').addEventListener('click', () => { pod.drawn = false; $('sigStatus').textContent = ''; initSigPad(); });
  $('btnScan').addEventListener('click', startScan);
  $('podBarcodeIn').addEventListener('keydown', e => { if (e.key === 'Enter') registerBarcode(e.target.value.trim()); });
  $('btnPodComplete').addEventListener('click', () => finishPod(false));
  $('btnPodFail').addEventListener('click', () => finishPod(true));
  // Stats
  document.querySelectorAll('#statsRange .chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('#statsRange .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    statsDays = +c.dataset.days;
    renderStats();
  }));
  // Biz
  $('btnGov').addEventListener('click', loadGov);
  $('btnAddDeal').addEventListener('click', () => {
    const t = $('dealTitle').value.trim();
    if (!t) return;
    S.deals.push({id: Date.now() + Math.random(), type: 'freight', title: t, value: +$('dealValue').value || 0, stage: 'lead'});
    $('dealTitle').value = ''; $('dealValue').value = '';
    saveDeals(); renderBiz();
  });
  // Install
  $('btnInstall').addEventListener('click', doInstall);
  $('installDismiss').addEventListener('click', () => {
    localStorage.setItem('fos.installDismissed', '1');
    $('installBanner').hidden = true;
  });
  // Cloud
  $('btnCloudAuth').addEventListener('click', cloudAuthClick);
  $('btnCloudPush').addEventListener('click', () => { pushCloud(); toast('Syncing…'); });
  $('btnLogin').addEventListener('click', () => doAuth(false));
  $('btnSignup').addEventListener('click', () => doAuth(true));
  $('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(false); });
  // Settings
  $('btnSettings').addEventListener('click', () => { loadSettingsForm(); $('settingsSheet').hidden = false; });
  $('btnSaveSettings').addEventListener('click', () => saveSettingsForm());
  $('btnGeoHome').addEventListener('click', geocodeHome);
  $('btnExport').addEventListener('click', exportJson);
  $('importFile').addEventListener('change', e => { if (e.target.files[0]) importJson(e.target.files[0]); });
  $('btnCsv').addEventListener('click', exportCsv);
}
function shiftDay(delta) {
  const d = new Date(S.date + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  S.date = toISODate(d);
  render();
}

/* ---------------- init ---------------- */
wire();
$('brandSub').textContent = 'Mobile Ops — ' + S.settings.company;
show('today');
startGps();
initCloud();
updateInstallUi();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// expose a couple of handlers used from generated HTML
window.show = show;
window.openJobSheet = openJobSheet;
