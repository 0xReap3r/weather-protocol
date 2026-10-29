// Storms chip: NOAA Storm Prediction Center outlooks for days 1–3, drawn as glowing risk
// contours instead of flat blobs:
//   - nested bands with a soft luminous edge and a crisp contour line, brighter as risk climbs
//   - a hazard hatch on Enhanced and above, a slow "breathing" glow on Moderate and High
//   - the level name written along each contour, like a forecaster's map
// The card shows the 1–5 scale with where the current region sits, the main threats here
// (tornado, hail, wind chances from SPC), and lets you view each hazard on its own.
// Watches and warnings stay on the Warnings layer. An outlook is a chance over a wide area,
// never a warning for a street.
import { fetchJSON } from "./data/fetch.js";
import { t } from "./i18n.js";
import { contains } from "./near.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SPC = "https://www.spc.noaa.gov/products/outlook";
const TTL = 15 * 60 * 1000;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// SPC's five categories plus general thunderstorms. Same order and meaning as SPC's map,
// in a palette tuned for a dark map (green → yellow → orange → red → magenta).
export const SPC_LEVELS = [
  { code: "TSTM", name: "Thunderstorms", n: 0, fill: "#7fb8a4", note: "Storms possible, not expected to be severe" },
  { code: "MRGL", name: "Marginal", n: 1, fill: "#34d399", note: "Isolated severe storms possible" },
  { code: "SLGT", name: "Slight", n: 2, fill: "#facc15", note: "Scattered severe storms possible" },
  { code: "ENH", name: "Enhanced", n: 3, fill: "#fb923c", note: "Numerous severe storms possible" },
  { code: "MDT", name: "Moderate", n: 4, fill: "#f43f5e", note: "Widespread severe storms likely" },
  { code: "HIGH", name: "High", n: 5, fill: "#e879f9", note: "Widespread, long-lived, intense storms expected" },
];
const BY_CODE = Object.fromEntries(SPC_LEVELS.map((l) => [l.code, l]));

// Probability contours for single hazards (chance of that hazard within 25 miles of a point).
const PROB = [
  { p: 2, color: "#2dd4bf" }, { p: 5, color: "#a3e635" }, { p: 10, color: "#facc15" }, { p: 15, color: "#fb923c" },
  { p: 30, color: "#f43f5e" }, { p: 45, color: "#e879f9" }, { p: 60, color: "#c084fc" },
];
const probStep = (p) => PROB.reduce((best, x, i) => (p >= x.p ? i : best), 0);

const DAYS = ["Today", "Tomorrow", "Day 3"];
// Which products exist for each day, as SPC publishes them.
const VIEWS = {
  1: [["cat", "Overall"], ["torn", "Tornado"], ["hail", "Hail"], ["wind", "Wind"]],
  2: [["cat", "Overall"], ["torn", "Tornado"], ["hail", "Hail"], ["wind", "Wind"]],
  3: [["cat", "Overall"], ["prob", "Any severe"]],
};
const HAZARD_ICON = {
  torn: '<path d="M4 5h16M6 9h12M8 13h8M10 17h5M12 21h1"/>',
  hail: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="8" r="2.4"/><circle cx="12" cy="16" r="3.4"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>',
  prob: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
};

// Diagonal hazard hatch, drawn once per color as a map image.
function hatch(color, alpha) {
  const s = 24, ratio = 2, px = s * ratio;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");
  g.strokeStyle = color; g.globalAlpha = alpha; g.lineWidth = 2.2 * ratio; g.lineCap = "square";
  for (let o = -px; o <= px * 2; o += 8 * ratio) { g.beginPath(); g.moveTo(o, px); g.lineTo(o + px, 0); g.stroke(); }
  return { width: px, height: px, data: g.getImageData(0, 0, px, px).data, pixelRatio: ratio };
}

export function initStorms({ map, beforeId, metro }) {
  const cache = {}; // `${day}:${product}` -> { at, fc }
  let day = 1, view = "cat", on = false, pulseRaf = null;
  let summary = null; // { here, state, threats, issued, empty }
  let demo = false;   // stormlineStorms.demo(): a made-up outlook to preview the look

  for (const l of SPC_LEVELS.filter((x) => x.n >= 3)) map.addImage(`spc-hatch-${l.code}`, hatch(l.fill, 0.32), { pixelRatio: 2 });

  map.addSource("storms", { type: "geojson", data: { type: "FeatureCollection", features: [] }, tolerance: 0.6 });
  const above = (n) => [">=", ["get", "lvl"], n];
  // 1) Faint wash: most of the color lives in the glowing edges, not a flat tint over the area.
  map.addLayer({ id: "storms-fill", type: "fill", source: "storms", filter: above(1),
    paint: { "fill-color": ["get", "color"], "fill-opacity": ["interpolate", ["linear"], ["get", "lvl"], 1, 0.025, 3, 0.055, 5, 0.1], "fill-antialias": false } }, beforeId);
  // 2) Hazard hatch on Enhanced and above.
  map.addLayer({ id: "storms-hatch", type: "fill", source: "storms", filter: ["all", above(3), ["has", "hatch"]],
    paint: { "fill-pattern": ["get", "hatch"], "fill-opacity": 0.9 } }, beforeId);
  // 3) Luminous edge: a wide, fully blurred line gives each contour a glow.
  const glowWidth = ["interpolate", ["linear"], ["zoom"], 4, ["*", 6, ["get", "w"]], 8, ["*", 14, ["get", "w"]], 12, ["*", 22, ["get", "w"]]];
  map.addLayer({ id: "storms-glow", type: "line", source: "storms", filter: ["all", above(1), ["<", ["get", "lvl"], 4]],
    layout: { "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": glowWidth, "line-blur": glowWidth, "line-opacity": 0.42 } }, beforeId);
  map.addLayer({ id: "storms-glow-hot", type: "line", source: "storms", filter: above(4),
    layout: { "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": glowWidth, "line-blur": glowWidth, "line-opacity": 0.5 } }, beforeId);
  // 4) Crisp contour.
  map.addLayer({ id: "storms-edge", type: "line", source: "storms", filter: above(1),
    layout: { "line-join": "round" },
    paint: { "line-color": ["get", "edge"], "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1, 10, ["+", 1, ["*", 0.35, ["get", "lvl"]]]], "line-opacity": 0.95 } }, beforeId);
  // General thunderstorms: just a fine dotted line.
  map.addLayer({ id: "storms-tstm", type: "line", source: "storms", filter: ["==", ["get", "lvl"], 0],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#7fb8a4", "line-width": 1.2, "line-opacity": 0.6, "line-dasharray": [0.2, 2.4] } }, beforeId);
  // 5) Names written along the contours.
  map.addLayer({ id: "storms-label", type: "symbol", source: "storms",
    layout: {
      "symbol-placement": "line", "symbol-spacing": 420, "text-field": ["get", "label"], "text-keep-upright": true,
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 12.5], "text-letter-spacing": 0.14, "text-max-angle": 30,
      "text-offset": [0, -0.9],
    },
    paint: { "text-color": ["get", "edge"], "text-halo-color": "#0b0f14", "text-halo-width": 2, "text-opacity": ["case", ["==", ["get", "lvl"], 0], 0.7, 1] } });

  const card = document.createElement("div");
  card.id = "storms-legend";
  card.className = "radar-legend storms-legend so-card";
  card.hidden = true;
  document.getElementById("radar-legend").after(card);

  async function load(d, product) {
    const key = `${d}:${product}`;
    const c = cache[key];
    if (c && Date.now() - c.at < TTL) return c.fc;
    const fc = await fetchJSON(`${SPC}/day${d}otlk_${product}.lyr.geojson`, { timeout: 15000 });
    cache[key] = { at: Date.now(), fc };
    return fc;
  }

  // Points that stand for "here": the region's towns, or towns statewide when zoomed out.
  const herePoints = () => {
    const towns = metro.id === metro.state.id ? metro.cities : metro.regionCities;
    const pts = towns.map(([, lat, lng]) => [lng, lat]);
    return pts.length ? pts : [metro.center];
  };
  const maxOver = (fc, pts, valueOf) => {
    let best = 0;
    for (const f of fc?.features || []) {
      const v = valueOf(f.properties);
      if (v > best && f.geometry && pts.some((p) => contains(f.geometry, p))) best = v;
    }
    return best;
  };
  const catLevel = (p) => BY_CODE[p.LABEL]?.n ?? -1;
  const probOf = (p) => { const v = parseFloat(p.LABEL); return Number.isFinite(v) && v < 1 ? Math.round(v * 100) : 0; };

  function featuresFor(fc, product) {
    const out = [];
    for (const f of fc?.features || []) {
      if (!f.geometry || f.geometry.type === "GeometryCollection" && !f.geometry.geometries?.length) continue;
      if (product === "cat") {
        const l = BY_CODE[f.properties.LABEL];
        if (!l) continue;
        out.push({ type: "Feature", geometry: f.geometry, properties: {
          lvl: l.n, color: l.fill, edge: l.n ? l.fill : "#9fd2c0", w: l.n >= 4 ? 1.4 : 1,
          label: l.n ? `${t(l.name).toUpperCase()} · ${l.n}/5` : t("Thunderstorms").toUpperCase(), ...(l.n >= 3 ? { hatch: `spc-hatch-${l.code}` } : {}) } });
      } else {
        const p = probOf(f.properties);
        if (!p) continue;
        const i = probStep(p);
        out.push({ type: "Feature", geometry: f.geometry, properties: {
          lvl: Math.min(5, i + 1), color: PROB[i].color, edge: PROB[i].color, w: 1, label: `${p}%` } });
      }
    }
    return out.sort((a, b) => a.properties.lvl - b.properties.lvl);
  }

  async function show() {
    if (!on) return;
    const d = day, v = VIEWS[d].some(([id]) => id === view) ? view : "cat";
    let fc = null, err = null;
    try { fc = await load(d, v); } catch (e) { err = e; }
    if (!on || d !== day || demo) return;
    map.getSource("storms")?.setData({ type: "FeatureCollection", features: featuresFor(fc, v) });
    // Summary for the card: category here and statewide, plus hazard chances here.
    const pts = herePoints();
    let cat = v === "cat" ? fc : null;
    try { cat = cat || (await load(d, "cat")); } catch (_) {}
    const statePts = metro.cities.map(([, lat, lng]) => [lng, lat]);
    const threats = {};
    for (const [id] of VIEWS[d].slice(1)) {
      try { threats[id] = maxOver(await load(d, id), pts, probOf); } catch (_) { threats[id] = null; }
    }
    const f0 = (cat?.features || [])[0]?.properties;
    summary = {
      here: cat ? maxOver(cat, pts, catLevel) : null,
      anyStorms: cat ? (cat.features || []).some((f) => f.properties.LABEL === "TSTM" && f.geometry && pts.some((p) => contains(f.geometry, p))) : false,
      state: cat && statePts.length ? maxOver(cat, statePts, catLevel) : null,
      threats, issued: f0?.ISSUE_ISO || null, err,
    };
    render();
    startPulse();
  }

  function render() {
    const s = summary;
    const issued = s?.issued ? new Date(s.issued).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    const here = s?.here ?? null;
    const L = here > 0 ? SPC_LEVELS[here] : null;
    const place = metro.id === metro.state.id ? "Texas" : metro.name;
    const headline = s == null ? "Loading the outlook…"
      : s.err ? "The outlook isn't loading right now."
      : L ? `${L.name} risk ${DAYS[day - 1] === "Today" ? "today" : DAYS[day - 1] === "Tomorrow" ? "tomorrow" : "on day 3"}`
      : s.anyStorms ? "Thunderstorms possible, not expected to be severe" : "No severe storms expected";
    const views = VIEWS[day];
    card.style.setProperty("--so", L ? L.fill : "#7fb8a4");
    card.innerHTML = `
      <div class="rl-head">
        <span class="rl-title">Storm outlook</span>
        <span class="rl-time">${issued ? `SPC · ${esc(issued)}` : s?.err ? "unavailable" : "loading…"}</span>
      </div>
      <div class="sl-days" role="group" aria-label="Outlook day">${DAYS.map((n, i) =>
        `<button type="button" class="sl-day" data-storm-day="${i + 1}" aria-pressed="${day === i + 1}">${n}</button>`).join("")}</div>
      <p class="so-place">${esc(place)}</p>
      <p class="so-head">${esc(headline)}</p>
      ${L ? `<p class="so-note">${esc(L.note)}.</p>` : ""}
      <div class="so-scale" role="img" aria-label="Risk ${here > 0 ? `${here} of 5` : "below 1 of 5"} here">
        ${SPC_LEVELS.slice(1).map((l) => `<span class="so-seg${here >= l.n ? " on" : ""}${here === l.n ? " here" : ""}" style="--c:${l.fill}"><i>${l.n}</i><b>${l.name}</b></span>`).join("")}
      </div>
      ${s && s.state > (here ?? 0) ? `<p class="so-note">Highest in Texas: <strong style="color:${SPC_LEVELS[s.state].fill}">${SPC_LEVELS[s.state].name} (${s.state}/5)</strong></p>` : ""}
      ${s && Object.keys(s.threats || {}).length ? `<div class="so-threats">${Object.entries(s.threats).map(([id, p]) => {
        const name = views.find((x) => x[0] === id)?.[1] || id;
        const c = p ? PROB[probStep(p)].color : "var(--text-dim)";
        return `<span class="so-threat" style="--c:${c}"><svg viewBox="0 0 24 24" aria-hidden="true">${HAZARD_ICON[id]}</svg><span>${esc(name)}</span><strong>${p == null ? "—" : p ? `${p}%` : `<${id === "torn" ? 2 : 5}%`}</strong></span>`;
      }).join("")}</div>` : ""}
      <div class="so-views" role="group" aria-label="Show on the map">${views.map(([id, n]) =>
        `<button type="button" data-storm-view="${id}" aria-pressed="${(views.some((x) => x[0] === view) ? view : "cat") === id}">${esc(n)}</button>`).join("")}</div>
      <p class="rl-note">${view === "cat" ? "Glowing contours are SPC's risk levels; hatching marks Enhanced and up." : "Chance of that hazard within 25 miles of a point."} From NOAA's Storm Prediction Center. Not a warning.</p>`;
  }

  // Moderate and High edges breathe slowly so they catch the eye (skipped for reduced motion).
  function startPulse() {
    if (pulseRaf || reduceMotion.matches) return;
    const t0 = performance.now();
    const frame = (now) => {
      const hot = on && (map.getSource("storms")?._data?.features || []).some((f) => f.properties.lvl >= 4);
      if (!hot) { pulseRaf = null; return; }
      const k = 0.5 + 0.5 * Math.sin(((now - t0) / 2600) * Math.PI * 2);
      map.setPaintProperty("storms-glow-hot", "line-opacity", 0.3 + 0.35 * k);
      pulseRaf = requestAnimationFrame(frame);
    };
    pulseRaf = requestAnimationFrame(frame);
  }

  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-storm-day]");
    if (b) { day = Number(b.dataset.stormDay); summary = null; render(); show(); return; }
    const v = e.target.closest("[data-storm-view]");
    if (v) { view = v.dataset.stormView; render(); show(); }
  });
  metro.onChange(() => on && show());
  setInterval(() => on && !document.hidden && show(), TTL);

  // Debug/preview: nested made-up risk areas around a point, levels 0–5. Reload to clear.
  function demoOutlook(center = metro.center) {
    const [cx, cy] = center;
    const blob = (rx, ry, seed) => {
      const pts = [];
      for (let i = 0; i <= 120; i++) {
        const t = (i / 120) * Math.PI * 2, r = 1 + 0.1 * Math.sin(3 * t + seed) + 0.06 * Math.cos(5 * t + seed * 2);
        const x = rx * r * Math.cos(t), y = ry * r * Math.sin(t), a = 0.55;
        pts.push([cx + 0.15 * seed + x * Math.cos(a) - y * Math.sin(a), cy + 0.05 * seed + x * Math.sin(a) + y * Math.cos(a)]);
      }
      pts[120] = pts[0];
      return { type: "Polygon", coordinates: [pts] };
    };
    const sizes = [[4.2, 2.6], [3.3, 2.0], [2.5, 1.5], [1.7, 1.0], [1.0, 0.6], [0.45, 0.28]];
    const fc = { type: "FeatureCollection", features: SPC_LEVELS.map((l, i) => ({ type: "Feature", geometry: blob(...sizes[i], i), properties: { LABEL: l.code } })) };
    demo = true;
    map.getSource("storms")?.setData({ type: "FeatureCollection", features: featuresFor(fc, "cat") });
    summary = { ...(summary || {}), here: 5, state: 5, anyStorms: true, threats: { torn: 30, hail: 45, wind: 60 }, issued: new Date().toISOString() };
    render();
    startPulse();
    return "Demo outlook on: reload to clear";
  }

  return {
    demo: demoOutlook,
    layerIds: ["storms-fill", "storms-hatch", "storms-glow", "storms-glow-hot", "storms-edge", "storms-tstm", "storms-label"],
    onToggle(v) { on = v; card.hidden = !v; if (v) { render(); show(); } },
    // Highest SPC category today over any of these points (used for fast polling): 0 none … 5 high.
    async levelToday(points) {
      try { return Math.max(0, maxOver(await load(1, "cat"), points, catLevel)); } catch (_) { return 0; }
    },
  };
}
