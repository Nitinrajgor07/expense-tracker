// Cache version — bump this string whenever you deploy a new version
const CACHE = "expense-tracker-v12";

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
      // 1. Pre-cache core application assets
      await cache.addAll(CORE_FILES).catch(err => {
        console.warn("[SW] Core pre-cache warning:", err);
      });

      // 2. Cache optional assets best-effort
      await Promise.allSettled(
        OPTIONAL_FILES.map(file =>
          cache.add(file).catch(() => { /* ignore optional/offline install */ })
        )
      );
    })
  );
  // Force activate immediately without waiting for existing clients to close
  self.skipWaiting();
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.map(key => {
            if (key !== CACHE) {
              console.log("[SW] Deleting stale legacy cache:", key);
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  // 1. Navigation Requests (Page Loads / PWA Launch)
  // Network-First with Cache Fallback: Always gets newest HTML online, falls back to cache offline
  if (e.request.mode === "navigate") {
    e.respondWith(
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
            return networkResponse;
          }
          // If network returned non-200, check cache
          return caches.match(e.request).then(cached => cached || networkResponse);
        })
        .catch(async () => {
          // Completely offline fallback
          const fallback =
            (await caches.match(e.request)) ||
            (await caches.match(basePath + "index.html")) ||
            (await caches.match(basePath + "expense-tracker.html")) ||
            (await caches.match(basePath));
          if (fallback) return fallback;

          return new Response(
            "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Expense Tracker</title><style>body{font-family:-apple-system,sans-serif;padding:32px;text-align:center;background:#f2f3f9;color:#1e293b;}.btn{margin-top:16px;padding:10px 20px;background:#7c6cf0;color:#fff;border:none;border-radius:12px;font-weight:600;cursor:pointer;}</style></head><body><h2>⚠️ You are currently offline</h2><p>Please connect to the internet to load Expense Tracker.</p><button class='btn' onclick='location.reload()'>Tap to Retry</button></body></html>",
            {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" }
            }
          );
        })
    );
    return;
  }

  // 2. Static Assets (CSS, JS, Icons, Images): Cache-First with Background Revalidation
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Revalidate same-origin assets in background
        const url = new URL(e.request.url);
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