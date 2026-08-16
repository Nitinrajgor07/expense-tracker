// Cache version — bump this string whenever you deploy a new version
const CACHE = "expense-tracker-v6";

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

// Install: cache core files reliably, optional files best-effort
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Cache core files
      await cache.addAll(CORE_FILES).catch(err => {
        console.warn("[SW] Core files cache warning:", err);
      });
      // Ensure expense-tracker.html is also populated for root and index.html in cache
      try {
        const appRes = await fetch(basePath + "expense-tracker.html");
        if (appRes && appRes.ok) {
          await cache.put(basePath + "expense-tracker.html", appRes.clone());
          await cache.put(basePath, appRes.clone());
          await cache.put(basePath + "index.html", appRes.clone());
        }
      } catch (err) {
        /* ignore */
      }
      // Cache optional files silently
      await Promise.allSettled(
        OPTIONAL_FILES.map(file =>
          cache.add(file).catch(() => { /* optional — ignore */ })
        )
      );
    })
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// Activate: clean old caches and claim all clients
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE) return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for navigation with solid offline fallback to expense-tracker.html
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  // Navigation requests: network-first with offline fallback to expense-tracker.html
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          // Update cache with fresh HTML on each navigation
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cachedApp = await caches.match(basePath + "expense-tracker.html");
          if (cachedApp) return cachedApp;
          const cachedRoot = await caches.match(basePath);
          if (cachedRoot) return cachedRoot;
          const cachedReq = await caches.match(e.request);
          if (cachedReq) return cachedReq;
          return new Response("Offline - Expense Tracker", {
            status: 503,
            statusText: "Offline",
            headers: { "Content-Type": "text/plain" }
          });
        })
    );
    return;
  }

  // All other requests: cache-first, then network with background cache update
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Cache successful GET responses (including opaque CDN responses)
        if (response && (response.status === 200 || response.type === "opaque")) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Return a blank 503 for failed non-navigate fetches
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