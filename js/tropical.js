// Hurricanes chip: active tropical storms from the National Hurricane Center (Atlantic and
// eastern Pacific; Pacific storms often send their rain into Texas), plus TxDOT's hurricane
// evacuation routes.
//   - the forecast cone (where the center may go; impacts reach well outside it)
//   - forecast track with points colored by strength, and the track so far
//   - coastal watches and warnings drawn along the coast in NHC's colors
//   - areas NHC is watching for development over the next 7 days, by chance
// The data loads with the chip off too, so the area panel can say when a spot is in a cone.
import { fetchJSON } from "./data/fetch.js";
import { t } from "./i18n.js";
import { contains } from "./near.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const NHC = "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer";
const EVAC = "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Evacuation_Routes/FeatureServer/0/query";
const L = { outlook: 3, points: 5, track: 6, cone: 7, warn: 8, past: 11 };
const TTL = 15 * 60 * 1000;

// Strength by max sustained wind (knots), Saffir-Simpson. Same colors on the map and in the key.
export const STRENGTH = [
  { id: "TD", name: "Tropical depression", min: 0, color: "#7cc4ff" },
  { id: "TS", name: "Tropical storm", min: 34, color: "#facc15" },
  { id: "H1", name: "Category 1 hurricane", min: 64, color: "#fb923c" },
  { id: "H2", name: "Category 2 hurricane", min: 83, color: "#f97316" },
  { id: "H3", name: "Category 3 hurricane", min: 96, color: "#ef4444" },
  { id: "H4", name: "Category 4 hurricane", min: 113, color: "#e11d48" },
  { id: "H5", name: "Category 5 hurricane", min: 137, color: "#e879f9" },
];
export const COAST = {
  HWR: { name: "Hurricane warning", color: "#ff2d2d" },
  HWA: { name: "Hurricane watch", color: "#ff8fb1" },
  TWR: { name: "Tropical storm warning", color: "#3b82f6" },
  TWA: { name: "Tropical storm watch", color: "#facc15" },
};
export const OUTLOOK = { Low: "#facc15", Medium: "#fb923c", High: "#ef4444" };
export const EVAC_COLOR = "#2dd4bf";
const strength = (kt) => [...STRENGTH].reverse().find((s) => (kt ?? 0) >= s.min) || STRENGTH[0];
const mph = (kt) => (kt == null ? null : Math.round(kt * 1.15078 / 5) * 5);

// Texas and its coastal waters, for "affects Texas" checks.
const TX_BOX = [-107, 25.0, -93.0, 36.8];
const touchesTexas = (geom) => {
  const pts = geom.type === "Polygon" ? geom.coordinates.flat() : geom.type === "MultiPolygon" ? geom.coordinates.flat(2) : geom.type === "LineString" ? geom.coordinates : [];
  return pts.some(([x, y]) => x >= TX_BOX[0] && x <= TX_BOX[2] && y >= TX_BOX[1] && y <= TX_BOX[3]);
};

export function initTropical({ map, beforeId, openSheet, onChange }) {
  let on = false, loadedAt = null, err = null, evacLoaded = false;
  let data = { cone: [], points: [], track: [], past: [], warn: [], outlook: [] };
  const empty = { type: "FeatureCollection", features: [] };
  const fcOf = (features) => ({ type: "FeatureCollection", features });

  for (const id of ["trop-outlook", "trop-cone", "trop-track", "trop-past", "trop-warn", "trop-points", "evac"]) map.addSource(id, { type: "geojson", data: empty });

  // Evacuation routes sit lowest, under the storm drawing.
  map.addLayer({ id: "evac-line", type: "line", source: "evac", minzoom: 5,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": EVAC_COLOR, "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 9, 0.8], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 9, 2.2, 13, 4] } }, beforeId);
  map.addLayer({ id: "evac-label", type: "symbol", source: "evac", minzoom: 8,
    layout: { "symbol-placement": "line", "symbol-spacing": 500, "text-field": ["concat", t("Evacuation route"), " ", ["get", "label"]],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"], "text-size": 11, "text-letter-spacing": 0.04 },
    paint: { "text-color": EVAC_COLOR, "text-halo-color": "#0a1119", "text-halo-width": 1.6 } });

  // 7-day outlook areas: hatched-looking dashed outline colored by chance.
  const outlookColor = ["match", ["get", "risk"], "High", OUTLOOK.High, "Medium", OUTLOOK.Medium, OUTLOOK.Low];
  map.addLayer({ id: "trop-outlook-fill", type: "fill", source: "trop-outlook", paint: { "fill-color": outlookColor, "fill-opacity": 0.08 } }, beforeId);
  map.addLayer({ id: "trop-outlook-line", type: "line", source: "trop-outlook",
    paint: { "line-color": outlookColor, "line-width": 1.6, "line-dasharray": [2, 2], "line-opacity": 0.85 } }, beforeId);
  map.addLayer({ id: "trop-outlook-label", type: "symbol", source: "trop-outlook",
    layout: { "text-field": ["get", "label"], "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"], "text-size": 11.5, "text-max-width": 10 },
    paint: { "text-color": outlookColor, "text-halo-color": "#0a1119", "text-halo-width": 1.6 } });

  // Cone: a soft white wash with a glowing edge, so it reads as "possible path", not a hazard zone.
  map.addLayer({ id: "trop-cone-fill", type: "fill", source: "trop-cone", paint: { "fill-color": "#e9f0f6", "fill-opacity": 0.1 } }, beforeId);
  map.addLayer({ id: "trop-cone-glow", type: "line", source: "trop-cone",
    paint: { "line-color": ["get", "color"], "line-width": 10, "line-blur": 8, "line-opacity": 0.35 } }, beforeId);
  map.addLayer({ id: "trop-cone-line", type: "line", source: "trop-cone",
    paint: { "line-color": "#e9f0f6", "line-width": 1.3, "line-opacity": 0.8 } }, beforeId);
  map.addLayer({ id: "trop-past", type: "line", source: "trop-past",
    layout: { "line-cap": "round" }, paint: { "line-color": "#8ea2b6", "line-width": 2, "line-opacity": 0.7, "line-dasharray": [1, 1.5] } });
  map.addLayer({ id: "trop-track", type: "line", source: "trop-track",
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#e9f0f6", "line-width": 2, "line-opacity": 0.9 } });
  map.addLayer({ id: "trop-warn", type: "line", source: "trop-warn",
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4, 9, 8] } });
  map.addLayer({ id: "trop-points", type: "circle", source: "trop-points",
    paint: {
      "circle-color": ["get", "color"], "circle-radius": ["case", ["==", ["get", "tau"], 0], 8, 5.5],
      "circle-stroke-color": "#0a1119", "circle-stroke-width": 2,
    } });
  map.addLayer({ id: "trop-label", type: "symbol", source: "trop-points",
    layout: {
      "text-field": ["case", ["==", ["get", "tau"], 0], ["format", ["get", "name"], {}, "\n", {}, ["get", "now"], { "font-scale": 0.85 }], ["get", "when"]],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": ["case", ["==", ["get", "tau"], 0], 13, 10.5], "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true,
    },
    paint: { "text-color": ["case", ["==", ["get", "tau"], 0], "#e9f0f6", "#8ea2b6"], "text-halo-color": "#0a1119", "text-halo-width": 1.8 } });

  const card = document.createElement("div");
  card.id = "trop-legend";
  card.className = "radar-legend trop-card";
  card.hidden = true;
  document.getElementById("legend-dock").append(card);

  const q = (layer) => fetchJSON(`${NHC}/${layer}/query?${new URLSearchParams({ where: "1=1", outFields: "*", returnGeometry: "true", outSR: "4326", f: "geojson" })}`, { timeout: 15000 })
    .then((j) => (j.features || []).filter((f) => f.geometry));

  async function load() {
    try {
      const [cone, points, track, past, warn, outlook] = await Promise.all([L.cone, L.points, L.track, L.past, L.warn, L.outlook].map(q));
      data = { cone, points, track, past, warn, outlook };
      err = null; loadedAt = Date.now();
    } catch (e) { err = e; }
    const nowPt = (num) => data.points.find((p) => p.properties.stormnum === num && p.properties.tau === 0);
    map.getSource("trop-cone")?.setData(fcOf(data.cone.map((f) => ({ ...f, properties: { ...f.properties, color: strength(nowPt(f.properties.stormnum)?.properties.maxwind).color } }))));
    map.getSource("trop-track")?.setData(fcOf(data.track));
    map.getSource("trop-past")?.setData(fcOf(data.past));
    map.getSource("trop-warn")?.setData(fcOf(data.warn.map((f) => ({ ...f, properties: { ...f.properties, color: COAST[f.properties.tcww]?.color || "#e9f0f6" } }))));
    map.getSource("trop-outlook")?.setData(fcOf(data.outlook.map((f) => ({ ...f, properties: { risk: f.properties.risk7day, label: t(`${f.properties.prob7day} chance in 7 days`) } }))));
    map.getSource("trop-points")?.setData(fcOf(data.points.map((f) => {
      const p = f.properties, s = strength(p.maxwind);
      return { ...f, properties: { tau: p.tau, color: s.color, name: p.stormname, now: `${mph(p.maxwind)} mph`, when: p.datelbl || "", num: p.stormnum } };
    })));
    render();
    onChange?.();
  }

  // One summary per active storm, from its current-position point.
  const storms = () => data.points.filter((p) => p.properties.tau === 0).map((f) => {
    const p = f.properties, s = strength(p.maxwind);
    const cone = data.cone.find((c) => c.properties.stormnum === p.stormnum && c.properties.basin === p.basin);
    return { f, p, s, cone, texas: cone ? touchesTexas(cone.geometry) : false, warnTX: data.warn.some((w) => w.properties.stormnum === p.stormnum && touchesTexas(w.geometry)) };
  }).sort((a, b) => (b.texas - a.texas) || ((b.p.maxwind || 0) - (a.p.maxwind || 0)));

  function render() {
    if (!on) return;
    const list = storms();
    const areas = data.outlook.length;
    card.innerHTML = `
      <div class="rl-head"><span class="rl-title">Hurricanes</span><span class="rl-time">${loadedAt ? `NHC · ${new Date(loadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : err ? "unavailable" : "loading…"}</span></div>
      <p class="fc-head">${err && !loadedAt ? "Hurricane data isn't loading right now." : !loadedAt ? "Loading…" :
        list.some((x) => x.texas) ? "A storm's forecast cone reaches Texas" : list.length ? `${list.length} active tropical system${list.length === 1 ? "" : "s"}, none headed for Texas` : "No active tropical storms"}</p>
      ${list.length ? `<ul class="fc-list">${list.map(({ p, s, texas }) => `<li><button type="button" class="fc-row" data-storm="${esc(p.basin)}-${p.stormnum}" style="--c:${s.color}">
        <span class="fc-dot" aria-hidden="true"></span><span class="fc-name">${esc(p.stormname)}</span><span class="fc-meta">${mph(p.maxwind)} mph${texas ? " · Texas in cone" : ""}</span></button></li>`).join("")}</ul>` : ""}
      ${areas ? `<p class="so-note">${areas} area${areas === 1 ? "" : "s"} NHC is watching for development (dashed).</p>` : ""}
      <ul class="rl-drops">
        <li><span class="sl-sw" style="--c:rgba(233,240,246,.35);border:1px solid #e9f0f6"></span>Forecast cone</li>
        <li><span class="sl-sw" style="--c:${COAST.HWR.color}"></span>Hurricane warning</li>
        <li><span class="sl-sw" style="--c:${COAST.TWR.color}"></span>Tropical storm warning</li>
        ${evacLoaded ? `<li><span class="sl-sw" style="--c:${EVAC_COLOR};height:4px"></span>Evacuation route</li>` : ""}
      </ul>
      <p class="rl-note">The cone shows where the center may go. Wind, surge and flooding reach far outside it. Evacuation orders come from your county; routes from TxDOT.</p>`;
  }

  async function loadEvac() {
    if (evacLoaded) return;
    try {
      const j = await fetchJSON(`${EVAC}?${new URLSearchParams({ where: "1=1", outFields: "MAP_LABEL,ROUTE_TYPE,RTE_PRFX", returnGeometry: "true", outSR: "4326", maxAllowableOffset: "0.001", geometryPrecision: "5", f: "geojson" })}`, { timeout: 20000 });
      map.getSource("evac")?.setData(fcOf((j.features || []).map((f) => ({ ...f, properties: { label: f.properties.MAP_LABEL || "", type: f.properties.ROUTE_TYPE || "" } }))));
      evacLoaded = true;
      render();
    } catch (_) { /* routes are a bonus */ }
  }

  function openStorm(key) {
    const x = storms().find(({ p }) => `${p.basin}-${p.stormnum}` === key);
    if (!x) return;
    const { f, p, s, texas, warnTX } = x;
    map.flyTo({ center: f.geometry.coordinates, zoom: Math.min(map.getZoom(), 5) });
    const fut = data.points.filter((q) => q.properties.stormnum === p.stormnum && q.properties.basin === p.basin && q.properties.tau > 0).sort((a, b) => a.properties.tau - b.properties.tau);
    document.getElementById("trop-body").innerHTML = `
      <p class="fire-kind" style="--c:${s.color}">${esc(s.name)} · ${p.basin === "AL" ? "Atlantic" : p.basin === "EP" ? "Eastern Pacific" : esc(p.basin)}</p>
      <div class="near-stats">
        <div><span class="st-l">Winds</span><span class="st-v fire-v">${mph(p.maxwind) ?? "—"}<small>mph</small></span></div>
        <div><span class="st-l">Gusts</span><span class="st-v fire-v">${mph(p.gust) ?? "—"}<small>mph</small></span></div>
        <div><span class="st-l">Moving</span><span class="st-v fire-v">${p.tcspd != null ? Math.round(p.tcspd * 1.15078) : "—"}<small>mph</small></span></div>
      </div>
      ${texas ? `<p class="near-911" style="border-color:${s.color}">Texas is inside this storm's forecast cone${warnTX ? ", and NHC has coastal watches or warnings for Texas" : ""}. Follow your county's evacuation orders and the National Weather Service.</p>` : ""}
      ${fut.length ? `<table class="ladder"><caption>Forecast</caption><tbody>${fut.map((q) => {
        const t = strength(q.properties.maxwind);
        return `<tr><th><span class="lad-dot" style="background:${t.color}"></span>${esc(q.properties.datelbl || "")}</th><td>${esc(t.name)}</td><td>${mph(q.properties.maxwind)} mph</td></tr>`;
      }).join("")}</tbody></table>` : ""}
      <p class="sheet-small">Advisory ${esc(p.advisnum || "")} from the National Hurricane Center, ${esc(p.advdate || "")}. <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">nhc.noaa.gov</a></p>`;
    openSheet("trop", p.stormname);
  }
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-storm]");
    if (b) openStorm(b.dataset.storm);
  });
  map.on("click", "trop-points", (e) => {
    const num = e.features?.[0]?.properties?.num;
    const x = storms().find(({ p }) => p.stormnum === num);
    if (x) openStorm(`${x.p.basin}-${x.p.stormnum}`);
  });
  map.on("mouseenter", "trop-points", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "trop-points", () => (map.getCanvas().style.cursor = ""));

  // Area panel: the spot is inside a forecast cone.
  function nearHTML(pt) {
    const hit = storms().filter((x) => x.cone && contains(x.cone.geometry, pt));
    if (!hit.length) return "";
    return `<h3 class="near-h">Tropical storms</h3><ul class="near-list">${hit.map(({ p, s }) => `<li><button type="button" class="near-alert" data-storm="${esc(p.basin)}-${p.stormnum}" style="--alert:${s.color}">
      <span class="na-event">In the forecast cone of ${esc(p.stormname)}<span class="ng-gap" style="display:block;font-weight:400">${esc(s.name)}, ${mph(p.maxwind)} mph winds</span></span></button></li>`).join("")}</ul>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".near [data-storm]");
    if (b) openStorm(b.dataset.storm);
  });

  load();
  setInterval(() => !document.hidden && load(), TTL);

  return {
    layerIds: ["evac-line", "evac-label", "trop-outlook-fill", "trop-outlook-line", "trop-outlook-label", "trop-cone-fill", "trop-cone-glow", "trop-cone-line", "trop-past", "trop-track", "trop-warn", "trop-points", "trop-label"],
    onToggle(v) { on = v; card.hidden = !v; if (v) { render(); loadEvac(); } },
    nearHTML,
    storms,
  };
}
