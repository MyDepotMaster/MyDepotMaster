// ── MDM Service Worker — offline-first ──────────────────────────────────────
// Registered from same origin (not blob URL) so Android Chrome can
// intercept navigation requests and serve the shell when offline.
//
// Strategy:
//   navigate requests  → cache-first (serve shell instantly offline)
//   Google Fonts       → cache-first (stale-while-revalidate)
//   Firebase REST      → network-first with cache fallback
//   everything else    → pass-through (network only)
// ────────────────────────────────────────────────────────────────────────────

const CACHE   = 'mdm-v8';
const SHELL   = './';          // resolves to index.html at the same path
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap';

// ── INSTALL: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll([SHELL, FONTS_CSS]).catch(() =>
        cache.add(SHELL).catch(() => {}) // fonts may fail offline — that's fine
      )
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: claim clients and purge old caches ─────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── HELPERS ──────────────────────────────────────────────────────────────────
function cacheFirst(req) {
  return caches.match(req).then(cached => {
    if (cached) {
      // Refresh in background
      fetch(req).then(r => {
        if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r));
      }).catch(() => {});
      return cached;
    }
    return fetch(req).then(r => {
      if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); }
      return r;
    });
  });
}

function networkFirst(req) {
  return fetch(req)
    .then(r => {
      if (r && r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); }
      return r;
    })
    .catch(() => caches.match(req));
}

// ── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Navigation — cache-first: return cached shell instantly, refresh in background
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const networkFetch = fetch(e.request).then(r => {
          if (r && r.ok) {
            const c = r.clone();
            caches.open(CACHE).then(ca => ca.put(e.request, c));
          }
          return r;
        }).catch(() => null);

        // Serve cached immediately; refresh from network in background
        if (cached) {
          networkFetch.catch(() => {});
          return cached;
        }
        // Not in cache yet — fetch from network, fall back to SHELL
        return networkFetch.then(r => r || caches.match(SHELL));
      })
    );
    return;
  }

  // Google Fonts — cache-first
  if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // Firebase REST — network-first with cache fallback (so reads work briefly offline)
  if (url.includes('firebaseio.com') || url.includes('googleapis.com/identitytoolkit') ||
      url.includes('securetoken.googleapis.com') || url.includes('firebaseinstallations')) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Everything else — pass through
});
