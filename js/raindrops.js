// Raindrop view of radar: sample the latest NEXRAD tile pixels on a fixed geographic grid
// and draw a drop wherever rain is falling, colored and sized by intensity (like the Bangkok map).
// The grid is anchored to map coordinates, so drops stay put while panning.

const TILE = (z, x, y, bust) =>
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${z}/${x}/${y}.png?_=${bust}`;

export const DROP_LEVELS = [
  null,
  { key: "light", label: "Light", color: "#4ea8ff", size: 0.5 },
  { key: "moderate", label: "Moderate", color: "#ffd23f", size: 0.6 },
  { key: "heavy", label: "Heavy", color: "#ff7a1a", size: 0.72 },
  { key: "severe", label: "Severe", color: "#ff2fd0", size: 0.85 },
];

/* ---------- Radar pixel → intensity level ---------- */
// The NEXRAD reflectivity palette runs cyan/blue → green → yellow → orange/red → magenta/purple.
export function levelFromRGBA(r, g, b, a) {
  if (a < 40) return 0;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max < 40 || d < 25) return 0; // near-black or gray: no echo worth showing
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h >= 160 && h < 250) return 1;            // cyan, blue: light
  if (h >= 75 && h < 160) return max > 180 ? 1 : 2; // bright green light, darker green moderate
  if (h >= 45 && h < 75) return 2;              // yellow: moderate
  if (h >= 15 && h < 45) return 3;              // orange: heavy
  if (h < 15 || h >= 345) return max < 200 ? 4 : 3; // red heavy, dark red severe
  if (h >= 250 && h < 345) return 4;            // magenta, purple: severe (hail possible)
  return 0;
}

/* ---------- Tile pixel cache ---------- */
const tiles = new Map(); // key -> Promise<ImageData|null>
function tilePixels(z, x, y, bust) {
  const key = `${z}/${x}/${y}/${bust}`;
  if (!tiles.has(key)) {
    tiles.set(
      key,
      fetch(TILE(z, x, y, bust))
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? createImageBitmap(b) : null))
        .then((bmp) => {
          if (!bmp) return null;
          const c = new OffscreenCanvas(256, 256);
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(bmp, 0, 0);
          return ctx.getImageData(0, 0, 256, 256);
        })
        .catch(() => null)
    );
    if (tiles.size > 120) tiles.delete(tiles.keys().next().value); // keep memory bounded
  }
  return tiles.get(key);
}

/* ---------- Web Mercator helpers ---------- */
const worldPx = (z) => 256 * 2 ** z;
const lngToX = (lng, z) => ((lng + 180) / 360) * worldPx(z);
const latToY = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z);
};
const xToLng = (x, z) => (x / worldPx(z)) * 360 - 180;
const yToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / worldPx(z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
};

// Drops for a bounding box [w, s, e, n] at a map zoom. Spacing is ~30 screen px.
export async function sampleDrops([w, s, e, n], mapZoom, bust, spacingPx = 30) {
  const z = Math.max(3, Math.min(10, Math.round(mapZoom)));
  const scale = 2 ** (z - mapZoom); // world px per screen px at tile zoom
  const step = Math.max(4, spacingPx * scale);
  const x0 = Math.floor(lngToX(w, z) / step) * step, x1 = lngToX(e, z);
  const y0 = Math.floor(latToY(n, z) / step) * step, y1 = latToY(s, z);
  const points = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) points.push([x, y]);
  if (points.length > 4000) return { type: "FeatureCollection", features: [] }; // zoomed way out

  const features = [];
  await Promise.all(
    points.map(async ([x, y]) => {
      const tx = Math.floor(x / 256), ty = Math.floor(y / 256);
      if (tx < 0 || ty < 0 || tx >= 2 ** z || ty >= 2 ** z) return;
      const img = await tilePixels(z, tx, ty, bust);
      if (!img) return;
      const px = Math.floor(x - tx * 256), py = Math.floor(y - ty * 256);
      // Take the strongest echo in a small window so thin cells aren't missed.
      let best = 0;
      for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) {
        const qx = Math.min(255, Math.max(0, px + dx)), qy = Math.min(255, Math.max(0, py + dy));
        const i = (qy * 256 + qx) * 4;
        best = Math.max(best, levelFromRGBA(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]));
      }
      if (!best) return;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [xToLng(x, z), yToLat(y, z)] },
        properties: { level: best, color: DROP_LEVELS[best].color, size: DROP_LEVELS[best].size },
      });
    })
  );
  return { type: "FeatureCollection", features };
}

// A raindrop shape as an SDF icon, so MapLibre can tint it per intensity.
export function dropIcon(px = 40) {
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  const ctx = c.getContext("2d");
  const w = px, h = px;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.06);
  ctx.bezierCurveTo(w * 0.5, h * 0.06, w * 0.18, h * 0.46, w * 0.18, h * 0.64);
  ctx.arc(w * 0.5, h * 0.64, w * 0.32, Math.PI, 0, true);
  ctx.bezierCurveTo(w * 0.82, h * 0.46, w * 0.5, h * 0.06, w * 0.5, h * 0.06);
  ctx.fill();
  return { width: px, height: px, data: new Uint8Array(ctx.getImageData(0, 0, px, px).data.buffer) };
}
