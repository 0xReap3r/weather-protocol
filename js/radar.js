// Rain radar drawn as rain drops (like the Bangkok map) instead of pixel tiles.
//
// Source: NWS NEXRAD composite reflectivity tiles from the Iowa Environmental Mesonet.
// We read the tiles' pixels in the browser, turn each color back into a reflectivity
// value with the radar's own palette (index → dBZ = index × 0.5 − 32.5), and place a drop
// on an evenly spaced grid wherever it's raining. Drop color and size show intensity.
// Six frames (50 min ago → now) loop; reduced-motion readers see the latest frame only.

const TILE = (suffix, bust, z, x, y) =>
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${suffix}/${z}/${x}/${y}.png?_=${bust}`;
const META = "https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json";
const FRAMES = [
  { suffix: "-m50m", minsAgo: 50 },
  { suffix: "-m40m", minsAgo: 40 },
  { suffix: "-m30m", minsAgo: 30 },
  { suffix: "-m20m", minsAgo: 20 },
  { suffix: "-m10m", minsAgo: 10 },
  { suffix: "", minsAgo: 0 },
];
const TILE_ZOOM = 8;     // native radar tiles: ~600 m pixels around DFW, exact palette colors
const GRID_PX = 30;      // one drop every ~30 screen pixels
const MIN_DBZ = 20;      // below this is drizzle, clutter or insects — no drop

// NWS-style intensity bands (dBZ). Rain rates use Marshall–Palmer, Z = 200·R^1.6.
export const RAIN_BANDS = [
  { min: 55, key: "extreme", label: "Hail / torrential", color: "#d94cff", size: 0.62 },
  { min: 45, key: "vheavy", label: "Very heavy", color: "#ff4d4d", size: 0.56 },
  { min: 38, key: "heavy", label: "Heavy", color: "#ffb020", size: 0.5 },
  { min: 30, key: "moderate", label: "Moderate", color: "#4fb3ff", size: 0.44 },
  { min: MIN_DBZ, key: "light", label: "Light", color: "#7fd4ff", size: 0.38 },
];
const bandFor = (dbz) => RAIN_BANDS.find((b) => dbz >= b.min) || null;
export const rainRateInHr = (dbz) => Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6) / 25.4;

/* ---------- Palette: RGB → dBZ ---------- */
const PAL_HEX = "00000085718f85728f86738d87758b87768b887789897987897a878a7b858b7d848b7e848c7f828d81808d82808e837e8f847c8f857c90877b918879918979928b77938d759691539894579b975b9d9a60a09d64a3a068a5a36da8a671aaa976adac7ab0af7eb2b283b7b88cbabb90bdbe94bfc199c2c49dc4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4c9ccb4c6c9b4c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4b0b6b4adb3b4aab0b4a4abb4a0a8b49da5b49aa2b497a0b4949db4919ab4949bb59098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a24b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d462bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a24bd69043d67e3cd66d35d65b11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e110c99110c95100c91100b880f0b840e0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308467d085b88076f9207849d0698a806adb205c1bd05d6c704ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400ff8f00ff8a00ff8500ff8000ff0000f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000a300009b00009400008d00007f0000780000710000fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36efea2bece720e9e10be3b200ffac00fca400f79b00f49300ef8800ea8300e87900e27200dd6900db05ecf005ebf005eaf005dde005dce005dbe005cdd005ccd004bdc004bcc004bbc004aeb004adb0049ea0049da0049ca0038e90038d90038c90037e80037d80036f70036e70036d70025f60025e60024f50024e50024d50023f40023e40023d40013030012f30012020011f20011e203a67b53a66b53a65b53a64b53a63b53a62b5";
const RGB_TO_DBZ = new Map();
for (let i = 1; i < 256; i++) {
  const h = PAL_HEX.slice(i * 6, i * 6 + 6);
  const key = parseInt(h, 16);
  if (!RGB_TO_DBZ.has(key)) RGB_TO_DBZ.set(key, i * 0.5 - 32.5);
}

/* ---------- Tile pixels ---------- */
const tileCache = new Map(); // `${frame}|${bust}|${x}/${y}` -> Promise<Uint8ClampedArray|null>
function tilePixels(frame, bust, x, y) {
  const key = `${frame}|${bust}|${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(im, 0, 0);
        resolve(g.getImageData(0, 0, 256, 256).data);
      } catch (_) { resolve(null); }
    };
    im.onerror = () => resolve(null);
    im.src = TILE(FRAMES[frame].suffix, bust, TILE_ZOOM, x, y);
  });
  tileCache.set(key, p);
  return p;
}

// Web Mercator: lng/lat → global pixel at TILE_ZOOM
const WORLD = 256 * 2 ** TILE_ZOOM;
const px = (lng) => ((lng + 180) / 360) * WORLD;
const py = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
};

function dbzAt(tiles, gx, gy) {
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const data = tiles.get(`${tx}/${ty}`);
  if (!data) return null;
  const i = ((Math.floor(gy) - ty * 256) * 256 + (Math.floor(gx) - tx * 256)) * 4;
  if (data[i + 3] === 0) return null;
  return RGB_TO_DBZ.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) ?? null;
}

/* ---------- Drop icon (SDF so MapLibre can tint it per band) ---------- */
function dropImage() {
  const S = 64, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.beginPath();
  // teardrop: point at top, round bottom
  g.moveTo(S / 2, 6);
  g.bezierCurveTo(S / 2 + 4, 18, S / 2 + 20, 30, S / 2 + 20, 42);
  g.arc(S / 2, 42, 20, 0, Math.PI, false);
  g.bezierCurveTo(S / 2 - 20, 30, S / 2 - 4, 18, S / 2, 6);
  g.fill();
  return g.getImageData(0, 0, S, S);
}

export function initRadar(map, { beforeId, isOn }) {
  const legend = document.getElementById("radar-legend");
  const timeEl = document.getElementById("radar-time");
  const playBtn = document.getElementById("radar-play");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let bust = Math.floor(Date.now() / 300000);
  let latest = null;
  let frame = FRAMES.length - 1;
  let playing = !reduce.matches;
  let timer = null;
  let frameData = FRAMES.map(() => null); // FeatureCollection per frame for the current view
  let computeToken = 0;

  if (!map.hasImage("rain-drop")) map.addImage("rain-drop", dropImage(), { sdf: true });
  map.addSource("radar-drops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer(
    {
      id: "radar-drops",
      type: "symbol",
      source: "radar-drops",
      layout: {
        "icon-image": "rain-drop",
        "icon-size": ["get", "size"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "dbz"],
      },
      paint: { "icon-color": ["get", "color"], "icon-opacity": 0.92, "icon-halo-color": "rgba(11,15,20,.8)", "icon-halo-width": 1 },
    },
    beforeId
  );

  /* Build drops for one frame over the visible map */
  async function computeFrame(f, token) {
    const b = map.getBounds();
    const pad = 0.15;
    const w = b.getWest() - pad, e = b.getEast() + pad, s = b.getSouth() - pad, n = b.getNorth() + pad;
    const tx0 = Math.floor(px(w) / 256), tx1 = Math.floor(px(e) / 256);
    const ty0 = Math.floor(py(n) / 256), ty1 = Math.floor(py(s) / 256);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 30) return { type: "FeatureCollection", features: [] }; // zoomed way out

    const tiles = new Map();
    const jobs = [];
    for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
      jobs.push(tilePixels(f, bust, x, y).then((d) => d && tiles.set(`${x}/${y}`, d)));
    }
    await Promise.all(jobs);
    if (token !== computeToken) return null;

    // Grid anchored to the map (not the screen) so drops don't swim while panning.
    const z = Math.round(map.getZoom() * 2) / 2;
    const stepPx = GRID_PX * (WORLD / (256 * 2 ** z)); // grid step in tile-zoom pixels
    const gx0 = Math.floor(px(w) / stepPx) * stepPx, gx1 = px(e);
    const gy0 = Math.floor(py(n) / stepPx) * stepPx, gy1 = py(s);
    const half = stepPx / 2;
    const sub = Math.max(1, Math.min(4, Math.round(half / 2))); // sample a few points per cell
    const features = [];
    for (let gy = gy0; gy <= gy1; gy += stepPx) {
      for (let gx = gx0; gx <= gx1; gx += stepPx) {
        let best = -99;
        for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
          const v = dbzAt(tiles, gx + (sx / sub) * stepPx, gy + (sy / sub) * stepPx);
          if (v != null && v > best) best = v;
        }
        const band = bandFor(best);
        if (!band) continue;
        const cx = gx + half, cy = gy + half;
        const lng = (cx / WORLD) * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / WORLD))) * 180) / Math.PI;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: { dbz: best, color: band.color, size: band.size, band: band.key },
        });
      }
    }
    return { type: "FeatureCollection", features };
  }

  async function recompute() {
    if (!isOn()) return;
    const token = ++computeToken;
    frameData = FRAMES.map(() => null);
    // Latest frame first so something shows right away.
    const order = [FRAMES.length - 1, ...FRAMES.map((_, i) => i).slice(0, -1)];
    for (const f of order) {
      if (reduce.matches && f !== FRAMES.length - 1) continue;
      const fc = await computeFrame(f, token);
      if (token !== computeToken || !fc) return;
      frameData[f] = fc;
      if (f === frame || (f === FRAMES.length - 1 && !frameData[frame])) show(f);
    }
  }

  function show(i) {
    if (!frameData[i]) return;
    frame = i;
    map.getSource("radar-drops")?.setData(frameData[i]);
    paintTime();
  }

  function paintTime() {
    if (!latest) { timeEl.textContent = ""; return; }
    const t = new Date(latest.getTime() - FRAMES[frame].minsAgo * 60000);
    const clock = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const n = frameData[frame]?.features.length ?? 0;
    timeEl.textContent = `${clock}${frame === FRAMES.length - 1 ? " · latest" : ""}${n ? "" : " · no rain in view"}`;
  }

  function tick() {
    let next = (frame + 1) % FRAMES.length;
    for (let k = 0; k < FRAMES.length && !frameData[next]; k++) next = (next + 1) % FRAMES.length;
    show(next);
    timer = setTimeout(tick, next === FRAMES.length - 1 ? 1800 : 600);
  }

  function setPlaying(p) {
    playing = p && !reduce.matches;
    clearTimeout(timer);
    playBtn.textContent = playing ? "Pause" : "Play";
    playBtn.setAttribute("aria-pressed", String(playing));
    if (playing && isOn()) timer = setTimeout(tick, 600);
    else show(FRAMES.length - 1);
  }
  playBtn.addEventListener("click", () => setPlaying(!playing));
  reduce.addEventListener?.("change", () => setPlaying(playing));

  async function refreshMeta() {
    try {
      const j = await (await fetch(META, { cache: "no-store" })).json();
      latest = j.meta?.valid ? new Date(j.meta.valid) : null;
    } catch (_) { /* keep the last known time */ }
    paintTime();
  }

  function refresh() {
    bust = Math.floor(Date.now() / 300000);
    tileCache.clear();
    refreshMeta();
    recompute();
  }
  setInterval(() => isOn() && refresh(), 5 * 60 * 1000);
  refreshMeta();

  let moveTimer = null;
  map.on("moveend", () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(recompute, 250);
  });

  return {
    layerIds: ["radar-drops"],
    onToggle(on) {
      legend.hidden = !on;
      if (on) { recompute(); setPlaying(playing || !reduce.matches); }
      else { clearTimeout(timer); computeToken++; }
    },
    // Debug: reflectivity at a point from the latest frame
    async dbzAt([lng, lat]) {
      const tx = Math.floor(px(lng) / 256), ty = Math.floor(py(lat) / 256);
      const d = await tilePixels(FRAMES.length - 1, bust, tx, ty);
      const tiles = new Map(d ? [[`${tx}/${ty}`, d]] : []);
      return dbzAt(tiles, px(lng), py(lat));
    },
  };
}
