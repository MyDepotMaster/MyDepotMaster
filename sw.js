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
//   - The SW strips _mv from cache keys so ?_mv=mdm-v22 and the bare URL
//     resolve to the same cached entry — no double-fetching.
//   - On activate the SW posts NEW_VERSION → index.html clears the webview
//     cache and navigates to the stamped URL.
//
// v26 changes (2026-06-12):
//   - Fix 29: Staff ID Card Generator. New "🪪 Print ID Card" button in every
//     staff profile modal opens a print-ready pop-up with front and back of a
//     credit-card-sized ID card (85.6 × 54 mm). Front shows initials avatar,
//     name, role, phone, date joined, location, contract type badge (colour-
//     coded), employee ID, and live status indicator. Back shows emergency
//     contact, company info, employee ID in barcode style, and signature line.
//     Fully offline — no external deps, pure HTML/CSS via _pdfPrint engine.
//
// v25 changes (2026-06-12):
//   - Cloud upload/download icons added to every nav tab (Dashboard, General,
//     Commodities, Staff, Books, Contacts). Each tab has two small SVG cloud
//     buttons: ↑ Upload (calls doFbSync immediately) and ↓ Download (fetches
//     cloud copy, version-gates with _v check, confirms before overwrite).
//     Icons fade in on hover (desktop); always visible on active tab; 45%
//     opacity on inactive tabs on touch devices. Button spins while syncing.
//   - Fix 27: First-Run Onboarding Checklist. 5-step setup modal auto-appears
//     after first admin login. Steps auto-check from live DATA state. Tapping
//     any step navigates to the relevant tab. Permanently dismissible.
//     Re-openable from Settings → Help & Documentation.
//   - Fix 28: Inline ℹ️ Tooltips. mdmTip() helper adds hoverable/tappable
//     info badges on key fields. Singleton popup positions intelligently near
//     screen edges. 15 tooltips added across: Currency, Shift Hours, Annual
//     Leave, Edit Window, Auto-Logout, Recovery PIN, Purchase Price, Selling
//     Price, Batch Name, Deduction, Budget Period/Value/Quantity, and more.
//
// v24 changes (2026-06-11):
//   - Two-Stage Shift Log: "Log Work" button split into ⏵ Clock In and
//     ✏️ Manual. Clock In (Stage 1) saves an open shift with status:'open',
//     timeInTs, staff, role, task, date, time-in. Clock Out (Stage 2)
//     completes the shift: adds time-out, qty, earnings, deductions, notes,
//     sets status:'completed' + timeOutTs. Open shifts show a pulsing
//     🟢 ACTIVE badge and inline ⏹ Clock Out button in the logs table.
//     Active-shifts banner at top of logs lists all open shifts.
//     Duplicate open-shift guard blocks double clock-in with redirect to
//     Clock Out. Edit-window calculation now anchors to timeOutTs instead
//     of uid creation time for completed staff logs. Migration on load tags
//     all legacy logs as status:'completed' with timeOutTs from uid timestamp.
//   - Hotfix: missing `function openLogForm(){` declaration (eaten by str_replace
//     anchor) caused a parse-time SyntaxError → blank dark screen on load.
//
// v23 changes (2026-06-11):
//   - PC/tablet nav moved from left sidebar to bottom tab bar.
//     Tabs display icon + label side-by-side (row layout), 64px tall,
//     max 140px wide per tab, centred across full width. Active tab
//     retains green top-border indicator. Content area uses full screen
//     width with 28–40px horizontal padding. Book editor unlocked from
//     480px cap on PC. Extra-wide (≥1200px) breakpoint bumped to 68px
//     tab height and 40px content padding.
//
// v22 changes (2026-06-11):
//   - Light theme purified: all hardcoded dark hex backgrounds (#0a1628,
//     #001a2e, #002b1f, #081428, #0d1a40, #1a0d2e, #0d2a00, #2a1500,
//     #3d1515) replaced with CSS variables (var(--surface),
//     var(--overlay-dark-1), rgba tints). Screen gradients now use
//     var(--surface2). fs-mini, gsearch-overlay, pay-row, unp-row,
//     role badges, activity icons, error boxes and all JS-rendered cards
//     are theme-aware. Quick-action buttons get body.light tint classes.
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
//     while offline or before sync caught up) are never dropped.
//
// v17 changes (2026-06-09):
//   - Any account from any depot can now log in on any device (no device binding).
//   - Pre-login restore always looks up username in Firebase usernames/ index first
//     to resolve the correct depot installId, then restores that depot's data.
//
// v16 changes (2026-06-09):
//   - Pre-login restore now always runs (not only when DATA.users is empty).
//   - On brand-new device/fresh install: looks up username in Firebase
//     usernames/ index to discover installId, then does a full depot restore.
//
// v15 changes (2026-06-09):
//   - Removed Depot Key as a recovery method entirely.
//   - Recovery is now PIN and email only.
//
// v14 changes (2026-06-09):
//   - Pre-login cloud restore when DATA.users is empty on fresh install.
//   - Better login error message when no local data exists on device.

// ────────────────────────────────────────────────────────────────────────────

const CACHE     = 'mdm-v26';   // ← bump this whenever you deploy a new version
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
