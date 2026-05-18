// Bump this string to force clients to pick up new code.
const VERSION = 'pabrik-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the API, cache-first for the shell.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.endsWith('.gs') || url.hostname.includes('script.google')) {
    // Let the page handle API calls directly (it has its own retry/queue).
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
