const CACHE_NAME = 'vgh-pwa-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : null;
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isHtml = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  const isCoreAsset = /\.(?:css|js)$/i.test(url.pathname) || url.pathname.endsWith('/manifest.json');

  // Network-first for HTML and core assets so updates appear without Ctrl+F5
  if (isSameOrigin && (isHtml || isCoreAsset)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Default: cache-first
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
