// Offline cache for the app shell. Map tiles are never cached.
const CACHE = 'stride-v1';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './js/app.js', './js/charts.js', './js/db.js', './js/health-import.js', './js/pedometer.js', './js/plan.js', './js/store.js', './js/tracker.js', './js/util.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  './js/vendor/fflate.umd.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('openstreetmap.org') || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && (url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com')) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
