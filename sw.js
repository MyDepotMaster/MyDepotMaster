// ── MDM Service Worker — offline-first ──────────────────────────────────────
// Registered from same origin (not blob URL) so Android Chrome can
// intercept navigation requests and serve the shell when offline.
//
// Strategy:
//   navigate requests  → network-first (always try latest; fall back to cache)
//   Google Fonts       → cache-first (stale-while-revalidate)
//   Firebase REST      → network-only (never cache auth/data requests)
//   everything else    → pass-through (network only)
//
// Update flow:
//   1. New SW installs → skipWaiting() fires immediately (always)
//   2. activate purges old caches → clients.claim() takes over all tabs
//   3. SW posts { type:'NEW_VERSION', version:CACHE } to every open tab
//   4. index.html listener: Median → clears webview cache + hard reload
//                           Browser → shows update toast
//
// Median note:
//   Median's webview caches the HTML shell independently of the SW cache.
//   To guarantee Median users always get the latest version:
//   - index.html stamps every URL with ?_mv=<VERSION> and forces a reload
//     if the stamp is missing or outdated (medianUpdateCheck IIFE).
//   - The SW strips _mv from cache keys so ?_mv=mdm-v20 and the bare URL
//     resolve to the same cached entry — no double-fetching.
//   - On activate the SW posts NEW_VERSION → index.html clears the webview
//     cache and navigates to the stamped URL.
//
// v21 changes (2026-06-11):
//   - Fix 23: Supplier picker added to General and Commodity receive forms.
//     supplierId + supplierName stored on every receive record; Supplier
//     Performance tab now auto-links without manual name matching.
//   - Fix 24: Vehicle / Transport Log added as new 🚛 Transport subtab inside
//     the Commodity tab. Fields: date, vehicle, driver, route, trip type,
//     cost, notes. Includes CSV export.
//   - Fix 25: Batch/lot traceability on commodity issues. Issue form shows
//     Source Receive Record dropdown (filtered by batch, shows date/qty/supplier).
//     sourceReceiveId stored on issue records. 🔍 Trace button on issue rows
//     opens a modal showing the full issue → receive chain with supplier details.
//
// v20 changes (2026-06-10):
//   - Fix 19: Credit/debt tracking on issue and receive records.
//     Issue form now captures payment status (paid/partial/credit) and
//     partial amount paid. Outstanding credit card shows all open debts.
//     Receive form captures supplier payment status (paid/partial/credit).
//   - Fix 20: Consolidated Profit & Loss view added as new P&L subtab
//     in the General tab. Shows revenue, COGS, gross profit, staff costs,
//     and net profit for the selected period, with a full COGS breakdown.
//
// v19 changes (2026-06-10):
//   - (index-4 release — see index.html changelog)
//
// v18 changes (2026-06-09):
//   - fbRestoreData now merges users instead of overwriting: cloud is
//     authoritative for users it knows, but local-only users (sub-users added
//     while offline or before sync caught up) are never dropped. Fixes chongo1
//     and mwansa being wiped when cloud restore runs with a higher _v.
//
// v17 changes (2026-06-09):
//   - Any account from any depot can now log in on any device (no device binding).
//   - Pre-login restore always looks up username in Firebase usernames/ index first
//     to resolve the correct depot installId, then restores that depot's data.
//     If the depot on the device differs from the one being logged into, the correct
//     depot data is force-loaded from Firebase before credentials are checked.
//
// v16 changes (2026-06-09):
//   - Pre-login restore now always runs (not only when DATA.users is empty).
//   - On brand-new device/fresh install with no installId: looks up the typed
//     username in Firebase usernames/ index to discover the installId, then
//     does a full depot restore — fixes login from content://downloads/ URLs.
//
// v15 changes (2026-06-09):
//   - Removed Depot Key as a recovery method entirely.
//   - Recovery is now PIN and email only.
//   - Fresh-install no-data screen directs user to go online/contact support.
//   - Removed depot key mention from login error message.
//
// v14 changes (2026-06-09):
//   - Pre-login cloud restore: if DATA.users is empty on fresh install,
//     fbRestoreData() is called before the username lookup so existing
//     accounts are found without needing the recovery flow.
//   - Better login error message when no local data exists on device.
//   - "Restore from Cloud" option added to recovery screen using Depot Key.


// ────────────────────────────────────────────────────────────────────────────

const CACHE     = 'mdm-v21';   // ← bump this whenever you deploy a new version
const SHELL     = './';
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap';

// ── HELPERS ──────────────────────────────────────────────────────────────────

// Strip _mv query param from a URL so cached entries are found regardless of
// whether the URL was stamped by the Median update check or not.
function stripMv(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('_mv');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Build a cache Request with the _mv param removed (used as the cache key).
function cacheKey(request) {
  const clean = stripMv(request.url);
  return clean === request.url ? request : new Request(clean, { mode: 'same-origin' });
}

function cacheFirst(req) {
  const key = cacheKey(req);
  return caches.match(key).then(cached => {
    // Serve cached immediately; revalidate in background (stale-while-revalidate)
    const revalidate = fetch(req).then(r => {
      if (r && r.ok) caches.open(CACHE).then(c => c.put(key, r.clone()));
      return r;
    }).catch(() => {});
    return cached || revalidate;
  });
}

function networkFirst(req) {
  const key = cacheKey(req);
  return fetch(req)
    .then(r => {
      if (r && r.ok) caches.open(CACHE).then(ca => ca.put(key, r.clone()));
      return r;
    })
    .catch(() => caches.match(key).then(cached => cached || caches.match(SHELL)));
}

// ── INSTALL: pre-cache the app shell ────────────────────────────────────────
// skipWaiting() is called unconditionally so a new SW always activates
// immediately — critical for Median where there may be no tab close/reopen.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.add(SHELL)                         // shell always first
        .then(() => cache.add('manifest.json').catch(() => {})) // manifest (best-effort)
        .then(() => cache.add(FONTS_CSS).catch(() => {}))       // fonts (best-effort, may fail offline)
      )
      .finally(() => self.skipWaiting())   // always activate immediately
  );
});

// ── ACTIVATE: claim clients, purge old caches, notify tabs ──────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Notify every open tab → index.html will handle Median reload or show toast
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(clients => {
            clients.forEach(client =>
              client.postMessage({ type: 'NEW_VERSION', version: CACHE })
            );
          });
      })
  );
});

// ── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  // Only handle GET — never intercept POST/PUT/DELETE (Firebase writes must go to network)
  if (req.method !== 'GET') return;

  // Firebase REST & auth endpoints — network-only, never cache
  // Caching auth/data responses would serve stale license or data reads offline
  if (
    url.includes('firebaseio.com') ||
    url.includes('googleapis.com/identitytoolkit') ||
    url.includes('securetoken.googleapis.com') ||
    url.includes('firebaseinstallations') ||
    url.includes('firebase')
  ) {
    // Let the browser handle it; offline queue in index.html handles write failures
    return;
  }

  // Navigation requests (loading the app shell) — network-first
  // Strips _mv before storing so both stamped and unstamped URLs hit the same entry.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => {
          if (r && r.ok) {
            caches.open(CACHE).then(ca => ca.put(cacheKey(req), r.clone()));
          }
          return r;
        })
        .catch(() =>
          caches.match(cacheKey(req))
            .then(cached => cached || caches.match(SHELL))
        )
    );
    return;
  }

  // Google Fonts — cache-first (stale-while-revalidate)
  if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // manifest.json — network-first with cache fallback
  if (url.includes('manifest.json')) {
    e.respondWith(networkFirst(req));
    return;
  }

  // Everything else — pass through to network
});
