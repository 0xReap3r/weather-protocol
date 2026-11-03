// "Storm shape" chip: the actual radar reflectivity image, drawn as a solid color fill instead of
// individual drops, so a storm's real size, shape and core are visible at a glance — the way radar
// looks on TV. Same imagery as the Radar chip's rain drops (NEXRAD composite reflectivity via the
// Iowa Environmental Mesonet), just rendered as a plain raster tile layer instead of being read
// pixel-by-pixel. Pairs with the Warnings layer: this shows the storm itself, the alert polygon and
// motion arrow show the threat area and where it's headed.
const TILE = (bust) => `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?_=${bust}`;

export function initStormCells({ map, beforeId }) {
  let on = false;
  let bust = Math.floor(Date.now() / 300000); // 5-minute cache buster, same cadence as the radar refresh

  map.addSource("stormcells", {
    type: "raster",
    tiles: [TILE(bust)],
    tileSize: 256,
    attribution: 'Radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a>',
  });
  map.addLayer(
    { id: "stormcells", type: "raster", source: "stormcells", paint: { "raster-opacity": 0.55, "raster-fade-duration": 300 } },
    beforeId
  );

  const card = document.createElement("div");
  card.id = "stormcells-legend";
  card.className = "radar-legend";
  card.hidden = true;
  card.innerHTML = `
    <div class="rl-head"><span class="rl-title">Storm shape</span><span class="rl-time">live radar</span></div>
    <p class="rl-note">The real shape of what's out there, not just the warning box. Green is lighter, red is heavier, purple or white is the most intense — often hail.</p>`;
  document.getElementById("legend-dock").append(card);

  function refresh() {
    bust = Math.floor(Date.now() / 300000);
    map.getSource("stormcells")?.setTiles([TILE(bust)]);
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
