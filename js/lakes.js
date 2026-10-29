// Lakes chip: Texas's major reservoirs from the Texas Water Development Board (daily).
// Each lake is a ring filled to how full it is. What matters in a storm is a lake ABOVE its normal
// full level: it is holding flood water and dams may be releasing it downstream, so those get a
// bright ring and "X ft above full". Flood-control reservoirs (Addicks, Barker and others) sit
// empty on purpose and only fill in floods, so they show feet above their normal level instead of %.
import { loadLakes } from "./data/texas.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const LAKE_COLORS = { low: "#c08a3e", mid: "#4f8fbf", full: "#4fb3ff", over: "#7df9ff", flood: "#8ea2b6" };
const TTL = 60 * 60 * 1000;
const ft = (v) => (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)).toString();

export function initLakes({ map, beforeId, openSheet }) {
  let on = false, lakes = [], loadedAt = null, err = null;

  map.addSource("lakes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const fill = ["case", ["get", "flood"], LAKE_COLORS.flood,
    ["interpolate", ["linear"], ["coalesce", ["get", "pct"], 0], 0, LAKE_COLORS.low, 40, LAKE_COLORS.low, 70, LAKE_COLORS.mid, 95, LAKE_COLORS.full]];
  map.addLayer({ id: "lakes-over", type: "circle", source: "lakes", filter: [">", ["get", "over"], 0.05],
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 11, 10, 18], "circle-color": LAKE_COLORS.over, "circle-blur": 0.9, "circle-opacity": 0.5 } }, beforeId);
  map.addLayer({ id: "lakes-dot", type: "circle", source: "lakes",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4.5, 10, 9],
      "circle-color": fill, "circle-opacity": ["case", ["get", "stale"], 0.45, 0.95],
      "circle-stroke-color": ["case", [">", ["get", "over"], 0.05], LAKE_COLORS.over, "#0a1119"],
      "circle-stroke-width": ["case", [">", ["get", "over"], 0.05], 2.2, 1.5],
    } });
  map.addLayer({ id: "lakes-label", type: "symbol", source: "lakes", minzoom: 6.5,
    layout: {
      "text-field": ["format", ["get", "short"], {}, "\n", {}, ["get", "line"], { "font-scale": 0.85 }],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": 11.5, "text-line-height": 1.2, "text-offset": [0, 1.1], "text-anchor": "top", "text-max-width": 10, "text-optional": true,
    },
    paint: { "text-color": ["case", [">", ["get", "over"], 0.05], LAKE_COLORS.over, "#a9c7de"], "text-halo-color": "#0a1119", "text-halo-width": 1.6 } });
  map.on("mouseenter", "lakes-dot", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "lakes-dot", () => (map.getCanvas().style.cursor = ""));

  const card = document.createElement("div");
  card.id = "lakes-legend";
  card.className = "radar-legend lake-card";
  card.hidden = true;
  document.getElementById("legend-dock").append(card);

  const lineFor = (l) => l.over > 0.05 ? `${ft(l.over)} ft above full` : l.flood ? "flood control" : l.pct == null ? "no reading" : `${Math.round(l.pct)}% full`;

  async function load() {
    try {
      const rows = await loadLakes();
      const today = Date.now();
      lakes = rows.filter((l) => Number.isFinite(l.at[0])).map((l) => {
        // Flood-control-only reservoirs (no % full) have no meaningful "full" line here: never flag them.
        const floodOnly = l.flood && l.pct == null;
        const over = !floodOnly && l.elev != null && l.pool != null ? l.elev - l.pool : null;
        // The board posts once a day; more than 3 days old counts as stale.
        const stale = !l.date || today - Date.parse(`${l.date}T12:00:00`) > 3 * 86400000;
        return { ...l, dual: l.flood && !floodOnly, flood: floodOnly, over: over ?? -1, stale };
      });
      err = null; loadedAt = Date.now();
    } catch (e) { err = e; }
    map.getSource("lakes")?.setData({ type: "FeatureCollection", features: lakes.map((l, i) => ({
      type: "Feature", geometry: { type: "Point", coordinates: l.at },
      properties: { i, short: l.short, pct: l.pct, over: l.over, flood: l.flood, stale: l.stale, line: lineFor(l) },
    })) });
    render();
  }

  function render() {
    if (!on) return;
    const over = lakes.filter((l) => l.over > 0.05).sort((a, b) => b.over - a.over);
    const supply = lakes.filter((l) => !l.flood && l.pct != null);
    const avg = supply.length ? Math.round(supply.reduce((s, l) => s + l.pct, 0) / supply.length) : null;
    const date = lakes.find((l) => l.date)?.date;
    card.innerHTML = `
      <div class="rl-head"><span class="rl-title">Lakes</span><span class="rl-time">${date ? `TWDB · ${esc(new Date(`${date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" }))}` : err ? "unavailable" : "loading…"}</span></div>
      <p class="fc-head">${err && !loadedAt ? "Lake levels aren't loading right now." : !loadedAt ? "Loading lakes…" :
        over.length ? `${over.length} lake${over.length === 1 ? " is" : "s are"} above full and may be releasing water` : "No major lake is above its full level"}</p>
      ${avg != null ? `<p class="so-note">${lakes.length} major reservoirs; water-supply lakes average ${avg}% full.</p>` : ""}
      ${over.length ? `<ul class="fc-list">${over.slice(0, 4).map((l) => `<li><button type="button" class="fc-row" data-lake="${lakes.indexOf(l)}" style="--c:${LAKE_COLORS.over}">
        <span class="fc-dot" aria-hidden="true"></span><span class="fc-name">${esc(l.name)}</span><span class="fc-meta">${esc(ft(l.over))} ft above full</span></button></li>`).join("")}</ul>` : ""}
      <div class="lake-bar" aria-hidden="true"></div>
      <div class="rl-labels"><span>Low</span><span>Half</span><span>Full</span><span style="color:${LAKE_COLORS.over}">Above full</span></div>
      <p class="rl-note">Daily levels from the Texas Water Development Board. A lake above full is holding flood water; follow the river authority and NWS for releases downstream.</p>`;
  }

  function openLake(i) {
    const l = lakes[i];
    if (!l) return;
    document.getElementById("lake-body").innerHTML = `
      <p class="fire-kind" style="--c:${l.over > 0.05 ? LAKE_COLORS.over : l.flood ? LAKE_COLORS.flood : LAKE_COLORS.mid}">${l.flood ? "Flood-control reservoir" : l.dual ? "Water-supply and flood-control reservoir" : "Water-supply reservoir"}</p>
      <div class="near-stats">
        ${l.flood ? "" : `<div><span class="st-l">Full</span><span class="st-v fire-v">${l.pct == null ? "—" : Math.round(l.pct)}<small>%</small></span></div>`}
        <div><span class="st-l">Level</span><span class="st-v fire-v">${l.elev == null ? "—" : Math.round(l.elev).toLocaleString()}<small>ft</small></span></div>
        ${l.flood ? "" : `<div><span class="st-l">${l.over >= 0 ? "Above full" : "Below full"}</span><span class="st-v fire-v${l.over > 0.05 ? " lake-over" : ""}">${l.pool == null ? "—" : ft(Math.abs(l.over))}<small>ft</small></span></div>`}
      </div>
      <p class="near-note" style="margin-top:12px">${l.over > 0.05
        ? "This lake is above its normal full level and is storing flood water. Dam operators may release water downstream, raising the river below. Follow the river authority and the National Weather Service."
        : l.flood ? "Flood-control reservoirs stay mostly empty and fill only during floods, then release slowly."
        : "Below its full level, the lake can still absorb some runoff."}</p>
      <p class="sheet-small">Reading for ${esc(l.date || "unknown date")}${l.stale ? " (more than 3 days old)" : ""}. ${l.flood ? "" : `Full = top of the conservation pool (${l.pool == null ? "—" : Math.round(l.pool).toLocaleString()} ft). `}From the Texas Water Development Board, <a href="https://waterdatafortexas.org/reservoirs/statewide" target="_blank" rel="noopener">Water Data for Texas</a>.</p>`;
    openSheet("lake", l.name);
  }
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lake]");
    if (b) { const l = lakes[+b.dataset.lake]; map.flyTo({ center: l.at, zoom: Math.max(map.getZoom(), 9) }); openLake(+b.dataset.lake); }
  });

  load();
  setInterval(() => on && !document.hidden && load(), TTL);

  return {
    layerIds: ["lakes-over", "lakes-dot", "lakes-label"],
    onToggle(v) { on = v; card.hidden = !v; if (v) render(); },
    openLake,
  };
}
