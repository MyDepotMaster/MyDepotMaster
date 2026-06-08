// ── MDM Service Worker — offline-first ──────────────────────────────────────
// Registered from same origin (not blob URL) so Android Chrome can
// intercept navigation requests and serve the shell when offline.
//
// Strategy:
//   navigate requests  → network-first (always try latest; fall back to cache)
//   Google Fonts       → cache-first (stale-while-revalidate)
//   Firebase REST      → network-first with cache fallback
//   everything else    → pass-through (network only)
//
// Update flow:
//   1. New SW installs → skipWaiting() takes over immediately
//   2. activate purges old caches → clients.claim() takes over all tabs
//   3. SW posts { type:'NEW_VERSION' } to every open tab
//   4. index.html listener auto-reloads (or shows a toast — your choice)
// ────────────────────────────────────────────────────────────────────────────

const CACHE   = 'mdm-v10';
const SHELL   = './';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap';

// ── INSTALL: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll([SHELL, FONTS_CSS]).catch(() =>
        cache.add(SHELL).catch(() => {}) // fonts may fail offline — that's fine
      )
    ).then(() => self.skipWaiting()) // take over immediately, don't wait for old tabs to close
  );
});

// ── ACTIVATE: claim clients, purge old caches, notify tabs ──────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => {
        // Tell every open tab that a new version is live → they can reload
        self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.postMessage({ type: 'NEW_VERSION' }));
        });
      })
  );
});

// ── HELPERS ──────────────────────────────────────────────────────────────────
function cacheFirst(req) {
  return caches.match(req).then(cached => {
    if (cached) {
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

  // Navigation — network-first: always attempt to load the latest shell.
  // Falls back to cache if offline, so the app still works without a connection.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r && r.ok) {
            const c = r.clone();
            caches.open(CACHE).then(ca => ca.put(e.request, c));
          }
          return r;
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match(SHELL)))
    );
    return;
  }

  // Google Fonts — cache-first
  if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // Firebase REST — network-first with cache fallback
  if (url.includes('firebaseio.com') || url.includes('googleapis.com/identitytoolkit') ||
      url.includes('securetoken.googleapis.com') || url.includes('firebaseinstallations')) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Everything else — pass through
});
