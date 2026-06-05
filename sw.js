// ── My Depot Master — Service Worker ────────────────────────────────────────
// Cache strategy:
//   App shell (index.html)  → cache-first, background refresh
//   Google Fonts            → cache-first (static)
//   Firebase REST           → network-only  (never cache auth/data)
//   Background Sync         → flushes offline writes when connection returns
// ─────────────────────────────────────────────────────────────────────────────

const CACHE      = 'mdm-v4';
const SHELL      = './index.html';
const SYNC_TAG   = 'mdm-offline-sync';
const FONTS      = [
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600&display=swap'
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([SHELL, ...FONTS]))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
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

  // Never intercept non-GET or Firebase requests
  if (method !== 'GET') return;
  if (
    url.includes('firebaseio.com') ||
    url.includes('firebase') ||
    url.includes('googleapis.com/identitytoolkit') ||
    url.includes('securetoken.google.com')
  ) return;

  // App shell — cache-first, refresh in background
  if (mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(SHELL);
        const networkPromise = fetch(e.request)
          .then(resp => {
            if (resp && resp.ok) cache.put(SHELL, resp.clone());
            return resp;
          })
          .catch(() => null);
        return cached || await networkPromise;
      })
    );
    return;
  }

  // Google Fonts — cache-first
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
  // Everything else — network only
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === SYNC_TAG) {
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(clients => {
          clients.forEach(c => c.postMessage({ type: 'MDM_FLUSH_QUEUE' }));
        })
    );
  }
});

// ── PUSH NOTIFICATIONS (stub — ready for future use) ─────────────────────────
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'My Depot Master', body: 'You have a new notification.' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'My Depot Master', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: data
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('./index.html');
    })
  );
});
