// "Flood from space" layer: NASA's near-real-time flood map (MODIS, 2-day composite, ~250 m),
// served by NASA GIBS. We recolor each tile so only flood water stands out:
//   Flood           → bright blue      Recurring flood → light blue
//   Normal water    → hidden (lakes and rivers that are always there)
//   Insufficient data (clouds, no pass) → faint gray, because gray means "no data", never "dry"
// and total the flooded acres per county for labels shown when zoomed out.
import { loadCounties } from "./data/counties.js";
import { contains } from "./near.js";
import { countyRain } from "./raintotals.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LAYER = "MODIS_Combined_Flood_2-Day";
// Totals under this are within the product's noise (a handful of ~16-acre pixels), so they're
// reported as "little or no flood water seen" rather than a number.
const MIN_ACRES = 100;
const Z = 9; // GIBS serves this product up to zoom 9
const tileUrl = (date, z, x, y) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${LAYER}/default/${date}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.png`;

// GIBS colormap for MODIS flood (gibs.earthdata.nasa.gov/colormaps/v1.0/output/MODIS_Flood.html)
const CLASS = { flood: [250, 30, 36], recurring: [255, 255, 0], water: [50, 210, 245], nodata: [175, 175, 175] };
export const SAT_COLORS = { flood: "#38c6ff", recurring: "#a5e4ff", water: "#2b7fd4", nodata: "#8a96a3" };
const near = (d, i, [r, g, b]) => Math.abs(d[i] - r) < 12 && Math.abs(d[i + 1] - g) < 12 && Math.abs(d[i + 2] - b) < 12;
function classify(d, i) {
  if (!d[i + 3]) return null;
  if (near(d, i, CLASS.flood)) return "flood";
  if (near(d, i, CLASS.recurring)) return "recurring";
  if (near(d, i, CLASS.nodata)) return "nodata";
  if (near(d, i, CLASS.water)) return "water";
  return null; // no water
}

// The latest complete 2-day composite: yesterday (UTC) covers yesterday and the day before.
export function satDate(offsetDays = 1) {
  return new Date(Date.now() - offsetDays * 864e5).toISOString().slice(0, 10);
}

async function tileImageData(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GIBS ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return { c, g, img: g.getImageData(0, 0, bmp.width, bmp.height) };
}

let protocolAdded = false;
function addProtocol() {
  if (protocolAdded) return;
  protocolAdded = true;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const OUT = { flood: [...hex(SAT_COLORS.flood), 255], recurring: [...hex(SAT_COLORS.recurring), 220], water: [...hex(SAT_COLORS.water), 170], nodata: [...hex(SAT_COLORS.nodata), 16] };
  maplibregl.addProtocol("floodsat", async (params, abort) => {
    const [date, z, x, y] = params.url.replace("floodsat://", "").split("/");
    const { c, g, img } = await tileImageData(tileUrl(date, z, x, y), abort?.signal);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const k = classify(d, i);
      const o = k ? OUT[k] : null;
      if (o) { d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o[3]; } else d[i + 3] = 0;
    }
    g.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: "image/png" });
    return { data: await blob.arrayBuffer() };
  });
}

function wetNeighbors(d, size, px, py) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const x = px + dx, y = py + dy;
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    const k = classify(d, (y * size + x) * 4);
    if (k === "flood" || k === "recurring" || (d[(y * size + x) * 4 + 3] && near(d, (y * size + x) * 4, CLASS.water))) n++;
  }
  return n;
}

// Flooded acres per county from the z9 tiles covering the counties.
async function countyTotals(counties, date) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of counties) { w = Math.min(w, c.bbox[0]); s = Math.min(s, c.bbox[1]); e = Math.max(e, c.bbox[2]); n = Math.max(n, c.bbox[3]); }
  const N = 2 ** Z;
  const tx = (lng) => ((lng + 180) / 360) * N;
  const ty = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };
  const lngOf = (x) => (x / N) * 360 - 180;
  const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;
  const totals = new Map(counties.map((c) => [c.geoid, { flood: 0, recurring: 0, nodata: 0, all: 0 }]));
  const jobs = [];
  for (let x = Math.floor(tx(w)); x <= Math.floor(tx(e)); x++) {
    for (let y = Math.floor(ty(n)); y <= Math.floor(ty(s)); y++) jobs.push([x, y]);
  }
  await Promise.all(jobs.map(async ([x, y]) => {
    const { img } = await tileImageData(tileUrl(date, Z, x, y));
    const d = img.data, size = img.width;
    for (let py = 0; py < size; py += 1) {
      const lat = latOf(y + (py + 0.5) / size);
      for (let px = 0; px < size; px += 1) {
        const lng = lngOf(x + (px + 0.5) / size);
        const cty = counties.find((c) => lng >= c.bbox[0] && lng <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3] && contains(c.geometry, [lng, lat]));
        if (!cty) continue;
        const t = totals.get(cty.geoid);
        t.all++;
        let k = classify(d, (py * size + px) * 4);
        // Lone flood pixels are usually cloud shadows or noise: count flood water only where
        // at least 2 of the 8 neighboring pixels are water too.
        if ((k === "flood" || k === "recurring") && wetNeighbors(d, size, px, py) < 2) k = null;
        if (k && k !== "water") t[k]++;
      }
    }
  }));
  // Ground area of one z9 pixel at the metro's latitude, in acres.
  const lat0 = (s + n) / 2;
  const m = (40075016.7 * Math.cos((lat0 * Math.PI) / 180)) / (256 * N);
  const acresPerPx = (m * m) / 4046.86;
  return counties.map((c) => {
    const t = totals.get(c.geoid);
    // "Recurring flood" is water where it shows up often (reservoir edges, river bottoms), so it
    // isn't counted as new flooding; it still shows on the map in a lighter blue.
    return { ...c, acres: Math.round(t.flood * acresPerPx), oftenAcres: Math.round(t.recurring * acresPerPx), cloudPct: t.all ? Math.round((t.nodata / t.all) * 100) : null };
  });
}

// Satellite flood flags are trusted only where there's a reason for water: at least an inch of
// rain somewhere in the county in the last 3 days, or an NWS flood product touching it.
// Elsewhere they're almost always reservoir edges or cloud shadows.
const FLOOD_ALERT = /Flood/;
function plausible(c, rain72, alerts) {
  const r = rain72?.find((x) => x.geoid === c.geoid);
  if (r?.max >= 1) return true;
  return alerts.some((f) => f.geometry && FLOOD_ALERT.test(f.properties.event || "") && contains(f.geometry, c.center));
}

export function initSatellite({ map, metro, beforeId, getAlertsFC }) {
  addProtocol();
  let on = false, date = satDate(1), totals = null, loading = null;

  map.addSource("satflood", { type: "raster", tiles: [`floodsat://${date}/{z}/{x}/{y}`], tileSize: 256, maxzoom: Z,
    attribution: 'Flood from space: <a href="https://www.earthdata.nasa.gov/data/tools/flood" target="_blank" rel="noopener">NASA LANCE / GIBS</a>' });
  map.addLayer({ id: "satflood", type: "raster", source: "satflood", paint: { "raster-resampling": "nearest", "raster-opacity": 0.95, "raster-fade-duration": 0 } }, beforeId);
  map.addSource("satflood-counties", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("satflood-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "satflood-county-line", type: "line", source: "satflood-counties", maxzoom: 11,
    paint: { "line-color": "#3aa3c9", "line-width": 1.1, "line-opacity": 0.55, "line-dasharray": [2, 2] },
  }, beforeId);
  map.addLayer({
    id: "satflood-label", type: "symbol", source: "satflood-labels", maxzoom: 11,
    layout: {
      "text-field": ["format", ["get", "name"], { "font-scale": 1, "text-color": "#e8edf2" }, "\n", {}, ["get", "line"], { "font-scale": 0.85 }],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": 12, "text-line-height": 1.2, "text-max-width": 14, "text-allow-overlap": false,
    },
    paint: { "text-color": ["case", [">=", ["get", "acres"], MIN_ACRES], SAT_COLORS.flood, "#9aa7b4"], "text-halo-color": "#0b0f14", "text-halo-width": 1.8 },
  });

  const card = document.createElement("div");
  card.id = "sat-legend";
  card.className = "radar-legend storms-legend sat-legend";
  card.hidden = true;
  document.getElementById("storms-legend").after(card);

  const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" });
  function renderCard(err) {
    const prev = satDate(2);
    const total = totals ? totals.reduce((a, c) => a + c.acres, 0) : null;
    card.innerHTML = `
      <div class="rl-head"><span class="rl-title">Flood from space</span><span class="rl-time">NASA · ${esc(fmtDate(prev))}–${esc(fmtDate(date))}</span></div>
      <ul class="rl-drops sl-levels">
        <li class="on"><span class="sl-sw" style="--c:${SAT_COLORS.flood}"></span>Flood water</li>
        <li class="on"><span class="sl-sw" style="--c:${SAT_COLORS.recurring}"></span>Floods often</li>
        <li class="on"><span class="sl-sw" style="--c:${SAT_COLORS.water}"></span>Normal water</li>
        <li class="on"><span class="sl-sw" style="--c:${SAT_COLORS.nodata}"></span>Clouds, no view</li>
      </ul>
      <p class="rl-note">${err ? "Satellite data isn't loading right now. " : total == null ? "Adding up flooded acres… " : total >= MIN_ACRES ? `The satellite flags about ${total.toLocaleString()} acres of possible flood water across the metro. ` : "Little or no flood water seen across the metro. "}Totals count only counties with an inch of rain in 3 days or an NWS flood alert; blue specks elsewhere are usually lake edges or cloud shadows. Satellites miss small streets and anything under cloud, so this never means a road is dry.</p>`;
  }

  async function loadTotals() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const counties = await loadCounties(metro);
        map.getSource("satflood-counties")?.setData({ type: "FeatureCollection", features: counties.map((c) => ({ type: "Feature", geometry: c.geometry, properties: { name: c.name } })) });
        const [raw, rain72] = await Promise.all([countyTotals(counties, date), countyRain(metro, "72h").catch(() => null)]);
        const alerts = getAlertsFC?.().features || [];
        totals = raw.map((c) => ({ ...c, rawAcres: c.acres, acres: plausible(c, rain72, alerts) ? c.acres : 0 }));
        if (!map.getSource("satflood-labels")) return;
        map.getSource("satflood-labels").setData({
          type: "FeatureCollection",
          features: totals.map((c) => ({
            type: "Feature", geometry: { type: "Point", coordinates: c.center },
            properties: {
              name: `${c.name.toUpperCase()} CO.`, acres: c.acres,
              line: c.acres >= MIN_ACRES ? `~${c.acres.toLocaleString()} acres possible flooding · satellite` : `little or no flood water seen${c.cloudPct >= 20 ? ` · ${c.cloudPct}% under cloud` : ""}`,
            },
          })),
        });
        renderCard();
      } catch (e) {
        renderCard(e);
      } finally { loading = null; }
    })();
    return loading;
  }

  // A new composite appears once a day; check every 3 hours.
  setInterval(() => {
    const d = satDate(1);
    if (d === date) return;
    date = d; totals = null;
    map.getSource("satflood")?.setTiles([`floodsat://${date}/{z}/{x}/{y}`]);
    if (on) { renderCard(); loadTotals(); }
  }, 3 * 3600e3);

  return {
    layerIds: ["satflood", "satflood-county-line", "satflood-label"],
    onToggle(v) {
      on = v; card.hidden = !v;
      if (v) { renderCard(); if (!totals) loadTotals(); }
    },
    getTotals: () => totals,
    date: () => date,
  };
}
