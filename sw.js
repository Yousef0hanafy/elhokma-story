/**
 * Service Worker — stale-while-revalidate for the e-learning module.
 *
 * Strategy:
 *  - On install: precache the app shell so the first offline visit works.
 *  - On fetch: NETWORK-FIRST for HTML and JS (so deploys are visible
 *    immediately, not after a stale cache hit). CACHE-FIRST for CSS,
 *    images, fonts, and other static assets (they change less often and
 *    cache-first is faster).
 *  - On activate: delete ALL old caches. The cache key is bumped manually
 *    on content changes (see DEPLOY.md).
 *
 * CRITICAL: A pure cache-first strategy (the previous version) serves stale
 * content for one page load after every deploy. For an assessment-bearing
 * e-learning module, that means a learner could complete a quiz with buggy
 * old code. Network-first for JS eliminates that risk.
 *
 * In SCORM sandboxed iframes, SW registration may fail — that's fine,
 * the page works without it (just not offline on first load).
 */
const CACHE_VERSION = 'elhokma-v2';
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

// Extensions that should always try network first (correctness-critical).
const NETWORK_FIRST = ['.html', '.js', '.webmanifest', '/'];

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
        // Delete ALL old caches. The current version's cache is rebuilt
        // from network responses as users visit.
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      // Tell all open clients to refresh so they pick up new code immediately
      // after the SW activates.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => {
        try { c.postMessage({ type: 'SW_UPDATED' }); } catch (e) {}
      }))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNetworkFirst = NETWORK_FIRST.some(ext => url.pathname.endsWith(ext));

  if (isNetworkFirst) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});

function networkFirst(req) {
  return fetch(req).then(resp => {
    if (resp && resp.status === 200) {
      const clone = resp.clone();
      caches.open(CACHE_VERSION).then(c => c.put(req, clone));
    }
    return resp;
  }).catch(() => {
    // Offline or error — fall back to cache.
    return caches.match(req).then(cached => {
      if (cached) return cached;
      // Navigation requests with no cached match get the cached index.html
      // (SPA shell) so offline deep-links still work.
      if (req.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(cached => {
    if (cached) {
      // Refresh in background (stale-while-revalidate).
      fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, clone));
        }
      }).catch(() => { /* offline — keep stale */ });
      return cached;
    }
    return fetch(req).then(resp => {
      if (resp && resp.status === 200) {
        const clone = resp.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, clone));
      }
      return resp;
    }).catch(() => {
      if (req.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    });
  });
}
