// ── My Depot Master — Service Worker ────────────────────────────────────────
// Strategy:
//   App shell (index.html)  → cache-first, background refresh
//   Google Fonts            → cache-first (static, rarely change)
//   Firebase REST calls     → network-only  (never cache auth/data)
//   Everything else         → network-only  (pass-through)
// ────────────────────────────────────────────────────────────────────────────

const CACHE  = 'mdm-v3';
const SHELL  = './index.html';
const FONTS  = [
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&display=swap'
];

// ── INSTALL: cache shell immediately ─────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([SHELL, ...FONTS]))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()) // don't block install if fonts fail
  );
});

// ── ACTIVATE: purge old caches and claim clients ──────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { url, method, mode } = e.request;

  // Never intercept non-GET or Firebase / Google Identity requests
  if (method !== 'GET') return;
  if (
    url.includes('firebaseio.com') ||
    url.includes('firebase') ||
    url.includes('googleapis.com/identitytoolkit') ||
    url.includes('securetoken.google.com')
  ) return;

  // ── App shell (navigation) — cache-first, refresh in background
  if (mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(SHELL);
        const networkPromise = fetch(e.request).then(resp => {
          if (resp && resp.ok) cache.put(SHELL, resp.clone());
          return resp;
        }).catch(() => null);
        return cached || await networkPromise;
      })
    );
    return;
  }

  // ── Google Fonts — cache-first, populate on first fetch
  if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        const resp = await fetch(e.request);
        if (resp && resp.ok) cache.put(e.request, resp.clone());
        return resp;
      })
    );
    return;
  }

  // Everything else — network only (no caching)
});
