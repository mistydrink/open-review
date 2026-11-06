// Offline support: keeps the app, the engine and the openings book cached so
// reviews work without an internet connection after the first visit.
// Bump VERSION whenever a cached file changes.

const VERSION = "open-review-v3";
const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/engine.js",
  "js/review.js",
  "js/board.js",
  "js/sample.js",
  "js/history.js",
  "js/prefs.js",
  "js/ads.js",
  "js/importers.js",
  "js/share.js",
  "js/insights.js",
  "vendor/chess.js",
  "vendor/pieces-cburnett.svg",
  "vendor/fonts/archivo-variable.woff2",
  "data/openings.json",
  "engine/stockfish-17.1-lite-single-03e3232.js",
  "engine/stockfish-17.1-lite-single-03e3232.wasm",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only handle this site's own files; game imports and ads go straight to the network.
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      // Serve from cache straight away, refresh it in the background.
      return hit || network;
    })
  );
});
