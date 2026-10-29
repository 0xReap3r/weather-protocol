// Low-water crossings (with the Rivers layer, zoomed in): the statewide inventory of places where
// a road dips through a creek, from the Texas Geographic Information Office / Texas Water
// Development Board. Most Texas flood deaths happen in vehicles, often at these crossings.
// We know WHERE they are, not whether they're flooded or closed: no live status exists statewide.
// So a crossing is never shown as "open" or "safe"; inside a flood warning it turns red.
import { badge, badgeSVG } from "./markers.js";
import { fetchJSON } from "./data/fetch.js";
import { contains, milesBetween } from "./near.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SVC = "https://feature.geographic.texas.gov/arcgis/rest/services/Basemap/Low_Water_Crossing/MapServer/0/query";
const CELL = 0.25;          // load in quarter-degree cells, cached for the session
const MIN_ZOOM = 10;        // map layer shows from here
const NEAR_MI = 2;
export const CROSSING_COLORS = { sign: "#f5c542", warn: "#ff4040" };
const FLOODY = /flood/i;

const TYPES = {
  "UNVENTED FORD": "Road dips through the creek bed (no culverts)",
  "VENTED FORD": "Low road over culverts; water flows over it in high water",
  "BRIDGE CLASS": "Low bridge that can go under water",
  "PEDESTRIAN CROSSING": "Low path or trail crossing",
};
const SIGNS = { GAUGE: "Depth gauge posted", ADV_WARN: "Advance warning sign", NONE: "No signs on record" };
const title = (s) => String(s || "").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Cr|Fm|Rm|Sh|Us|Ih|Pr)\b/g, (m) => m.toUpperCase());

export function crossingIconSVG(warn = false, size = 16) {
  return badgeSVG(warn ? { glyph: "crossing", ring: CROSSING_COLORS.warn, fill: "#4a1010" } : { glyph: "crossing", ring: CROSSING_COLORS.sign }, size);
}

export function initCrossings({ map, beforeId, openSheet, getAlertsFC, isOn }) {
  const cells = new Map(); // "x,y" -> Promise<features>
  let shown = [];

  map.addSource("crossings", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // Badges: a road-dipping-through-water pictogram; yellow ring normally, red inside a flood warning.
  badge(map, "lwx", { glyph: "crossing", ring: CROSSING_COLORS.sign });
  badge(map, "lwx-warn", { glyph: "crossing", ring: CROSSING_COLORS.warn, fill: "#4a1010" });
  map.addLayer({ id: "crossings-glow", type: "circle", source: "crossings", minzoom: MIN_ZOOM, filter: ["get", "warn"],
    paint: { "circle-color": CROSSING_COLORS.warn, "circle-radius": 13, "circle-blur": 1, "circle-opacity": 0.35 } }, beforeId);
  // Storm pulse: a white ring beating around a crossing inside an active flood warning.
  map.addLayer({ id: "crossings-stormpulse", type: "circle", source: "crossings", minzoom: MIN_ZOOM, filter: ["get", "warn"],
    paint: { "circle-radius": 10, "circle-color": "#ffffff", "circle-opacity": 0, "circle-stroke-width": 0 } }, beforeId);
  map.addLayer({ id: "crossings", type: "symbol", source: "crossings", minzoom: MIN_ZOOM,
    layout: {
      "icon-image": ["case", ["get", "warn"], "mk-lwx-warn", "mk-lwx"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], MIN_ZOOM, 0.75, 14, 1.1, 18, 1.3],
      "icon-allow-overlap": true, "symbol-sort-key": ["case", ["get", "warn"], 0, 1],
      "text-field": ["step", ["zoom"], "", 12.5, ["get", "road"]],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"], "text-size": 11,
      "text-offset": [0, 1.4], "text-anchor": "top", "text-optional": true,
    },
    paint: { "text-color": ["case", ["get", "warn"], "#ff9a9a", "#f2d98a"], "text-halo-color": "#0a1119", "text-halo-width": 1.6 } });
  map.on("mouseenter", "crossings", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "crossings", () => (map.getCanvas().style.cursor = ""));

  function loadCell(x, y) {
    const key = `${x},${y}`;
    if (!cells.has(key)) {
      const env = [x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL];
      cells.set(key, fetchJSON(`${SVC}?${new URLSearchParams({
        where: "1=1", geometry: env.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
        outFields: "objectid,lwx_type,owner,county,road,flowsource,location_1,signage", returnGeometry: "true", outSR: "4326", f: "geojson",
      })}`, { timeout: 15000 })
        .then((j) => (j.features || []).filter((f) => f.geometry).map((f) => {
          const p = f.properties;
          return { id: p.objectid, at: f.geometry.coordinates, type: p.lwx_type || "", owner: (p.owner || "").trim(), county: title(p.county),
            road: title(p.road) || "Unnamed road", creek: title(p.flowsource), where: title(p.location_1), sign: (p.signage || "").trim() };
        }))
        .catch(() => { cells.delete(key); return []; }));
    }
    return cells.get(key);
  }
  const cellsFor = ([w, s, e, n]) => {
    const out = [];
    for (let x = Math.floor(w / CELL); x <= Math.floor(e / CELL); x++) for (let y = Math.floor(s / CELL); y <= Math.floor(n / CELL); y++) out.push([x, y]);
    return out;
  };
  const floodAlerts = () => (getAlertsFC()?.features || []).filter((f) => FLOODY.test(f.properties.event || "") && /warning|emergency/i.test(f.properties.event || ""));
  const warnAt = (pt, alerts = floodAlerts()) => alerts.find((a) => contains(a.geometry, pt));

  let timer = null;
  async function refresh() {
    if (!isOn() || map.getZoom() < MIN_ZOOM) return;
    const b = map.getBounds();
    const want = cellsFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    if (want.length > 12) return;
    const rows = (await Promise.all(want.map(([x, y]) => loadCell(x, y)))).flat();
    const alerts = floodAlerts();
    shown = rows;
    map.getSource("crossings")?.setData({ type: "FeatureCollection", features: rows.map((c) => ({
      type: "Feature", geometry: { type: "Point", coordinates: c.at }, properties: { id: c.id, road: c.road, warn: !!warnAt(c.at, alerts) },
    })) });
  }
  map.on("moveend", () => { clearTimeout(timer); timer = setTimeout(refresh, 300); });

  function open(id) {
    const c = shown.find((x) => x.id === id) || nearCache.find((x) => x.id === id);
    if (!c) return;
    const w = warnAt(c.at);
    document.getElementById("crossing-body").innerHTML = `
      <p class="fire-kind" style="--c:${w ? CROSSING_COLORS.warn : CROSSING_COLORS.sign}">Low-water crossing${c.county ? ` · ${esc(c.county)} County` : ""}</p>
      ${w ? `<p class="near-911" style="border-color:${CROSSING_COLORS.warn}"><strong>${esc(w.properties.event)}</strong> covers this crossing. Don't drive or walk into water here. Turn around, don't drown.</p>` : ""}
      <table class="ladder fire-facts"><tbody>
        ${c.creek ? `<tr><th>Crosses</th><td>${esc(c.creek)}</td></tr>` : ""}
        ${c.where ? `<tr><th>Where</th><td>${esc(c.where)}</td></tr>` : ""}
        ${c.type ? `<tr><th>Type</th><td>${esc(TYPES[c.type] || title(c.type))}</td></tr>` : ""}
        ${SIGNS[c.sign] ? `<tr><th>Signs</th><td>${esc(SIGNS[c.sign])}</td></tr>` : ""}
        ${c.owner ? `<tr><th>Maintained by</th><td>${esc(title(c.owner))}</td></tr>` : ""}
      </tbody></table>
      <p class="near-note" style="margin-top:12px">This map doesn't know if the crossing is flooded or barricaded. Water over the road can be deeper and faster than it looks: 12 inches can float a car. Turn around, don't drown.</p>
      <p class="sheet-small">From the statewide low-water crossing inventory, Texas Geographic Information Office and Texas Water Development Board. Some crossings may be missing or since rebuilt.</p>`;
    openSheet("crossing", c.road);
  }
  map.on("click", "crossings", (e) => { const id = e.features?.[0]?.properties?.id; if (id != null) open(id); });

  // Area panel: crossings within 2 miles (loaded for the spot, chip on or off).
  let nearCache = [], nearKey = null;
  async function prepNear(pt) {
    const key = pt.map((v) => v.toFixed(2)).join(",");
    if (key === nearKey) return false;
    nearKey = key;
    const d = 0.04;
    const rows = (await Promise.all(cellsFor([pt[0] - d, pt[1] - d, pt[0] + d, pt[1] + d]).map(([x, y]) => loadCell(x, y)))).flat();
    nearCache = rows.map((c) => ({ ...c, mi: milesBetween(pt, c.at) })).filter((c) => c.mi <= NEAR_MI).sort((a, b) => a.mi - b.mi);
    return true;
  }
  // where: "top" renders only when a nearby crossing is inside a flood warning (goes under the
  // verdict); "list" renders the calm version further down, and nothing when "top" already did.
  function nearHTML(pt, where = "list") {
    if (!nearCache.length) return "";
    const alerts = floodAlerts();
    const warned = nearCache.filter((c) => warnAt(c.at, alerts));
    if ((where === "top") !== (warned.length > 0)) return "";
    // Calm version: one quiet line; the list only matters when a flood warning covers a crossing.
    if (where === "list") return `<p class="near-quiet">${crossingIconSVG(false, 14)}${nearCache.length} low-water crossing${nearCache.length === 1 ? "" : "s"} within ${NEAR_MI} mi. Never drive into water.</p>`;
    const list = (warned.length ? warned : nearCache).slice(0, 3);
    return `<h3 class="near-h">Low-water crossings<span class="near-h-note">${nearCache.length} within ${NEAR_MI} mi</span></h3>
      ${warned.length ? `<p class="near-note" style="color:#ffb3b3">${warned.length} ${warned.length === 1 ? "is" : "are"} inside a flood warning. Avoid ${warned.length === 1 ? "it" : "them"}.</p>` : ""}
      <ul class="near-list">${list.map((c) => {
        const w = warned.includes(c);
        return `<li><button type="button" class="near-alert" data-crossing="${c.id}" style="--alert:${w ? CROSSING_COLORS.warn : CROSSING_COLORS.sign}">
          <span class="na-event">${esc(c.road)}${c.creek ? `<span class="ng-gap" style="display:block;font-weight:400">over ${esc(c.creek)}</span>` : ""}</span><span class="ng-dist">${c.mi < 0.1 ? "<0.1" : c.mi.toFixed(1)} mi</span></button></li>`;
      }).join("")}</ul>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".near [data-crossing]");
    if (b) open(Number(b.dataset.crossing));
  });

  return {
    layerIds: ["crossings-glow", "crossings-stormpulse", "crossings"],
    refresh,
    prepNear,
    nearHTML,
    // Crossings in view that sit inside a flood warning (for the legend/key and debugging)
    warned: () => shown.filter((c) => warnAt(c.at)),
  };
}
