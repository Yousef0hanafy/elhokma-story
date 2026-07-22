/**
 * Service Worker — offline-first caching for the e-learning module.
 *
 * Strategy:
 *  - On install: precache the app shell (HTML, CSS, JS, favicon, manifest).
 *  - On fetch: cache-first for same-origin GET requests; fall back to network.
 *    Network errors (offline) fall back to cached responses.
 *  - On activate: clean up old cache versions.
 *
 * Note: This SW intentionally does NOT cache Google Fonts (cross-origin).
 * The page has system-font fallbacks in CSS so it remains usable offline.
 * Fonts get cached by the HTTP cache and the browser will serve them on
 * repeat visits even without this SW.
 *
 * In SCORM sandboxed iframes, SW registration may fail — that's fine,
 * the page works without it (just not offline on first load).
 */
const CACHE_VERSION = 'elhokma-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './css/animations.css',
  './css/scenes.css',
  './js/error-boundary.js',
  './js/scorm-api.js',
  './js/tts.js',
  './js/content.js',
  './js/narrator.js',
  './js/animator.js',
  './js/modal-manager.js',
  './js/app.js',
  './favicon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL).catch(err => {
        // Don't fail install if a single asset 404s — the app still works.
        console.warn('[SW] Some precache assets failed:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET, same-origin (skip cross-origin font/CDN requests)
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // Refresh in background
        fetch(req).then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, clone));
          }
        }).catch(() => { /* offline — serve stale */ });
        return cached;
      }
      return fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => {
        // Last resort: serve index.html for navigation requests
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
