// "Storm shape" chip: the real radar reflectivity, recolored in our own palette instead of the
// stock NWS green-yellow-red-purple every other weather app uses, and faded in by intensity so a
// light rain wash barely tints the map while a genuine storm core reads as a bold glow — roads,
// labels and every marker (all real MapLibre layers, drawn after this one) stay on top and legible.
// Same source tiles the Radar chip reads pixel-by-pixel for drops (NEXRAD composite reflectivity
// via the Iowa Environmental Mesonet), recolored through a custom MapLibre protocol the same way
// js/satellite.js recolors NASA's flood tiles.
import { dbzFromRGB } from "./radar.js";

const TILE = (bust, z, x, y) => `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${z}/${x}/${y}.png?_=${bust}`;

// Cool, faint and quiet at light rain; hot and bold only at a real storm's core. The top band
// (hail-range reflectivity) uses the same violet-magenta this app already uses for a Tornado or
// Flash Flood Emergency, so "the most intense color on the map" means the same thing everywhere
// in StormFront, not just here.
const BANDS = [
  { min: 55, rgb: [214, 64, 178], a: 215 }, // hail / extreme
  { min: 45, rgb: [230, 96, 58], a: 185 },  // very heavy
  { min: 38, rgb: [224, 155, 46], a: 140 }, // heavy
  { min: 30, rgb: [79, 179, 212], a: 92 },  // moderate
  { min: 15, rgb: [90, 148, 176], a: 44 },  // light
];
export const STORMCELL_BANDS = [
  { key: "extreme", label: "Hail / extreme", color: "#d640b2" },
  { key: "vheavy", label: "Very heavy", color: "#e6603a" },
  { key: "heavy", label: "Heavy", color: "#e09b2e" },
  { key: "moderate", label: "Moderate", color: "#4fb3d4" },
  { key: "light", label: "Light", color: "#5a94b0" },
];
const bandFor = (dbz) => BANDS.find((b) => dbz >= b.min) || null;

let protocolAdded = false;
function addProtocol() {
  if (protocolAdded) return;
  protocolAdded = true;
  maplibregl.addProtocol("stormshape", async (params, abort) => {
    const url = params.url.replace("stormshape://", "https://");
    const res = await fetch(url, { signal: abort?.signal });
    if (!res.ok) throw new Error(`radar tile ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const img = g.getImageData(0, 0, bmp.width, bmp.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue; // already transparent
      const dbz = dbzFromRGB(d[i], d[i + 1], d[i + 2]);
      const band = dbz == null ? null : bandFor(dbz);
      if (!band) { d[i + 3] = 0; continue; }
      d[i] = band.rgb[0]; d[i + 1] = band.rgb[1]; d[i + 2] = band.rgb[2]; d[i + 3] = band.a;
    }
    g.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: "image/png" });
    return { data: await blob.arrayBuffer() };
  });
}

export function initStormCells({ map, beforeId }) {
  let on = false;
  let bust = Math.floor(Date.now() / 300000); // 5-minute cache buster, same cadence as the radar refresh

  addProtocol();
  map.addSource("stormcells", {
    type: "raster",
    tiles: [`stormshape://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?_=${bust}`],
    tileSize: 256,
    attribution: 'Radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a>',
  });
  // No raster-opacity multiplier here — the recolored alpha already carries the fade, so a light
  // echo stays a faint wash and only a real core reads as bold, without flattening everything else.
  map.addLayer(
    { id: "stormcells", type: "raster", source: "stormcells", paint: { "raster-fade-duration": 300 } },
    beforeId
  );

  const card = document.createElement("div");
  card.id = "stormcells-legend";
  card.className = "radar-legend";
  card.hidden = true;
  card.innerHTML = `
    <div class="rl-head"><span class="rl-title">Storm shape</span><span class="rl-time">live radar</span></div>
    <ul class="rl-drops">${STORMCELL_BANDS.map((b) => `<li><span class="rl-drop" style="--c:${b.color};--s:1"></span>${b.label}</li>`).join("")}</ul>
    <p class="rl-note">Fainter and cooler is lighter rain, so it won't bury the map under it. The magenta glow is the most intense — often hail — the same color this app uses for a Tornado or Flash Flood Emergency.</p>`;
  document.getElementById("legend-dock").append(card);

  function refresh() {
    bust = Math.floor(Date.now() / 300000);
    map.getSource("stormcells")?.setTiles([`stormshape://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?_=${bust}`]);
  }
  setInterval(() => on && refresh(), 5 * 60 * 1000);

  return {
    layerIds: ["stormcells"],
    onToggle(v) {
      on = v;
      card.hidden = !v;
      if (v) refresh();
    },
  };
}
