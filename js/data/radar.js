// NEXRAD national radar from the Iowa Environmental Mesonet (free, public, CORS-enabled).
// The map shows the radar tiles; this module also reads tile pixels to tell how hard it's
// raining at a point, so we can say it in plain words ("Heavy rain over you").

export const RADAR_TILES = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png";
const SAMPLE_Z = 8; // ~600 m per pixel: fine enough for "over this spot"

// Standard NWS reflectivity colors (dBZ). We match each pixel to the nearest one.
const RAMP = [
  [5, 4, 233, 231], [10, 1, 159, 244], [15, 3, 0, 244], [20, 2, 253, 2], [25, 1, 197, 1],
  [30, 0, 142, 0], [35, 253, 248, 2], [40, 229, 188, 0], [45, 253, 149, 0], [50, 253, 0, 0],
  [55, 212, 0, 0], [60, 188, 0, 0], [65, 248, 0, 253], [70, 152, 84, 198],
];
function dbzFromRGB(r, g, b, a) {
  if (a < 40) return null; // transparent = no echo
  let best = null, bestD = Infinity;
  for (const [dbz, R, G, B] of RAMP) {
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bestD) { bestD = d; best = dbz; }
  }
  return best;
}

// Plain-language intensity. Rates are rough Marshall–Palmer conversions.
export const LEVELS = [
  { min: 60, key: "extreme", word: "Very heavy rain, hail possible", short: "Very heavy", color: "#ff3fd1", rate: "2+ in/hr" },
  { min: 50, key: "vheavy", word: "Very heavy rain", short: "Very heavy", color: "#ff3b3b", rate: "about 2 in/hr" },
  { min: 40, key: "heavy", word: "Heavy rain", short: "Heavy", color: "#ff9a1f", rate: "about 0.5–2 in/hr" },
  { min: 30, key: "moderate", word: "Moderate rain", short: "Moderate", color: "#f5d90a", rate: "about 0.1–0.5 in/hr" },
  { min: 20, key: "light", word: "Light rain", short: "Light", color: "#3ddc97", rate: "under 0.1 in/hr" },
];
export const levelFor = (dbz) => (dbz == null ? null : LEVELS.find((l) => dbz >= l.min) || null);

export const ADVICE = {
  extreme: "Flash flooding can start within minutes. Stay off low roads, underpasses and creek crossings. Get indoors; hail is possible.",
  vheavy: "Flash flooding can start within minutes. Stay off low roads, underpasses and creek crossings. Turn around, don't drown.",
  heavy: "Street flooding is possible. Avoid underpasses and low-water crossings, and move cars off low ground.",
  moderate: "Roads are slick and low spots can pond. Slow down and leave extra room.",
  light: "Light rain. Roads may be slick.",
};

/* ---------- Tile pixel reading ---------- */
const tileCache = new Map(); // "bucket/z/x/y" -> Promise<ImageData|null>
const bucket = () => Math.floor(Date.now() / (5 * 60 * 1000)); // radar refreshes about every 5 min

function lngLatToPixel(lng, lat, z) {
  const n = 256 * 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

function loadTile(z, x, y) {
  const key = `${bucket()}/${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    if (tileCache.size > 200) tileCache.clear();
    tileCache.set(
      key,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = c.height = 256;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, 256, 256));
          } catch (_) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = RADAR_TILES.replace("{z}", z).replace("{x}", x).replace("{y}", y) + `?t=${bucket()}`;
      })
    );
  }
  return tileCache.get(key);
}

// dBZ at a point (strongest echo within ~1 km, so a thin storm edge isn't missed). null = no echo.
export async function sampleDbz([lng, lat], z = SAMPLE_Z) {
  const [px, py] = lngLatToPixel(lng, lat, z);
  let best = null;
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const X = Math.floor(px) + dx, Y = Math.floor(py) + dy;
    const data = await loadTile(z, Math.floor(X / 256), Math.floor(Y / 256));
    if (!data) continue;
    const i = ((Y % 256) * 256 + (X % 256)) * 4;
    const d = dbzFromRGB(data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]);
    if (d != null && (best == null || d > best)) best = d;
  }
  return best;
}

// Raindrop markers: sample a grid of screen points and keep the ones with rain.
export async function rainGrid(map, stepPx = 46) {
  const canvas = map.getCanvas();
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const z = Math.max(5, Math.min(9, Math.round(map.getZoom())));
  const pts = [];
  for (let y = stepPx / 2; y < h; y += stepPx) {
    for (let x = stepPx / 2; x < w; x += stepPx) pts.push(map.unproject([x, y]).toArray());
  }
  const out = await Promise.all(pts.map((p) => sampleDbz(p, z).then((d) => ({ p, d }))));
  return {
    type: "FeatureCollection",
    features: out
      .filter((o) => o.d != null && o.d >= 20)
      .map((o) => {
        const lv = levelFor(o.d);
        return { type: "Feature", geometry: { type: "Point", coordinates: o.p }, properties: { dbz: o.d, color: lv.color, key: lv.key } };
      }),
  };
}
