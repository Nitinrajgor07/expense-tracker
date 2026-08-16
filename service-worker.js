// Cache version — bump this string whenever you deploy a new version
const CACHE = "expense-tracker-v8";

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

// Install: cache core files reliably and pre-populate app content
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // 1. Cache core assets
      await cache.addAll(CORE_FILES).catch(err => {
        console.warn("[SW] Core files cache warning:", err);
      });

      // 2. Ensure both index.html and expense-tracker.html are cached for root
      try {
        const appRes = await fetch(basePath + "index.html");
        if (appRes && appRes.ok) {
          await cache.put(basePath, appRes.clone());
          await cache.put(basePath + "index.html", appRes.clone());
          await cache.put(basePath + "expense-tracker.html", appRes.clone());
        }
      } catch (err) {
        /* ignore fetch failures during offline install */
      }

      // 3. Cache optional files best-effort
      await Promise.allSettled(
        OPTIONAL_FILES.map(file =>
          cache.add(file).catch(() => { /* optional — ignore */ })
        )
      );
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate: clean old caches and claim all clients
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE) {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Fast-launch with Cache-First + Stale-While-Revalidate
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);

  // Navigation requests: Check cache first for INSTANT mobile load, update in background
  if (e.request.mode === "navigate") {
    e.respondWith(
      (async () => {
        // Try matching exact request or app HTML from cache first
        const cachedResponse =
          (await caches.match(e.request)) ||
          (await caches.match(basePath)) ||
          (await caches.match(basePath + "index.html")) ||
          (await caches.match(basePath + "expense-tracker.html"));

        // If found in cache, return immediately and update cache in background
        if (cachedResponse) {
          // Background revalidation
          fetch(e.request)
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
            })
            .catch(() => { /* offline / network error — cached version already returned */ });

          return cachedResponse;
        }

        // If not in cache (e.g. initial first run), fetch from network
        try {
          const networkResponse = await fetch(e.request);
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
        } catch (netErr) {
          // Offline fallback
          const fallback =
            (await caches.match(basePath)) ||
            (await caches.match(basePath + "index.html")) ||
            (await caches.match(basePath + "expense-tracker.html"));
          if (fallback) return fallback;

          return new Response("Offline - Expense Tracker", {
            status: 503,
            statusText: "Offline",
            headers: { "Content-Type": "text/plain" }
          });
        }
      })()
    );
    return;
  }

  // All other requests (CSS, JS, images, icons, CDN): Cache-First + Stale-While-Revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Revalidate in background for same-origin resources
        if (url.origin === self.location.origin) {
          fetch(e.request).then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE).then(cache => cache.put(e.request, clone));
            }
          }).catch(() => {});
        }
        return cached;
      }

      return fetch(e.request).then(response => {
        if (response && (response.status === 200 || response.type === "opaque")) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        return new Response("", { status: 503, statusText: "Offline" });
      });
    })
  );
});

// Message handler: skip waiting on demand (update flow)
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});