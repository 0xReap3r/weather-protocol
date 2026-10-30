// Service worker: caches the app shell so it opens instantly and survives a dropped connection.
// Live data (added in Phase 2) is always fetched fresh — never served stale from this cache.
const VERSION = "shell-v52";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/i18n.js",
  "./js/i18n/es.js",
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
  "./js/storms.js",
  "./js/fires.js",
  "./js/tropical.js",
  "./js/lakes.js",
  "./js/crossings.js",
  "./js/data/texas.js",
  "./js/menu.js",
  "./js/search.js",
  "./js/markers.js",
  "./js/feed.js",
  "./js/places.js",
  "./js/route.js",
  "./js/grid.js",
  "./js/legends.js",
  "./js/push.js",
  "./js/region.js",
  "./js/satellite.js",
  "./js/raintotals.js",
  "./js/data/counties.js",
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
  if (url.pathname.startsWith("/api/")) return; // live data from our Worker is never cached
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

/* ---------- Push alerts (Phase 7) ---------- */
// Pushes arrive empty; fetch this device's waiting messages from the Worker and show them.
const API = /workers\.dev$/.test(self.location.hostname) ? "/api/push" : "https://weather-protocol.protocolxv-dev.workers.dev/api/push";
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let msgs = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const r = await fetch(`${API}/inbox?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: "no-store" });
      msgs = (await r.json()).messages || [];
    } catch (_) { /* fall through to a generic notice */ }
    if (!msgs.length) msgs = [{ title: "Stormline", body: "New weather alert for one of your places. Open the map for details.", url: "/" }];
    for (const m of msgs.slice(0, 3)) {
      await self.registration.showNotification(m.title, {
        body: m.body,
        tag: m.tag || undefined,
        data: { url: m.url || "/" },
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        requireInteraction: /^(Tornado|Flash Flood|Extreme Wind)/.test(m.title),
        vibrate: [300, 120, 300, 120, 300],
      });
    }
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) { await win.focus(); return win.navigate(url).catch(() => {}); }
    return self.clients.openWindow(url);
  })());
});
