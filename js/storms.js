// Storms chip: NOAA Storm Prediction Center severe-storm outlook (days 1–3), shaded in SPC's own
// colors, with a small legend card to switch days. Watches and warnings stay on the Warnings layer.
// An outlook is a chance of severe storms over a broad area, never a warning for a street.
import { fetchJSON } from "./data/fetch.js";
import { contains } from "./near.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const URL = (d) => `https://www.spc.noaa.gov/products/outlook/day${d}otlk_cat.lyr.geojson`;
const TTL = 15 * 60 * 1000;

// SPC's five levels plus general thunderstorms, in SPC's published colors.
export const SPC_LEVELS = [
  { code: "TSTM", name: "Thunderstorms", n: 0, fill: "#C1E9C1", note: "Storms possible, not expected to be severe" },
  { code: "MRGL", name: "Marginal", n: 1, fill: "#66A366", note: "Isolated severe storms possible" },
  { code: "SLGT", name: "Slight", n: 2, fill: "#FFE066", note: "Scattered severe storms possible" },
  { code: "ENH", name: "Enhanced", n: 3, fill: "#FFA366", note: "Numerous severe storms possible" },
  { code: "MDT", name: "Moderate", n: 4, fill: "#E06666", note: "Widespread severe storms likely" },
  { code: "HIGH", name: "High", n: 5, fill: "#EE99EE", note: "Widespread, long-lived, intense storms expected" },
];
const BY_CODE = Object.fromEntries(SPC_LEVELS.map((l) => [l.code, l]));
const DAY_NAMES = ["Today", "Tomorrow", "Day 3"];

export function initStorms({ map, beforeId }) {
  const cache = {}; // day -> { at, fc }
  let day = 1;
  let on = false;

  map.addSource("storms", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "storms-fill", type: "fill", source: "storms",
    paint: { "fill-color": ["get", "fill"], "fill-opacity": ["case", ["==", ["get", "LABEL"], "TSTM"], 0.1, 0.22] },
  }, beforeId);
  map.addLayer({
    id: "storms-line", type: "line", source: "storms",
    paint: { "line-color": ["get", "stroke"], "line-width": ["case", ["==", ["get", "LABEL"], "TSTM"], 1, 2], "line-opacity": 0.9 },
  }, beforeId);
  map.addLayer({
    id: "storms-label", type: "symbol", source: "storms", filter: ["!=", ["get", "LABEL"], "TSTM"],
    layout: {
      "text-field": ["get", "title"],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": 11, "text-letter-spacing": 0.06, "symbol-placement": "point", "text-max-width": 14,
    },
    paint: { "text-color": ["get", "fill"], "text-halo-color": "#0b0f14", "text-halo-width": 2 },
  });

  // Legend card, below the radar legend in the top bar.
  const card = document.createElement("div");
  card.id = "storms-legend";
  card.className = "radar-legend storms-legend";
  card.hidden = true;
  document.getElementById("radar-legend").after(card);

  async function load(d, force = false) {
    const c = cache[d];
    if (!force && c && Date.now() - c.at < TTL) return c.fc;
    const fc = await fetchJSON(URL(d), { timeout: 15000 });
    cache[d] = { at: Date.now(), fc };
    return fc;
  }

  function render(fc, err) {
    const f0 = fc?.features?.[0]?.properties;
    const issued = f0?.ISSUE_ISO ? new Date(f0.ISSUE_ISO).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    const present = new Set((fc?.features || []).map((f) => f.properties.LABEL));
    card.innerHTML = `
      <div class="rl-head">
        <span class="rl-title">Storm outlook</span>
        <span class="rl-time">${err ? "unavailable" : issued ? `SPC · ${esc(issued)}` : "loading…"}</span>
      </div>
      <div class="sl-days" role="group" aria-label="Outlook day">${DAY_NAMES.map((n, i) =>
        `<button type="button" class="sl-day" data-storm-day="${i + 1}" aria-pressed="${day === i + 1}">${n}</button>`).join("")}</div>
      <ul class="rl-drops sl-levels">${SPC_LEVELS.slice(1).map((l) =>
        `<li class="${present.has(l.code) ? "on" : ""}"><span class="sl-sw" style="--c:${l.fill}"></span>${l.n} ${l.name}</li>`).join("")}</ul>
      <p class="rl-note">${fc && !fc.features?.length ? "No thunderstorms outlined. " : ""}Chance of severe storms over a wide area, from NOAA. Not a warning.</p>`;
  }

  async function show() {
    if (!on) return;
    let fc = null, err = null;
    try { fc = await load(day); } catch (e) { err = e; }
    if (!on) return;
    const features = (fc?.features || []).map((f) => {
      const lvl = BY_CODE[f.properties.LABEL];
      return { ...f, properties: { ...f.properties, fill: f.properties.fill || lvl?.fill || "#888", stroke: f.properties.stroke || "#888",
        title: lvl ? `${lvl.name.toUpperCase()} RISK${lvl.n ? ` · ${lvl.n} OF 5` : ""}` : f.properties.LABEL2 || "" } };
    });
    map.getSource("storms")?.setData({ type: "FeatureCollection", features });
    render(fc, err);
  }

  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-storm-day]");
    if (!b) return;
    day = Number(b.dataset.stormDay);
    render(cache[day]?.fc || null);
    show();
  });
  setInterval(() => on && !document.hidden && show(), TTL);

  return {
    layerIds: ["storms-fill", "storms-line", "storms-label"],
    onToggle(v) { on = v; card.hidden = !v; if (v) { render(cache[day]?.fc || null); show(); } },
    // Highest SPC level today over any of these points (used for fast polling): 0 none … 5 high.
    async levelToday(points) {
      try {
        const fc = await load(1);
        let best = 0;
        for (const f of fc.features || []) {
          const n = BY_CODE[f.properties.LABEL]?.n || 0;
          if (n > best && points.some((pt) => contains(f.geometry, pt))) best = n;
        }
        return best;
      } catch (_) { return 0; }
    },
  };
}
