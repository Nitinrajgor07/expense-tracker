// Cache version — bump this string whenever you deploy a new version
// v9: Force-evict old redirect-only index.html and serve full app from cache
const CACHE = "expense-tracker-v9";

// Automatically detect the base path relative to the service worker file location
const basePath = self.location.pathname.substring(0, self.location.pathname.lastIndexOf('/') + 1);

const CORE_FILES = [
  basePath,
  basePath + "index.html",
  basePath + "expense-tracker.html",
  basePath + "manifest.json",
  basePath + "icons/icon-192.png",
  basePath + "icons/icon-512.png"
];

const OPTIONAL_FILES = [
  basePath + "icons/screenshot-desktop.png",
  basePath + "icons/screenshot-mobile.png",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"
];

// ─── Install ─────────────────────────────────────────────────────────────────
// ALWAYS fetch fresh copies of core files from network (no-cache)
// so we never pre-populate stale redirect HTML into the new cache.
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Fetch core files fresh from network (bypass any old cache)
      await Promise.allSettled(
        CORE_FILES.map(url =>
          fetch(url, { cache: "no-store" })
            .then(res => {
              if (res && res.ok && res.status === 200) {
                return cache.put(url, res);
              }
            })
            .catch(() => { /* network unavailable on install — handled in activate */ })
        )
      );

      // Cache optional files best-effort
      await Promise.allSettled(
        OPTIONAL_FILES.map(url =>
          cache.add(url).catch(() => {})
        )
      );
    })
  );
  // Activate immediately — do NOT wait for old SW to be released
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────
// Delete ALL old caches and claim all open clients immediately
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  // Navigation requests (page loads):
  // Always try network first with a short timeout, fall back to cache.
  // This ensures the user gets a fresh page whenever online,
  // and the app still loads offline from cache.
  if (e.request.mode === "navigate") {
    e.respondWith(
      (async () => {
        // Try network with a 4s timeout
        const networkRes = await Promise.race([
          fetch(e.request, { cache: "no-cache" }).catch(() => null),
          new Promise(resolve => setTimeout(() => resolve(null), 4000))
        ]);

        if (networkRes && networkRes.ok && networkRes.status === 200) {
          // Validate: must be a full app HTML, not a short redirect
          const clone = networkRes.clone();
          const text = await clone.text();
          const isFullApp = text.length > 50000; // Full app is ~400KB; redirect shell is <10KB

          if (isFullApp) {
            // Cache the fresh full app under all relevant keys
            const responseToCache = new Response(text, {
              status: networkRes.status,
              statusText: networkRes.statusText,
              headers: networkRes.headers
            });
            const cache = await caches.open(CACHE);
            cache.put(e.request, responseToCache.clone());
            cache.put(basePath, responseToCache.clone());
            cache.put(basePath + "index.html", responseToCache.clone());
            cache.put(basePath + "expense-tracker.html", responseToCache.clone());
            return responseToCache;
          }
        }

        // Network failed or returned bad response — serve from cache
        const cached =
          (await caches.match(e.request)) ||
          (await caches.match(basePath)) ||
          (await caches.match(basePath + "index.html")) ||
          (await caches.match(basePath + "expense-tracker.html"));

        if (cached) {
          // Validate cached version is not the old redirect shell
          const cachedText = await cached.clone().text();
          if (cachedText.length > 50000) {
            return cached;
          }
          // Cached version is the bad redirect shell — delete it and try network again
          const cache = await caches.open(CACHE);
          await cache.delete(e.request);
          await cache.delete(basePath);
          await cache.delete(basePath + "index.html");
          await cache.delete(basePath + "expense-tracker.html");
        }

        // Last resort: fetch from network without timeout
        try {
          return await fetch(e.request);
        } catch (err) {
          return new Response("Offline - Expense Tracker is not yet cached. Please connect to load once.", {
            status: 503,
            headers: { "Content-Type": "text/plain" }
          });
        }
      })()
    );
    return;
  }

  // ── Static assets: Cache-First + background revalidation ──────────────────
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Revalidate same-origin resources in background
        const url = new URL(e.request.url);
        if (url.origin === self.location.origin) {
          fetch(e.request).then(res => {
            if (res && res.status === 200) {
              caches.open(CACHE).then(cache => cache.put(e.request, res));
            }
          }).catch(() => {});
        }
        return cached;
      }

      return fetch(e.request).then(res => {
        if (res && (res.status === 200 || res.type === "opaque")) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => new Response("", { status: 503 }));
    })
  );
});

// ─── Message ──────────────────────────────────────────────────────────────────
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});