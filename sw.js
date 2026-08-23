const CACHE_NAME = 'reddevil-app-v6';
const APP_SHELL = [
  './',
  './index.html',
  './boss_timer.js?v=6.6',
  './assets/lordnine_logo.png',
  './assets/nong_devil.png',
  './version.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isAppAsset = requestUrl.pathname === '/' ||
    requestUrl.pathname.endsWith('/index.html') ||
    requestUrl.pathname.endsWith('/boss_timer.js') ||
    requestUrl.pathname.startsWith('/assets/') ||
    requestUrl.pathname.endsWith('/version.json');

  // Never cache Firebase, Gemini, CDN, webhook, or other third-party responses.
  if (!isSameOrigin || !isAppAsset) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
