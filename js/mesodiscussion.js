// Mesoscale discussions chip: SPC's short-fuse "we're watching this area" notes, usually posted
// 1-4 hours before a watch (or deciding against one). Short-lived and usually empty — most hours
// nothing is in effect. The service always returns one placeholder feature (name "NoArea") when
// nothing is active; that one is filtered out rather than drawn.
import { fetchJSON } from "./data/fetch.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const MD_FILL = "#a900e6";
export const MD_LINE = "#d27bff";
const URL = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query"
  + "?where=1%3D1&outFields=*&returnGeometry=true&f=geojson";
const TTL = 3 * 60 * 1000; // SPC posts these on no fixed schedule; poll often while the chip is on

export function initMesoDiscussion({ map, beforeId, openSheet }) {
  let on = false, discussions = [], loadedAt = null, err = null;

  map.addSource("meso", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "meso-fill", type: "fill", source: "meso", paint: { "fill-color": MD_FILL, "fill-opacity": 0.22 } }, beforeId);
  map.addLayer({ id: "meso-glow", type: "line", source: "meso",
    paint: { "line-color": MD_FILL, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 6, 10, 14], "line-blur": 10, "line-opacity": 0.35 } });
  map.addLayer({ id: "meso-line", type: "line", source: "meso", paint: { "line-color": MD_LINE, "line-width": 1.6, "line-opacity": 0.9 } });
  map.addLayer({ id: "meso-label", type: "symbol", source: "meso",
    layout: { "symbol-placement": "point", "text-field": ["concat", "MD ", ["get", "num"]],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"], "text-size": 12, "text-allow-overlap": false },
    paint: { "text-color": MD_LINE, "text-halo-color": "#0a1119", "text-halo-width": 1.6 } });
  map.on("mouseenter", "meso-fill", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "meso-fill", () => (map.getCanvas().style.cursor = ""));

  const card = document.createElement("div");
  card.id = "meso-legend";
  card.className = "radar-legend";
  card.hidden = true;
  document.getElementById("legend-dock").append(card);

  async function load() {
    try {
      const fc = await fetchJSON(URL, { timeout: 15000 });
      discussions = (fc.features || [])
        .filter((f) => f.properties?.name && f.properties.name !== "NoArea" && f.geometry)
        .map((f) => ({
          num: f.properties.name, info: f.properties.folderpath || "", link: linkFor(f.properties),
          date: f.properties.idp_filedate || f.properties.idp_ingestdate || null, geometry: f.geometry,
        }));
      err = null; loadedAt = Date.now();
    } catch (e) { err = e; }
    map.getSource("meso")?.setData({
      type: "FeatureCollection",
      features: discussions.map((d) => ({ type: "Feature", geometry: d.geometry, properties: { num: d.num } })),
    });
    render();
  }

  function linkFor(p) {
    const m = /MD(\d{4})/.exec(p.folderpath || "") || /md(\d{4})/.exec(p.popupinfo || "");
    return m ? `https://www.spc.noaa.gov/products/md/${new Date().getFullYear()}/md${m[1]}.html` : "https://www.spc.noaa.gov/products/md/";
  }

  function render() {
    if (!on) return;
    card.innerHTML = `
      <div class="rl-head"><span class="rl-title">Mesoscale discussions</span><span class="rl-time">${loadedAt ? "SPC" : err ? "unavailable" : "loading…"}</span></div>
      <p class="fc-head">${err && !loadedAt ? "Mesoscale discussions aren't loading right now." : !loadedAt ? "Loading…" :
        discussions.length ? `${discussions.length} discussion${discussions.length === 1 ? "" : "s"} in effect` : "No mesoscale discussion in effect"}</p>
      ${discussions.length ? `<ul class="fc-list">${discussions.map((d) => `<li><button type="button" class="fc-row" data-md="${d.num}" style="--c:${MD_LINE}">
        <span class="fc-dot" aria-hidden="true"></span><span class="fc-name">MD ${esc(d.num)}</span><span class="fc-meta">${esc(d.info)}</span></button></li>`).join("")}</ul>` : ""}
      <p class="rl-note">A forecaster explaining what they're watching for the next 1–4 hours — not a watch or warning itself.</p>`;
  }

  function openOne(num) {
    const d = discussions.find((x) => x.num === num);
    if (!d) return;
    document.getElementById("meso-body").innerHTML = `
      <p class="fire-kind" style="--c:${MD_LINE}">Mesoscale discussion ${esc(d.num)}</p>
      <p class="near-note">${esc(d.info)}</p>
      <p class="sheet-small">Full discussion text: <a href="${esc(d.link)}" target="_blank" rel="noopener">spc.noaa.gov</a>. From the NOAA Storm Prediction Center.</p>`;
    openSheet("meso", `MD ${d.num}`);
  }
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-md]");
    if (b) {
      const d = discussions.find((x) => x.num === b.dataset.md);
      if (d?.geometry) {
        const pts = [];
        (function flatten(a) { if (typeof a[0] === "number") pts.push(a); else a.forEach(flatten); })(d.geometry.coordinates);
        const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
        if (lngs.length) map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: 9 });
      }
      openOne(b.dataset.md);
    }
  });
  map.on("click", "meso-fill", (e) => { const f = e.features[0]; if (f) openOne(f.properties.num); });

  load();
  setInterval(() => on && !document.hidden && load(), TTL);

  return {
    layerIds: ["meso-fill", "meso-glow", "meso-line", "meso-label"],
    onToggle(v) { on = v; card.hidden = !v; if (v) render(); },
    openDiscussion: openOne,
  };
}
