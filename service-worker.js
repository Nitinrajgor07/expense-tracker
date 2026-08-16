// Cache version — bump this string whenever you deploy a new version
const CACHE = "expense-tracker-v10";

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
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // 1. Cache core assets
      await cache.addAll(CORE_FILES).catch(err => {
        console.warn("[SW] Core files pre-cache warning:", err);
      });

      // 2. Cache optional assets best-effort
      await Promise.allSettled(
        OPTIONAL_FILES.map(file =>
          cache.add(file).catch(() => { /* ignore offline/CDN failure during install */ })
        )
      );
    })
  );
  // Activate immediately without waiting for old worker to exit
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE)
            .map(key => {
              console.log("[SW] Evicting legacy cache:", key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  // 1. Navigation requests (Page Loads / PWA Launch)
  // Fast Stale-While-Revalidate: Instant <3ms load from cache + background revalidation
  if (e.request.mode === "navigate") {
    e.respondWith(
      (async () => {
        // Try matching cache for instant mobile launch
        const cachedResponse =
          (await caches.match(e.request)) ||
          (await caches.match(basePath + "index.html")) ||
          (await caches.match(basePath + "expense-tracker.html")) ||
          (await caches.match(basePath));

        // Background network update
        const fetchPromise = fetch(e.request)
          .then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE).then(cache => {
                cache.put(e.request, clone);
                cache.put(basePath, networkResponse.clone());
                cache.put(basePath + "index.html", networkResponse.clone());
                cache.put(basePath + "expense-tracker.html", networkResponse.clone());
              });
            }
            return networkResponse;
          })
          .catch(() => null);

        // If we have a cached version, return it immediately for instant launch
        if (cachedResponse) {
          // Trigger background update without blocking
          e.waitUntil(fetchPromise);
          return cachedResponse;
        }

        // If not in cache (first run), wait for network
        const networkResponse = await fetchPromise;
        if (networkResponse) return networkResponse;

        // Offline fallback
        const fallback =
          (await caches.match(basePath + "index.html")) ||
          (await caches.match(basePath + "expense-tracker.html")) ||
          (await caches.match(basePath));
        if (fallback) return fallback;

        return new Response("Offline - Expense Tracker", {
          status: 503,
          headers: { "Content-Type": "text/plain" }
        });
      })()
    );
    return;
  }

  // 2. Static Assets (CSS, JS, Icons, Images): Cache-First + Stale-While-Revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Revalidate same-origin assets in background
        if (url.origin === self.location.origin) {
          fetch(e.request)
            .then(res => {
              if (res && res.status === 200) {
                const clone = res.clone();
                caches.open(CACHE).then(cache => cache.put(e.request, clone));
              }
            })
            .catch(() => {});
        }
        return cached;
      }

      return fetch(e.request)
        .then(res => {
          if (res && (res.status === 200 || res.type === "opaque")) {
            const clone = res.clone();
            caches.open(CACHE).then(cache => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => new Response("", { status: 503 }));
    })
  );
});

// ─── Message ──────────────────────────────────────────────────────────────────
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});