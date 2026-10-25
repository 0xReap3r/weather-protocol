// "Rain totals" layer: how much rain has fallen in the last 1 hour, 24 hours or 3 days, from the
// NWS Multi-Radar Multi-Sensor (MRMS) radar estimates (1 km, updated hourly), via NOAA's
// mapservices ImageServer. Map colors and legend come from NOAA's own rendering, so they match.
// County labels show the average and the most rain anywhere in the county.
import { fetchJSON } from "./data/fetch.js";
import { loadCounties } from "./data/counties.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const B = "https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer";
export const PERIODS = [
  { id: "1h", label: "1 hour", rf: "rft_1hr", item: "conus_QPE_01H" },
  { id: "24h", label: "24 hours", rf: "rft_24hr", item: "conus_QPE_24H" },
  { id: "72h", label: "3 days", rf: "rft_72hr", item: "conus_QPE_72H" },
];
const enc = (o) => encodeURIComponent(JSON.stringify(o));
const hourStamp = () => new Date().toISOString().slice(0, 13);
const tiles = (p) =>
  [`${B}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&renderingRule=${enc({ rasterFunction: p.rf })}&f=image&t=${hourStamp()}`];
const inches = (v) => (v == null ? "—" : v < 0.01 ? "0" : v < 1 ? v.toFixed(2).replace(/^0/, "") : v.toFixed(1));

// Rain totals at one spot, every period in one request: { "1h": in, "24h": in, "72h": in, at }
const spotCache = new Map();
export async function rainTotalsAt([lng, lat]) {
  const key = `${lng.toFixed(2)},${lat.toFixed(2)}|${hourStamp()}`;
  if (spotCache.has(key)) return spotCache.get(key);
  const p = (async () => {
    const geom = enc({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
    const j = await fetchJSON(`${B}/identify?geometry=${geom}&geometryType=esriGeometryPoint&returnCatalogItems=true&returnGeometry=false&f=json`, { timeout: 12000 });
    const names = j.catalogItems?.features?.map((f) => f.attributes.name) || [];
    const vals = j.properties?.Values || [];
    const ends = j.catalogItems?.features?.map((f) => f.attributes.idp_validendtime) || [];
    const out = { at: ends.length ? Math.max(...ends.filter(Boolean)) : null };
    for (const per of PERIODS) {
      const i = names.indexOf(per.item);
      const v = i >= 0 ? Number(vals[i]) : null;
      out[per.id] = Number.isFinite(v) && v >= 0 ? v : null;
    }
    return out;
  })().catch((e) => { spotCache.delete(key); throw e; });
  spotCache.set(key, p);
  return p;
}

export function initRainTotals({ map, metro, beforeId }) {
  let on = false, period = PERIODS[1], legend = {}, stats = {};
  let stamp = hourStamp();

  map.addSource("raintotal", { type: "raster", tiles: tiles(period), tileSize: 256,
    attribution: 'Rain totals: <a href="https://mrms.nssl.noaa.gov/" target="_blank" rel="noopener">NOAA MRMS</a>' });
  map.addLayer({ id: "raintotal", type: "raster", source: "raintotal", paint: { "raster-opacity": 0.6, "raster-fade-duration": 0 } }, beforeId);
  map.addSource("raintotal-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "raintotal-label", type: "symbol", source: "raintotal-labels", maxzoom: 11,
    layout: {
      "text-field": ["format", ["get", "name"], {}, "\n", {}, ["get", "line"], { "font-scale": 0.85 }],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": 12, "text-line-height": 1.2, "text-max-width": 14,
    },
    paint: { "text-color": ["case", [">=", ["get", "max"], 1], "#7fd4ff", "#9aa7b4"], "text-halo-color": "#0b0f14", "text-halo-width": 1.8 },
  });

  const card = document.createElement("div");
  card.className = "radar-legend storms-legend rt-legend";
  card.hidden = true;
  document.getElementById("storms-legend").after(card);

  async function loadLegend(p) {
    if (legend[p.id]) return legend[p.id];
    const j = await fetchJSON(`${B}/legend?renderingRule=${enc({ rasterFunction: p.rf })}&f=json`, { timeout: 12000 });
    const rows = j.layers?.[0]?.legend || [];
    // Show a handful of steps so the card stays small: 0.1, 0.5, 1, 2, 4, 8 in and up.
    const want = ["0.10 - 0.25", "0.50 - 1.00", "1.00 - 1.50", "2.00 - 3.00", "4.00 - 5.00", "8.00 - 10.00"];
    legend[p.id] = rows.filter((r) => want.includes(r.label)).map((r) => ({ label: r.label.split(" - ")[0].replace(/\.00$/, "").replace(/^0/, ""), img: `data:${r.contentType};base64,${r.imageData}` }));
    return legend[p.id];
  }

  async function loadStats(p) {
    const key = `${p.id}|${stamp}`;
    if (stats[key]) return stats[key];
    const counties = await loadCounties(metro);
    const mr = enc({ mosaicMethod: "esriMosaicAttribute", where: `name='${p.item}'` });
    stats[key] = await Promise.all(counties.map(async (c) => {
      try {
        const j = await fetchJSON(`${B}/computeStatisticsHistograms?geometry=${enc({ rings: c.geometry.type === "Polygon" ? c.geometry.coordinates : c.geometry.coordinates.flat(), spatialReference: { wkid: 4326 } })}&geometryType=esriGeometryPolygon&mosaicRule=${mr}&f=json`, { timeout: 15000 });
        const st = j.statistics?.[0];
        return { ...c, mean: st ? st.mean : null, max: st ? st.max : null };
      } catch (_) { return { ...c, mean: null, max: null }; }
    }));
    return stats[key];
  }

  async function render() {
    if (!on) return;
    card.innerHTML = `
      <div class="rl-head"><span class="rl-title">Rain totals</span><span class="rl-time">NOAA radar · last ${esc(period.label)}</span></div>
      <div class="sl-days" role="group" aria-label="Time period">${PERIODS.map((p) => `<button type="button" class="sl-day" data-rt="${p.id}" aria-pressed="${p.id === period.id}">${p.label}</button>`).join("")}</div>
      <ul class="rl-drops sl-levels rt-steps"><li class="on">loading…</li></ul>
      <p class="rl-note">Inches of rain estimated from radar, updated hourly. Radar can miss or overcount; local gauges are the final word.</p>`;
    const p = period;
    try {
      const lg = await loadLegend(p);
      if (p !== period || !on) return;
      card.querySelector(".rt-steps").innerHTML = lg.map((r) => `<li class="on"><img class="rt-sw" src="${r.img}" alt="">${esc(r.label)}"</li>`).join("") + "<li class=\"on\">and up</li>";
    } catch (_) {
      card.querySelector(".rt-steps").innerHTML = `<li class="on">Legend unavailable</li>`;
    }
    try {
      const rows = await loadStats(p);
      if (p !== period || !on) return;
      map.getSource("raintotal-labels")?.setData({
        type: "FeatureCollection",
        features: rows.filter((r) => r.mean != null).map((r) => ({
          type: "Feature", geometry: { type: "Point", coordinates: r.center },
          properties: { name: `${r.name.toUpperCase()} CO.`, max: r.max, line: r.max < 0.01 ? `no rain, last ${p.label}` : `${inches(r.mean)}" avg · ${inches(r.max)}" most` },
        })),
      });
    } catch (_) { /* labels are a bonus; the map layer still shows */ }
  }

  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rt]");
    if (!b) return;
    period = PERIODS.find((p) => p.id === b.dataset.rt);
    map.getSource("raintotal")?.setTiles(tiles(period));
    render();
  });

  // New estimates land a few minutes after each hour.
  setInterval(() => {
    if (hourStamp() === stamp) return;
    stamp = hourStamp();
    map.getSource("raintotal")?.setTiles(tiles(period));
    if (on) render();
  }, 5 * 60 * 1000);

  return {
    layerIds: ["raintotal", "raintotal-label"],
    onToggle(v) { on = v; card.hidden = !v; if (v) render(); },
  };
}

export { inches as formatInches };
