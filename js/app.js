import { APP, METROS, DEFAULT_METRO } from "./config.js";
import { LAYERS, loadLayerState, saveLayerState } from "./layers.js";
import { loadAlerts, uniqueAlerts } from "./data/alerts.js";
import { loadGauges, loadStageflow, CATEGORY } from "./data/gauges.js";
import { initNearPanel } from "./near.js";
import { initRadar } from "./radar.js";
import { fimLayers, exportTiles, NFHL, NFHL_ZONES_LAYER } from "./data/floodmaps.js";

const metro = METROS[DEFAULT_METRO];
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Time helpers ---------- */
const clock = (iso) =>
  new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
function ago(iso) {
  if (!iso) return "unknown";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}

/* ---------- Branding from config (rename in one place) ---------- */
document.title = APP.name;
$("#app-name").textContent = APP.name;
$("#metro-name").textContent = metro.name;
$("#disclaimer").textContent = APP.disclaimer;

/* ---------- Map ---------- */
const map = new maplibregl.Map({
  container: "map",
  style: APP.basemapStyle,
  center: metro.center,
  zoom: metro.zoom,
  maxBounds: metro.maxBounds,
  attributionControl: { compact: true },
  pitchWithRotate: false,
  dragRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "imperial", maxWidth: 90 }), "bottom-left");

// If the page loads in a hidden tab or a zero-size window, the canvas can come up the wrong size.
const resizeMap = () => map.resize();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  resizeMap();
  refreshAll(); // catch up after the phone was locked
});
window.addEventListener("pageshow", resizeMap);

// Map layer ids behind each chip. Chips without data yet map to nothing.
const MAP_LAYERS = {
  alerts: ["alerts-fill", "alerts-line", "alerts-pulse", "alerts-label"],
  rivers: ["gauges-pulse", "gauges-circle", "gauges-label"],
  rain: [], // filled in once the radar frames are added
  zones: ["fema-zones"],
};
let radar = null;
const LABEL_FONT = ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"]; // must exist in the basemap's glyphs

// On desktop the Near-you column covers the right of the map, so offset the map's
// center to the visible area (the crosshair in CSS uses the same 372px offset).
const desktop = window.matchMedia("(min-width: 960px)");
const applyPadding = () => map.setPadding({ top: 0, bottom: 0, left: 0, right: desktop.matches ? 432 : 0 });
desktop.addEventListener("change", applyPadding);

map.on("load", () => {
  resizeMap();
  applyPadding();
  map.fitBounds(metro.bounds, { padding: 24, duration: 0 });

  // Pilot-area outline so people know where coverage starts and stops.
  const [w, s, e, n] = metro.bounds;
  map.addSource("pilot-area", {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
  });
  map.addLayer({
    id: "pilot-area-line",
    type: "line",
    source: "pilot-area",
    paint: { "line-color": "#f0b429", "line-width": 1.25, "line-opacity": 0.55, "line-dasharray": [3, 3] },
  });

  // Raster layers go under the basemap's place labels so town names stay readable.
  const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;

  // FEMA flood zones (National Flood Hazard Layer). FEMA only draws them when zoomed in.
  map.addSource("fema-zones", {
    type: "raster",
    tiles: [exportTiles(NFHL, [NFHL_ZONES_LAYER])],
    tileSize: 256,
    minzoom: 11,
    attribution: 'Flood zones: <a href="https://msc.fema.gov/" target="_blank" rel="noopener">FEMA NFHL</a>',
  });
  map.addLayer({ id: "fema-zones", type: "raster", source: "fema-zones", minzoom: 11, paint: { "raster-opacity": 0.6 } }, firstLabel);

  // Rain radar
  radar = initRadar(map, { beforeId: firstLabel, isOn: () => layerState.rain });
  MAP_LAYERS.rain = radar.layerIds;
  window.stormlineRadar = radar; // debugging aid

  // Warnings
  map.addSource("alerts", { type: "geojson", data: alertsFC });
  map.addLayer({
    id: "alerts-fill",
    type: "fill",
    source: "alerts",
    paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "storm"], 0.28, 0.14] },
  });
  map.addLayer({
    id: "alerts-line",
    type: "line",
    source: "alerts",
    paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "storm"], 2.5, 1.25], "line-opacity": 0.9 },
  });

  // Pulse ring around warnings and watches (rank 45+) so active events catch the eye.
  map.addLayer({
    id: "alerts-pulse",
    type: "line",
    source: "alerts",
    filter: [">=", ["get", "rank"], 45],
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0, "line-blur": 2 },
  });
  map.addLayer({
    id: "alerts-label",
    type: "symbol",
    source: "alerts",
    layout: {
      "text-field": ["upcase", ["get", "event"]],
      "text-font": LABEL_FONT,
      "text-size": 11,
      "text-letter-spacing": 0.06,
      "symbol-placement": "point",
      "text-max-width": 12,
      "text-allow-overlap": false,
    },
    paint: { "text-color": ["get", "color"], "text-halo-color": "#0b0f14", "text-halo-width": 2 },
  });

  // Gauges
  map.addSource("gauges", { type: "geojson", data: gaugesFC });
  // Pulse ring under gauges at action stage or higher.
  map.addLayer({
    id: "gauges-pulse",
    type: "circle",
    source: "gauges",
    filter: [">=", ["get", "rank"], 2],
    paint: { "circle-radius": 8, "circle-color": ["get", "color"], "circle-opacity": 0, "circle-stroke-width": 0 },
  });
  map.addLayer({
    id: "gauges-circle",
    type: "circle",
    source: "gauges",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 13, 10],
      "circle-color": ["get", "color"],
      "circle-opacity": ["case", ["get", "stale"], 0.45, 1],
      "circle-stroke-color": "#0b0f14",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "gauges-label",
    type: "symbol",
    source: "gauges",
    minzoom: 8,
    layout: {
      "text-field": [
        "step", ["zoom"],
        ["get", "label"],
        9.5,
        ["format", ["get", "short"], { "font-scale": 0.9 }, "\n", {}, ["get", "label"], { "font-scale": 0.85, "text-color": "#9aa7b4" }],
      ],
      "text-font": LABEL_FONT,
      "text-size": 12.5,
      "text-line-height": 1.25,
      "text-offset": [0, 1.3],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: { "text-color": "#e8edf2", "text-halo-color": "#0b0f14", "text-halo-width": 1.5 },
  });

  applyLayerVisibility();
  near?.render();
  startPulse();

  for (const id of ["gauges-circle", "alerts-fill"]) {
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }
  map.on("click", (e) => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ["gauges-circle", "alerts-fill"].filter((l) => map.getLayer(l)) });
    const gauge = hit.find((f) => f.layer.id === "gauges-circle");
    if (gauge) return openGauge(gauge.properties.lid);
    // Anywhere else (including inside a warning area): show that spot in the Near-you panel.
    near?.setPin(e.lngLat.toArray());
  });

});


map.on("error", (e) => {
  console.error("[map]", e && e.error ? e.error.message : e);
});
window.stormlineMap = map; // handy for debugging in the browser console

/* ---------- Pulse animation for active events ---------- */
// Runs only while something qualifies, and never when the reader prefers reduced motion.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let pulseRaf = null;
function pulseNeeded() {
  const g = gaugesFC.features.some((f) => f.properties.rank >= 2);
  const a = alertsFC.features.some((f) => f.properties.rank >= 45);
  return g || a;
}
function startPulse() {
  if (!map.getLayer("gauges-pulse") || pulseRaf || reduceMotion.matches || !pulseNeeded()) return;
  const t0 = performance.now();
  const frame = (now) => {
    if (!pulseNeeded()) { pulseRaf = null; return; }
    const t = ((now - t0) % 1600) / 1600; // 0 → 1 every 1.6 s
    map.setPaintProperty("gauges-pulse", "circle-radius", 8 + 18 * t);
    map.setPaintProperty("gauges-pulse", "circle-opacity", 0.55 * (1 - t));
    map.setPaintProperty("alerts-pulse", "line-width", 2 + 10 * t);
    map.setPaintProperty("alerts-pulse", "line-opacity", 0.6 * (1 - t));
    pulseRaf = requestAnimationFrame(frame);
  };
  pulseRaf = requestAnimationFrame(frame);
}

/* ---------- Data refresh ---------- */
const feeds = {}; // name -> { ok, at (Date of last success), err }
let alertsFC = { type: "FeatureCollection", features: [] };
let alertList = [];
let gauges = [];
let near = null; // "Near you" panel, created once everything below is defined
let gaugesFC = { type: "FeatureCollection", features: [] };

async function refreshAlerts() {
  try {
    alertsFC = await loadAlerts(metro);
    alertList = uniqueAlerts(alertsFC);
    map.getSource("alerts")?.setData(alertsFC);
    feeds.alerts = { ok: true, at: new Date() };
  } catch (err) {
    feeds.alerts = { ...(feeds.alerts || {}), ok: false, err: err.message };
  }
  renderBanner();
  if (currentView === "alerts") renderAlertList();
  near?.render();
  startPulse();
  updateStatus();
}

async function refreshGauges() {
  try {
    const res = await loadGauges(metro);
    gauges = res.gauges;
    gaugesFC = res.fc;
    map.getSource("gauges")?.setData(gaugesFC);
    feeds.gauges = { ok: res.failed === 0, at: new Date(), err: res.failed ? `${res.failed} gauge(s) didn't respond` : null };
    near?.render();
    startPulse();
  } catch (err) {
    feeds.gauges = { ...(feeds.gauges || {}), ok: false, err: err.message };
  }
  updateStatus();
}

let refreshing = null;
function refreshAll() {
  if (refreshing) return refreshing;
  refreshing = Promise.allSettled([refreshAlerts(), refreshGauges()]).finally(() => (refreshing = null));
  return refreshing;
}

/* ---------- Status badge ---------- */
const STATUS = {
  live: { text: "LIVE" },
  stale: { text: "DELAYED" },
  offline: { text: "OFFLINE" },
  loading: { text: "LOADING" },
};
const MAX_AGE_MS = 15 * 60 * 1000;

function updateStatus() {
  const badge = $("#status");
  const list = ["alerts", "gauges"].map((k) => feeds[k]).filter(Boolean);
  let kind, note;
  if (!navigator.onLine) {
    kind = "offline";
    note = "No connection. What you see may be out of date.";
  } else if (list.length < 2 && !list.some((f) => !f.ok)) {
    kind = "loading";
    note = "Loading live data…";
  } else {
    const oldest = Math.min(...list.map((f) => (f.at ? f.at.getTime() : 0)));
    const bad = list.find((f) => !f.ok) || (Date.now() - oldest > MAX_AGE_MS ? { err: "Data hasn't updated in over 15 minutes" } : null);
    kind = bad ? "stale" : "live";
    note = bad
      ? `${bad.err || "A data source is behind"}. Last good update ${oldest ? ago(new Date(oldest).toISOString()) : "never"}.`
      : `Updated ${ago(new Date(oldest).toISOString())}`;
  }
  badge.dataset.state = kind;
  $("#status-text").textContent = STATUS[kind].text;
  badge.title = note;
  $("#status-note").textContent = note;
}
$("#status").addEventListener("click", () => toast($("#status-note").textContent));
window.addEventListener("offline", updateStatus);
window.addEventListener("online", () => refreshAll());

/* ---------- Warnings banner ---------- */
function renderBanner() {
  const b = $("#alert-banner");
  if (!feeds.alerts) return (b.hidden = true);
  b.hidden = false;
  if (!alertList.length) {
    b.dataset.level = "none";
    b.style.removeProperty("--alert");
    b.innerHTML = `<span class="ab-dot" aria-hidden="true"></span><span>No active NWS alerts for ${esc(metro.name)}</span>`;
    return;
  }
  const top = alertList[0];
  const others = alertList.length - 1;
  b.dataset.level = "active";
  b.style.setProperty("--alert", top.color);
  b.innerHTML = `<span class="ab-dot" aria-hidden="true"></span><span class="ab-text"><strong>${esc(top.event)}</strong>${
    others ? ` <span class="ab-more">+${others} more</span>` : ""
  }</span><span class="ab-go" aria-hidden="true">›</span>`;
}
$("#alert-banner").addEventListener("click", () => openAlerts());

/* ---------- Layer chips ---------- */
const layerState = loadLayerState();
const chipRow = $("#chips");
for (const layer of LAYERS) {
  const btn = document.createElement("button");
  btn.className = "chip";
  btn.type = "button";
  btn.id = `chip-${layer.id}`;
  btn.setAttribute("aria-pressed", String(layerState[layer.id]));
  btn.innerHTML = `<span class="chip-dot" aria-hidden="true"></span>${layer.label}${
    MAP_LAYERS[layer.id] ? "" : '<span class="chip-soon">soon</span>'
  }`;
  btn.addEventListener("click", () => toggleLayer(layer.id));
  chipRow.appendChild(btn);
}

function applyLayerVisibility() {
  radar?.onToggle(!!layerState.rain);
  for (const [id, ids] of Object.entries(MAP_LAYERS)) {
    for (const l of ids) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", layerState[id] ? "visible" : "none");
  }
}
function toggleLayer(id) {
  layerState[id] = !layerState[id];
  if (id === "zones" && layerState.zones && map.getZoom() < 11) toast("Zoom in closer to see FEMA flood zones.");
  saveLayerState(layerState);
  $(`#chip-${id}`).setAttribute("aria-pressed", String(layerState[id]));
  applyLayerVisibility();
  if (currentView === "layers") renderLayerList();
}

/* ---------- Bottom sheet ---------- */
const sheet = $("#sheet");
let currentView = null;
function openSheet(view, title) {
  currentView = view;
  for (const el of sheet.querySelectorAll("[data-view]")) el.hidden = el.dataset.view !== view;
  $("#sheet-title").textContent = title;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  requestAnimationFrame(() => sheet.classList.add("open"));
}
function closeSheet() {
  currentView = null;
  sheet.classList.remove("open");
  setTimeout(() => !currentView && (sheet.hidden = true), 200);
}
$("#btn-layers").addEventListener("click", () => { renderLayerList(); openSheet("layers", "Layers"); });
$("#btn-about").addEventListener("click", () => openSheet("about", "About"));
sheet.querySelector(".sheet-close").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => e.key === "Escape" && !sheet.hidden && closeSheet());

function renderLayerList() {
  const list = $("#layer-list");
  list.innerHTML = "";
  for (const l of LAYERS) {
    const live = !!MAP_LAYERS[l.id];
    const li = document.createElement("li");
    li.innerHTML = `
      <label class="layer-row">
        <input type="checkbox" id="toggle-${l.id}" ${layerState[l.id] ? "checked" : ""}>
        <span class="layer-text">
          <span class="layer-name">${esc(l.label)}${live ? ' <span class="tag-live">Live</span>' : ""}</span>
          <span class="layer-hint">${esc(l.hint)}</span>
          <span class="layer-meta">${esc(l.source)}${live ? "" : ` · coming in Phase ${l.phase}`}</span>
        </span>
      </label>`;
    li.querySelector("input").addEventListener("change", () => toggleLayer(l.id));
    list.appendChild(li);
  }
}

/* ---------- Alerts sheet ---------- */
function openAlerts(focusId) {
  renderAlertList(focusId);
  openSheet("alerts", alertList.length ? `${alertList.length} active alert${alertList.length > 1 ? "s" : ""}` : "Alerts");
}
function renderAlertList(focusId) {
  const el = $("#alert-list");
  if (!alertList.length) {
    el.innerHTML = `<p class="sheet-lead">No active National Weather Service alerts for ${esc(metro.name)} right now. Checked ${esc(ago(feeds.alerts?.at?.toISOString()))}.</p>`;
    return;
  }
  el.innerHTML = alertList
    .map(
      (a) => `
    <details class="alert-item" style="--alert:${a.color}" ${a.id === focusId || (!focusId && a === alertList[0]) ? "open" : ""}>
      <summary>
        <span class="ai-swatch" aria-hidden="true"></span>
        <span class="ai-head">
          <span class="ai-event">${esc(a.event)}</span>
          <span class="ai-when">Until ${esc(clock(a.expires))}</span>
        </span>
      </summary>
      <div class="ai-body">
        <p class="ai-area">${esc(a.areaDesc)}</p>
        ${a.instruction ? `<h4>What to do</h4><p class="ai-text">${esc(a.instruction)}</p>` : ""}
        <h4>Details</h4>
        <p class="ai-text">${esc(a.description)}</p>
        <p class="ai-meta">Issued ${esc(clock(a.sent))} by ${esc(a.sender || "National Weather Service")}</p>
      </div>
    </details>`
    )
    .join("");
}

/* ---------- Gauge sheet ---------- */
async function openGauge(lid) {
  const g = gauges.find((x) => x.lid === lid);
  if (!g) return;
  const cat = CATEGORY[g.category];
  const ladder = ["major", "moderate", "minor", "action"]
    .filter((k) => g.stages[k] != null)
    .map((k) => {
      const diff = g.stage != null ? g.stages[k] - g.stage : null;
      const rel = diff == null ? "" : diff > 0 ? `${diff.toFixed(1)} ft above current` : `reached (${Math.abs(diff).toFixed(1)} ft over)`;
      return `<tr class="${diff != null && diff <= 0 ? "hit" : ""}"><th scope="row"><span class="lad-dot" style="background:${CATEGORY[k].color}"></span>${esc(CATEGORY[k].label.replace("Near flood stage", "Action stage"))}</th><td>${g.stages[k].toFixed(1)} ft</td><td>${rel}</td></tr>`;
    })
    .join("");

  $("#gauge-body").innerHTML = `
    <div class="g-now">
      <div class="g-value"><span class="g-num">${g.stage != null ? g.stage.toFixed(1) : "—"}</span><span class="g-unit">${esc(g.stageUnit)}</span></div>
      <div class="g-cat" style="--cat:${cat.color}">${esc(g.stale ? "No recent reading" : cat.label)}</div>
    </div>
    <p class="g-time">Reading from ${esc(g.observedAt ? `${clock(g.observedAt)} (${ago(g.observedAt)})` : "unknown time")}${
      g.flow != null ? ` · Flow ${esc(Math.round(g.flow * (g.flowUnit === "kcfs" ? 1000 : 1)).toLocaleString())} cfs` : ""
    }</p>
    <div id="g-chart" class="g-chart" aria-label="Water level, last 48 hours"><p class="g-loading">Loading 48-hour trend…</p></div>
    ${g.forecastStage != null ? `<p class="g-fc">NWS forecast: ${g.forecastStage.toFixed(1)} ft${g.forecastAt ? ` by ${esc(clock(g.forecastAt))}` : ""}</p>` : `<p class="g-fc">No NWS forecast issued for this gauge right now.</p>`}
    ${ladder ? `<table class="ladder"><caption>Official flood stages</caption><tbody>${ladder}</tbody></table>` : `<p class="g-fc">This ${g.kind === "lake" ? "lake" : "gauge"} has no official flood stages.</p>`}
    ${g.fimUrl ? `<section class="g-fim">
      <h4>Flood map <span class="g-fim-tag">modeled</span></h4>
      <p class="g-fim-lead">Where water would reach if the river hits each flood level. From NWS hydraulic models, not observed flooding.</p>
      <div class="g-fim-btns" role="group" aria-label="Show modeled flooding">
        <button type="button" data-fim="minor">Minor</button>
        <button type="button" data-fim="moderate">Moderate</button>
        <button type="button" data-fim="major">Major</button>
        <button type="button" data-fim="off" aria-pressed="true">Off</button>
      </div>
      <p class="g-fim-note" id="g-fim-note"></p>
    </section>` : ""}
    <p class="g-links"><a href="${esc(g.pageUrl)}" target="_blank" rel="noopener">Full NWS gauge page ↗</a></p>
    <p class="ai-meta">Source: NOAA National Water Prediction Service · ${esc(g.lid)}</p>`;
  openSheet("gauge", g.name);
  $("#gauge-body").querySelectorAll("[data-fim]").forEach((b) =>
    b.addEventListener("click", () => showInundation(g, b.dataset.fim))
  );

  try {
    const sf = await loadStageflow(lid);
    if (currentView !== "gauge") return;
    $("#g-chart").innerHTML = trendChart(sf, g);
  } catch (_) {
    $("#g-chart").innerHTML = `<p class="g-loading">Couldn't load the trend. Try again in a minute.</p>`;
  }
}

function trendChart(sf, g) {
  const pts = [...sf.observed, ...sf.forecast];
  if (pts.length < 2) return `<p class="g-loading">Not enough recent readings to chart.</p>`;
  const W = 340, H = 140, L = 34, R = 8, T = 10, B = 22;
  const t0 = Math.min(...pts.map((p) => p.t)), t1 = Math.max(...pts.map((p) => p.t));
  let v0 = Math.min(...pts.map((p) => p.v)), v1 = Math.max(...pts.map((p) => p.v));
  // Show the action/minor line if it's within reach, so the reader can see the gap.
  const lines = ["action", "minor"].map((k) => ({ k, v: g.stages[k] })).filter((x) => x.v != null && x.v <= v1 + Math.max(3, (v1 - v0) * 2));
  for (const x of lines) v1 = Math.max(v1, x.v);
  const pad = Math.max(0.5, (v1 - v0) * 0.12);
  v0 -= pad; v1 += pad;
  const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - v0) / (v1 - v0 || 1)) * (H - T - B);
  const path = (arr) => arr.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join("");
  const obs = sf.observed;
  const area = obs.length > 1 ? `${path(obs)}L${X(obs.at(-1).t).toFixed(1)} ${H - B}L${X(obs[0].t).toFixed(1)} ${H - B}Z` : "";
  const ticks = [v0 + pad, (v0 + v1) / 2, v1 - pad].map((v) => `<text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`).join("");
  const nowX = X(Date.now());
  const flood = lines
    .map((x) => `<line x1="${L}" x2="${W - R}" y1="${Y(x.v)}" y2="${Y(x.v)}" stroke="${CATEGORY[x.k].color}" stroke-dasharray="4 4" stroke-width="1"/><text x="${W - R}" y="${Y(x.v) - 4}" text-anchor="end" fill="${CATEGORY[x.k].color}">${x.k === "minor" ? "Flood stage" : "Action"} ${x.v.toFixed(0)} ft</text>`)
    .join("");
  const last = obs.at(-1);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Water level over the last 48 hours">
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="ax"/>
    ${ticks}
    ${area ? `<path d="${area}" class="area"/>` : ""}
    ${obs.length > 1 ? `<path d="${path(obs)}" class="obs"/>` : ""}
    ${sf.forecast.length > 1 ? `<path d="${path(sf.forecast)}" class="fc"/>` : ""}
    ${flood}
    ${nowX > L && nowX < W - R ? `<line x1="${nowX}" x2="${nowX}" y1="${T}" y2="${H - B}" class="now"/>` : ""}
    ${last ? `<circle cx="${X(last.t)}" cy="${Y(last.v)}" r="3.5" class="end"/>` : ""}
    <text x="${L}" y="${H - 6}">48 hr ago</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${sf.forecast.length > 1 ? "forecast" : "now"}</text>
  </svg>`;
}

/* ---------- Modeled flood extent (NWS inundation maps) ---------- */
let inundationFor = null;
async function showInundation(g, level) {
  const note = $("#g-fim-note");
  $("#gauge-body").querySelectorAll("[data-fim]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fim === level)));
  if (map.getLayer("inundation")) map.removeLayer("inundation");
  if (map.getSource("inundation")) map.removeSource("inundation");
  inundationFor = null;
  if (level === "off") { if (note) note.textContent = ""; return; }
  try {
    const { categories } = await fimLayers(g.fimUrl);
    const id = categories[level];
    if (id == null) { note.textContent = `No ${level} flood map for this gauge.`; return; }
    map.addSource("inundation", {
      type: "raster",
      tiles: [exportTiles(g.fimUrl, [id])],
      tileSize: 256,
      attribution: "Flood maps: NOAA NWS (modeled)",
    });
    map.addLayer({ id: "inundation", type: "raster", source: "inundation", paint: { "raster-opacity": 0.75 } }, "alerts-fill");
    inundationFor = g.lid;
    const stage = g.stages[level];
    note.textContent = `Showing ${level} flooding${stage != null ? ` (river at ${stage.toFixed(0)} ft)` : ""}. Today's reading: ${g.stage != null ? g.stage.toFixed(1) + " ft" : "unknown"}.`;
    map.easeTo({ center: [g.lng, g.lat], zoom: Math.max(map.getZoom(), 12) });
  } catch (_) {
    note.textContent = "Couldn't load the flood map. Try again in a minute.";
  }
}

/* ---------- Near me ---------- */
let meMarker = null;
const inBounds = ([lng, lat], [w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n;
$("#btn-locate").addEventListener("click", locateMe);
function locateMe() {
  const btn = $("#btn-locate");
  if (!("geolocation" in navigator)) return toast("Location isn't available in this browser.");
  btn.classList.add("busy");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.classList.remove("busy");
      const here = [pos.coords.longitude, pos.coords.latitude];
      if (!meMarker) {
        const el = document.createElement("div");
        el.className = "me-dot";
        el.setAttribute("aria-label", "Your location");
        meMarker = new maplibregl.Marker({ element: el });
      }
      meMarker.setLngLat(here).addTo(map);
      map.flyTo({ center: here, zoom: 13, speed: 1.6 });
      if (!inBounds(here, metro.bounds)) toast(`You're outside the ${metro.name} pilot area. Coverage there may be limited.`);
      near?.setMe(here);
    },
    (err) => {
      btn.classList.remove("busy");
      toast(err.code === err.PERMISSION_DENIED
        ? "Location is blocked. Allow it in your browser settings to use Near me."
        : "Couldn't find your location. Try again outside or with Wi-Fi on.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

/* ---------- Install as app (PWA) ---------- */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  $("#btn-install").hidden = false;
});
$("#btn-install").addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  $("#btn-install").hidden = true;
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

updateStatus();

near = initNearPanel({
  map,
  metro,
  getAlertsFC: () => alertsFC,
  getGauges: () => gauges,
  openGauge,
  openAlerts,
  locate: locateMe,
});
window.stormlineNear = near; // debugging aid
// Debug: stormlineDemo() paints a fake flood-stage gauge + warning so you can see pulsing. Reload to clear.
window.stormlineDemo = () => {
  const g = gaugesFC.features[0];
  if (g) { g.properties = { ...g.properties, rank: 3, color: CATEGORY.minor.color, label: "31.2 ft · flood 30" }; map.getSource("gauges")?.setData(gaugesFC); }
  const [lng, lat] = map.getCenter().toArray(), d = 0.08;
  alertsFC = { type: "FeatureCollection", features: [...alertsFC.features, { type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] },
    properties: { id: "demo", event: "Flash Flood Warning (demo)", color: "#e0352b", rank: 85, storm: true, headline: "Demo", areaDesc: "Demo area", expires: new Date(Date.now() + 3600e3).toISOString(), sent: new Date().toISOString(), description: "Demo only.", instruction: "" } }] };
  map.getSource("alerts")?.setData(alertsFC);
  startPulse(); near?.render();
  return "Demo on — reload the page to clear it";
};

// A shared link like #at=32.78,-96.80 opens with a pin on that spot.
const atMatch = location.hash.match(/^#at=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
if (atMatch) {
  const pt = [Number(atMatch[2]), Number(atMatch[1])];
  map.once("load", () => { map.jumpTo({ center: pt, zoom: 13 }); near.setPin(pt); });
}

// Data loads right away — it doesn't wait for the map. The map draws whatever has arrived
// once it's ready (see addSource above), so the banner and status work even on a slow map.
refreshAll();
setInterval(refreshAlerts, metro.refresh.alertsMs);
setInterval(refreshGauges, metro.refresh.gaugesMs);
setInterval(updateStatus, 30000); // ages "x min ago" and flips to DELAYED if a feed stalls
