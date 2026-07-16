/* FuturoOS service worker — offline app shell */
const CACHE = 'fos-v12';
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
  './vendor/jspdf.umd.min.js',
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

// The app's OWN html/js/css are network-first: a cache-first shell strands users
// on an old build after a deploy (they refresh and still see the stale app), so
// go to the network when online and fall back to cache offline. Everything else
// — vendor libs, fonts, map tiles, icons — stays cache-first for speed since it
// rarely changes.
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
