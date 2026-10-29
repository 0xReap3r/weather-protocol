// Check a route: driving route from your location (or the spot in the panel) to a saved place
// or a spot you tap, checked against NWS warnings it passes through and roads neighbors
// reported flooded, iced or blocked. Routing from the public OSRM server (OpenStreetMap data).
// Never says a route is safe: "nothing reported" is not "clear".
import { contains, milesBetween } from "./near.js";
import { fetchJSON } from "./data/fetch.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const NEAR_ROUTE_M = 120; // a reported block within this distance of the line counts as "on the route"

function metersToLine([lng, lat], coords) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][0] - lng) * kx, ay = (coords[i - 1][1] - lat) * ky;
    const bx = (coords[i][0] - lng) * kx, by = (coords[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export function initRoute({ map, getSpot, getMe, getPlaces, getAlertsFC, getRoads, openSheet, closeSheet, onPick, toast }) {
  const root = document.getElementById("route-body");
  let from = "spot", to = null, result = null, busy = false, picking = false;

  map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "route-case", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#0b0f14", "line-width": 8 } });
  map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#e9f0f6", "line-width": 4 } });

  const fromPoint = () => (from === "me" && getMe() ? getMe() : getSpot().at);

  function render() {
    const places = getPlaces();
    const me = getMe();
    root.innerHTML = `
      <p class="rp-911">Water over the road? <strong>Turn around, don't drown.</strong></p>
      <h3 class="rp-h">From</h3>
      <div class="sl-days">
        <button type="button" class="sl-day" data-route-from="spot" aria-pressed="${from === "spot"}">${esc(getSpot().label)}</button>
        <button type="button" class="sl-day" data-route-from="me" aria-pressed="${from === "me"}" ${me ? "" : "disabled title=\"Use Near me first\""}>My location</button>
      </div>
      <h3 class="rp-h">To</h3>
      <div class="sl-days route-to">
        ${places.map((p) => `<button type="button" class="sl-day" data-route-to="${p.id}" aria-pressed="${to?.id === p.id}">${esc(p.name)}</button>`).join("")}
        <button type="button" class="sl-day" data-route-tap aria-pressed="${to?.id === "tap"}">${to?.id === "tap" ? "Spot on the map" : "Tap the map…"}</button>
      </div>
      ${places.length ? "" : `<p class="near-note">Save places in My places to pick them here.</p>`}
      ${busy ? `<p class="near-note">Checking the route…</p>` : result ? resultHTML() : ""}
      <p class="sheet-small">Checks NWS warnings and neighbor reports only. It can't see every flooded street, closures or traffic. Routing: OSRM, OpenStreetMap data.</p>`;
  }

  function resultHTML() {
    if (result.error) return `<p class="near-note">${esc(result.error)}</p>`;
    const { miles, mins, alerts, roads, dest } = result;
    const o = fromPoint();
    const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${o[1].toFixed(5)},${o[0].toFixed(5)}&destination=${dest[1].toFixed(5)},${dest[0].toFixed(5)}&travelmode=driving`;
    const bad = alerts.length || roads.some((r) => r.confirmed);
    return `
      <div class="avoid-card" data-level="${bad ? "on" : roads.length ? "some" : "none"}">
        <p class="rc-head"><span>Route check</span><span>${miles.toFixed(1)} mi · about ${Math.round(mins)} min without traffic</span></p>
        <p class="avoid-title">${alerts.length ? `Passes through ${alerts.length} warning${alerts.length > 1 ? "s" : ""}` : roads.length ? `${roads.length} reported problem${roads.length > 1 ? "s" : ""} on the way` : "Nothing reported on this route"}</p>
        ${alerts.length ? `<ul class="near-list">${alerts.map((a) => `<li class="nr-row" style="--rc:${a.color}"><span class="nr-dot"></span><span class="nr-text"><span class="nr-what">${esc(a.event)}</span><span class="nr-meta">${a.expires ? `until ${esc(new Date(a.expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}` : "NWS"}</span></span></li>`).join("")}</ul>` : ""}
        ${roads.length ? `<ul class="near-list" style="margin-top:6px">${roads.map((r) => `<li><button type="button" class="nr-row road-row${r.confirmed ? "" : " faint"}" style="--rc:#ff7a3d" data-route-spot="${r.at.join(",")}"><span class="nr-dot"></span><span class="nr-text"><span class="nr-what">${esc(r.street || "Street name not found")}${r.city ? ` <span class="road-city">${esc(r.city)}</span>` : ""}</span><span class="nr-meta">${esc(r.label)} · ${r.confirmed ? `${r.reporters} neighbors` : "1 report, unconfirmed"}</span></span><span class="road-go" aria-hidden="true">›</span></button></li>`).join("")}</ul>` : ""}
        ${bad ? "" : `<p class="near-note">That doesn't mean it's clear. Watch for water and never drive into it.</p>`}
      </div>
      <div class="near-actions">
        <a class="near-btn" href="${gmaps}" target="_blank" rel="noopener">Open in Google Maps</a>
        <button type="button" class="near-btn" data-route-clear>Clear route</button>
      </div>`;
  }

  async function check() {
    if (!to) return;
    busy = true; result = null; render();
    const o = fromPoint(), d = to.at;
    try {
      const j = await fetchJSON(`${OSRM}/${o[0].toFixed(5)},${o[1].toFixed(5)};${d[0].toFixed(5)},${d[1].toFixed(5)}?overview=full&geometries=geojson`, { timeout: 15000 });
      const r = j.routes?.[0];
      if (!r) throw new Error("No driving route found between those spots.");
      const line = r.geometry.coordinates;
      map.getSource("route")?.setData({ type: "Feature", geometry: r.geometry, properties: {} });
      // Warnings the route passes through (sample the line; one hit is enough per alert).
      const step = Math.max(1, Math.floor(line.length / 300));
      const seen = new Map();
      for (const f of getAlertsFC().features) {
        if (!f.geometry || seen.has(f.properties.id)) continue;
        for (let i = 0; i < line.length; i += step) if (contains(f.geometry, line[i])) { seen.set(f.properties.id, f.properties); break; }
      }
      const alerts = [...seen.values()].sort((a, b) => b.rank - a.rank);
      const roads = (getRoads() || [])
        .filter((x) => metersToLine(x.at, line) <= NEAR_ROUTE_M)
        .map((x) => ({ ...x, label: x.kind === "flood" ? "Flooded" : x.kind === "ice" ? "Iced" : "Blocked (storm damage)" }));
      result = { miles: r.distance / 1609.34, mins: r.duration / 60, alerts, roads, dest: d };
      const b = new maplibregl.LngLatBounds(line[0], line[0]);
      for (const c of line) b.extend(c);
      map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 600 });
    } catch (e) {
      result = { error: /Timed out|Failed to fetch|NetworkError/i.test(e.message) ? "The routing service didn't respond. Try again in a minute." : e.message };
    }
    busy = false;
    render();
  }

  root.addEventListener("click", (e) => {
    const f = e.target.closest("[data-route-from]");
    if (f && !f.disabled) { from = f.dataset.routeFrom; render(); if (to) check(); return; }
    const t = e.target.closest("[data-route-to]");
    if (t) { to = getPlaces().find((p) => p.id === t.dataset.routeTo); check(); return; }
    if (e.target.closest("[data-route-tap]")) { picking = true; closeSheet(); toast("Tap where you're going."); return; }
    const s = e.target.closest("[data-route-spot]");
    if (s) { onPick(s.dataset.routeSpot.split(",").map(Number)); return; }
    if (e.target.closest("[data-route-clear]")) { clear(); render(); }
  });

  function clear() {
    to = null; result = null;
    map.getSource("route")?.setData({ type: "FeatureCollection", features: [] });
  }

  return {
    open(place) {
      if (place) to = place;
      render();
      openSheet("route", "Check a route");
      if (place) check();
    },
    // The map's click handler asks first, so a tap can set the destination.
    takeClick(lngLat) {
      if (!picking) return false;
      picking = false;
      to = { id: "tap", at: lngLat };
      render();
      openSheet("route", "Check a route");
      check();
      return true;
    },
    layerIds: ["route-case", "route-line"],
  };
}

export { milesBetween };
