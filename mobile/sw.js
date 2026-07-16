/* FuturoOS service worker — offline support without staleness.
   Strategy: network-first for the app shell (html/js/css/manifest) so every
   deploy reaches users immediately and a bad cache can never wedge the app;
   cache-first for immutable assets (vendor libs, icons, fonts); never touch
   live APIs or map tiles. */
const CACHE = 'fos-v5';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './icons/mark.svg',
  // brand chrome (best-effort: install succeeds even if these are unreachable)
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// live data and map tiles must always come from the network, uncached
const BYPASS = /api\.sam\.gov|router\.project-osrm|nominatim|supabase\.co|tile\.openstreetmap\.org/;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (BYPASS.test(url.host)) return;

  const isShell = req.mode === 'navigate' ||
    (url.origin === location.origin && /\.(html|js|css|webmanifest)$/.test(url.pathname));

  if (isShell) {
    // network-first: fresh app every load, cache only as the offline fallback
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() =>
        caches.match(req).then(hit => hit ||
          (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
      )
    );
    return;
  }

  // static assets: cache-first, populate opportunistically
  e.respondWith(
    caches.match(req).then(hit => hit ||
      fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => Response.error())
    )
  );
});
