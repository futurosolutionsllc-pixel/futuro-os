/* FuturoOS service worker — atomic, controlled offline app shell (P0-D).

   Update-safety contract (see README "Controlled PWA updates"):
   - Install is ATOMIC: the new worker's cache is only usable if EVERY mandatory
     same-origin shell asset was fetched and stored. A single failure aborts the
     install and removes the half-built candidate cache, so a partial shell is
     never promoted and the previous worker keeps serving the last-known-good shell.
   - Install does NOT skipWaiting: the new worker WAITS until the page explicitly
     approves activation (after a P0-C durability flush). No mid-work reloads.
   - Activation preserves last-known-good: it deletes only OBSOLETE caches this
     worker owns (fos-* prefix), never the current cache and never unrelated
     origin caches, and only runs after a successful atomic install.
   - Fetch policy is unchanged from the approved PR #6 behavior. */

const VERSION = 'v13';                       // bump rationale (v12 -> v13): atomic install +
                                             // controlled-update lifecycle changed; a fresh cache
                                             // name is required so the new worker installs into its
                                             // own candidate cache and activation can retire v12.
const CACHE = 'fos-' + VERSION;              // this version's uniquely versioned candidate cache
const CACHE_PREFIX = 'fos-';                 // ownership marker: only caches with this prefix are ours

// MANDATORY same-origin app shell. Install FAILS (and is rolled back) if any of
// these cannot be fetched + cached, so a new worker never activates with a partial
// shell and offline startup always has a complete, internally consistent build.
const MANDATORY = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/mark.svg',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/jspdf.umd.min.js',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png'
];

// OPTIONAL cross-origin brand chrome. Cached best-effort and kept SEPARATE from the
// mandatory guarantee: their reachability must never decide install success.
const OPTIONAL = [
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Atomic install: fetch + validate every mandatory asset into the candidate cache.
// Any failure -> delete the candidate cache and reject, so nothing partial survives.
async function installShell() {
  const cache = await caches.open(CACHE);
  const results = await Promise.all(MANDATORY.map(async url => {
    let res;
    try { res = await fetch(new Request(url, { cache: 'reload' })); }
    catch (e) { return { url, ok: false }; }
    if (!res || !res.ok) return { url, ok: false };       // 404/5xx is a hard install failure
    try { await cache.put(url, res.clone()); return { url, ok: true }; }
    catch (e) { return { url, ok: false }; }
  }));
  const failed = results.filter(r => !r.ok).map(r => r.url);
  if (failed.length) {
    // Roll back: never leave a partial candidate cache to accumulate or be promoted.
    try { await caches.delete(CACHE); } catch (e) {}
    throw new Error('P0-D atomic install aborted; missing shell asset(s): ' + failed.join(', '));
  }
  // Optional chrome is a bonus layer, isolated from the atomic guarantee above.
  await Promise.allSettled(OPTIONAL.map(u =>
    fetch(new Request(u, { mode: 'no-cors' }))
      .then(r => (r ? cache.put(u, r) : null))
      .catch(() => {})
  ));
  // Deliberately NO self.skipWaiting() here: the worker waits for the page to approve.
}

self.addEventListener('install', e => { e.waitUntil(installShell()); });

// Activation runs only after a successful atomic install. Retire only obsolete caches
// WE own; leave the current cache and any unrelated origin caches untouched. Idempotent.
async function activateShell() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter(k => k !== CACHE && k.indexOf(CACHE_PREFIX) === 0)
        .map(k => caches.delete(k))
  );
  await self.clients.claim();
}

self.addEventListener('activate', e => { e.waitUntil(activateShell()); });

// Controlled activation channel. The worker only leaves the waiting state when the
// page sends a validated request naming THIS worker's version. Malformed or unrelated
// messages are ignored so a stale page can never force an unexpected activation.
self.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'GET_VERSION') {
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ type: 'VERSION', version: VERSION });
    return;
  }
  if (d.type === 'SKIP_WAITING' && d.version === VERSION) {
    self.skipWaiting();
    return;
  }
  // Any other message: ignored on purpose.
});

/* ---------------- fetch (approved PR #6 policy, preserved) ----------------
   The app's OWN html/js/css are network-first: a cache-first shell strands users
   on an old build after a deploy (they refresh and still see the stale app), so
   go to the network when online and fall back to cache offline. Everything else
   — vendor libs, fonts, map tiles, icons — stays cache-first for speed since it
   rarely changes. */
const isAppShell = url =>
  url.origin === self.location.origin &&
  !url.pathname.includes('/vendor/') &&
  (/\/$/.test(url.pathname) || /\/(index\.html|app\.js|styles\.css)$/.test(url.pathname));

const cachePut = (req, res) => {
  const clone = res.clone();
  caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
};

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // never cache live APIs (routing, geocoding, SAM.gov, Supabase data/auth)
  // or map tiles — a cached failed tile would blank the map permanently
  if (/api\.sam\.gov|router\.project-osrm|nominatim|supabase\.co|tile\.openstreetmap\.org/.test(url.host)) return;
  if (e.request.method !== 'GET') return;

  if (isAppShell(url)) {
    e.respondWith(
      fetch(e.request)
        .then(res => { if (res.ok) cachePut(e.request, res); return res; })
        .catch(() => caches.match(e.request).then(hit =>
          hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(hit => hit ||
      fetch(e.request).then(res => {
        // cache successful same-origin + tile/CDN responses opportunistically
        if (res.ok || res.type === 'opaque') cachePut(e.request, res);
        return res;
      }).catch(() => e.request.mode === 'navigate'
        ? caches.match('./index.html')
        : Response.error())
    )
  );
});
