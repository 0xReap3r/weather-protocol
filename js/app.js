import { isEs, setLang, t, eventName } from "./i18n.js"; // first: Spanish mode translates everything rendered after this
import { APP } from "./config.js";
import { createRegion } from "./region.js";
import { LAYERS, loadLayerState, saveLayerState } from "./layers.js";
import { loadAlerts, uniqueAlerts } from "./data/alerts.js";
import { loadGauges, loadStageflow, loadGaugeDetail, gaugeFeatures, CATEGORY } from "./data/gauges.js";
import { loadCounties } from "./data/counties.js";
import { initNearPanel } from "./near.js";
import { initRadar } from "./radar.js";
import { renderKey } from "./key.js";
import { initOutlook } from "./outlook.js";
import { initReports } from "./reports.js";
import { initTransit } from "./transit.js";
import { initStorms } from "./storms.js";
import { initFires } from "./fires.js";
import { initTropical } from "./tropical.js";
import { initLakes } from "./lakes.js";
import { initCrossings } from "./crossings.js";
import { initMenu } from "./menu.js";
import { initSearch } from "./search.js";
import { badge, ICON_SIZE } from "./markers.js";
import { initSatellite } from "./satellite.js";
import { initFeed } from "./feed.js";
import { initPlaces } from "./places.js";
import { initRoute } from "./route.js";
import { initGrid } from "./grid.js";
import { initLegends } from "./legends.js";
import { initPush } from "./push.js";
import { initRainTotals, rainTotalsAt, formatInches } from "./raintotals.js";
import { contains, milesBetween } from "./near.js";
import { fimLayers, exportTiles, NFHL, NFHL_ZONES_LAYER } from "./data/floodmaps.js";

// Phase 9: one Texas map; `metro` describes the region nearest the map center (see region.js).
const metro = createRegion();
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
$(".mn-brand").textContent = APP.name;
$("#metro-name").textContent = metro.name;
loadCounties(metro).catch(() => {}); // statewide county outlines (zone alerts, region lists, push matching)
$("#disclaimer").textContent = APP.disclaimer;

/* ---------- Map ---------- */
const map = new maplibregl.Map({
  container: "map",
  style: APP.basemapStyle,
  center: metro.center,
  zoom: metro.zoom,
  minZoom: 4.5,
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
  alerts: ["alerts-fill", "alerts-glow", "alerts-line", "alerts-pulse", "alerts-label"],
  rivers: ["gauges-pulse", "gauges-dot", "gauges-quiet", "gauges-circle", "gauges-label"],
  rain: [], // filled in once the radar frames are added
  zones: ["fema-zones"],
  transit: [], // filled in once the map is ready
  storms: [], // filled in once the map is ready
  tropical: [], // filled in once the map is ready
  fires: [], // filled in once the map is ready
  lakes: [], // filled in once the map is ready
  satflood: [], // filled in once the map is ready
  raintotal: [], // filled in once the map is ready
  grid: [], // not a map layer: the chip shows or hides the Texas grid pill
  reports: [], // filled in once the map is ready
};
let radar = null;
let reports = null; // neighbor reports, created once the map is ready
let transit = null; // DART rail, created once the map is ready
let storms = null; // SPC outlook, created once the map is ready
let fires = null, tropical = null, lakes = null, crossings = null; // NIFC wildfires and NHC tropical storms
let satellite = null, rainTotals = null; // NASA flood map and NOAA rain totals
let feed = null, places = null, route = null, push = null; // What's happened, My places, Check a route, alerts
const LABEL_FONT = ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"]; // must exist in the basemap's glyphs

// On desktop the Near-you column covers the right of the map, so offset the map's
// center to the visible area (the crosshair in CSS uses the same 372px offset).
const desktop = window.matchMedia("(min-width: 960px)");
const applyPadding = () => map.setPadding({ top: 0, bottom: 0, left: 0, right: desktop.matches ? 432 : 0 });
desktop.addEventListener("change", applyPadding);

map.on("load", () => {
  resizeMap();
  // On phones, start with the map credits folded into the (i) button so they don't cover the map.
  if (window.matchMedia("(max-width: 719px)").matches) map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  applyPadding();
  // Coverage edge: the Texas state line (Census TIGERweb), so people know where coverage stops.
  map.addSource("pilot-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  fetch(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query?where=${encodeURIComponent(`STATE='${metro.stateFips}'`)}&outFields=NAME&outSR=4326&geometryPrecision=3&maxAllowableOffset=0.01&f=geojson`)
    .then((r) => r.json()).then((fc) => map.getSource("pilot-area")?.setData(fc)).catch(() => {});
  map.addLayer({
    id: "pilot-area-line",
    type: "line",
    source: "pilot-area",
    paint: { "line-color": "#c9d6e2", "line-width": 1.1, "line-opacity": 0.4, "line-dasharray": [2, 3] },
  });

  // Blue water: the basemap draws lakes and rivers in gray; tint them so water reads as water
  // (blue means water or rain everywhere in the app).
  for (const [id, prop, color] of [
    ["water", "fill-color", "#0e2f4a"], ["waterway", "line-color", "#1d5f8f"],
    ["watername_lake", "text-color", "#6fa8d6"], ["waterway_label", "text-color", "#5f95c2"],
  ]) if (map.getLayer(id)) map.setPaintProperty(id, prop, color);

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

  // SPC severe-storm outlook (Storms chip), under everything else.
  storms = initStorms({ map, beforeId: firstLabel, metro });
  MAP_LAYERS.storms = storms.layerIds;
  window.stormlineStorms = storms; // debugging aid

  // Hurricanes (NHC + TxDOT evacuation routes) and wildfires (NIFC), Texas-season layers.
  tropical = initTropical({ map, beforeId: firstLabel, openSheet, onChange: () => near?.render() });
  MAP_LAYERS.tropical = tropical.layerIds;
  fires = initFires({ map, metro, beforeId: firstLabel, openSheet, onChange: () => near?.render() });
  MAP_LAYERS.fires = fires.layerIds;
  lakes = initLakes({ map, beforeId: firstLabel, openSheet });
  MAP_LAYERS.lakes = lakes.layerIds;
  window.stormlineTropical = tropical; window.stormlineFires = fires; window.stormlineLakes = lakes; // debugging aids

  // Rain totals (NOAA MRMS) and flood from space (NASA), under the radar drops.
  rainTotals = initRainTotals({ map, metro, beforeId: firstLabel, openSheet });
  MAP_LAYERS.raintotal = rainTotals.layerIds;
  satellite = initSatellite({ map, metro, beforeId: firstLabel, getAlertsFC: () => alertsFC });
  MAP_LAYERS.satflood = satellite.layerIds;
  window.stormlineSatellite = satellite; // debugging aid

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
    paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "storm"], 0.2, 0.1] },
  });
  // Soft glow just outside each warning edge (same treatment as the storm outlook contours).
  map.addLayer({
    id: "alerts-glow",
    type: "line",
    source: "alerts",
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["get", "storm"], 6, 3], 10, ["case", ["get", "storm"], 14, 7]],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 5, 4, 10, 10],
      "line-opacity": ["case", ["get", "storm"], 0.45, 0.25],
    },
  });
  map.addLayer({
    id: "alerts-line",
    type: "line",
    source: "alerts",
    paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "storm"], 2, 1.1], "line-opacity": 0.95 },
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
      "text-field": ["upcase", ["coalesce", ["get", "label"], ["get", "event"]]],
      "text-font": LABEL_FONT,
      "text-size": 11,
      "text-letter-spacing": 0.06,
      "symbol-placement": "point",
      "text-max-width": 12,
      "text-allow-overlap": false,
    },
    paint: { "text-color": ["get", "color"], "text-halo-color": "#0a1119", "text-halo-width": 2 },
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
  // Storm pulse: a white ring that beats around a gauge sitting inside an active NWS warning.
  map.addLayer({
    id: "gauges-stormpulse",
    type: "circle",
    source: "gauges",
    filter: ["get", "warn"],
    paint: { "circle-radius": 10, "circle-color": "#ffffff", "circle-opacity": 0, "circle-stroke-width": 0 },
  });
  // Gauges as badges: a river-gauge pictogram (a lake for lake levels) ringed in its flood-stage
  // color. Zoomed out, only gauges at action stage or higher get a badge; the rest are quiet dots.
  for (const [cat, c] of Object.entries(CATEGORY)) {
    badge(map, `gauge-${cat}`, { glyph: cat === "not_defined" ? "lake" : "gauge", ring: c.color, ink: cat === "unknown" ? "#8ea2b6" : "#f2f6fa" });
  }
  map.addLayer({
    id: "gauges-dot", type: "circle", source: "gauges", maxzoom: 9, filter: ["<", ["get", "rank"], 2],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.8, 8.9, 3.2],
      "circle-color": ["get", "color"], "circle-opacity": ["case", ["get", "stale"], 0.35, 0.8],
      "circle-stroke-color": "#0a1119", "circle-stroke-width": 1,
    },
  });
  const gaugeIcon = { "icon-image": ["concat", "mk-gauge-", ["get", "cat"]], "icon-size": ICON_SIZE, "icon-allow-overlap": true, "symbol-sort-key": ["-", 0, ["get", "rank"]] };
  map.addLayer({ id: "gauges-quiet", type: "symbol", source: "gauges", minzoom: 9, filter: ["<", ["get", "rank"], 2],
    layout: gaugeIcon, paint: { "icon-opacity": ["case", ["get", "stale"], 0.45, 1] } });
  map.addLayer({ id: "gauges-circle", type: "symbol", source: "gauges", filter: [">=", ["get", "rank"], 2],
    layout: { ...gaugeIcon, "icon-size": ["interpolate", ["linear"], ["zoom"], 5, 0.82, 9, 1.02, 13, 1.22, 17, 1.4] },
    paint: { "icon-opacity": ["case", ["get", "stale"], 0.45, 1] } });
  map.addLayer({
    id: "gauges-label",
    type: "symbol",
    source: "gauges",
    minzoom: 9,
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
      "text-offset": [0, 1.55],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: { "text-color": "#e8edf2", "text-halo-color": "#0a1119", "text-halo-width": 1.5 },
  });

  // Low-water crossings ride with the Rivers chip, zoomed in (statewide TxGIO inventory).
  crossings = initCrossings({ map, beforeId: "gauges-circle", openSheet, getAlertsFC: () => alertsFC, isOn: () => !!layerState.rivers });
  MAP_LAYERS.rivers = [...MAP_LAYERS.rivers, ...crossings.layerIds];
  window.stormlineCrossings = crossings; // debugging aid

  // DART rail sits under warnings' labels but above the shading.
  transit = initTransit({
    map,
    beforeId: "alerts-label",
    getAlertsFC: () => alertsFC,
    getRoadCells: () => reports?.getCells(),
    openSheet,
    onPick: pickSpot,
  });
  MAP_LAYERS.transit = transit.layerIds;
  window.stormlineTransit = transit; // debugging aid

  // Neighbor reports draw on top of official layers.
  reports = initReports({
    map,
    metro,
    openSheet,
    closeSheet,
    toast,
    getSpot: () => near.getSpot(),
    onChange: () => { near?.render(); transit?.refresh(); },
    onPick: pickSpot,
  });
  MAP_LAYERS.reports = reports.layerIds;
  window.stormlineReports = reports; // debugging aid

  // What's happened, My places and Check a route (the route line draws on top of everything).
  feed = initFeed({
    metro,
    getGauges: () => gauges,
    getReports: () => ({ cells: reports.getCells(), roads: reports.roads() }),
    openSheet, openAlerts, openGauge, onPick: pickSpot,
    isActiveAlert: (id) => alertsFC.features.some((f) => f.properties.id === id),
  });
  route = initRoute({
    map, getSpot: () => near.getSpot(), getMe: () => meAt, getPlaces: () => places?.list() || [],
    getAlertsFC: () => alertsFC, getRoads: () => reports.roads(), openSheet, closeSheet, onPick: pickSpot, toast,
  });
  places = initPlaces({
    getSpot: () => near.getSpot(), getAlertsFC: () => alertsFC, getRoads: () => reports.roads(),
    openSheet, onPick: pickSpot, onRoute: (p) => route.open(p), toast,
    onChange: () => push?.sync(),
  });
  push = initPush({ metro, getPlaces: () => places.list(), toast });
  places.onRender(() => push.render());
  push.sync(); // keep the server's copy of places current
  window.stormlinePlaces = places; window.stormlineRoute = route; window.stormlineFeed = feed; // debugging aids

  applyLayerVisibility();
  near?.render();
  reports.refresh();
  startPulse();

  for (const id of ["gauges-circle", "gauges-quiet", "alerts-fill", "reports-road"]) {
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }
  map.on("click", (e) => {
    if (route?.takeClick(e.lngLat.toArray())) return; // choosing a route destination
    const hit = map.queryRenderedFeatures(e.point, { layers: ["gauges-circle", "gauges-quiet", "transit-station", "alerts-fill"].filter((l) => map.getLayer(l)) });
    const gauge = hit.find((f) => f.layer.id === "gauges-circle" || f.layer.id === "gauges-quiet");
    if (gauge) return openGauge(gauge.properties.lid);
    const lake = layerState.lakes && map.getLayer("lakes-dot") && map.queryRenderedFeatures(e.point, { layers: ["lakes-dot"] })[0];
    if (lake) return lakes.openLake(lake.properties.i);
    if (layerState.raintotal && map.getLayer("mesonet-dot") && map.queryRenderedFeatures(e.point, { layers: ["mesonet-dot"] }).length) return; // raintotals.js opens the station
    const fire = map.getLayer("fires-point") && layerState.fires && map.queryRenderedFeatures(e.point, { layers: ["fires-point"] })[0];
    if (fire) return fires.openFire(fire.properties.id);
    if (layerState.tropical && map.getLayer("trop-points") && map.queryRenderedFeatures(e.point, { layers: ["trop-points"] }).length) return; // tropical.js opens the storm
    const station = hit.find((f) => f.layer.id === "transit-station");
    if (station) return transit.openStation(station.properties.id);
    // Anywhere else (including inside a warning area): show that spot in the Near-you panel.
    near?.setPin(e.lngLat.toArray());
  });

});


map.on("error", (e) => {
  console.error("[map]", e && e.error ? e.error.message : e);
});
window.stormlineMap = map; // handy for debugging in the browser console

/* ---------- Current region follows the map center ---------- */
map.on("moveend", () => metro.setCenter(map.getCenter().toArray(), map.getZoom()));
metro.onChange(() => {
  $("#metro-name").textContent = metro.name;
  alertList = regionAlerts();
  renderBanner();
  if (currentView === "alerts") renderAlertList();
  if (currentView === "outlook") outlook.render();
  grid?.render();
  scheduleAlerts();
});
function flyToRegion(id) {
  const r = metro.regions.find((x) => x.id === id);
  const v = r ? { center: r.center, zoom: r.zoom } : metro.state.view;
  map.flyTo({ ...v, speed: 1.6 });
}

/* ---------- Pulse animation for active events ---------- */
// Runs only while something qualifies, and never when the reader prefers reduced motion.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let pulseRaf = null;
// White storm-pulse rings: one per marker layer that can sit inside an active warning.
const STORM_PULSE_LAYERS = ["gauges-stormpulse", "crossings-stormpulse", "transit-stormpulse"];
function pulseNeeded() {
  const g = gaugesFC.features.some((f) => f.properties.rank >= 2 || f.properties.warn);
  const a = alertsFC.features.some((f) => f.properties.rank >= 45);
  const x = (crossings?.warned?.().length || 0) > 0;
  const s = !!transit?.anyFlagged?.();
  return g || a || x || s;
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
    for (const id of STORM_PULSE_LAYERS) {
      if (!map.getLayer(id)) continue;
      map.setPaintProperty(id, "circle-radius", 11 + 16 * t);
      map.setPaintProperty(id, "circle-opacity", 0.9 * (1 - t));
    }
    pulseRaf = requestAnimationFrame(frame);
  };
  pulseRaf = requestAnimationFrame(frame);
}

/* ---------- Data refresh ---------- */
const feeds = {}; // name -> { ok, at (Date of last success), err }
let alertsFC = { type: "FeatureCollection", features: [] };
let alertList = [];    // alerts touching the current region (banner, alert list, fast polling)
let allAlerts = [];    // every active alert in the state
let alertBoxes = [];   // [alert id, bbox] for each drawn shape
let gauges = [];
let near = null; // "Near you" panel, created once everything below is defined
let gaugesFC = { type: "FeatureCollection", features: [] };

// A gauge "warn"s (white storm pulse) when an active warning or emergency covers its spot.
const STORM_RANK = 45; // matches the alerts-pulse threshold: warnings and emergencies, not watches/advisories
function tagGaugeWarn() {
  const storms = alertsFC.features.filter((f) => f.properties.rank >= STORM_RANK);
  for (const f of gaugesFC.features) f.properties.warn = storms.some((a) => contains(a.geometry, f.geometry.coordinates));
}

async function refreshAlerts() {
  try {
    alertsFC = await loadAlerts(metro);
    if (isEs) for (const f of alertsFC.features) f.properties.label = eventName(f.properties.event);
    allAlerts = uniqueAlerts(alertsFC);
    alertBoxes = alertsFC.features.map((f) => [f.properties.id, geomBox(f.geometry)]);
    alertList = regionAlerts();
    map.getSource("alerts")?.setData(alertsFC);
    tagGaugeWarn();
    map.getSource("gauges")?.setData(gaugesFC);
    crossings?.refresh(); // recolor crossings inside flood warnings
    feeds.alerts = { ok: true, at: new Date() };
  } catch (err) {
    feeds.alerts = { ...(feeds.alerts || {}), ok: false, err: err.message };
  }
  renderBanner();
  if (currentView === "alerts") renderAlertList();
  if (currentView === "outlook") outlook.render();
  near?.render();
  transit?.refresh();
  checkDanger();
  startPulse();
  updateStatus();
  scheduleAlerts();
}

function geomBox(g) {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c) => (typeof c[0] === "number" ? ((w = Math.min(w, c[0])), (e = Math.max(e, c[0])), (s = Math.min(s, c[1])), (n = Math.max(n, c[1]))) : c.forEach(walk));
  if (g.type === "GeometryCollection") g.geometries.forEach((x) => walk(x.coordinates)); else walk(g.coordinates);
  return [w, s, e, n];
}
function regionBox() {
  if (metro.id === metro.state.id) return metro.bounds; // zoomed out: the whole state
  const [lng, lat] = metro.center, r = metro.radius;
  const dLat = r / 111, dLng = r / (111 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}
function regionAlerts() {
  const [w, s, e, n] = regionBox();
  const ids = new Set(alertBoxes.filter(([, b]) => b[0] <= e && b[2] >= w && b[1] <= n && b[3] >= s).map(([id]) => id));
  return allAlerts.filter((a) => ids.has(a.id));
}

async function refreshGauges() {
  try {
    const res = await loadGauges(metro);
    gauges = res.gauges;
    gaugesFC = res.fc;
    tagGaugeWarn();
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
      : `Updated ${ago(new Date(oldest).toISOString())}${alertDelayMs < metro.refresh.alertsMs ? " · checking warnings every minute during active weather" : ""}`;
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
    document.documentElement.style.removeProperty("--threat");
    b.innerHTML = `<span class="ab-dot" aria-hidden="true"></span><span class="ab-text"><span class="txt-long">No active NWS alerts for ${esc(metro.name)}</span><span class="txt-short">No NWS alerts now</span></span><span class="ab-next">What's coming ›</span>`;
    return;
  }
  const top = alertList[0];
  const others = alertList.length - 1;
  b.dataset.level = "active";
  b.style.setProperty("--alert", top.color);
  document.documentElement.style.setProperty("--threat", top.color);
  b.innerHTML = `<span class="ab-dot" aria-hidden="true"></span><span class="ab-text"><strong>${esc(top.event)}</strong>${
    others ? ` <span class="ab-more">+${others} more</span>` : ""
  }</span><span class="ab-next">What's coming ›</span>`;
}
$("#alert-banner").addEventListener("click", () => openOutlook());

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
  if (layer.tier === "more") btn.dataset.tier = "more"; // shown only while switched on; the rest live in "More layers"
  btn.addEventListener("click", () => toggleLayer(layer.id));
  chipRow.appendChild(btn);
}
{
  const more = document.createElement("button");
  more.className = "chip chip-more";
  more.type = "button";
  more.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>More layers`;
  more.addEventListener("click", () => { renderLayerList(); openSheet("layers", "Layers"); });
  chipRow.appendChild(more);
}

function applyLayerVisibility() {
  radar?.onToggle(!!layerState.rain);
  transit?.onToggle(!!layerState.transit);
  storms?.onToggle(!!layerState.storms);
  tropical?.onToggle(!!layerState.tropical);
  fires?.onToggle(!!layerState.fires);
  lakes?.onToggle(!!layerState.lakes);
  grid?.render();
  satellite?.onToggle(!!layerState.satflood);
  rainTotals?.onToggle(!!layerState.raintotal);
  for (const [id, ids] of Object.entries(MAP_LAYERS)) {
    for (const l of ids) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", layerState[id] ? "visible" : "none");
  }
}
function toggleLayer(id) {
  layerState[id] = !layerState[id];
  if (id === "reports" && layerState.reports) reports?.refresh();
  if (id === "rivers" && layerState.rivers) crossings?.refresh();
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
const openAbout = () => openSheet("about", "About");
$("#btn-about").addEventListener("click", openAbout);
// One-tap language switch in the footer, labeled in the other language.
$("#btn-lang").textContent = isEs ? "English" : "Español";
$("#btn-lang").lang = isEs ? "en" : "es";
$("#btn-lang").addEventListener("click", () => setLang(isEs ? "en" : "es"));
$("#btn-key").addEventListener("click", () => { $("#key-body").innerHTML = renderKey(); openSheet("key", "Map key"); });
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
          <span class="ai-when">${t("Until")} ${esc(clock(a.expires))}</span>
        </span>
      </summary>
      <div class="ai-body">
        <p class="ai-area" translate="no">${esc(a.areaDesc)}</p>
        ${isEs ? `<p class="ai-lang">Official text from the National Weather Service, in English.</p>` : ""}
        ${a.instruction ? `<h4>What to do</h4><p class="ai-text" translate="no" lang="en">${esc(a.instruction)}</p>` : ""}
        <h4>Details</h4>
        <p class="ai-text" translate="no" lang="en">${esc(a.description)}</p>
        <p class="ai-meta">${t("Issued")} ${esc(clock(a.sent))} · ${esc(a.sender || t("National Weather Service"))}</p>
      </div>
    </details>`
    )
    .join("");
}

/* ---------- Gauge sheet ---------- */
async function openGauge(lid) {
  let g = gauges.find((x) => x.lid === lid);
  if (!g) return;
  if (g.partial) {
    // Statewide list has the reading; flood stages, forecast and flood map come from the gauge record.
    $("#gauge-body").innerHTML = `<p class="near-note">Loading ${esc(g.name)}…</p>`;
    openSheet("gauge", g.name);
    try {
      const d = await loadGaugeDetail(lid);
      g = { ...d, stage: g.stage ?? d.stage, category: g.category, observedAt: g.observedAt || d.observedAt, stale: g.stale, partial: false };
      gauges = gauges.map((x) => (x.lid === lid ? g : x));
      gaugesFC = gaugeFeatures(gauges);
      map.getSource("gauges")?.setData(gaugesFC);
    } catch (_) { /* show what the statewide list has */ }
  }
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
      if (!inBounds(here, metro.bounds)) toast(`You're outside ${metro.stateName}. Coverage there is limited for now.`);
      near?.setMe(here);
      meAt = here;
      meAtTime = Date.now();
      checkDanger();
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

/* ---------- Fast polling during active weather ---------- */
// Alerts are checked every 2 minutes normally, and every minute when a tornado, severe
// thunderstorm or flash flood warning or watch is out for the area, or SPC outlines a
// Slight risk or higher today.
const ACTIVE = /Tornado|Severe Thunderstorm|Flash Flood|Extreme Wind/;
let alertTimer = null;
let alertDelayMs = metro.refresh.alertsMs;
async function scheduleAlerts() {
  const active = alertList.some((a) => ACTIVE.test(a.event));
  const spc = storms ? await storms.levelToday([metro.center, ...metro.regionCities.map(([, lat, lng]) => [lng, lat])]) : 0;
  alertDelayMs = active || spc >= 2 ? 60 * 1000 : metro.refresh.alertsMs;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(refreshAlerts, alertDelayMs);
}
window.stormlinePolling = () => `${alertDelayMs / 1000}s`; // debugging aid

/* ---------- "You're inside the warning" ---------- */
// Uses the location from Near me only (never asked for on its own). While a dangerous
// warning is anywhere near, the location is refreshed every 2 minutes without a prompt.
const DANGER = [
  { re: /Tornado Emergency/, level: "extreme", act: "Take cover now. A confirmed, damaging tornado is heading your way. Get to the lowest floor, an interior room away from windows, and cover your head." },
  { re: /Tornado Warning/, level: "extreme", act: "Take shelter now. Go to the lowest floor, an interior room away from windows. Cover your head and neck." },
  { re: /Flash Flood Emergency/, level: "extreme", act: "Get to higher ground now. Don't drive into water. If water is rising inside, go to the highest floor, not the attic." },
  { re: /Flash Flood Warning/, level: "severe", act: "Move to higher ground. Never drive or walk into flooded roads. Turn around, don't drown." },
  { re: /Extreme Wind Warning/, level: "extreme", act: "Take shelter now in an interior room on the lowest floor, as for a tornado." },
  { re: /Severe Thunderstorm Warning/, level: "severe", act: "Get indoors and away from windows. Damaging wind or large hail is possible." },
];
let meAt = null, meAtTime = 0, lastDangerKey = "";
const dangerBar = $("#danger-bar");
function checkDanger() {
  let hit = null, nearHit = null;
  if (meAt) {
    for (const rule of DANGER) {
      for (const f of alertsFC.features) {
        if (!rule.re.test(f.properties.event || "") || !f.geometry) continue;
        if (contains(f.geometry, meAt)) { hit = { rule, f }; break; }
        if (!nearHit && f.properties.storm && milesToFeature(f, meAt) <= 5) nearHit = { rule, f };
      }
      if (hit) break;
    }
  }
  const show = hit || nearHit;
  if (!show) { dangerBar.hidden = true; lastDangerKey = ""; return; }
  const { rule, f } = show;
  const inside = !!hit;
  const until = f.properties.expires ? new Date(f.properties.expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  dangerBar.dataset.level = inside ? rule.level : "near";
  dangerBar.style.setProperty("--alert", f.properties.color || "#ff3b3b");
  dangerBar.innerHTML = `
    <span class="db-head"><strong>${esc(f.properties.event)}</strong> ${inside ? "· you're inside it" : "· within 5 miles of you"}${until ? ` · until ${esc(until)}` : ""}</span>
    <span class="db-act">${esc(inside ? rule.act : "Be ready to act. Know where you'll take shelter.")}</span>
    <span class="db-links"><button type="button" class="db-btn" data-danger-open="${esc(f.properties.id)}">Details</button><a class="db-btn" href="tel:911">Call 911</a></span>
    <span class="db-src">From your last location ${esc(ago(new Date(meAtTime).toISOString()))} · NWS</span>`;
  dangerBar.hidden = false;
  const key = `${f.properties.id}|${inside}`;
  if (key !== lastDangerKey && inside && navigator.vibrate && !reduceMotion.matches) navigator.vibrate([300, 150, 300]);
  lastDangerKey = key;
}
function milesToFeature(f, pt) {
  let best = Infinity;
  const walk = (c) => (typeof c[0] === "number" ? (best = Math.min(best, milesBetween(pt, c))) : c.forEach(walk));
  walk(f.geometry.coordinates || []);
  return best;
}
dangerBar.addEventListener("click", (e) => {
  const b = e.target.closest("[data-danger-open]");
  if (b) openAlerts(b.dataset.dangerOpen);
});
// Keep the location fresh while a dangerous warning is within 25 miles (only if Near me was used).
setInterval(() => {
  if (!meAt || document.hidden || !("geolocation" in navigator)) return;
  const close = alertsFC.features.some((f) => f.geometry && DANGER.some((r) => r.re.test(f.properties.event || "")) && milesToFeature(f, meAt) <= 25);
  if (!close) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    meAt = [pos.coords.longitude, pos.coords.latitude];
    meAtTime = Date.now();
    meMarker?.setLngLat(meAt);
    checkDanger();
  }, () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}, 2 * 60 * 1000);

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
  // "New version available": when a newer app shell takes over while this page is open,
  // offer a one-tap refresh (pages left open for days otherwise keep running old code).
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) $("#update-bar").hidden = false;
  });
  const checkForUpdate = () => navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  setInterval(() => !document.hidden && checkForUpdate(), 15 * 60 * 1000);
  document.addEventListener("visibilitychange", () => !document.hidden && checkForUpdate());
  $("#update-reload").addEventListener("click", () => location.reload());
  $("#update-later").addEventListener("click", () => ($("#update-bar").hidden = true));
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
  openAbout,
  getTopHTML: (pt) => {
    crossings?.prepNear(pt).then((changed) => changed && near?.render());
    return (tropical?.nearHTML(pt) || "") + (crossings?.nearHTML(pt, "top") || "") + (fires?.nearHTML(pt) || "");
  },
  getQuietHTML: (pt) => (crossings?.nearHTML(pt, "list") || "") + (fires?.banLine(pt) || ""),
  getReportsHTML: (pt) => rainSoFarHTML(pt) + (reports?.summaryHTML(pt) || "") + stationsHTML(pt),
});

// Rain that has already fallen at the spot (NOAA MRMS radar estimates), loaded in the background.
const rainSoFar = new Map(); // "lng,lat" (2 decimals) -> totals | "loading" | "failed"
function rainSoFarHTML(pt) {
  const key = `${pt[0].toFixed(2)},${pt[1].toFixed(2)}`;
  const v = rainSoFar.get(key);
  if (!v) {
    rainSoFar.set(key, "loading");
    rainTotalsAt(pt).then((t) => rainSoFar.set(key, t)).catch(() => rainSoFar.set(key, "failed")).finally(() => near?.render());
  }
  if (!v || v === "loading") return `<h3 class="near-h">Rain so far</h3><p class="near-note">Checking radar rain totals…</p>`;
  if (v === "failed") return `<h3 class="near-h">Rain so far</h3><p class="near-note">Rain totals are unavailable right now.</p>`;
  const when = v.at ? new Date(v.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return `<h3 class="near-h">Rain so far <span class="near-h-note">NOAA radar${when ? ` · to ${esc(when)}` : ""}</span></h3>
    <div class="near-stats rt-stats">
      <div><span class="st-l">Last hour</span><span class="st-v">${formatInches(v["1h"])}<small>in</small></span></div>
      <div><span class="st-l">24 hours</span><span class="st-v">${formatInches(v["24h"])}<small>in</small></span></div>
      <div><span class="st-l">3 days</span><span class="st-v">${formatInches(v["72h"])}<small>in</small></span></div>
    </div>`;
}
setInterval(() => rainSoFar.clear(), 30 * 60 * 1000); // estimates refresh hourly

// Rail stations near the spot that carry a warning or flooding flag.
function stationsHTML(pt) {
  const list = transit?.flaggedNear(pt, 1.5) || [];
  if (!list.length) return "";
  return `<h3 class="near-h">DART stations <span class="near-h-note">within 1.5 mi</span></h3>
    <ul class="near-list">${list.slice(0, 3).map((s) => `<li><button type="button" class="nr-row road-row" style="--rc:${s.flags.some((f) => f.type === "warning") ? "#ff3b3b" : "#4fb3ff"}" data-station-open="${esc(s.id)}">
      <span class="nr-dot"></span><span class="nr-text"><span class="nr-what">${esc(s.name)}</span><span class="nr-meta">${esc(s.flags[0].text)}</span></span><span class="road-go" aria-hidden="true">›</span></button></li>`).join("")}</ul>`;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-places-open]")) { places?.open(); return; }
  const b = e.target.closest("[data-station-open]");
  if (b) {
    if (!layerState.transit) toggleLayer("transit");
    transit?.openStation(b.dataset.stationOpen);
  }
});
// Fly to a spot and describe it in the side panel (Roads to avoid, stations).
// Search: move the map to the place and point the area panel at it.
initSearch({
  map, metro,
  onPick: (r) => {
    closeSheet();
    if (r.region) return flyToRegion(r.region);
    map.flyTo({ center: r.at, zoom: r.zoom || 11.5, speed: 1.6 });
    near?.setPin(r.at);
  },
});

function pickSpot(at) {
  closeSheet();
  map.flyTo({ center: at, zoom: Math.max(map.getZoom(), 15), speed: 1.4 });
  near?.setPin(at);
}
$("#btn-report").addEventListener("click", () => reports?.openReport());

/* ---------- What's coming (outlook) ---------- */
const outlook = initOutlook({
  metro,
  getAlertsFC: () => alertsFC,
  getGauges: () => gauges,
  getAlertCount: () => alertList.length,
  openAlerts: () => openAlerts(),
  onPickCity: (at) => {
    closeSheet();
    map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 11) });
    near.setPin(at);
  },
});
function openOutlook() {
  openSheet("outlook", "What's coming");
  outlook.render();
}
window.stormlineOutlook = outlook; // debugging aid

initLegends(); // fold legend cards (folded by default on phones)

/* ---------- Texas grid (ERCOT) ---------- */
const grid = initGrid({ isOn: () => !!layerState.grid && metro.gridErcot, isMixed: () => metro.gridMixed, openSheet });
window.stormlineGrid = grid; // debugging aid

/* ---------- Side menu ---------- */
function applyPreset(ids) {
  for (const l of LAYERS) {
    if (l.id === "grid") continue; // not live yet
    layerState[l.id] = ids.includes(l.id);
    $(`#chip-${l.id}`)?.setAttribute("aria-pressed", String(layerState[l.id]));
  }
  saveLayerState(layerState);
  applyLayerVisibility();
  if (layerState.reports) reports?.refresh();
  if (layerState.zones && map.getZoom() < 11) toast("Zoom in closer to see FEMA flood zones.");
}
const expandNear = (scrollTo) => {
  const panel = $("#near");
  panel.classList.add("expanded");
  if (scrollTo) {
    const h = [...panel.querySelectorAll(".near-h")].find((el) => el.textContent.startsWith(scrollTo));
    h?.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" });
  }
};
const feedText = (f) => (!f ? "waiting" : f.ok === false ? `problem · last good ${f.at ? ago(f.at.toISOString()) : "never"}` : `updated ${ago(f.at.toISOString())}`);
const menu = initMenu({
  getRegions: () => ({ list: metro.regions, current: metro.id }),
  onRegion: flyToRegion,
  getLayerState: () => layerState,
  applyPreset,
  canInstall: () => !!deferredInstall,
  getFeeds: () => [
    { name: "NWS warnings", ...(feeds.alerts || {}), text: `${feedText(feeds.alerts)} · every ${Math.round(alertDelayMs / 60000)} min` },
    { name: "River gauges", ...(feeds.gauges || {}), text: feedText(feeds.gauges) },
    { name: "Neighbor reports", at: null, ok: true, text: reports ? `${reports.store.mode === "live" ? "shared database" : "demo, this device"} · every 1 min` : "waiting" },
  ],
  actions: {
    toast,
    map: () => {},
    warnings: () => openAlerts(),
    feed: () => feed?.open(),
    grid: () => { if (!layerState.grid) toggleLayer("grid"); $("#grid-pill").hidden ? toast("Texas grid status is loading…") : $("#grid-pill").click(); },
    places: () => places?.open(),
    route: () => route?.open(),
    coming: () => openOutlook(),
    area: () => expandNear(),
    reports: () => expandNear("Neighbor reports"),
    avoid: () => reports?.openAvoid(),
    rail: () => { if (!layerState.transit) toggleLayer("transit"); toast("Rail is on. Tap a station for details."); },
    report: () => reports?.openReport(),
    locate: () => locateMe(),
    share: () => {
      const [lng, lat] = near.getSpot().at;
      const url = `${location.origin}${location.pathname}#at=${lat.toFixed(5)},${lng.toFixed(5)}`;
      (navigator.share ? navigator.share({ title: APP.name, url }) : navigator.clipboard.writeText(url).then(() => toast("Link copied.")))
        .catch(() => {});
    },
    layers: () => { renderLayerList(); openSheet("layers", "Layers"); },
    key: () => { $("#key-body").innerHTML = renderKey(); openSheet("key", "Map key"); },
    install: () => $("#btn-install").click(),
    guide: () => { $("#guide-body").innerHTML = menu.guideHTML(); openSheet("guide", "How to use it"); },
    news: () => { $("#news-body").innerHTML = menu.newsHTML(); openSheet("news", "What's new"); },
    about: () => openAbout(),
    status: () => openDataStatus(),
    privacy: () => window.open(isEs ? "privacy-es.html" : "privacy.html", "_blank", "noopener"),
  },
});
window.stormlineMenu = menu; // debugging aid

/* ---------- Data status (server checks every 10 minutes) ---------- */
const STATUS_API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api/status" : `${APP.apiBase}/api/status`;
async function openDataStatus() {
  const body = $("#status-body");
  body.innerHTML = `<p class="near-note">Checking…</p>`;
  openSheet("status", "Data status");
  try {
    const j = await (await fetch(STATUS_API, { cache: "no-store" })).json();
    const rows = j.sources || [];
    const bad = rows.filter((r) => !r.ok);
    body.innerHTML = `
      <p class="sheet-lead">${rows.length ? (bad.length ? `${bad.length} of ${rows.length} sources had a problem at the last check.` : `All ${rows.length} sources answered at the last check.`) : "No checks have run yet. They run every 10 minutes."}</p>
      <ul class="mn-feeds">${rows.map((r) => `<li class="${r.ok ? "" : "bad"}"><span><strong>${esc(r.source)}</strong><br><small style="color:var(--text-dim)">${esc(r.powers || "")}</small></span>
        <span>${r.ok ? `OK · ${esc(ago(r.at))}` : `${esc(r.detail || "Problem")}${r.last_ok ? ` · last OK ${esc(ago(r.last_ok))}` : ""}`}</span></li>`).join("")}</ul>
      <p class="sheet-small">Our server checks each public source every 10 minutes. When one is down, the parts of the map it powers show their last good data with its time, or say they're unavailable.</p>`;
  } catch (_) {
    body.innerHTML = `<p class="near-note">Couldn't load the status check right now.</p>`;
  }
}
window.stormlineNear = near; // debugging aid
// Debug: stormlineDemo() paints a fake flood-stage gauge + warning so you can see pulsing. Reload to clear.
window.stormlineDemo = (kind = "flood") => {
  const tornado = kind === "tornado";
  const [lng, lat] = map.getCenter().toArray(), d = 0.08;
  const g = gaugesFC.features[0];
  // Move the gauge into the fake warning so you can see the white storm pulse right away.
  if (g) { g.geometry.coordinates = [lng, lat]; g.properties = { ...g.properties, rank: 3, color: CATEGORY.minor.color, label: "31.2 ft · flood 30" }; }
  alertsFC = { type: "FeatureCollection", features: [...alertsFC.features, { type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] },
    properties: { id: "demo", event: tornado ? "Tornado Warning (demo)" : "Flash Flood Warning (demo)", color: tornado ? "#ff00ff" : "#e0352b", rank: tornado ? 95 : 85, storm: true, headline: "Demo", areaDesc: "Demo area", expires: new Date(Date.now() + 3600e3).toISOString(), sent: new Date().toISOString(), description: "Demo only.", instruction: "" } }] };
  tagGaugeWarn();
  map.getSource("gauges")?.setData(gaugesFC);
  map.getSource("alerts")?.setData(alertsFC);
  if (tornado && !meAt) { meAt = [lng, lat]; meAtTime = Date.now(); } // demo puts "you" at the map center
  startPulse(); near?.render(); transit?.refresh(); crossings?.refresh(); checkDanger();
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
scheduleAlerts();
setInterval(refreshGauges, metro.refresh.gaugesMs);
setInterval(updateStatus, 30000); // ages "x min ago" and flips to DELAYED if a feed stalls
