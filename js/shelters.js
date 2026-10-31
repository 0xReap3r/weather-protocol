// Shelters chip: two layers, one dataset for context and one for right now.
//  - Registered shelter SITES (schools, churches, community centers) from HIFLD — a year-round
//    inventory of places that CAN serve as a shelter, shown as quiet frost dots. This is not a
//    live status feed: most of these are closed on an ordinary day.
//  - Shelters FEMA currently lists as OPEN, pulled from the live ESF#6 Shelter System through our
//    Worker. Usually empty — it only fills while a shelter is actually activated for a disaster.
//    These get a bright highlighted ring and sort above the quiet sites.
import { badge, ICON_SIZE } from "./markers.js";
import { loadShelterSites, loadOpenShelters } from "./data/shelters.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const SHELTER_COLORS = { site: "#c9d3dc", open: "#35d488" };
const SITES_TTL = 24 * 60 * 60 * 1000; // year-round list: once a day is plenty
const OPEN_TTL = 10 * 60 * 1000; // live status: match the Worker's own cache

export function initShelters({ map, beforeId, openSheet }) {
  let on = false, sites = [], open = [], loadedSitesAt = null, loadedOpenAt = null, siteErr = null, openErr = null;

  map.addSource("shelters", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  badge(map, "shelter-site", { glyph: "shelter", ring: SHELTER_COLORS.site });
  badge(map, "shelter-open", { glyph: "shelter", ring: SHELTER_COLORS.open, ink: SHELTER_COLORS.open });
  map.addLayer({
    id: "shelters-dot", type: "symbol", source: "shelters",
    layout: {
      "icon-image": ["case", ["get", "open"], "mk-shelter-open", "mk-shelter-site"],
      "icon-size": ["case", ["get", "open"], ["*", ICON_SIZE, 1.15], ICON_SIZE],
      "icon-allow-overlap": true, "symbol-sort-key": ["case", ["get", "open"], -1, 0],
    },
    paint: { "icon-opacity": ["case", ["get", "open"], 1, 0.75] },
  }, beforeId);
  map.addLayer({
    id: "shelters-label", type: "symbol", source: "shelters", minzoom: 11, filter: ["get", "open"],
    layout: {
      "text-field": ["get", "name"], "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": 11.5, "text-offset": [0, 1.4], "text-anchor": "top", "text-max-width": 10, "text-optional": true,
    },
    paint: { "text-color": SHELTER_COLORS.open, "text-halo-color": "#0a1119", "text-halo-width": 1.6 },
  });
  map.on("mouseenter", "shelters-dot", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "shelters-dot", () => (map.getCanvas().style.cursor = ""));

  const card = document.createElement("div");
  card.id = "shelters-legend";
  card.className = "radar-legend";
  card.hidden = true;
  document.getElementById("legend-dock").append(card);

  function setData() {
    const feats = [
      ...sites.map((s, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: s.at },
        properties: { kind: "site", i, open: false, name: s.name } })),
      ...open.map((s, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: s.at },
        properties: { kind: "open", i, open: true, name: s.name } })),
    ];
    map.getSource("shelters")?.setData({ type: "FeatureCollection", features: feats });
  }

  async function loadSites() {
    try { sites = (await loadShelterSites()).filter((s) => Number.isFinite(s.at[0])); siteErr = null; loadedSitesAt = Date.now(); }
    catch (e) { siteErr = e; }
    setData(); render();
  }
  async function loadOpen() {
    try { open = (await loadOpenShelters()).filter((s) => Number.isFinite(s.at[0])); openErr = null; loadedOpenAt = Date.now(); }
    catch (e) { openErr = e; }
    setData(); render();
  }

  function render() {
    if (!on) return;
    card.innerHTML = `
      <div class="rl-head"><span class="rl-title">Shelters</span><span class="rl-time">${loadedSitesAt ? "HIFLD" : siteErr ? "unavailable" : "loading…"}</span></div>
      <p class="fc-head">${!loadedOpenAt ? "Checking for shelters open right now…" :
        open.length ? `${open.length} shelter${open.length === 1 ? "" : "s"} open right now in Texas` : "No shelter is listed as open right now"}</p>
      ${open.length ? `<ul class="fc-list">${open.slice(0, 6).map((s) => `<li><button type="button" class="fc-row" data-open="${open.indexOf(s)}" style="--c:${SHELTER_COLORS.open}">
        <span class="fc-dot" aria-hidden="true"></span><span class="fc-name">${esc(s.name)}</span><span class="fc-meta">${esc(s.city || "")}</span></button></li>`).join("")}</ul>` : ""}
      <p class="rl-note">${sites.length ? `${sites.length.toLocaleString()} registered sites shown quietly in the background — schools, churches, community centers that CAN serve as a shelter, not a live status. ` : ""}Call ahead — a listing doesn't mean it's open today.</p>`;
  }

  function openOne(kind, i) {
    const s = kind === "open" ? open[i] : sites[i];
    if (!s) return;
    document.getElementById("shelter-body").innerHTML = `
      <p class="fire-kind" style="--c:${kind === "open" ? SHELTER_COLORS.open : SHELTER_COLORS.site}">${kind === "open" ? "Open right now" : "Registered shelter site"}</p>
      <p class="near-note">${esc(s.address || "")}${s.city ? `, ${esc(s.city)}` : ""}${s.county ? ` · ${esc(s.county)} County` : ""}</p>
      <div class="near-stats">
        ${s.cap != null || s.evacCap != null ? `<div><span class="st-l">Capacity</span><span class="st-v fire-v">${(s.cap ?? s.evacCap).toLocaleString()}</span></div>` : ""}
        ${s.pets ? `<div><span class="st-l">Pets</span><span class="st-v fire-v">Yes</span></div>` : ""}
      </div>
      <p class="sheet-small">${kind === "open"
        ? `${s.org ? `Run by ${esc(s.org)}. ` : ""}From FEMA's Shelter System. Call ahead before heading there — capacity and status can change fast.`
        : "A registered site that can serve as a shelter, not a live status — most days it's closed. From the Department of Homeland Security's HIFLD National Shelter System."}</p>`;
    openSheet("shelter", s.name);
  }
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (b) { const s = open[+b.dataset.open]; map.flyTo({ center: s.at, zoom: Math.max(map.getZoom(), 11) }); openOne("open", +b.dataset.open); }
  });
  map.on("click", "shelters-dot", (e) => {
    const f = e.features[0];
    if (!f) return;
    openOne(f.properties.open ? "open" : "site", f.properties.i);
  });

  loadOpen();
  setInterval(() => on && !document.hidden && loadOpen(), OPEN_TTL);

  return {
    layerIds: ["shelters-dot", "shelters-label"],
    onToggle(v) {
      on = v; card.hidden = !v;
      if (v && !loadedSitesAt) loadSites();
      if (v) render();
    },
    openShelter: openOne,
  };
}
