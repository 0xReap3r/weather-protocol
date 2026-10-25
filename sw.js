// Service worker: caches the app shell so it opens instantly and survives a dropped connection.
// Live data (added in Phase 2) is always fetched fresh — never served stale from this cache.
const VERSION = "shell-v19";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/config.js",
  "./js/layers.js",
  "./js/data/fetch.js",
  "./js/data/alerts.js",
  "./js/data/gauges.js",
  "./js/near.js",
  "./js/data/rain.js",
  "./js/data/floodmaps.js",
  "./js/radar.js",
  "./js/key.js",
  "./js/outlook.js",
  "./js/reports.js",
  "./js/data/reports.js",
  "./js/data/outlook.js",
  "./js/data/roadnames.js",
  "./js/data/transit.js",
  "./js/transit.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // let the network handle data + tiles
  // Network first for the shell so updates land quickly; fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
