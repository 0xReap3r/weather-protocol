// Rain radar, two ways:
//  • Drops (default): raindrop icons on a grid, colored by intensity, sampled from the latest scan.
//  • Loop: the classic radar image, six frames over the last 50 minutes.
// Data: NWS NEXRAD composite reflectivity tiles from the Iowa Environmental Mesonet.
import { sampleDrops, dropIcon, DROP_LEVELS } from "./raindrops.js";

const TILE = (suffix, bust) =>
  `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${suffix}/{z}/{x}/{y}.png?_=${bust}`;
const FRAMES = [
  { suffix: "-m50m", minsAgo: 50 },
  { suffix: "-m40m", minsAgo: 40 },
  { suffix: "-m30m", minsAgo: 30 },
  { suffix: "-m20m", minsAgo: 20 },
  { suffix: "-m10m", minsAgo: 10 },
  { suffix: "", minsAgo: 0 },
];
const META = "https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json";
const OPACITY = 0.72;
const ATTRIB = 'Radar: NWS NEXRAD via <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a>';
const MODE_KEY = "stormline.radarMode.v1";

export function initRadar(map, { beforeId, isOn }) {
  const legend = document.getElementById("radar-legend");
  const timeEl = document.getElementById("radar-time");
  const playBtn = document.getElementById("radar-play");
  const modeBtns = legend.querySelectorAll("[data-radar-mode]");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let bust = Math.floor(Date.now() / 300000);
  let latest = null;
  let frame = FRAMES.length - 1;
  let playing = !reduce.matches;
  let timer = null;
  let mode = "drops";
  try { mode = localStorage.getItem(MODE_KEY) === "loop" ? "loop" : "drops"; } catch (_) {}

  /* ---- Loop frames ---- */
  const frameIds = FRAMES.map((_, i) => `radar-${i}`);
  FRAMES.forEach((f, i) => {
    const src = { type: "raster", tiles: [TILE(f.suffix, bust)], tileSize: 256 };
    if (i === FRAMES.length - 1) src.attribution = ATTRIB; // credit once, not six times
    map.addSource(`radar-${i}`, src);
    map.addLayer(
      {
        id: `radar-${i}`,
        type: "raster",
        source: `radar-${i}`,
        layout: { visibility: "none" },
        paint: { "raster-opacity": i === frame ? OPACITY : 0, "raster-opacity-transition": { duration: 0 }, "raster-fade-duration": 0 },
      },
      beforeId
    );
  });

  /* ---- Drops ---- */
  map.addImage("raindrop", dropIcon(40), { sdf: true, pixelRatio: 2 });
  map.addSource("raindrops", { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: ATTRIB });
  map.addLayer({
    id: "raindrops",
    type: "symbol",
    source: "raindrops",
    layout: {
      visibility: "none",
      "icon-image": "raindrop",
      "icon-size": ["*", ["get", "size"], 1.6],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "level"],
    },
    paint: { "icon-color": ["get", "color"], "icon-opacity": 0.92, "icon-halo-color": "rgba(11,15,20,.7)", "icon-halo-width": 1 },
  });

  let dropToken = 0;
  async function refreshDrops() {
    if (!isOn() || mode !== "drops") return;
    const token = ++dropToken;
    const b = map.getBounds();
    const fc = await sampleDrops([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom(), bust);
    if (token === dropToken) map.getSource("raindrops")?.setData(fc);
  }
  let moveTimer = null;
  map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(refreshDrops, 250); });

  /* ---- Shared ---- */
  function setVis(id, on) { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }
  function apply() {
    const on = isOn();
    legend.hidden = !on;
    legend.dataset.mode = mode;
    modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.radarMode === mode)));
    setVis("raindrops", on && mode === "drops");
    frameIds.forEach((id) => setVis(id, on && mode === "loop"));
    clearTimeout(timer);
    if (!on) return;
    if (mode === "drops") { show(FRAMES.length - 1); refreshDrops(); }
    else setPlaying(playing);
  }

  function show(i) {
    frame = i;
    frameIds.forEach((id, k) => map.getLayer(id) && map.setPaintProperty(id, "raster-opacity", k === i ? OPACITY : 0));
    paintTime();
  }
  function paintTime() {
    if (!latest) { timeEl.textContent = ""; return; }
    const t = new Date(latest.getTime() - FRAMES[frame].minsAgo * 60000);
    const clock = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    timeEl.textContent = frame === FRAMES.length - 1 ? `${clock} · latest` : clock;
  }
  function tick() {
    const next = (frame + 1) % FRAMES.length;
    show(next);
    timer = setTimeout(tick, next === FRAMES.length - 1 ? 1800 : 550);
  }
  function setPlaying(p) {
    playing = p && !reduce.matches;
    clearTimeout(timer);
    playBtn.textContent = playing ? "Pause" : "Play";
    playBtn.setAttribute("aria-pressed", String(playing));
    if (playing && isOn() && mode === "loop") timer = setTimeout(tick, 550);
    else show(FRAMES.length - 1);
  }
  playBtn.addEventListener("click", () => setPlaying(!playing));
  modeBtns.forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.radarMode;
      try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
      apply();
    })
  );
  reduce.addEventListener?.("change", () => setPlaying(playing));

  // Drop legend swatches come from the same levels the map uses.
  const swatches = document.getElementById("radar-drops-key");
  if (swatches) {
    swatches.innerHTML = DROP_LEVELS.slice(1)
      .map((l) => `<span class="rd-key"><span class="rd-drop" style="--c:${l.color};--s:${l.size}"></span>${l.label}</span>`)
      .join("");
  }

  async function refreshMeta() {
    try {
      const j = await (await fetch(META, { cache: "no-store" })).json();
      latest = j.meta?.valid ? new Date(j.meta.valid) : null;
    } catch (_) {}
    paintTime();
  }
  function refreshAll() {
    bust = Math.floor(Date.now() / 300000);
    FRAMES.forEach((f, i) => map.getSource(`radar-${i}`)?.setTiles([TILE(f.suffix, bust)]));
    refreshMeta();
    refreshDrops();
  }
  setInterval(refreshAll, 5 * 60 * 1000);
  refreshMeta();

  return {
    layerIds: [], // radar manages its own layer visibility (drops vs loop)
    onToggle: apply,
    sampleHere: refreshDrops,
  };
}
