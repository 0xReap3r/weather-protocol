// Rain radar: NWS NEXRAD composite reflectivity tiles from the Iowa Environmental Mesonet.
// Six frames (50 min ago → now) loop like a TV weather map. Reduced-motion readers get the
// latest frame only. Tiles refresh every 5 minutes.

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

export function initRadar(map, { beforeId, isOn }) {
  const legend = document.getElementById("radar-legend");
  const timeEl = document.getElementById("radar-time");
  const playBtn = document.getElementById("radar-play");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let bust = Math.floor(Date.now() / 300000);
  let latest = null; // Date of the newest scan
  let frame = FRAMES.length - 1;
  let playing = !reduce.matches;
  let timer = null;

  FRAMES.forEach((f, i) => {
    map.addSource(`radar-${i}`, {
      type: "raster",
      tiles: [TILE(f.suffix, bust)],
      tileSize: 256,
      attribution: i === FRAMES.length - 1 ? ATTRIB : undefined,
    });
    map.addLayer(
      {
        id: `radar-${i}`,
        type: "raster",
        source: `radar-${i}`,
        paint: {
          "raster-opacity": i === frame ? OPACITY : 0,
          "raster-opacity-transition": { duration: 0 },
          "raster-fade-duration": 0,
        },
      },
      beforeId
    );
  });

  const ids = FRAMES.map((_, i) => `radar-${i}`);

  function show(i) {
    frame = i;
    ids.forEach((id, k) => map.getLayer(id) && map.setPaintProperty(id, "raster-opacity", k === i ? OPACITY : 0));
    paintTime();
  }

  function paintTime() {
    if (!latest) { timeEl.textContent = ""; return; }
    const t = new Date(latest.getTime() - FRAMES[frame].minsAgo * 60000);
    const clock = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    timeEl.textContent = frame === FRAMES.length - 1 ? `${clock} · latest` : clock;
  }

  function tick() {
    // Hold on the newest frame a little longer so it reads as "now".
    const next = (frame + 1) % FRAMES.length;
    show(next);
    timer = setTimeout(tick, next === FRAMES.length - 1 ? 1800 : 550);
  }

  function setPlaying(p) {
    playing = p && !reduce.matches;
    clearTimeout(timer);
    playBtn.textContent = playing ? "Pause" : "Play";
    playBtn.setAttribute("aria-pressed", String(playing));
    if (playing && isOn()) timer = setTimeout(tick, 550);
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

  function refreshTiles() {
    bust = Math.floor(Date.now() / 300000);
    FRAMES.forEach((f, i) => map.getSource(`radar-${i}`)?.setTiles([TILE(f.suffix, bust)]));
    refreshMeta();
  }
  setInterval(refreshTiles, 5 * 60 * 1000);
  refreshMeta();

  return {
    layerIds: ids,
    // Called when the Radar chip toggles. Visibility itself is handled by the app's layer code.
    onToggle(on) {
      legend.hidden = !on;
      if (on) setPlaying(playing || !reduce.matches);
      else clearTimeout(timer);
    },
  };
}
