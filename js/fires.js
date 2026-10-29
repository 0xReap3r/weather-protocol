// Fires chip: active Texas wildfires from the national interagency feed (NIFC WFIGS), the same
// source InciWeb and state agencies publish to. Points sized by acres, with mapped fire
// perimeters where crews have drawn one. Prescribed (planned) burns get their own gold
// "flame in a dashed ring" symbol and label, so they catch the eye without reading as a wildfire.
// The data loads even with the chip off: the area panel mentions a wildfire within 25 miles.
// Fire locations can lag what crews on the ground know; local evacuation orders always win.
import { fetchJSON } from "./data/fetch.js";
import { badge, badgeSVG } from "./markers.js";
import { t } from "./i18n.js";
import { milesBetween, contains } from "./near.js";
import { loadBurnBans } from "./data/texas.js";
import { loadCounties } from "./data/counties.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const WFIGS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services";
const POINTS = `${WFIGS}/WFIGS_Incident_Locations_Current/FeatureServer/0/query`;
const PERIMS = `${WFIGS}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query`;
const FIELDS = "IncidentName,IncidentSize,PercentContained,POOCounty,IncidentTypeCategory,FireDiscoveryDateTime,ModifiedOnDateTime_dt,UniqueFireIdentifier,FireCauseGeneral,FireBehaviorGeneral";
const TTL = 10 * 60 * 1000;
const NEAR_MI = 25;

export const FIRE_COLORS = { wild: "#ff5a1f", planned: "#ffc23d", perimeter: "#ff4d1f", ban: "#d9822b" };

// Map symbols (shared badge style, markers.js). Wildfire: a white flame on a solid fire-orange
// badge. Planned burn: a gold flame in a dashed gold ring ("fire kept inside a line"), so it
// stands out without ever reading as a wildfire.
const WILD_BADGE = { glyph: "flame", fill: FIRE_COLORS.wild, ring: "#ffd2b8", ink: "#fff6ec", filledGlyph: true, ringWidth: 1.4 };
const PLANNED_BADGE = { glyph: "flame", ring: FIRE_COLORS.planned, ink: FIRE_COLORS.planned, dashed: true, filledGlyph: true };
export function fireIconSVG(kind, size = 16) { return badgeSVG(kind === "planned" ? PLANNED_BADGE : WILD_BADGE, size); }
function addFireIcons(map) {
  badge(map, "fire-wild", WILD_BADGE);
  badge(map, "fire-planned", PLANNED_BADGE);
}

export function initFires({ map, metro, beforeId, openSheet, onChange }) {
  let bans = null, banCounties = []; // Texas A&M Forest Service county burn bans
  let on = false, fc = { type: "FeatureCollection", features: [] }, perims = { type: "FeatureCollection", features: [] };
  let loadedAt = null, err = null;

  // Burn bans: counties where outdoor burning is banned, a faint amber wash with a dashed edge.
  map.addSource("burnbans", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "burnban-fill", type: "fill", source: "burnbans", paint: { "fill-color": FIRE_COLORS.ban, "fill-opacity": 0.09 } }, beforeId);
  map.addLayer({ id: "burnban-line", type: "line", source: "burnbans",
    paint: { "line-color": FIRE_COLORS.ban, "line-width": 0.8, "line-opacity": 0.45, "line-dasharray": [3, 2] } }, beforeId);
  async function loadBans() {
    try {
      const [b, counties] = await Promise.all([loadBurnBans(), loadCounties(metro)]);
      bans = b;
      banCounties = counties.filter((c) => b.banned.has(String(c.geoid).slice(-3)));
      map.getSource("burnbans")?.setData({ type: "FeatureCollection", features: banCounties.map((c) => ({ type: "Feature", geometry: c.geometry, properties: { name: c.name } })) });
      render();
      onChange?.();
    } catch (_) { /* bans are a bonus */ }
  }

  map.addSource("fires", { type: "geojson", data: fc });
  map.addSource("fire-perims", { type: "geojson", data: perims });
  map.addLayer({ id: "fires-perim-fill", type: "fill", source: "fire-perims",
    paint: { "fill-color": FIRE_COLORS.perimeter, "fill-opacity": ["case", ["get", "planned"], 0.06, 0.16] } }, beforeId);
  // (MapLibre 4 can't vary dashes per feature, so planned-burn edges get their own dashed layer.)
  map.addLayer({ id: "fires-perim-line", type: "line", source: "fire-perims", filter: ["!", ["get", "planned"]],
    paint: { "line-color": FIRE_COLORS.perimeter, "line-width": 1.4, "line-opacity": 0.9 } }, beforeId);
  map.addLayer({ id: "fires-perim-planned", type: "line", source: "fire-perims", filter: ["get", "planned"],
    paint: { "line-color": FIRE_COLORS.perimeter, "line-width": 1.2, "line-opacity": 0.4, "line-dasharray": [2, 2] } }, beforeId);
  // Ember glow under every fire (gold for planned burns), bigger for bigger fires.
  addFireIcons(map);
  const acres = ["coalesce", ["get", "acres"], 0];
  map.addLayer({ id: "fires-glow", type: "circle", source: "fires",
    paint: {
      "circle-color": ["case", ["get", "planned"], FIRE_COLORS.planned, FIRE_COLORS.wild],
      "circle-radius": ["interpolate", ["linear"], acres, 0, 14, 1000, 20, 10000, 28, 100000, 38],
      "circle-blur": 1,
      "circle-opacity": ["case", ["get", "stale"], 0.1, ["get", "planned"], 0.28, 0.45],
    } });
  map.addLayer({ id: "fires-point", type: "symbol", source: "fires",
    layout: {
      "icon-image": ["case", ["get", "planned"], "mk-fire-planned", "mk-fire-wild"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, ["interpolate", ["linear"], acres, 0, 0.78, 1000, 0.95, 10000, 1.15, 100000, 1.4], 9, ["interpolate", ["linear"], acres, 0, 1, 1000, 1.18, 10000, 1.4, 100000, 1.65]],
      "icon-allow-overlap": true, "icon-ignore-placement": true,
      "symbol-sort-key": ["case", ["get", "planned"], 1, 0],
    },
    paint: { "icon-opacity": ["case", ["get", "stale"], 0.5, 1] } });
  map.addLayer({ id: "fires-label", type: "symbol", source: "fires", minzoom: 7,
    layout: {
      "text-field": ["format", ["get", "name"], {}, "\n", {}, ["get", "line"], { "font-scale": 0.85 }],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": 12, "text-line-height": 1.2, "text-offset": [0, 1.6], "text-anchor": "top", "text-max-width": 12,
    },
    paint: { "text-color": ["case", ["get", "planned"], "#ffd98a", "#ffb08a"], "text-halo-color": "#0a1119", "text-halo-width": 1.6 } });

  for (const id of ["fires-point"]) {
    map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
  }

  const card = document.createElement("div");
  card.id = "fires-legend";
  card.className = "radar-legend fire-card";
  card.hidden = true;
  document.getElementById("legend-dock").append(card);

  async function load() {
    try {
      const q = (u, extra) => `${u}?${new URLSearchParams({ where: extra, outFields: "*", returnGeometry: "true", outSR: "4326", f: "geojson" })}`;
      const [pts, per] = await Promise.all([
        fetchJSON(`${POINTS}?${new URLSearchParams({ where: "POOState='US-TX'", outFields: FIELDS, returnGeometry: "true", outSR: "4326", f: "geojson" })}`, { timeout: 15000 }),
        fetchJSON(q(PERIMS, "attr_POOState='US-TX'"), { timeout: 15000 }).catch(() => ({ features: [] })),
      ]);
      fc = {
        type: "FeatureCollection",
        features: (pts.features || []).filter((f) => f.geometry).map((f) => {
          const p = f.properties;
          const planned = p.IncidentTypeCategory === "RX" || /^rx\b/i.test(p.IncidentName || "");
          const name = String(p.IncidentName || "Unnamed fire").replace(/^rx\s+/i, "").trim();
          const contained = p.PercentContained == null || planned ? null : Math.round(p.PercentContained);
          const stale = !!p.ModifiedOnDateTime_dt && Date.now() - p.ModifiedOnDateTime_dt > 3 * 86400000;
          return {
            type: "Feature", geometry: f.geometry,
            properties: {
              id: p.UniqueFireIdentifier || name, name: t(planned ? `Planned burn: ${name}` : `${name} Fire`.replace(/ Fire Fire$/i, " Fire")),
              planned, stale, acres: p.IncidentSize, contained, county: p.POOCounty || "",
              found: p.FireDiscoveryDateTime, updated: p.ModifiedOnDateTime_dt, cause: p.FireCauseGeneral || "", behavior: p.FireBehaviorGeneral || "",
              line: t(`${acresText(p.IncidentSize)}${contained != null && !planned ? ` · ${contained}% contained` : ""}`),
            },
          };
        }).sort((a, b) => (b.properties.acres || 0) - (a.properties.acres || 0)),
      };
      perims = {
        type: "FeatureCollection",
        features: (per.features || []).filter((f) => f.geometry).map((f) => ({ type: "Feature", geometry: f.geometry,
          properties: { planned: f.properties.attr_IncidentTypeCategory === "RX", name: f.properties.attr_IncidentName } })),
      };
      err = null; loadedAt = Date.now();
    } catch (e) { err = e; }
    map.getSource("fires")?.setData(fc);
    map.getSource("fire-perims")?.setData(perims);
    render();
    onChange?.();
  }

  const wild = () => fc.features.filter((f) => !f.properties.planned);

  function render() {
    if (!on) return;
    const w = wild(), planned = fc.features.length - w.length;
    const big = w.slice(0, 3);
    card.innerHTML = `
      <div class="rl-head"><span class="rl-title">Wildfires</span><span class="rl-time">${loadedAt ? `NIFC · ${esc(ago(loadedAt))}` : err ? "unavailable" : "loading…"}</span></div>
      <p class="fc-head">${err && !loadedAt ? "Fire data isn't loading right now." : !loadedAt ? "Loading fires…" :
        w.length ? `${w.length} active wildfire${w.length === 1 ? "" : "s"} in Texas` : "No active wildfires reported in Texas"}</p>
      ${big.length ? `<ul class="fc-list">${big.map((f) => `<li><button type="button" class="fc-row" data-fire="${esc(f.properties.id)}">
        <span class="fc-dot" aria-hidden="true"></span><span class="fc-name">${esc(f.properties.name)}</span><span class="fc-meta">${esc(f.properties.line)}</span></button></li>`).join("")}</ul>` : ""}
      <ul class="fc-facts">
        <li>${fireIconSVG("planned", 14)}<span>Planned burns</span><b>${planned}</b></li>
        ${bans ? `<li><span class="ban-sw" aria-hidden="true"></span><span>Counties with a burn ban</span><b>${bans.banned.size}</b></li>` : ""}
      </ul>
      <p class="rl-note">Follow local evacuation orders; this map can lag crews.</p>`;
  }

  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fire]");
    if (b) openFire(b.dataset.fire, true);
  });

  function openFire(id, fly) {
    const f = fc.features.find((x) => x.properties.id === id);
    if (!f) return;
    const p = f.properties;
    if (fly) map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 10) });
    document.getElementById("fire-body").innerHTML = `
      <p class="fire-kind" style="--c:${p.planned ? FIRE_COLORS.planned : FIRE_COLORS.wild}">${p.planned ? "Planned burn (prescribed fire)" : "Wildfire"}${p.county ? ` · ${esc(p.county)} County` : ""}</p>
      <div class="near-stats">
        <div><span class="st-l">Size</span><span class="st-v fire-v">${p.acres == null ? "—" : Math.round(p.acres).toLocaleString()}<small>acres</small></span></div>
        ${p.planned ? "" : `<div><span class="st-l">Contained</span><span class="st-v fire-v">${p.contained == null ? "—" : p.contained}<small>${p.contained == null ? "" : "%"}</small></span></div>`}
        <div><span class="st-l">Updated</span><span class="st-v fire-v fire-ago${p.stale ? " fire-stale" : ""}">${esc(ago(p.updated) || "—")}</span></div>
      </div>
      ${p.stale ? `<p class="near-note">No update from crews in over 3 days, so this may be out of date (often a fire that is out but not yet closed).</p>` : ""}
      <table class="ladder fire-facts"><tbody>
        <tr><th>Found</th><td>${esc(when(p.found))}</td></tr>
        ${p.behavior ? `<tr><th>Fire behavior</th><td>${esc(p.behavior)}</td></tr>` : ""}
        ${p.cause ? `<tr><th>Cause</th><td>${esc(p.cause)}</td></tr>` : ""}
      </tbody></table>
      <p class="near-911">${p.planned ? "Planned burns are set on purpose by land managers and can still send smoke over roads." : "Leave when local officials say to. Don't wait for this map."} In danger now? Call <strong>911</strong>.</p>
      <p class="sheet-small">From the National Interagency Fire Center's current incident feed (WFIGS), shared with Texas A&amp;M Forest Service. Size and containment are what crews last reported and can lag. <a href="https://tfsweb.tamu.edu/" target="_blank" rel="noopener">Texas A&amp;M Forest Service</a></p>`;
    openSheet("fire", p.name);
  }

  // Area panel: a burn ban in this county, and wildfires (not planned burns) within 25 miles.
  function nearHTML(pt) {
    return firesHTML(pt);
  }
  // Burn ban for the spot's county: a quiet line lower in the panel (most of Texas has one in a dry fall).
  function banLine(pt) {
    const ban = banCounties.find((c) => contains(c.geometry, pt));
    if (!ban) return "";
    const since = bans.banned.get(String(ban.geoid).slice(-3))?.since;
    return `<p class="near-quiet"><span class="ban-sw" aria-hidden="true"></span>Burn ban in ${esc(ban.name)} County${since ? ` since ${esc(new Date(since).toLocaleDateString([], { month: "short", day: "numeric" }))}` : ""}. No outdoor burning.</p>`;
  }
  function firesHTML(pt) {
    if (!loadedAt) return "";
    const rows = wild().map((f) => ({ f, mi: milesBetween(pt, f.geometry.coordinates) })).filter((x) => x.mi <= NEAR_MI).sort((a, b) => a.mi - b.mi).slice(0, 3);
    if (!rows.length) return "";
    return `<h3 class="near-h">Wildfires nearby</h3><ul class="near-list">${rows.map(({ f, mi }) => `<li><button type="button" class="near-alert" data-fire="${esc(f.properties.id)}" style="--alert:${FIRE_COLORS.wild}">
      <span class="na-event">${esc(f.properties.name)}<span class="ng-gap" style="display:block;font-weight:400">${esc(f.properties.line)}</span></span><span class="ng-dist">${mi < 1 ? "<1" : Math.round(mi)} mi</span></button></li>`).join("")}</ul>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".near [data-fire]");
    if (b) openFire(b.dataset.fire, true);
  });

  load();
  loadBans();
  setInterval(() => !document.hidden && load(), TTL);
  setInterval(() => !document.hidden && loadBans(), 60 * 60 * 1000);

  return {
    layerIds: ["burnban-fill", "burnban-line", "fires-perim-fill", "fires-perim-line", "fires-perim-planned", "fires-glow", "fires-point", "fires-label"],
    onToggle(v) { on = v; card.hidden = !v; if (v) render(); },
    openFire: (id) => openFire(id, false),
    nearHTML,
    banLine,
    list: () => fc.features,
  };
}
