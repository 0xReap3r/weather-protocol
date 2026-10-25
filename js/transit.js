// Rail layer: DART lines and stations, with stations flagged when an official flood or tornado
// warning covers them or neighbors confirm flooding close by. A flag means "check before you go",
// never "closed" or "open": service status comes from DART only.
import { loadTransit, DART_ALERTS_URL, DART_WINTER_URL } from "./data/transit.js";
import { contains, milesBetween } from "./near.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const WARN = /Flash Flood|Flood Warning|Tornado Warning|Tornado Emergency/;
const WINTER = /Winter Storm|Ice Storm|Winter Weather|Freezing/;
const FLAG_COLOR = { warning: "#ff3b3b", water: "#4fb3ff", winter: "#c9f1ff" };

export function initTransit({ map, beforeId, getAlertsFC, getRoadCells, openSheet, onPick }) {
  let data = null;
  let flags = new Map(); // station id -> [{ type, text }]

  map.addSource("transit-lines", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("transit-stations", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "transit-line-case", type: "line", source: "transit-lines", filter: ["get", "rail"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#0b0f14", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 7] },
  }, beforeId);
  map.addLayer({
    id: "transit-line", type: "line", source: "transit-lines",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["case", ["get", "rail"], ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 4], 1.5],
      "line-opacity": 0.85,
    },
  }, beforeId);
  map.addLayer({
    id: "transit-station", type: "circle", source: "transit-stations", minzoom: 9,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["case", ["get", "flagged"], 5, 2.5], 14, ["case", ["get", "flagged"], 9, 6]],
      "circle-color": ["case", ["get", "flagged"], ["get", "flagColor"], "#e8edf2"],
      "circle-stroke-color": "#0b0f14",
      "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: "transit-station-label", type: "symbol", source: "transit-stations", minzoom: 12,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-max-width": 10,
    },
    paint: { "text-color": ["case", ["get", "flagged"], ["get", "flagColor"], "#c9d3dc"], "text-halo-color": "#0b0f14", "text-halo-width": 1.6 },
  });

  function computeFlags() {
    flags = new Map();
    if (!data) return;
    const alerts = (getAlertsFC()?.features || []).filter((f) => f.geometry);
    const water = (getRoadCells() || []).filter((c) => c.kind === "flood" && c.reporters >= 2);
    for (const s of data.stations) {
      const list = [];
      for (const a of alerts) {
        const ev = a.properties.event || "";
        if ((WARN.test(ev) || WINTER.test(ev)) && contains(a.geometry, s.at) && !list.some((x) => x.text.startsWith(ev))) {
          list.push({ type: WARN.test(ev) ? "warning" : "winter", text: `${ev} covers this station` });
        }
      }
      const wet = water.filter((c) => milesBetween(s.at, [c.cell_lng, c.cell_lat]) <= 0.3);
      if (wet.length) list.push({ type: "water", text: `Neighbors confirm flooded road${wet.length > 1 ? "s" : ""} within a few blocks` });
      if (list.length) flags.set(s.id, list);
    }
  }

  function draw() {
    if (!data) return;
    computeFlags();
    map.getSource("transit-lines")?.setData(data.lines);
    map.getSource("transit-stations")?.setData({
      type: "FeatureCollection",
      features: data.stations.map((s) => {
        const f = flags.get(s.id);
        const top = f ? (f.find((x) => x.type === "warning") || f.find((x) => x.type === "water") || f[0]).type : null;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: s.at },
          properties: { id: s.id, label: s.name.replace(/ Station$/, ""), flagged: !!f, flagColor: top ? FLAG_COLOR[top] : "#e8edf2" },
        };
      }),
    });
  }

  let loading = null;
  function ensureLoaded() {
    if (data || loading) return loading;
    loading = loadTransit()
      .then((d) => { data = d; draw(); })
      .catch(() => {})
      .finally(() => (loading = null));
    return loading;
  }

  function openStation(id) {
    const s = data?.stations.find((x) => x.id === String(id));
    if (!s) return;
    const f = flags.get(s.id) || [];
    const body = document.getElementById("station-body");
    body.innerHTML = `
      <div class="st-lines">${s.lines.map((l) => `<span class="st-line" style="--lc:${l.color}">${esc(l.line)}</span>`).join("") || '<span class="near-note">Line info unavailable</span>'}</div>
      ${f.length
        ? `<ul class="near-list st-flags">${f.map((x) => `<li class="nr-row" style="--rc:${FLAG_COLOR[x.type]}"><span class="nr-dot"></span><span class="nr-text"><span class="nr-what">${esc(x.text)}</span></span></li>`).join("")}</ul>
           <p class="near-note">Check DART before you travel. Trains can be held or replaced by buses during flooding, storms and ice.</p>`
        : `<p class="near-note">No flood or tornado warning covers this station and no neighbor has confirmed flooding nearby. That's not a service status: check DART before you travel.</p>`}
      <div class="near-actions">
        <a class="near-btn" href="${DART_ALERTS_URL}" target="_blank" rel="noopener">DART service alerts</a>
        <a class="near-btn" href="${DART_WINTER_URL}" target="_blank" rel="noopener">Winter weather plan</a>
        <button type="button" class="near-btn" data-station-pin="${s.at.join(",")}">Show this area</button>
      </div>
      <p class="sheet-small">Lines and stations from DART's published schedule data. Flags come from NWS warnings and neighbor reports, not from DART.</p>`;
    openSheet("station", s.name);
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-station-pin]");
    if (b) onPick(b.dataset.stationPin.split(",").map(Number));
  });
  map.on("mouseenter", "transit-station", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "transit-station", () => (map.getCanvas().style.cursor = ""));

  ensureLoaded(); // stations feed the side panel's flags even while the Rail layer is off

  return {
    layerIds: ["transit-line-case", "transit-line", "transit-station", "transit-station-label"],
    onToggle(on) { if (on) ensureLoaded(); },
    refresh: draw,
    openStation,
    flaggedNear(pt, miles = 1) {
      if (!data) return [];
      return data.stations
        .filter((s) => flags.has(s.id) && milesBetween(pt, s.at) <= miles)
        .map((s) => ({ ...s, flags: flags.get(s.id) }));
    },
  };
}
