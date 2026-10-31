// Winter severity chip (Phase 16): NWS/WPC's Winter Storm Severity Index — the official rollup
// of how disruptive winter weather will be over the next 3 days, built for exactly the thing
// Texas gets hit by (ice first, snow second): an "Overall Impact" category (Limited/Minor/
// Moderate/Major/Extreme) plus three components (Ice Accumulation, Snow Amount, Blowing Snow)
// that drive it. Same host and query pattern as the Storms/mesoscale-discussion layers
// (mapservices.weather.noaa.gov, CORS OK, browser-direct — no Worker needed).
import { contains } from "./near.js";
import { fetchJSON } from "./data/fetch.js";
import { STATE } from "./config.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const BASE = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer";
// Days 1-3 combined layer ids. 4 = Overall Impact (drawn on the map); 9/19/27 are the components
// that explain WHY — fetched for the area panel and sheet, never drawn as their own map layers.
const LAYER = { overall: 4, snow: 9, ice: 19, blowingSnow: 27 };
const TTL = 20 * 60 * 1000; // WPC issues this ~4x/day; no need to poll like a short-fuse product

// Official WSSI color ramp (from the service's own renderer).
export const WSSI_COLORS = {
  "WINTER WEATHER AREA": "#d2dfe7", MINOR: "#faf5a3", MODERATE: "#f7962f", MAJOR: "#e61f26", EXTREME: "#7853a1",
};
const ORDER = ["WINTER WEATHER AREA", "MINOR", "MODERATE", "MAJOR", "EXTREME"];
const TITLE = { "WINTER WEATHER AREA": "Limited impact", MINOR: "Minor impacts", MODERATE: "Moderate impacts", MAJOR: "Major impacts", EXTREME: "Extreme impacts" };
const COMP_LABEL = { snow: "Snow amount", ice: "Ice accumulation", blowingSnow: "Blowing snow" };

function periodText(valid) {
  // "16Z 10/31/26 - 12Z 11/03/26" -> "through Mon 11/3"
  const m = /- (\d{2})Z (\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(valid || "");
  if (!m) return "";
  const d = new Date(`20${m[2].slice(-2)}-${m[2].split("/")[0].padStart(2, "0")}-${m[2].split("/")[1].padStart(2, "0")}T${m[1]}:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : `through ${d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" })}`;
}

export function initWssi({ map, beforeId, openSheet }) {
  let on = false, areas = [], components = { snow: [], ice: [], blowingSnow: [] }, loadedAt = null, err = null;

  map.addSource("wssi", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "wssi-fill", type: "fill", source: "wssi",
    paint: {
      "fill-color": ["match", ["get", "impact"], ...Object.entries(WSSI_COLORS).flat(), "#d2dfe7"],
      "fill-opacity": ["match", ["get", "impact"], "WINTER WEATHER AREA", 0.1, "MINOR", 0.16, "MODERATE", 0.22, 0.3],
    },
  }, beforeId);
  map.addLayer({
    id: "wssi-glow", type: "line", source: "wssi", filter: ["in", ["get", "impact"], ["literal", ["MAJOR", "EXTREME"]]],
    paint: { "line-color": ["match", ["get", "impact"], ...Object.entries(WSSI_COLORS).flat(), "#d2dfe7"], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 5, 10, 12], "line-blur": 8, "line-opacity": 0.4 },
  });
  map.addLayer({
    id: "wssi-line", type: "line", source: "wssi",
    paint: { "line-color": ["match", ["get", "impact"], ...Object.entries(WSSI_COLORS).flat(), "#d2dfe7"], "line-width": 1.2, "line-opacity": 0.85 },
  });
  map.on("mouseenter", "wssi-fill", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "wssi-fill", () => (map.getCanvas().style.cursor = ""));

  const card = document.createElement("div");
  card.id = "wssi-legend";
  card.className = "radar-legend";
  card.hidden = true;
  document.getElementById("legend-dock").append(card);

  // Nationwide service with no state attribute to filter on — a bbox is the only way to keep an
  // Extreme-impact polygon over, say, Minnesota from being reported as the worst in Texas.
  const BBOX = STATE.bounds.join(",");
  async function fetchLayer(id) {
    const url = `${BASE}/${id}/query?geometry=${encodeURIComponent(BBOX)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`
      + `&outFields=impact,valid_time&returnGeometry=true&f=geojson`;
    const j = await fetchJSON(url, { timeout: 15000 });
    return (j.features || []).filter((f) => f.geometry && f.properties?.impact);
  }

  async function load() {
    try {
      const [overall, snow, ice, blowingSnow] = await Promise.all(
        [LAYER.overall, LAYER.snow, LAYER.ice, LAYER.blowingSnow].map(fetchLayer)
      );
      areas = overall
        .filter((f) => f.properties.impact !== "WINTER WEATHER AREA") // baseline forecast domain, not a real impact
        .map((f) => ({ impact: f.properties.impact, valid: f.properties.valid_time, geometry: f.geometry }))
        .sort((a, b) => ORDER.indexOf(b.impact) - ORDER.indexOf(a.impact));
      components = { snow, ice, blowingSnow };
      err = null; loadedAt = Date.now();
    } catch (e) { err = e; }
    map.getSource("wssi")?.setData({
      type: "FeatureCollection",
      features: areas.map((a) => ({ type: "Feature", geometry: a.geometry, properties: { impact: a.impact } })),
    });
    render();
  }

  function render() {
    if (!on) return;
    const worst = areas[0];
    card.innerHTML = `
      <div class="rl-head"><span class="rl-title">Winter severity</span><span class="rl-time">${loadedAt ? "WPC" : err ? "unavailable" : "loading…"}</span></div>
      <p class="fc-head">${err && !loadedAt ? "Winter severity isn't loading right now." : !loadedAt ? "Loading…" :
        areas.length ? `${areas.length} ${areas.length === 1 ? "area" : "areas"} with winter impact · worst: ${TITLE[worst.impact]}` : "No winter impact expected across Texas right now"}</p>
      ${areas.length ? `<ul class="fc-list">${areas.slice(0, 6).map((a, i) => `<li><button type="button" class="fc-row" data-wssi="${i}" style="--c:${WSSI_COLORS[a.impact]}">
        <span class="fc-dot" aria-hidden="true"></span><span class="fc-name">${esc(TITLE[a.impact])}</span><span class="fc-meta">${esc(periodText(a.valid))}</span></button></li>`).join("")}</ul>` : ""}
      <p class="rl-note">WPC's 3-day winter outlook: how disruptive, not just how much snow. Not a warning itself.</p>`;
  }

  // Which components (ice/snow/blowing snow) are driving the impact at a point, worst first.
  function componentsAt(pt) {
    const hit = [];
    for (const key of ["ice", "snow", "blowingSnow"]) {
      const f = components[key]
        .filter((x) => x.properties.impact !== "WINTER WEATHER AREA" && contains(x.geometry, pt))
        .sort((a, b) => ORDER.indexOf(b.properties.impact) - ORDER.indexOf(a.properties.impact))[0];
      if (f) hit.push({ key, impact: f.properties.impact });
    }
    return hit.sort((a, b) => ORDER.indexOf(b.impact) - ORDER.indexOf(a.impact));
  }

  function openOne(i) {
    const a = areas[i];
    if (!a) return;
    const center = (() => {
      const pts = [];
      (function flatten(x) { if (typeof x[0] === "number") pts.push(x); else x.forEach(flatten); })(a.geometry.coordinates);
      return pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] : null;
    })();
    const drivers = center ? componentsAt(center) : [];
    document.getElementById("wssi-body").innerHTML = `
      <p class="fire-kind" style="--c:${WSSI_COLORS[a.impact]}">${esc(TITLE[a.impact])}</p>
      <p class="near-note">${esc(periodText(a.valid)) || "Next 3 days"}</p>
      ${drivers.length ? `<h3 class="rp-h">What's driving it</h3><ul class="near-list">${drivers.map((d) => `<li class="nr-row"><span class="nr-dot" style="--rc:${WSSI_COLORS[d.impact]}"></span><span class="nr-text"><span class="nr-what">${esc(COMP_LABEL[d.key])}</span><span class="nr-meta">${esc(TITLE[d.impact])}</span></span></li>`).join("")}</ul>` : ""}
      <p class="sheet-small">From NOAA's Weather Prediction Center. A 3-day outlook of likely impact, not a watch or warning — check the Warnings layer for those.</p>`;
    openSheet("wssi", "Winter severity");
  }
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-wssi]");
    if (b) {
      const i = Number(b.dataset.wssi);
      const a = areas[i];
      if (a?.geometry) {
        const pts = [];
        (function flatten(x) { if (typeof x[0] === "number") pts.push(x); else x.forEach(flatten); })(a.geometry.coordinates);
        const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
        if (lngs.length) map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: 8 });
      }
      openOne(i);
    }
  });
  map.on("click", "wssi-fill", (e) => {
    const f = e.features[0];
    if (!f) return;
    const i = areas.findIndex((a) => a.impact === f.properties.impact);
    if (i >= 0) openOne(i);
  });

  // One quiet line for the area panel: worst component covering a given point, if any.
  function nearHTML(pt) {
    const drivers = componentsAt(pt);
    if (!drivers.length) return "";
    const worst = drivers[0];
    return `<p class="near-quiet">${esc(COMP_LABEL[worst.key])} · ${esc(TITLE[worst.impact])} · next 3 days (WPC winter outlook)</p>`;
  }

  // Loads regardless of the chip being on, like fires.js's burn bans and crossings.js — so the
  // area panel's quiet line (nearHTML) works for every visitor, not just after they turn this on.
  load();
  setInterval(() => !document.hidden && load(), TTL);

  return {
    layerIds: ["wssi-fill", "wssi-glow", "wssi-line"],
    onToggle(v) { on = v; card.hidden = !v; render(); },
    nearHTML,
  };
}
