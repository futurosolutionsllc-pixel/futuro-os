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

/* ================= durable persistence (P0-C: mobile offline durability) =========
   The mobile CRM must never silently lose valid offline work, show an empty CRM
   when good local data exists, or upload stale/default state over newer cloud.

   Design (smallest architecture that closes the confirmed failures):
   - Per-account SCOPE. All durable snapshots are keyed by the authenticated
     Supabase uid, or 'local' while signed out, so two accounts on one phone can
     never read or overwrite each other's work (reuses P0-A's uid/epoch model —
     see index.html; this is the same isolation contract, not a second one).
   - Two durability tiers. localStorage is the fast SYNCHRONOUS live store the
     renderer reads; IndexedDB is a second, more eviction-resistant tier that
     keeps a last-known-good (LKG) copy for recovery. localStorage per-key writes
     are atomic (a key is fully replaced or left unchanged — never half-written),
     so 'current' can never expose a partial value; the LKG + IDB tiers exist for
     external corruption, quota eviction (iOS drops PWA localStorage after ~7 idle
     days), and interrupted multi-step writes.
   - Serialized, coalesced writes. IDB writes run on one chain that keeps only the
     newest queued snapshot, so a slow older write can never replace a newer one.
   - Failures surface. A failed durable write returns ok:false; callers warn the
     user and never report "saved".
   See README "Mobile offline durability". */
const Store = (() => {
  const NS = 'fos.acct';                                  // scoped snapshot key prefix
  const LEGACY = { jobs: 'fos.jobs', deals: 'deals', settings: 'fos.settings', savedAt: 'fos.savedAt' };
  const RECOVERY_MAX = 3;                                 // bounded corrupt-payload copies / scope
  const IDB_NAME = 'futuroos-mobile';                     // durability store identity — do not rename
  const IDB_VERSION = 1;
  const IDB_STORE = 'snapshots';
  const SCHEMA = 2;                                       // snapshot schema (matches cloudState schema)

  let scope = 'local';                                    // 'local' (anonymous) or a Supabase uid
  let rev = 0;                                            // monotonic write sequence for current scope
  let curSavedAt = 0;                                     // savedAt of the current scope's snapshot
  let corruptAtBoot = false;
  let lastScopeCorrupt = false;   // active scope loaded from a CORRUPT cache with nothing recovered
  let lastWriteOk = true;
  let db = null, dbReady = null;

  const scopedKey = (sc, name) => NS + '.' + (sc || 'local') + (name ? '.' + name : '');
  const curKey = sc => scopedKey(sc);                     // fos.acct.<scope>
  const lkgKey = sc => scopedKey(sc, 'lkg');              // fos.acct.<scope>.lkg
  const pick = s => ({ jobs: s.jobs, deals: s.deals, settings: s.settings });

  const validSavedAt = n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= Date.now() + 86400000;
  const validSnap = d => !!d && typeof d === 'object' &&
    Array.isArray(d.jobs) && Array.isArray(d.deals) && !!d.settings && typeof d.settings === 'object';

  function readRaw(key) {
    // {state:'OK'|'ABSENT'|'CORRUPT', data?, raw?}. CORRUPT never rewrites/deletes the value.
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { return { state: 'ABSENT' }; }
    if (raw === null) return { state: 'ABSENT' };
    let d = null;
    try { d = JSON.parse(raw); } catch (e) { return { state: 'CORRUPT', raw }; }
    if (!validSnap(d)) return { state: 'CORRUPT', raw };
    return { state: 'OK', data: d };
  }

  // An unreadable snapshot is preserved byte-for-byte under a bounded set of keys,
  // never repaired, never shown, never uploaded. At the cap we stop (never prune).
  function preserveCorrupt(sc, raw) {
    try {
      if (typeof raw !== 'string' || !raw) return;
      const pfx = scopedKey(sc, 'recovery') + '.';
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pfx) === 0) n++; }
      if (n >= RECOVERY_MAX) return;
      const key = pfx + Date.now();
      if (localStorage.getItem(key) !== null) return;      // never overwrite
      localStorage.setItem(key, raw);
    } catch (e) { /* out of quota: abandon preservation rather than destroy data */ }
  }

  // Best available localStorage snapshot for a scope: current if OK, else LKG.
  // A corrupt current is preserved before falling through.
  function readScoped(sc) {
    const cur = readRaw(curKey(sc));
    if (cur.state === 'OK') return { data: cur.data, source: 'current' };
    if (cur.state === 'CORRUPT') preserveCorrupt(sc, cur.raw);
    const lkg = readRaw(lkgKey(sc));
    if (lkg.state === 'OK') return { data: lkg.data, source: 'lkg', recovered: cur.state === 'CORRUPT' };
    return { data: null, source: 'none', recovered: cur.state === 'CORRUPT', absent: cur.state === 'ABSENT' };
  }

  // Promote-on-write: write 'current'; only if that succeeds, copy the PRIOR good
  // current into LKG. Returns false on quota/security failure (caller surfaces it).
  function writeScopedLocal(sc, snap) {
    const prior = readRaw(curKey(sc));
    try { localStorage.setItem(curKey(sc), JSON.stringify(snap)); }
    catch (e) { return false; }
    if (prior.state === 'OK' && validSavedAt(prior.data.savedAt)) {
      try { localStorage.setItem(lkgKey(sc), JSON.stringify(prior.data)); } catch (e) { /* LKG best-effort */ }
    }
    return true;
  }

  function composeFromLegacy() {
    // One-time carry of the pre-P0-C global keys (existing installs) into a snapshot.
    let jobs = [], deals = [], settings = {};
    try { jobs = JSON.parse(localStorage.getItem(LEGACY.jobs) || '[]'); } catch (e) {}
    try { deals = JSON.parse(localStorage.getItem(LEGACY.deals) || '[]'); } catch (e) {}
    try { settings = JSON.parse(localStorage.getItem(LEGACY.settings) || '{}'); } catch (e) {}
    if (!Array.isArray(jobs)) jobs = [];
    if (!Array.isArray(deals)) deals = [];
    if (!settings || typeof settings !== 'object') settings = {};
    const savedAt = +(localStorage.getItem(LEGACY.savedAt) || 0) || Date.now();
    return { schema: SCHEMA, jobs, deals, settings, savedAt, rev: 0 };
  }

  /* ---- IndexedDB durability tier (LKG + recovery; async, serialized) ---- */
  function openDb() {
    if (dbReady) return dbReady;
    dbReady = new Promise(resolve => {
      let req;
      try { req = indexedDB.open(IDB_NAME, IDB_VERSION); }
      catch (e) { resolve(null); return; }                // IDB unavailable (private mode / disabled)
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE, { keyPath: 'scope' });
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbReady;
  }

  let idbChain = Promise.resolve();
  let idbPending = null;                                   // newest queued {scope,snap}
  function idbWrite(sc, snap) {
    idbPending = { scope: sc, snap };                      // coalesce: retain only the newest
    idbChain = idbChain.then(async () => {
      if (!idbPending) return;
      const jobIt = idbPending; idbPending = null;
      const d = await openDb();
      if (!d) return;
      await new Promise(res => {
        let tx;
        try { tx = d.transaction(IDB_STORE, 'readwrite'); } catch (e) { return res(); }
        const st = tx.objectStore(IDB_STORE);
        const getReq = st.get(jobIt.scope);
        getReq.onsuccess = () => {
          const ex = getReq.result;
          // atomic promote: prior valid current -> LKG within this same transaction
          const lkg = (ex && validSnap(ex.current) && validSavedAt(ex.current.savedAt))
            ? ex.current : (ex && ex.lastKnownGood) || null;
          const rec = {
            scope: jobIt.scope, current: jobIt.snap, lastKnownGood: lkg,
            meta: { uid: jobIt.scope === 'local' ? null : jobIt.scope, savedAt: jobIt.snap.savedAt, schema: SCHEMA, rev: jobIt.snap.rev }
          };
          try { st.put(rec); } catch (e) {}
        };
        getReq.onerror = () => {};
        tx.oncomplete = () => res();
        tx.onerror = () => res();
        tx.onabort = () => res();                          // interrupted write: current stays intact
      });
    }).catch(() => {});
    return idbChain;
  }

  function idbRead(sc) {
    return openDb().then(d => {
      if (!d) return null;
      return new Promise(res => {
        let tx;
        try { tx = d.transaction(IDB_STORE, 'readonly'); } catch (e) { return res(null); }
        const req = tx.objectStore(IDB_STORE).get(sc);
        req.onsuccess = () => {
          const rec = req.result;
          if (!rec) return res(null);
          if (validSnap(rec.current)) return res(rec.current);
          if (validSnap(rec.lastKnownGood)) return res(rec.lastKnownGood);   // recover from interrupted/corrupt current
          res(null);
        };
        req.onerror = () => res(null);
      });
    });
  }

  return {
    get scope() { return scope; },
    corruptAtBoot: () => corruptAtBoot,
    scopeCorrupt: () => lastScopeCorrupt,   // active scope had unreadable data we could not recover
    lastWriteOk: () => lastWriteOk,
    savedAt: () => curSavedAt || 0,

    // Synchronous boot: anonymous scope, migrate legacy globals once, hydrate memory.
    bootSnapshot() {
      scope = 'local'; rev = 0; curSavedAt = 0; lastScopeCorrupt = false;
      const cur = readRaw(curKey('local'));
      if (cur.state === 'ABSENT') {
        const hasLegacy = ['jobs', 'deals', 'settings'].some(k => localStorage.getItem(LEGACY[k]) !== null);
        if (hasLegacy) {
          const snap = composeFromLegacy();
          writeScopedLocal('local', snap); idbWrite('local', snap);
          rev = snap.rev; curSavedAt = snap.savedAt;
          return pick(snap);
        }
        return { jobs: [], deals: [], settings: {} };
      }
      if (cur.state === 'OK') { rev = cur.data.rev || 0; curSavedAt = cur.data.savedAt || 0; return pick(cur.data); }
      // CORRUPT: preserve, then fall back to LKG; async IDB recovery runs after boot.
      preserveCorrupt('local', cur.raw);
      const lkg = readRaw(lkgKey('local'));
      if (lkg.state === 'OK') { rev = lkg.data.rev || 0; curSavedAt = lkg.data.savedAt || 0; return pick(lkg.data); }
      corruptAtBoot = true; lastScopeCorrupt = true;
      return { jobs: [], deals: [], settings: {} };
    },

    async init() { await openDb(); },

    // If the active scope has no usable localStorage snapshot but IDB holds a
    // durable one, rehydrate the live store from it. Returns the snapshot or null.
    async recoverFromDurable(sc) {
      if (readRaw(curKey(sc)).state === 'OK') return null;
      const dur = await idbRead(sc);
      if (!dur || !validSnap(dur)) return null;
      curSavedAt = dur.savedAt || curSavedAt; rev = dur.rev || rev;
      writeScopedLocal(sc, dur);
      return pick(dur);
    },

    // Persist the in-memory snapshot for the active scope. Serialized to IDB;
    // localStorage is synchronous. bump:false preserves savedAt (used when we are
    // recording authoritative cloud state, not a fresh local edit).
    persist(mem, opts) {
      const bump = !opts || opts.bump !== false;
      if (bump) { rev++; curSavedAt = Date.now(); }
      if (!curSavedAt) curSavedAt = Date.now();
      const snap = { schema: SCHEMA, jobs: mem.jobs, deals: mem.deals, settings: mem.settings, savedAt: curSavedAt, rev };
      const ok = writeScopedLocal(scope, snap);
      lastWriteOk = ok;
      idbWrite(scope, snap);
      return { ok, savedAt: snap.savedAt };
    },

    // Record state pulled from the cloud, preserving the cloud's savedAt so a
    // later compare sees local == cloud (no upload loop, no stale overwrite).
    applyRemote(mem, savedAt) {
      curSavedAt = validSavedAt(savedAt) ? savedAt : Date.now();
      rev++;
      const snap = { schema: SCHEMA, jobs: mem.jobs, deals: mem.deals, settings: mem.settings, savedAt: curSavedAt, rev };
      lastWriteOk = writeScopedLocal(scope, snap);
      idbWrite(scope, snap);
      return lastWriteOk;
    },

    // Switch scope to a uid (sign-in) or 'local' (sign-out). On first sign-in for
    // an account with no snapshot yet, seed it from the anonymous bucket so local-
    // first work follows the sign-in. Returns the scope's in-memory snapshot.
    setAccount(uid) {
      const target = uid || 'local';
      if (target === scope) return null;
      if (uid && readRaw(curKey(uid)).state === 'ABSENT') {
        const anon = readScoped('local');
        if (anon.data && (anon.data.jobs.length || anon.data.deals.length)) {
          writeScopedLocal(uid, { schema: SCHEMA, jobs: anon.data.jobs, deals: anon.data.deals,
            settings: anon.data.settings, savedAt: anon.data.savedAt || Date.now(), rev: 0 });
        }
      }
      scope = target;
      const r = readScoped(scope);
      if (r.data) { rev = r.data.rev || 0; curSavedAt = r.data.savedAt || 0; lastScopeCorrupt = false; return pick(r.data); }
      // No usable snapshot: distinguish a brand-new/empty scope (trusted) from an
      // unreadable one (untrusted — there WAS data we could not recover).
      lastScopeCorrupt = r.recovered === true;
      rev = 0; curSavedAt = 0;
      return { jobs: [], deals: [], settings: {} };
    },

    // Lifecycle durability: force the latest in-memory state to localStorage
    // synchronously (IDB may not finish before suspension) for the CURRENT scope
    // only. Does not bump savedAt. Kicks the IDB mirror; returns the chain promise.
    flush(mem) {
      if (!curSavedAt) curSavedAt = Date.now();
      const snap = { schema: SCHEMA, jobs: mem.jobs, deals: mem.deals, settings: mem.settings, savedAt: curSavedAt, rev };
      if (!writeScopedLocal(scope, snap)) lastWriteOk = false;
      return idbWrite(scope, snap);
    },

    // Explicit offline-data removal for ONE scope only (active by default):
    // current, LKG, recovery copies, and the IDB record. Never touches other scopes.
    async removeScope(sc) {
      const s = sc || scope;
      const prefix = scopedKey(s, '');
      try {
        const kill = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k === curKey(s) || k.indexOf(prefix + '.') === 0)) kill.push(k);
        }
        kill.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      } catch (e) {}
      const d = await openDb();
      if (d) { try { const tx = d.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).delete(s); } catch (e) {} }
      if (s === scope) { rev = 0; curSavedAt = 0; }
    },

    // Test-only hook: reset in-memory scope/rev state (harness uses this between cases).
    _resetForTest() { scope = 'local'; rev = 0; curSavedAt = 0; corruptAtBoot = false; lastWriteOk = true; db = null; dbReady = null; idbChain = Promise.resolve(); idbPending = null; }
  };
})();

const S = {
  jobs: [], deals: [], settings: Object.assign({}, DEFAULT_SETTINGS),
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
// Hydrate the live store from the durable, account-scoped snapshot (guarded — a
// corrupt cache can no longer throw at module load and blank the whole app).
(() => {
  const boot = Store.bootSnapshot();
  S.jobs = Array.isArray(boot.jobs) ? boot.jobs : [];
  S.deals = Array.isArray(boot.deals) ? boot.deals : [];
  S.settings = Object.assign({}, DEFAULT_SETTINGS, boot.settings || {});
})();

// Centralized save: persist the whole in-memory snapshot durably, surface storage
// failure (never a false "saved"), then queue the relevant cloud sync.
function _persistLocal(queue) {
  const r = Store.persist(S);
  if (r.ok) _localTrusted = true;   // a genuine local write means we hold real data now
  else toast('⚠ Storage full — changes may not be saved. Back up from Settings.');
  if (queue) queue();
  return r;
}
const saveJobs = () => _persistLocal(queueJobSync);
const saveDeals = () => _persistLocal(queueCloudSave);
const saveSettings = () => _persistLocal(queueCloudSave);

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
// Guarded parse: corrupt track data must never throw in a render/GPS path.
function readTrack(key) {
  try { const a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function logBreadcrumb(cur) {
  const key = trackKey(toISODate(new Date()));
  const track = readTrack(key);
  const last = track[track.length - 1];
  if (!last || haversine(last, cur) > 30) {
    track.push({t: cur.t, lat: +cur.lat.toFixed(5), lng: +cur.lng.toFixed(5)});
    if (track.length > 4000) track.splice(0, track.length - 4000);
    try { localStorage.setItem(key, JSON.stringify(track)); } catch (e) { /* storage full — skip */ }
  }
}
function milesOn(date) {
  const track = readTrack(trackKey(date));
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
    if (k && k.startsWith('fos.track.')) tracks[k] = readTrack(k);
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
  if (view === 'biz' && typeof supa !== 'undefined' && supa && cloudUser) fetchInbox();
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
      <div class="stop-name">${esc(j.customer || 'Unnamed')} ${j.type === 'pickup' ? '<span class="badge type-pickup">Pickup</span>' : ''}${j.secured ? '<span class="badge ontime">🛡 Secured</span>' : ''}</div>
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
  map = L.map('map', {zoomControl: true}).setView(S.pos ? [S.pos.lat, S.pos.lng] : [39.5, -98.35], S.pos ? 14 : 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {maxZoom: 19, attribution: '© OpenStreetMap'}).addTo(map);
  mapLayer = L.layerGroup().addTo(map);
  setTimeout(() => map.invalidateSize(), 60);
}
function updateMyMarker() {
  if (!map || !S.pos) return;
  if (!myMarker) {
    myMarker = L.circleMarker([S.pos.lat, S.pos.lng], {radius: 8, color: '#86a6ff', fillColor: '#3b72ff', fillOpacity: .9}).addTo(map);
    // first GPS fix: if still on the country-level default with no stops to
    // frame, bring the map to the driver
    if (map.getZoom() <= 5 && !jobsOn(S.date).some(j => j.lat != null)) {
      map.setView([S.pos.lat, S.pos.lng], 14);
    }
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
  else if (S.pos) map.setView([S.pos.lat, S.pos.lng], Math.max(map.getZoom(), 13));
  $('mapLegend').innerHTML = jobs.length
    ? `${jobs.length} stops on ${S.date}${geom ? ' · optimized road route' : ' · straight-line preview (run Optimize for road route)'}`
    : (S.pos ? 'No stops on this day — showing your position.' : 'No geocoded stops for this day. Waiting for GPS…');
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
  $('jEmail').value = j?.email || '';
  $('jAddress').value = j?.address || '';
  $('jDate').value = j?.date || S.date;
  $('jWinS').value = j?.winS || '';
  $('jWinE').value = j?.winE || '';
  $('jRate').value = j?.rate ?? (prefill?.rate ?? '');
  $('jBarcode').value = j?.barcodeRequired || '';
  $('jNotes').value = j?.notes || '';
  $('jSecured').checked = !!j?.secured;
  $('jMinAge').value = j?.minAge || '';
  $('jMinAgeWrap').hidden = !j?.secured;
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
  j.email = $('jEmail').value.trim();
  const addrChanged = j.address !== $('jAddress').value.trim();
  j.address = $('jAddress').value.trim();
  j.date = $('jDate').value || S.date;
  j.winS = $('jWinS').value;
  j.winE = $('jWinE').value;
  j.rate = +$('jRate').value || 0;
  j.barcodeRequired = $('jBarcode').value.trim();
  j.notes = $('jNotes').value.trim();
  j.secured = $('jSecured').checked;
  j.minAge = +$('jMinAge').value || 0;
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
  syncCalendar(j);
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
    ${j.pod.receivedBy ? `<div class="detail-row"><span>Received by</span><span>${esc(j.pod.receivedBy)}</span></div>` : ''}
    ${j.pod.idVerify ? `<div class="detail-row"><span>ID verified</span><span>${j.pod.idVerify.verified ? '✓' : '⚠'} ${esc(j.pod.idVerify.method || '')}${j.pod.idVerify.age != null ? ' · age ' + j.pod.idVerify.age : ''}</span></div>` : ''}
    ${j.pod.lat ? `<div class="detail-row"><span>Location</span><span>${j.pod.lat.toFixed(5)}, ${j.pod.lng.toFixed(5)}</span></div>` : ''}
    ${j.pod.hash ? `<div class="detail-row"><span>Integrity</span><span style="font-family:var(--mono);font-size:11px">${j.pod.hash.slice(0, 16)}…</span></div>` : ''}
    <div class="detail-photos">${(j.pod.photos || []).map(p => `<img src="${p}" alt="POD photo">`).join('')}</div>
    ${j.pod.signature ? `<img class="detail-sig" src="${j.pod.signature}" alt="Signature">` : ''}` : '';
  const rc = j.pod && j.pod.receipt;
  const chStat = s => s === 'sent' ? '✓ sent' : s === 'not_configured' ? 'needs keys' : s === 'skipped' ? '—' : s ? esc(s) : '—';
  const receiptBlock = (j.status === 'done') ? `
    <h3 style="margin-top:14px">Customer receipt</h3>
    ${rc && rc.conf ? `<div class="detail-row"><span>Confirmation</span><span>${esc(rc.conf)}</span></div>` : ''}
    ${rc && rc.email !== undefined ? `<div class="detail-row"><span>Email</span><span>${chStat(rc.email)}</span></div>` : ''}
    ${rc && rc.sms !== undefined ? `<div class="detail-row"><span>Text</span><span>${chStat(rc.sms)}</span></div>` : ''}
    ${rc && rc.pending ? `<div class="detail-row"><span>Status</span><span>pending — not sent yet</span></div>` : ''}
    <div class="row gap8" style="margin-top:8px">
      <button class="btn small grow" id="dRcptDl"><i class="ti ti-download"></i> Download PDF</button>
      <button class="btn small grow success" id="dRcptSend"><i class="ti ti-send"></i> ${rc && rc.sentAt ? 'Resend' : 'Send'}</button>
    </div>` : '';
  $('detailContent').innerHTML = `
    <div class="stop-name" style="font-size:18px">${esc(j.customer || 'Unnamed')}</div>
    <div class="stop-addr" style="white-space:normal">${esc(j.address || '')}</div>
    <div style="margin:10px 0" class="row gap8">
      <button class="btn small" id="dEdit"><i class="ti ti-pencil"></i> Edit</button>
      <button class="btn small" id="dNav"><i class="ti ti-navigation"></i> Navigate</button>
      ${j.status !== 'done' && j.status !== 'failed' ? '<button class="btn small success" id="dPod"><i class="ti ti-checklist"></i> POD</button>' : ''}
      ${j.pod ? '<button class="btn small" id="dCustody"><i class="ti ti-file-certificate"></i> Custody record</button>' : ''}
      ${j.status === 'done' || j.status === 'failed' ? '<button class="btn small" id="dReopen"><i class="ti ti-arrow-back-up"></i> Reopen</button>' : ''}
    </div>
    ${rows.map(r => `<div class="detail-row"><span>${r[0]}</span><span>${esc(r[1])}</span></div>`).join('')}
    ${pod}
    ${receiptBlock}
    ${events ? `<h3 style="margin-top:14px">Activity</h3>${events}` : ''}`;
  $('detailSheet').hidden = false;
  $('dEdit').onclick = () => { $('detailSheet').hidden = true; openJobSheet(id); };
  $('dNav').onclick = () => window.open(navLink(j), '_blank');
  const dPod = $('dPod'); if (dPod) dPod.onclick = () => { $('detailSheet').hidden = true; openPod(id); };
  const dCu = $('dCustody'); if (dCu) dCu.onclick = () => openCustodyRecord(id);
  const dRe = $('dReopen'); if (dRe) dRe.onclick = () => { j.status = 'pending'; j.pod = null; saveJobs(); $('detailSheet').hidden = true; render(); };
  const dDl = $('dRcptDl'); if (dDl) dDl.onclick = () => downloadReceipt(id);
  const dSend = $('dRcptSend'); if (dSend) dSend.onclick = () => resendReceipt(id);
}

/* ---------------- POD ---------------- */
const pod = {photos: [], signature: null, barcodes: [], drawn: false};
let idv = null, idStream = null;   // ID-verification result + scanner stream (secured deliveries)
function openPod(id) {
  const j = S.jobs.find(x => x.id === id);
  if (!j) return;
  S.podJobId = id;
  pod.photos = []; pod.signature = null; pod.barcodes = []; pod.drawn = false;
  idv = null;
  const secured = !!j.secured;
  $('podIdBlock').hidden = !secured;
  $('idResult').innerHTML = '';
  $('idScanStatus').textContent = '';
  $('idVideo').hidden = true;
  $('podIdReq').textContent = secured ? (j.minAge ? `required · ${j.minAge}+` : 'required') : '';
  $('podJobLine').textContent = `${j.customer || ''} — ${j.address || ''}`;
  $('podPhotos').innerHTML = '';
  $('podPhotoCount').textContent = '';
  $('podBarcodes').textContent = '';
  $('podBarcodeIn').value = '';
  $('podNote').value = '';
  $('podRecvName').value = '';
  $('podStatus').textContent = j.secured ? '🛡 Secured delivery — photo, signature, and recipient name are required to complete.' : '';
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
async function sha256Hex(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; } // non-secure context — hash unavailable
}

async function finishPod(failed) {
  const j = S.jobs.find(x => x.id === S.podJobId);
  if (!j) return;
  const typed = $('podBarcodeIn').value.trim();
  if (typed) registerBarcode(typed);
  const receivedBy = $('podRecvName').value.trim();
  if (!failed && j.secured) {
    // secured deliveries: the custody basics are mandatory, no overrides
    const missing = [];
    if (!pod.photos.length) missing.push('photo');
    if (!pod.drawn) missing.push('signature');
    if (!receivedBy) missing.push('recipient name');
    if (j.barcodeRequired && !pod.barcodes.includes(j.barcodeRequired)) missing.push(`barcode ${j.barcodeRequired}`);
    if (missing.length) {
      $('podStatus').textContent = '🛡 Secured delivery — still needed: ' + missing.join(', ') + '.';
      return;
    }
  } else if (!failed && j.barcodeRequired && !pod.barcodes.includes(j.barcodeRequired)) {
    if (!confirm(`Required barcode ${j.barcodeRequired} not scanned. Complete anyway?`)) return;
  }
  if (!failed && j.secured && (!idv || !idv.verified)) {
    if (!confirm('Recipient ID is not verified. Complete this secured delivery anyway?')) return;
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
    receivedBy,
    note: $('podNote').value.trim(),
    reason,
    idVerify: (!failed && j.secured) ? idv : null,
    t: new Date().toISOString(),
    lat: S.pos?.lat ?? null, lng: S.pos?.lng ?? null
  };
  // tamper-evident integrity fingerprint over the custody facts
  j.pod.hash = await sha256Hex(JSON.stringify({
    job: j.id, customer: j.customer, address: j.address, secured: !!j.secured,
    status: failed ? 'failed' : 'done', completedAt: j.pod.t,
    lat: j.pod.lat, lng: j.pod.lng, receivedBy,
    barcodes: pod.barcodes, note: j.pod.note, reason,
    idVerified: !!(j.pod.idVerify && j.pod.idVerify.verified),
    photoCount: pod.photos.length, signed: !!j.pod.signature
  }));
  j.status = failed ? 'failed' : 'done';
  logEvent(j, failed ? 'failed' : 'completed');
  // Durable-save the completion. On quota failure, drop the heavy photos rather
  // than lose the delivery record itself, then retry — never a false "saved".
  let w = Store.persist(S);
  if (!w.ok) {
    j.pod.photos = []; w = Store.persist(S);
    toast(w.ok ? 'Storage full — photos not saved' : '⚠ Storage full — could not fully save this delivery');
  }
  queueJobSync();
  fireWebhook(failed ? 'job.failed' : 'job.completed', j);
  stopScan(); stopIdScan();
  $('podSheet').hidden = true;
  toast(failed ? 'Marked failed' : '✓ Delivered');
  render();
  // Completed deliveries mint a confirmation number + PDF receipt and email/text
  // the customer (best-effort; degrades gracefully offline or before keys are set).
  if (!failed) issueReceipt(j);
}

/* ---------------- ID verification (secured deliveries) ---------------- */
// Parse the PDF417 barcode on the back of a US/CA driver license (AAMVA).
function parseAAMVA(raw) {
  const get = code => { const m = String(raw).match(new RegExp(code + '([^\\n\\r]*)')); return m ? m[1].trim() : ''; };
  const parseDate = s => {
    s = (s || '').replace(/\D/g, ''); if (s.length !== 8) return null;
    let mo = +s.slice(0, 2), da = +s.slice(2, 4), yr = +s.slice(4, 8);          // MMDDYYYY (US)
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && yr >= 1900 && yr <= 2100) return new Date(yr, mo - 1, da);
    yr = +s.slice(0, 4); mo = +s.slice(4, 6); da = +s.slice(6, 8);              // YYYYMMDD (CA)
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && yr >= 1900 && yr <= 2100) return new Date(yr, mo - 1, da);
    return null;
  };
  const last = get('DCS'), first = get('DAC') || get('DCT');
  return { first, last, name: (first + ' ' + last).trim(),
    dob: parseDate(get('DBB')), expiry: parseDate(get('DBA')), licLast4: (get('DAQ') || '').slice(-4) };
}
// Reduce a parsed ID to a stored-safe verification RESULT — never the raw ID.
function verifyId(p, job) {
  const now = new Date();
  const age = p.dob ? Math.floor((now - p.dob) / (365.25 * 864e5)) : null;
  const minAge = +job.minAge || 0;
  const ageOk = minAge ? (age != null && age >= minAge) : true;
  const notExpired = p.expiry ? p.expiry >= now : null;
  const cust = (job.customer || '').toLowerCase();
  const nameMatch = p.last ? cust.includes(p.last.toLowerCase()) : false;
  const verified = ageOk && notExpired !== false && (nameMatch || !job.customer);
  return { method: 'barcode', verified, nameMatch, age, ageOk, minAge, notExpired,
    licLast4: p.licLast4, name: p.name, ts: new Date().toISOString() };
}
function renderIdResult(v, job) {
  const chip = (ok, txt) => `<span class="badge ${ok === true ? 'ontime' : ok === false ? 'late' : ''}" style="margin:2px 4px 0 0">${ok === true ? '✓' : ok === false ? '✕' : '•'} ${esc(txt)}</span>`;
  const parts = [];
  if (v.method === 'barcode') {
    if (job && job.customer) parts.push(chip(v.nameMatch, v.nameMatch ? 'name match' : 'name mismatch'));
    if (v.minAge) parts.push(chip(v.ageOk, `${v.minAge}+ ${v.age != null ? '(' + v.age + ')' : ''}`));
    else if (v.age != null) parts.push(chip(true, 'age ' + v.age));
    if (v.notExpired != null) parts.push(chip(v.notExpired, v.notExpired ? 'ID valid' : 'ID expired'));
  } else {
    parts.push(chip(true, 'confirmed by courier'));
  }
  $('idResult').innerHTML = `<div class="pod-block" style="margin-top:8px;border:1px solid ${v.verified ? '#2ee6a4' : '#f87171'};border-radius:10px;padding:10px">
    <div class="pod-label" style="color:${v.verified ? '#2ee6a4' : '#f87171'}">${v.verified ? '✓ Identity verified' : '⚠ Verify manually before completing'}</div>
    <div style="margin-top:4px">${parts.join('')}</div></div>`;
  $('idScanStatus').textContent = '';
}
async function startIdScan() {
  const job = S.jobs.find(x => x.id === S.podJobId); if (!job) return;
  if (!('BarcodeDetector' in window)) { $('idScanStatus').textContent = 'Barcode scan not supported here — use Photo ID.'; return; }
  const video = $('idVideo');
  try {
    idStream = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'environment'}});
    video.srcObject = idStream; video.hidden = false; await video.play();
    let formats = ['pdf417'];
    try { const supp = await BarcodeDetector.getSupportedFormats(); if (!supp.includes('pdf417')) formats = supp; } catch (e) {}
    const detector = new BarcodeDetector({formats});
    $('idScanStatus').textContent = 'Point at the barcode on the BACK of the ID…';
    const tick = async () => {
      if (!idStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) { idv = verifyId(parseAAMVA(codes[0].rawValue), job); renderIdResult(idv, job); stopIdScan(); return; }
      } catch (e) { /* keep trying */ }
      requestAnimationFrame(tick);
    };
    tick();
  } catch (e) { $('idScanStatus').textContent = 'Camera unavailable — use Photo ID.'; }
}
function stopIdScan() {
  if (idStream) { idStream.getTracks().forEach(t => t.stop()); idStream = null; }
  const v = $('idVideo'); if (v) v.hidden = true;
}
// iOS / no-BarcodeDetector fallback: courier eyeballs the ID and confirms.
// Privacy: the ID photo is shown transiently and NEVER stored.
function idPhotoFallback(file) {
  const job = S.jobs.find(x => x.id === S.podJobId);
  const url = URL.createObjectURL(file);
  $('idResult').innerHTML = `<div class="pod-block" style="margin-top:8px;border:1px solid var(--b2);border-radius:10px;padding:10px">
    <img src="${url}" alt="ID" style="max-width:100%;max-height:170px;border-radius:8px;display:block">
    <div class="hint" style="margin:6px 0">Check the ID matches the recipient${job && job.minAge ? ` and they are ${job.minAge}+` : ''}. This photo is not saved.</div>
    <button class="btn success grow" id="idPhotoConfirm"><i class="ti ti-check"></i> Identity confirmed</button></div>`;
  $('idPhotoConfirm').onclick = () => {
    URL.revokeObjectURL(url);
    idv = {method: 'photo', verified: true, manual: true, nameMatch: null, age: null, ts: new Date().toISOString()};
    renderIdResult(idv, job);
  };
}

/* ---------------- receipt: confirmation #, PDF, email + SMS ---------------- */
function confirmationNumber() {
  const co = ((S.settings.company || 'FOS').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()) || 'FO';
  const d = new Date(), ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${co}-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
function buildReceiptPdf(job) {
  const {jsPDF} = window.jspdf;
  const doc = new jsPDF({unit: 'pt', format: 'a4'});
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const r = job.pod && job.pod.receipt || {};
  let y = 54;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(20);
  doc.text(S.settings.company || 'Futuro OS', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(90);
  doc.text('Delivery Receipt', M, y + 18); doc.setTextColor(20); y += 48;
  doc.setDrawColor(200); doc.roundedRect(M, y, W - 2 * M, 44, 6, 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
  doc.text('CONFIRMATION NUMBER', M + 12, y + 17);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20);
  doc.text(r.conf || '—', M + 12, y + 34); y += 66;
  const row = (k, v) => { if (!v) return; doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120); doc.text(k, M, y); doc.setTextColor(20); doc.text(String(v), M + 120, y, {maxWidth: W - 2 * M - 120}); y += 20; };
  row('Recipient', job.customer || '—');
  row('Address', job.address || '—');
  row('Type', job.type || 'delivery');
  row('Completed', job.pod && job.pod.t ? new Date(job.pod.t).toLocaleString() : '');
  if (job.pod && job.pod.barcodes && job.pod.barcodes.length) row('Package(s)', job.pod.barcodes.join(', '));
  if (job.pod && job.pod.lat) row('Geo-stamp', `${job.pod.lat.toFixed(5)}, ${job.pod.lng.toFixed(5)}`);
  const v = job.pod && job.pod.idVerify;
  if (v) {
    y += 6; doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20); doc.text('Identity verification', M, y); y += 15;
    const parts = [v.verified ? 'Verified' : 'Not fully verified', v.method === 'barcode' ? 'ID barcode' : 'photo ID'];
    if (v.nameMatch != null) parts.push(v.nameMatch ? 'name match' : 'name mismatch');
    if (v.age != null) parts.push('age ' + v.age);
    if (v.notExpired != null) parts.push(v.notExpired ? 'ID valid' : 'ID expired');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text(parts.join(' · '), M, y); y += 18;
  }
  if (job.pod && job.pod.note) row('Note', job.pod.note);
  if (job.pod && job.pod.signature) {
    y += 6; doc.setFontSize(9); doc.setTextColor(120); doc.text('Signature', M, y); y += 6;
    try { doc.addImage(job.pod.signature, 'JPEG', M, y, 180, 60); } catch (e) {} y += 72;
  }
  const photos = (job.pod && job.pod.photos) || [];
  photos.slice(0, 3).forEach((p, i) => { try { doc.addImage(p, 'JPEG', M + i * 120, y, 110, 82); } catch (e) {} });
  doc.setFontSize(8); doc.setTextColor(150);
  doc.text(`Thank you for choosing ${S.settings.company || 'Futuro OS'}.`, M, H - 30);
  return doc.output('blob');
}
function dataURLtoBlob(dataURL) {
  const [meta, b64] = String(dataURL).split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], {type: mime});
}
// Move base64 POD photos into Storage and keep only URLs on the job, so heavy
// days don't bloat the synced row / localStorage. Best-effort: a failed upload
// keeps that photo inline. Runs after the PDF is built (it needs the base64).
async function offloadPodPhotos(job) {
  if (!(supa && cloudUser)) return;
  const photos = job.pod && job.pod.photos;
  if (!Array.isArray(photos) || !photos.length || !String(photos[0]).startsWith('data:')) return;
  const urls = [];
  for (const p of photos) {
    if (!String(p).startsWith('data:')) { urls.push(p); continue; }
    try {
      const ppath = 'photos/' + (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now() + Math.random().toString(36).slice(2)) + '.jpg';
      const pu = await supa.storage.from('receipts').upload(ppath, dataURLtoBlob(p), {contentType: 'image/jpeg'});
      urls.push(pu.error ? p : supa.storage.from('receipts').getPublicUrl(ppath).data.publicUrl);
    } catch (e) { urls.push(p); }
  }
  job.pod.photos = urls;
  saveJobs();
}
async function issueReceipt(job) {
  job.pod = job.pod || {};
  job.pod.receipt = job.pod.receipt || {};
  if (!job.pod.receipt.conf) job.pod.receipt.conf = confirmationNumber();
  saveJobs();
  let blob;
  try { blob = buildReceiptPdf(job); } catch (e) { toast('Receipt PDF failed'); return; }
  if (!(supa && cloudUser)) { job.pod.receipt.pending = true; saveJobs(); toast('Receipt saved on phone (sign in to email/text it)'); return; }
  try {
    const path = (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now() + Math.random().toString(36).slice(2)) + '.pdf';
    const up = await supa.storage.from('receipts').upload(path, blob, {contentType: 'application/pdf', upsert: false});
    if (up.error) throw up.error;
    const pub = supa.storage.from('receipts').getPublicUrl(path);
    job.pod.receipt.pdfUrl = pub.data.publicUrl; job.pod.receipt.path = path; job.pod.receipt.pending = false;
    const {data: res, error} = await supa.functions.invoke('send-receipt', {body: {
      customerEmail: job.email || '', customerPhone: job.phone || '', customerName: job.customer || '',
      confirmation: job.pod.receipt.conf, pdfUrl: pub.data.publicUrl, company: S.settings.company || 'Futuro OS',
      address: job.address || '', when: job.pod.t ? new Date(job.pod.t).toLocaleString() : ''
    }});
    if (error) throw error;
    job.pod.receipt.email = res && res.email; job.pod.receipt.sms = res && res.sms;
    job.pod.receipt.configured = res && res.configured; job.pod.receipt.sentAt = Date.now();
    saveJobs();
    const bits = []; if (res && res.email === 'sent') bits.push('emailed'); if (res && res.sms === 'sent') bits.push('texted');
    if (bits.length) toast('Receipt ' + bits.join(' + '));
    else if (res && (res.email === 'not_configured' || res.sms === 'not_configured')) toast('Receipt saved · add Resend/Twilio keys to auto-send');
    else toast('Receipt saved');
    offloadPodPhotos(job); // slim the synced row (PDF already embedded the photos)
  } catch (e) {
    job.pod.receipt.pending = true; saveJobs(); toast('Receipt saved · will send when online');
  }
}
function downloadReceipt(id) {
  const j = S.jobs.find(x => x.id === id); if (!j || !j.pod) return;
  // Prefer the hosted PDF — it has the photos embedded even after they've been
  // offloaded to Storage URLs (which a local regenerate can't re-embed).
  if (j.pod.receipt && j.pod.receipt.pdfUrl) { window.open(j.pod.receipt.pdfUrl, '_blank'); return; }
  if (!j.pod.receipt) { j.pod.receipt = {conf: confirmationNumber()}; saveJobs(); }
  try { const blob = buildReceiptPdf(j); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `receipt-${j.pod.receipt.conf}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  catch (e) { toast('PDF failed'); }
}
async function resendReceipt(id) {
  const j = S.jobs.find(x => x.id === id); if (!j) return;
  toast('Sending receipt…'); await issueReceipt(j); if (S.view) openDetail(id);
}

/* ---------------- custody record — printable chain-of-custody document
   (complements the customer receipt PDF: this is the operator/compliance
   artifact with the full event trail, GPS stamps, and integrity hash) ---------------- */
function custodyRecordHtml(j) {
  const s = S.settings;
  const fmtEvt = e => {
    const names = {created: 'Order created', enroute: 'Departed — en route', arrived: 'Arrived on site',
      completed: 'Delivered — custody transferred', failed: 'Delivery attempt failed', navigate: 'Navigation started', sms: 'Customer notified (SMS)'};
    const gps = e.lat != null ? ` @ ${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : '';
    return `<tr><td>${new Date(e.t).toLocaleString()}</td><td>${esc(names[e.type] || e.type)}${e.label ? ' — ' + esc(e.label) : ''}${gps}</td></tr>`;
  };
  const p = j.pod || {};
  const idv2 = p.idVerify;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Custody ${esc(j.id)} — ${esc(s.company)}</title>
<style>
body{font-family:system-ui,sans-serif;color:#111;max-width:700px;margin:24px auto;padding:0 16px;font-size:13px;line-height:1.5}
h1{font-size:17px;margin:0}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #136131;padding-bottom:10px;margin-bottom:14px}
.co{font-size:19px;font-weight:800;color:#136131}
.tag{display:inline-block;background:#136131;color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:99px}
table{width:100%;border-collapse:collapse;margin:8px 0 16px}
td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top;font-size:12.5px}
th{background:#f2f6f3;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#136131}
.sec{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#136131;font-weight:700;margin:16px 0 4px}
img.sig{max-height:90px;border:1px solid #ddd;border-radius:6px;background:#fff}
img.ph{max-width:180px;max-height:180px;border:1px solid #ddd;border-radius:6px;margin:4px 6px 0 0}
.hash{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;word-break:break-all;background:#f2f6f3;padding:8px 10px;border-radius:6px}
.foot{margin-top:18px;font-size:10.5px;color:#666}
@media print{.noprint{display:none}}
</style></head><body>
<div class="head">
  <div><div class="co">${esc(s.company)}</div><h1>Proof of Delivery — Chain of Custody Record</h1></div>
  <div style="text-align:right">${j.secured ? '<span class="tag">SECURED DELIVERY</span><br>' : ''}<span style="font-size:11px;color:#666">Ref ${esc(j.id)}</span></div>
</div>
<table>
  <tr><td style="width:150px"><b>Status</b></td><td>${j.status === 'done' ? 'DELIVERED' : 'ATTEMPT FAILED' + (p.reason ? ' — ' + esc(p.reason) : '')}</td></tr>
  <tr><td><b>Customer</b></td><td>${esc(j.customer || '—')}</td></tr>
  <tr><td><b>Address</b></td><td>${esc(j.address || '—')}</td></tr>
  <tr><td><b>Service date</b></td><td>${esc(j.date)}${(j.winS || j.winE) ? ` (window ${j.winS || '…'}–${j.winE || '…'})` : ''}</td></tr>
  <tr><td><b>Completed</b></td><td>${p.t ? new Date(p.t).toLocaleString() : '—'}${p.lat != null ? ` @ ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : ''}</td></tr>
  <tr><td><b>Received by</b></td><td>${esc(p.receivedBy || '—')}</td></tr>
  ${idv2 ? `<tr><td><b>ID verification</b></td><td>${idv2.verified ? 'VERIFIED' : 'NOT VERIFIED'}${idv2.method ? ' · ' + esc(idv2.method) : ''}${idv2.age != null ? ' · age ' + idv2.age : ''}</td></tr>` : ''}
  ${p.barcodes?.length ? `<tr><td><b>Barcodes verified</b></td><td>${p.barcodes.map(esc).join(', ')}</td></tr>` : ''}
  ${p.receipt?.conf ? `<tr><td><b>Confirmation #</b></td><td>${esc(p.receipt.conf)}</td></tr>` : ''}
  ${p.note ? `<tr><td><b>Note</b></td><td>${esc(p.note)}</td></tr>` : ''}
</table>
<div class="sec">Custody timeline</div>
<table><tr><th style="width:190px">Time</th><th>Event</th></tr>${(j.events || []).map(fmtEvt).join('')}</table>
${p.signature ? `<div class="sec">Recipient signature</div><img class="sig" src="${p.signature}" alt="signature">` : ''}
${p.photos?.length ? `<div class="sec">Photos (${p.photos.length})</div>${p.photos.map(ph => `<img class="ph" src="${ph}">`).join('')}` : ''}
${p.hash ? `<div class="sec">Record integrity (SHA-256)</div><div class="hash">${p.hash}</div>
<div class="foot">This fingerprint was computed from the custody facts above at the moment of completion. Recomputing it over the same facts must produce the same value — any alteration of this record changes the fingerprint.</div>` : ''}
<div class="foot">Generated ${new Date().toLocaleString()} by ${esc(s.company)} · Futuro OS Mobile Ops</div>
<button class="noprint" onclick="print()" style="margin-top:14px;padding:10px 18px;font-size:14px;cursor:pointer">Print / Save as PDF</button>
</body></html>`;
}
function openCustodyRecord(id) {
  const j = S.jobs.find(x => x.id === id);
  if (!j || !j.pod) return;
  const w = window.open('', '_blank');
  if (!w) { toast('Popup blocked — allow popups for this site'); return; }
  w.document.write(custodyRecordHtml(j));
  w.document.close();
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

/* ---------------- website inbox (same inbound_leads funnel the desktop reads) ---------------- */
let inbox = [], inboxLoaded = false;
async function fetchInbox() {
  if (!supa || !cloudUser) { inboxLoaded = false; renderInbox(); return; }
  try {
    const {data, error} = await supa.from('inbound_leads')
      .select('*').eq('status', 'new').order('created_at', {ascending: false});
    if (!error) { inbox = data || []; inboxLoaded = true; }
  } catch (e) { /* offline — keep whatever we had */ }
  renderInbox();
}
function renderInbox() {
  const hint = $('inboxHint'), list = $('bizInbox');
  if (!supa || !cloudUser) {
    hint.textContent = 'Sign in (Settings → Cloud sync) to see inquiries from your websites.';
    list.innerHTML = '';
    return;
  }
  hint.textContent = inboxLoaded
    ? (inbox.length ? `${inbox.length} new ${inbox.length === 1 ? 'inquiry' : 'inquiries'}` : 'No new inquiries — website leads land here.')
    : 'Loading…';
  list.innerHTML = inbox.map(l => `
    <div class="stop" data-id="${esc(l.id)}" style="cursor:default">
      <div class="stop-body">
        <div class="stop-name">${esc(l.company || l.name || '(no company)')}</div>
        <div class="stop-addr">${esc(l.name || '')}${l.name && (l.email || l.phone) ? ' · ' : ''}${esc(l.email || '')}${l.email && l.phone ? ' · ' : ''}${esc(l.phone || '')}</div>
        <div class="stop-meta">
          <span class="badge status-enroute">${esc(l.source || 'website')}</span>
          ${l.equipment ? `<span class="badge">${esc(l.equipment)}</span>` : ''}
          ${l.lane ? `<span>${esc(l.lane)}</span>` : ''}
        </div>
        ${l.message ? `<div class="hint" style="margin-top:6px">${esc(l.message)}</div>` : ''}
        <div class="row gap8" style="margin-top:10px">
          <button class="btn small grow" data-inbox="dismiss">Dismiss</button>
          <button class="btn small success grow" data-inbox="accept"><i class="ti ti-plus"></i> Add to pipeline</button>
        </div>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-inbox]').forEach(b => b.addEventListener('click', () =>
    inboxAction(b.closest('.stop').dataset.id, b.dataset.inbox)));
}
async function inboxAction(id, action) {
  const l = inbox.find(x => x.id === id);
  if (!l) return;
  if (action === 'accept') {
    S.deals.push({id: Date.now() + Math.random(), type: 'web',
      title: (l.company || l.name || 'Website lead') + (l.lane ? ' — ' + l.lane : ''), value: 0, stage: 'lead'});
    saveDeals();
  }
  try { await supa.from('inbound_leads').update({status: action === 'accept' ? 'accepted' : 'dismissed'}).eq('id', id); }
  catch (e) { toast('Offline — will remain in inbox'); return; }
  inbox = inbox.filter(x => x.id !== id);
  renderInbox();
  if (action === 'accept') { renderBiz(); toast('Added to pipeline'); }
}

/* ---------------- BIZ (pipeline + SAM.gov) ---------------- */
function renderBiz() {
  renderInbox();
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
  // app lock
  $('sLockMins').value = localStorage.getItem('fos.lockMins') || '0';
  $('lockStatus').textContent = hasPin() ? 'PIN is set — the app locks when idle.' : 'No PIN set — anyone with this phone can open the app.';
  $('btnRemovePin').hidden = !hasPin();
  $('btnLockNow').hidden = !hasPin();
  $('btnSetPin').innerHTML = hasPin() ? '<i class="ti ti-lock-cog"></i> Change PIN' : '<i class="ti ti-lock-cog"></i> Set PIN';
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
  localStorage.setItem('fos.lockMins', $('sLockMins').value);
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

// --- account isolation + cloud-write gating (reuses the P0-A desktop model) ---
let _authEpoch = 0;          // bumped on sign-out/switch; invalidates in-flight async work
let _cloudWritable = false;  // no cloud write until a definitive load outcome authorizes it
let _cloudInFlight = false, _cloudPending = false;
// False when boot could not read a valid local snapshot AND recovery failed: an
// empty/default state we cannot trust must never be uploaded over the cloud.
let _localTrusted = true;
// Capture identity + epoch before an await; re-check with _authOk before acting on
// the result, so a write from a previous auth session can never land on a new one.
function _authCap() { return { uid: (cloudUser && cloudUser.id) || null, epoch: _authEpoch }; }
function _authOk(cap) { const uid = cloudUser && cloudUser.id; return !!(cap && cap.uid && uid && cap.epoch === _authEpoch && cap.uid === uid); }

// Load the active account's durable snapshot into memory and switch scope. Used on
// sign-in (uid) and sign-out (null). Renders whatever local data exists immediately
// so an offline start shows the account's real work, not an empty CRM.
function _switchScope(uid) {
  const mem = Store.setAccount(uid || null);
  if (mem) { S.jobs = mem.jobs; S.deals = mem.deals; S.settings = Object.assign({}, DEFAULT_SETTINGS, mem.settings || {}); }
  // If this scope's cache was unreadable and nothing recovered, stay protective so
  // the empty/default state is never uploaded over the account's cloud. Try the
  // IndexedDB durability tier before giving up.
  _localTrusted = !Store.scopeCorrupt();
  if (!_localTrusted) {
    Store.recoverFromDurable(Store.scope).then(rec => {
      if (rec && Store.scope === (uid || 'local')) {
        S.jobs = Array.isArray(rec.jobs) ? rec.jobs : S.jobs;
        S.deals = Array.isArray(rec.deals) ? rec.deals : S.deals;
        S.settings = Object.assign({}, DEFAULT_SETTINGS, rec.settings || {});
        _localTrusted = true; render();
      }
    }).catch(() => {});
  }
  return mem;
}

function initCloud() {
  if (!window.supabase) { updateCloudUi(); return; } // CDN unreachable → local-only mode
  supa = window.supabase.createClient(FF_SUPABASE_URL, FF_SUPABASE_KEY);
  supa.auth.getSession().then(async ({data}) => {
    if (data && data.session) {
      cloudUser = data.session.user;
      _switchScope(cloudUser.id);   // load this account's scoped snapshot before any cloud read
      updateCloudUi(); render(); loadSettingsForm();
      await pullCloud();     // deals/settings (+ one-time carry-over of old inline jobs)
      await pullJobs();      // authoritative jobs from the shared table
      subscribeJobs();       // live updates from the desktop Deliveries page
      fetchInbox();
    } else updateCloudUi();
  }).catch(() => updateCloudUi());
}
// mobile_snapshot carries only deals + settings; JOBS live in the shared `jobs`
// table (below) so the desktop Deliveries surface and the phone read/write one list.
// savedAt comes from the durable snapshot so cloud and local carry the SAME stamp
// (a later compare then sees a tie, not a phantom "local is newer" → no upload loop).
const cloudState = () => ({schema: 2, deals: S.deals, settings: S.settings, savedAt: Store.savedAt() || Date.now()});
function applyCloudState(d) {
  if (!d) return false;
  _cloudApplying = true;
  try {
    // one-time migration: old snapshots stored jobs inline — carry them over once
    // so pullJobs() can push them into the shared jobs table.
    if (Array.isArray(d.jobs) && d.jobs.length && !S.jobs.length) S.jobs = d.jobs;
    if (Array.isArray(d.deals)) S.deals = d.deals;
    if (d.settings) S.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings);
    // Persist with the cloud's savedAt preserved (not a fresh local stamp).
    Store.applyRemote(S, d.savedAt);
    _localTrusted = true;             // we now hold verified state from the cloud
  } finally { _cloudApplying = false; }
  return true;
}
// Three distinct outcomes, never conflated: a failed cloud READ (ERROR) must not be
// treated as an absent row (which would authorize uploading local over the cloud).
async function pullCloud() {
  const cap = _authCap();
  if (!_authOk(cap) || !supa) return;
  let row = null, err = null;
  try {
    const res = await supa.from('mobile_snapshot').select('data').eq('owner', cap.uid).maybeSingle();
    row = res.data; err = res.error;
  } catch (e) { err = e; }
  if (!_authOk(cap)) return;                                   // switched accounts mid-flight
  if (err) { updateCloudUi('cloud error — using local data'); return; }  // CLOUD_LOAD_ERROR: do NOT authorize writes
  _cloudWritable = true;                                        // CLOUD_ROW_LOADED or CLOUD_ROW_ABSENT: definitive
  const localAt = Store.savedAt();
  if (row && row.data && (row.data.savedAt || 0) > localAt) {   // cloud strictly newer → cloud wins
    applyCloudState(row.data); loadSettingsForm(); updateCloudUi();
  } else {
    // Row absent, local newer, or exact savedAt tie → this device wins (deterministic
    // tie-break: local wins; it re-uploads the same stamp once, so no loop).
    pushCloud();
  }
}
async function pushCloud() {
  const cap = _authCap();
  if (!_authOk(cap) || !supa) return;
  if (!_cloudWritable) { updateCloudUi('local only — sync not yet authorized'); return; }  // never upload before a load outcome
  if (!_localTrusted) { updateCloudUi('local data unverified — not syncing'); return; }     // never upload corrupt/default state
  if (_cloudInFlight) { _cloudPending = true; return; }         // serialize: no overlapping upserts
  _cloudInFlight = true;
  const data = cloudState();
  try {
    const {error} = await supa.from('mobile_snapshot')
      .upsert({owner: cap.uid, data, updated_at: new Date().toISOString()}, {onConflict: 'owner'});
    if (!_authOk(cap)) return;                                  // signed out while the write was in flight
    updateCloudUi(error ? 'cloud error: ' + error.message : null);
  } catch (e) { updateCloudUi('offline — will retry on next save'); }
  finally {
    _cloudInFlight = false;
    if (_cloudPending) { _cloudPending = false; if (_authOk(cap) && _cloudWritable) pushCloud(); }
  }
}
function queueCloudSave() {
  if (_cloudApplying) return;                                   // savedAt already set by Store.persist
  if (!supa || !cloudUser) return;
  clearTimeout(_cloudTimer);
  _cloudTimer = setTimeout(pushCloud, 800);
}

/* ------- shared jobs table (two-way sync with the desktop Deliveries page) ------- */
let _jobTimer = null, _jobsChannel = null, _rtTimer = null;
function jobToRow(j, uid) {
  return {
    id: j.id, owner: uid || cloudUser.id, type: j.type || 'delivery', customer: j.customer || null,
    phone: j.phone || null, email: j.email || null, address: j.address || null,
    lat: j.lat ?? null, lng: j.lng ?? null, job_date: j.date || null,
    win_s: j.winS || null, win_e: j.winE || null, rate: j.rate ?? null,
    status: j.status || 'pending', notes: j.notes || null, barcode_required: j.barcodeRequired || null,
    secured: !!j.secured, min_age: j.minAge || null, seq: j.seq ?? null,
    events: j.events || [], pod: j.pod || null, source: j.source || 'mobile',
    updated_at: new Date().toISOString()
  };
}
function rowToJob(r) {
  return {
    id: r.id, type: r.type || 'delivery', customer: r.customer || '', phone: r.phone || '',
    email: r.email || '', address: r.address || '', lat: r.lat, lng: r.lng, date: r.job_date || '',
    winS: r.win_s || '', winE: r.win_e || '', rate: +r.rate || 0, status: r.status || 'pending',
    notes: r.notes || '', barcodeRequired: r.barcode_required || '', secured: !!r.secured,
    minAge: r.min_age || 0, seq: r.seq ?? 0, events: r.events || [], pod: r.pod || null,
    source: r.source || 'desktop', _u: r.updated_at
  };
}
async function pullJobs() {
  const cap = _authCap();
  if (!_authOk(cap) || !supa) return;
  let data = null, error = null;
  try { const res = await supa.from('jobs').select('*').eq('owner', cap.uid); data = res.data; error = res.error; }
  catch (e) { return; }                                     // offline — keep local
  if (error) { console.warn('pullJobs:', error.message); return; }  // load error is never row-absence
  if (!_authOk(cap)) return;                                // switched accounts mid-flight
  const rows = data || [];
  if (!rows.length) { if (S.jobs.length) pushAllJobs(); return; } // seed cloud from this phone
  // server rows are authoritative for their id; keep local-only (offline) jobs.
  const seen = new Set();
  const merged = rows.map(r => { seen.add(r.id); return rowToJob(r); });
  const localOnly = S.jobs.filter(j => !seen.has(j.id));
  localOnly.forEach(j => merged.push(j));
  _cloudApplying = true;
  // Persist authoritative jobs without bumping savedAt (this is cloud state, not
  // a fresh local edit that should win the next deals/settings compare).
  try { S.jobs = merged; Store.persist(S, {bump: false}); }
  finally { _cloudApplying = false; }
  if (localOnly.length) localOnly.forEach(pushJob); // push offline-created jobs up
  render();
}
async function pushAllJobs() {
  const cap = _authCap();
  if (!_authOk(cap) || !supa || !S.jobs.length) return;
  try { await supa.from('jobs').upsert(S.jobs.map(j => jobToRow(j, cap.uid)), {onConflict: 'id'}); }
  catch (e) { /* offline — retry on next save */ }
}
async function pushJob(job) {
  const cap = _authCap();
  if (!_authOk(cap) || !supa) return;
  try { await supa.from('jobs').upsert([jobToRow(job, cap.uid)], {onConflict: 'id'}); } catch (e) {}
}
async function deleteJobRow(id) {
  const cap = _authCap();
  if (!_authOk(cap) || !supa) return;
  try { await supa.from('jobs').delete().eq('id', id).eq('owner', cap.uid); } catch (e) {}
}
// Mirror a delivery window to Google Calendar (best-effort; dormant until the
// Google Apps Script bridge + secrets are set — see integrations/google-apps-script).
async function syncCalendar(j, remove) {
  if (!supa || !cloudUser || (!j || (!j.date && !remove))) return;
  try {
    await supa.functions.invoke('sync-calendar', {body: {
      id: j.id, customer: j.customer, address: j.address,
      job_date: j.date, win_s: j.winS, win_e: j.winE, type: j.type, remove: !!remove
    }});
  } catch (e) {}
}
function queueJobSync() {
  if (_cloudApplying) return;
  if (!supa || !cloudUser) return;
  clearTimeout(_jobTimer);
  _jobTimer = setTimeout(pushAllJobs, 800);
}
function subscribeJobs() {
  if (!supa || !cloudUser || _jobsChannel) return;
  try {
    _jobsChannel = supa.channel('jobs-' + cloudUser.id)
      .on('postgres_changes', {event: '*', schema: 'public', table: 'jobs', filter: 'owner=eq.' + cloudUser.id},
        () => { clearTimeout(_rtTimer); _rtTimer = setTimeout(pullJobs, 400); })
      .subscribe();
  } catch (e) {}
}
function unsubscribeJobs() {
  if (_jobsChannel) { try { supa.removeChannel(_jobsChannel); } catch (e) {} _jobsChannel = null; }
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
    unsubscribeJobs();
    _authEpoch++;                    // invalidate any pending/in-flight cloud write first
    _cloudWritable = false;
    clearTimeout(_cloudTimer); clearTimeout(_jobTimer);
    await supa.auth.signOut().catch(() => {});
    cloudUser = null;
    _switchScope(null);              // back to the anonymous scope — no account data left on screen
    updateCloudUi(); render(); loadSettingsForm();
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
      _authEpoch++;                  // fresh session — invalidate any stale in-flight work
      _cloudWritable = false;
      _switchScope(cloudUser.id);    // load this account's scoped snapshot immediately (offline-safe)
      $('authSheet').hidden = true;
      updateCloudUi(); render(); loadSettingsForm();
      await pullCloud();
      await pullJobs();
      subscribeJobs();
      fetchInbox();
      toast('Signed in — cloud sync on');
    } else {
      st.textContent = 'Account created. If email confirmation is on, check your inbox, then Sign in.';
    }
  } catch (e) { st.textContent = 'Network error — try again.'; }
}

/* ---------------- app lock (4-digit PIN) ---------------- */
const LOCK = {entry: '', mode: 'unlock', firstPin: '', locked: false};
let _bgAt = 0;
async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function pinSalt() {
  let s = localStorage.getItem('fos.pinSalt');
  if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('fos.pinSalt', s); }
  return s;
}
const hasPin = () => !!localStorage.getItem('fos.pinHash');
function buildKeypad() {
  const kp = $('keypad'); if (!kp) return;
  kp.innerHTML = ['1','2','3','4','5','6','7','8','9','','0','⌫']
    .map(k => k === '' ? '<button class="blank"></button>' : `<button data-k="${k}">${k}</button>`).join('');
  kp.querySelectorAll('button[data-k]').forEach(b => b.addEventListener('click', () => lockKey(b.dataset.k)));
}
function renderDots() {
  const n = LOCK.entry.length;
  $('lockDots').innerHTML = Array.from({length: 4}, (_, i) => `<span class="${i < n ? 'on' : ''}"></span>`).join('');
}
async function lockKey(k) {
  $('lockMsg').textContent = '';
  if (k === '⌫') { LOCK.entry = LOCK.entry.slice(0, -1); renderDots(); return; }
  if (LOCK.entry.length >= 4) return;
  LOCK.entry += k; renderDots();
  if (LOCK.entry.length < 4) return;
  if (LOCK.mode === 'unlock') {
    const ok = (await sha(pinSalt() + LOCK.entry)) === localStorage.getItem('fos.pinHash');
    if (ok) { LOCK.entry = ''; hideLock(); }
    else { $('lockMsg').textContent = 'Wrong PIN'; LOCK.entry = ''; renderDots(); if (navigator.vibrate) navigator.vibrate(120); }
  } else if (LOCK.mode === 'set') {
    LOCK.firstPin = LOCK.entry; LOCK.entry = ''; LOCK.mode = 'confirm';
    $('lockTitle').textContent = 'Confirm PIN'; $('lockSub').textContent = 'Re-enter to confirm'; renderDots();
  } else if (LOCK.mode === 'confirm') {
    if (LOCK.entry === LOCK.firstPin) { await savePin(LOCK.firstPin); }
    else { $('lockMsg').textContent = "PINs didn't match"; LOCK.entry = ''; LOCK.firstPin = ''; LOCK.mode = 'set';
      $('lockTitle').textContent = 'Enter new PIN'; renderDots(); }
  }
}
async function savePin(pin) {
  localStorage.setItem('fos.pinHash', await sha(pinSalt() + pin));
  LOCK.entry = ''; LOCK.firstPin = ''; LOCK.mode = 'unlock';
  hideLock(); toast('PIN set — app locks when idle'); loadSettingsForm();
}
function showLock(mode) {
  LOCK.mode = mode || 'unlock'; LOCK.entry = ''; LOCK.firstPin = ''; LOCK.locked = true;
  const setting = LOCK.mode !== 'unlock';
  $('lockTitle').textContent = setting ? 'Enter new PIN' : 'Enter PIN';
  $('lockSub').textContent = setting ? 'Choose a 4-digit PIN' : 'Futuro OS is locked';
  $('lockMsg').textContent = '';
  $('lockCancel').hidden = !setting;
  buildKeypad(); renderDots();
  $('lockScreen').hidden = false;
}
function hideLock() { LOCK.locked = false; $('lockScreen').hidden = true; }
function lockNow() { if (hasPin()) showLock('unlock'); }

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
    if (b.dataset.close === 'podSheet') { stopScan(); stopIdScan(); }
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
    const delId = S.editingId;
    const delJob = S.jobs.find(j => j.id === delId);
    S.jobs = S.jobs.filter(j => j.id !== delId);
    saveJobs(); deleteJobRow(delId); if (delJob) syncCalendar(delJob, true); $('jobSheet').hidden = true; render();
  });
  // POD
  $('podPhoto').addEventListener('change', e => { if (e.target.files[0]) addPodPhoto(e.target.files[0]); e.target.value = ''; });
  $('sigClear').addEventListener('click', () => { pod.drawn = false; $('sigStatus').textContent = ''; initSigPad(); });
  $('btnScan').addEventListener('click', startScan);
  $('podBarcodeIn').addEventListener('keydown', e => { if (e.key === 'Enter') registerBarcode(e.target.value.trim()); });
  // Secured-delivery ID verification
  $('jSecured').addEventListener('change', e => { $('jMinAgeWrap').hidden = !e.target.checked; });
  $('btnIdScan').addEventListener('click', startIdScan);
  $('idPhoto').addEventListener('change', e => { if (e.target.files[0]) idPhotoFallback(e.target.files[0]); e.target.value = ''; });
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
  $('btnInboxRefresh').addEventListener('click', fetchInbox);
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
  // (btnDesktop is a plain <a href="../"> in the app bar — no JS, so it still
  //  works even if this script is served stale from cache.)
  $('btnSettings').addEventListener('click', () => { loadSettingsForm(); $('settingsSheet').hidden = false; });
  $('btnSaveSettings').addEventListener('click', () => saveSettingsForm());
  // App lock
  $('btnSetPin').addEventListener('click', () => { $('settingsSheet').hidden = true; showLock('set'); });
  $('btnRemovePin').addEventListener('click', () => { if (confirm('Remove the PIN lock?')) { localStorage.removeItem('fos.pinHash'); toast('PIN removed'); loadSettingsForm(); } });
  $('btnLockNow').addEventListener('click', () => { $('settingsSheet').hidden = true; lockNow(); });
  $('sLockMins').addEventListener('change', () => localStorage.setItem('fos.lockMins', $('sLockMins').value));
  $('lockCancel').addEventListener('click', () => { if (LOCK.mode !== 'unlock') hideLock(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { _bgAt = Date.now(); }
    else if (hasPin() && !LOCK.locked) {
      const mins = +(localStorage.getItem('fos.lockMins') || '0');
      if (_bgAt && Date.now() - _bgAt >= mins * 60000) showLock('unlock');
    }
  });
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

/* ---------------- lifecycle durability (P0-C) ----------------
   Mobile browsers freeze/kill backgrounded tabs and rarely fire beforeunload.
   On every hide/suspend, force the latest in-memory snapshot to durable local
   storage FIRST (synchronous), then best-effort flush any pending cloud write.
   Idempotent, and Store.flush targets the CURRENT scope only, so nothing is
   written under a signed-out/other account. The SW's controllerchange reload
   also triggers pagehide, so an update mid-edit is flushed here too. */
function _lifecycleFlush() {
  // In protective mode (local unreadable + unrecovered) the in-memory state is an
  // empty placeholder — do NOT let a hide overwrite the durable tiers (localStorage
  // LKG / IndexedDB) with it before async recovery has had a chance to restore data.
  if (_localTrusted) { try { Store.flush(S); } catch (e) { /* durability best-effort — never block hide */ } }
  // Cloud flush only after a definitive load has authorized writes, so a hide that
  // lands before reconciliation can never push stale local over newer cloud state.
  const cap = _authCap();
  if (_authOk(cap) && _cloudWritable) {
    clearTimeout(_cloudTimer); pushCloud();
    clearTimeout(_jobTimer); pushAllJobs();
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) _lifecycleFlush(); });
window.addEventListener('pagehide', _lifecycleFlush);
window.addEventListener('freeze', _lifecycleFlush);   // Page Lifecycle API (Chromium)

/* Durability internals exposed for the external P0-C regression harness. Harmless
   in production (no secrets, no auto-actions); the harness drives the real
   reconciliation/persistence code rather than a copy. */
window.__fosDurability = {
  Store, get S() { return S; }, render,
  get cloudUser() { return cloudUser; }, get epoch() { return _authEpoch; },
  get cloudWritable() { return _cloudWritable; }, get localTrusted() { return _localTrusted; },
  setSupa(m) { supa = m; }, setSupabaseLib(m) { window.supabase = m; },
  setCloudWritable(v) { _cloudWritable = !!v; }, setLocalTrusted(v) { _localTrusted = !!v; },
  signIn(uid) { cloudUser = { id: uid, email: uid + '@futuroos.test' }; _authEpoch++; _cloudWritable = false; _switchScope(uid); },
  signOut() { _authEpoch++; _cloudWritable = false; clearTimeout(_cloudTimer); clearTimeout(_jobTimer); cloudUser = null; _switchScope(null); },
  pullCloud, pullJobs, pushCloud, pushAllJobs, pushJob, saveJobs, saveDeals, saveSettings,
  lifecycleFlush: () => _lifecycleFlush(),
  recover: (sc) => Store.recoverFromDurable(sc || Store.scope)
};

/* ---------------- init ---------------- */
wire();
$('brandSub').textContent = 'Mobile Ops — ' + S.settings.company;
if (hasPin()) showLock('unlock');   // require PIN before the app is usable
show('today');
startGps();
initCloud();
updateInstallUi();
// P0-C async recovery: if the synchronous boot could not read a valid local
// snapshot for the active scope, rehydrate from the IndexedDB durability tier
// before the user starts editing over an empty screen.
Store.init().then(async () => {
  const rec = await Store.recoverFromDurable(Store.scope);
  if (rec) {
    S.jobs = Array.isArray(rec.jobs) ? rec.jobs : S.jobs;
    S.deals = Array.isArray(rec.deals) ? rec.deals : S.deals;
    S.settings = Object.assign({}, DEFAULT_SETTINGS, rec.settings || {});
    render();
    _localTrusted = true;             // recovered a valid durable snapshot
    if (Store.corruptAtBoot()) toast('Recovered your data from the on-device backup');
  } else if (Store.corruptAtBoot()) {
    // No valid local snapshot and none recoverable: stay protective — do NOT let
    // this empty/default state be uploaded over whatever the cloud may hold.
    _localTrusted = false;
    toast('⚠ Local data was unreadable — working in recovery mode');
  }
}).catch(() => {});
/* ---------------- controlled service-worker updates (P0-D) ----------------
   An app update must never reload during active or unsaved work, activate a
   partial cache, or strand the user offline. sw.js installs the new build
   atomically and then WAITS. This coordinator detects the waiting worker, shows a
   single non-blocking prompt, and — only on explicit approval — forces a P0-C
   durability flush, tells the worker to activate, and reloads exactly once. If the
   flush cannot be confirmed, activation is refused and the current version stays
   live. Reload is armed only for our own approved activation, so an unrelated
   controllerchange (e.g. a sibling tab, or first install) never auto-reloads. */

// P0-C durability-flush contract for update approval. Returns Promise<boolean>:
// true only when the live in-memory state was safely persisted to the durable tier.
// In protective/recovery mode (_localTrusted === false) the in-memory state is an
// empty placeholder, so we must NOT flush (it would clobber good durable data) and
// must NOT report success — the caller then refuses to activate and keeps the
// current version. Reuses Store.flush + Store.lastWriteOk (the real P0-C API), not a
// second save system, and never touches auth UID/epoch scope (Store.flush is
// scope-local by construction).
function _durableFlushForUpdate() {
  if (!_localTrusted) return Promise.resolve(false);
  let chain;
  try { chain = Store.flush(S); }                       // sync localStorage write + kick IDB mirror
  catch (e) { return Promise.resolve(false); }
  const check = () => Store.lastWriteOk() !== false;    // the synchronous local write must have held
  return Promise.resolve(chain).then(check, check);
}

/* @p0d-coordinator-start (extracted verbatim by FuturoFreight_Test_Harnesses/p0d-harness.html) */
function _createSwUpdate(deps) {
  const container = deps.container;                 // ServiceWorkerContainer (real or mocked)
  const getController = deps.getController;         // () => current controller worker or null
  const durableFlush = deps.durableFlush;           // () => Promise<boolean> (P0-C flush + confirm)
  const reload = deps.reload;                       // () => void
  const session = deps.session;                     // sessionStorage-like (may be null)
  const ui = deps.ui;                               // { show(v), hide(), status(msg, isError) }
  const RELOAD_TIMEOUT = deps.reloadTimeout || 8000;
  const ACT_KEY = 'fos.swActivated';                // version we drove to activation (survives reload)

  let pendingWorker = null, pendingVersion = null;
  let promptedVersion = null;                        // dedupe: one prompt per version per session
  let approving = false, reloadArmed = false, reloaded = false, reloadTimer = null;

  // Ask a worker its version over a MessageChannel (bounded; null on timeout/failure).
  function versionOf(worker) {
    return new Promise(res => {
      if (!worker || !worker.postMessage) return res(null);
      let done = false;
      const finish = v => { if (!done) { done = true; res(v); } };
      const to = setTimeout(() => finish(null), 2000);
      let ch;
      try { ch = new MessageChannel(); } catch (e) { clearTimeout(to); return res(null); }
      ch.port1.onmessage = ev => { clearTimeout(to); finish((ev.data && ev.data.version) || null); };
      try { worker.postMessage({ type: 'GET_VERSION' }, [ch.port2]); }
      catch (e) { clearTimeout(to); finish(null); }
    });
  }

  async function maybePrompt(worker) {
    if (!worker) return;
    // An UPDATE only exists when a worker already controls this page; the very first
    // install has no controller and must never surface an update prompt.
    if (!getController()) return;
    const v = (await versionOf(worker)) || 'pending';
    if (promptedVersion === v) return;                          // already prompting this version
    if (session && session.getItem(ACT_KEY) === v) return;      // already activated -> reloaded page
    promptedVersion = v; pendingWorker = worker; pendingVersion = v;
    ui.show(v);
  }

  async function approve() {
    if (approving || reloaded) return false;
    approving = true;
    ui.status('Saving your work…', false);
    let ok = false;
    try { ok = await durableFlush(); } catch (e) { ok = false; }
    if (!ok) {
      approving = false;
      ui.status('Couldn’t save locally — staying on the current version.', true);
      return false;                                             // refuse activation; keep current version
    }
    // Record intent BEFORE activating so a reload can't re-drive the same version (loop guard).
    if (session) { try { session.setItem(ACT_KEY, pendingVersion); } catch (e) {} }
    reloadArmed = true;
    ui.status('Updating…', false);
    try { pendingWorker.postMessage({ type: 'SKIP_WAITING', version: pendingVersion }); } catch (e) {}
    // Bounded recovery: if the new worker never takes control, don't hang or loop.
    reloadTimer = setTimeout(() => {
      if (reloaded) return;
      reloadArmed = false; approving = false;
      ui.status('Update ready — reload when you’re done to finish.', false);
    }, RELOAD_TIMEOUT);
    return true;
  }

  function later() { ui.hide(); }   // session-only dismissal; the prompt returns next launch

  function onControllerChange() {
    if (reloaded) return;
    if (!reloadArmed) return;         // never auto-reload on an activation we didn't approve
    reloaded = true;
    clearTimeout(reloadTimer);
    reload();
  }

  function attach(registration) {
    if (!registration) return;
    // A worker that finished installing in a prior session and is still waiting now.
    if (registration.waiting) maybePrompt(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const nw = registration.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed') maybePrompt(nw);
      });
    });
  }

  if (container && container.addEventListener) {
    container.addEventListener('controllerchange', onControllerChange);
  }

  return {
    attach, maybePrompt, approve, later, onControllerChange,
    get state() { return { pendingVersion, promptedVersion, approving, reloadArmed, reloaded }; }
  };
}
/* @p0d-coordinator-end */

// Real update UI (thin DOM adapter over the inline #swUpdate bar in index.html).
const _swUpdateUi = {
  show() {
    const bar = $('swUpdate'); if (!bar) return;
    const msg = $('swUpdateMsg'); if (msg) msg.textContent = 'App update ready.';
    bar.classList.remove('is-error');
    bar.hidden = false;
  },
  hide() { const bar = $('swUpdate'); if (bar) bar.hidden = true; },
  status(text, isError) {
    const msg = $('swUpdateMsg'); if (msg) msg.textContent = text;
    const bar = $('swUpdate'); if (bar) bar.classList.toggle('is-error', !!isError);
  }
};

// Expose the real factory + flush for the external P0-D regression harness (drives
// the real coordinator/durability code with mocked worker/cache/session deps).
window.__fosSWUpdate = { create: _createSwUpdate, durableFlush: _durableFlushForUpdate };

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  const _swUpdate = _createSwUpdate({
    container: navigator.serviceWorker,
    getController: () => navigator.serviceWorker.controller,
    durableFlush: _durableFlushForUpdate,
    reload: () => location.reload(),
    session: (() => { try { return window.sessionStorage; } catch (e) { return null; } })(),
    ui: _swUpdateUi
  });
  const _now = $('swUpdateNow'), _later = $('swUpdateLater');
  if (_now) _now.addEventListener('click', () => _swUpdate.approve());
  if (_later) _later.addEventListener('click', () => _swUpdate.later());
  navigator.serviceWorker.register('sw.js')
    .then(reg => _swUpdate.attach(reg))
    .catch(() => { toast('Update check unavailable — the app still works offline.'); });
}
// expose a couple of handlers used from generated HTML
window.show = show;
window.openJobSheet = openJobSheet;
window.downloadReceipt = downloadReceipt;
window.resendReceipt = resendReceipt;
