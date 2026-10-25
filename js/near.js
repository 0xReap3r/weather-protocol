// "Near you" panel: answers "am I OK right here?" before the reader studies the map.
// The spot is the map center by default (no permission needed) or the reader's location.
// Wording rule: we report what official sources say. We never call a place "safe".

import { fetchJSON } from "./data/fetch.js";
import { CATEGORY } from "./data/gauges.js";
import { loadRainNow } from "./data/rain.js";
import { femaZone } from "./data/floodmaps.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Geometry ---------- */
function milesBetween([lng1, lat1], [lng2, lat2]) {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(pt, rings) {
  return inRing(pt, rings[0]) && !rings.slice(1).some((hole) => inRing(pt, hole));
}
function contains(geom, pt) {
  if (!geom) return false;
  if (geom.type === "Polygon") return inPolygon(pt, geom.coordinates);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((p) => inPolygon(pt, p));
  if (geom.type === "GeometryCollection") return geom.geometries.some((g) => contains(g, pt));
  return false;
}
// Rough distance from a point to a polygon's nearest vertex — good enough for "nearby".
function milesToGeom(geom, pt) {
  let best = Infinity;
  const walk = (c) => (typeof c[0] === "number" ? (best = Math.min(best, milesBetween(pt, c))) : c.forEach(walk));
  if (geom.type === "GeometryCollection") geom.geometries.forEach((g) => walk(g.coordinates));
  else walk(geom.coordinates);
  return best;
}

/* ---------- NWS point info + hourly forecast (cached per ~3-mile grid cell) ---------- */
const pointCache = new Map(); // key -> { place, hourly, at }
const POINT_TTL = 30 * 60 * 1000;
async function pointInfo([lng, lat]) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = pointCache.get(key);
  if (hit && Date.now() - hit.at < POINT_TTL) return hit;
  const p = await fetchJSON(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, { timeout: 12000 });
  const rel = p.properties?.relativeLocation?.properties || {};
  let hourly = null;
  try {
    const h = await fetchJSON(p.properties.forecastHourly, { timeout: 12000 });
    const periods = h.properties?.periods || [];
    const now = periods.find((x) => Date.parse(x.endTime) > Date.now()) || periods[0];
    const next6 = periods.slice(0, 6);
    hourly = now && {
      temp: now.temperature,
      unit: now.temperatureUnit,
      wind: `${now.windSpeed} ${now.windDirection || ""}`.trim(),
      sky: now.shortForecast,
      rainNow: now.probabilityOfPrecipitation?.value ?? null,
      rainMax6: Math.max(0, ...next6.map((x) => x.probabilityOfPrecipitation?.value ?? 0)),
      next12: periods
        .filter((x) => Date.parse(x.endTime) > Date.now())
        .slice(0, 12)
        .map((x) => ({ t: x.startTime, pop: x.probabilityOfPrecipitation?.value ?? 0 })),
    };
  } catch (_) { /* forecast is a nice-to-have; the panel works without it */ }
  const out = { place: rel.city ? `${rel.city}, ${rel.state}` : null, hourly, at: Date.now() };
  pointCache.set(key, out);
  return out;
}

/* ---------- Rain falling now (Open-Meteo nowcast) ---------- */
const clockTime = (local) => {
  const [h, m] = local.slice(11, 16).split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
function rainCard(rain) {
  if (!rain) return `<p class="near-note rain-line">Checking for rain…</p>`;
  if (rain.failed) return `<p class="near-note rain-line">Rain-now data is unavailable right now.</p>`;
  if (!rain.level) {
    const soon = rain.startsAt
      ? ` ${rain.peakLevel ? rain.peakLevel.label : "Light"} rain may start around ${clockTime(rain.startsAt)}.`
      : " None expected in the next 2 hours.";
    return `<p class="near-note rain-line"><span class="rain-dot"></span>No rain falling here now.${soon}</p>`;
  }
  const l = rain.level;
  const segs = [1, 2, 3, 4].map((n) => `<span class="${n <= l.bars ? "on" : ""}"></span>`).join("");
  return `<section class="rain-card" data-level="${l.key}">
      <p class="rc-head"><span>Rain now</span><span>${esc(rain.rate.toFixed(2))} in/hr</span></p>
      <h3 class="rc-title"><span class="rc-icon" aria-hidden="true"></span>${esc(l.label)} rain over you</h3>
      <div class="rc-bar" aria-hidden="true">${segs}</div>
      <p class="rc-advice">${esc(l.advice)}</p>
      <p class="rc-src">Model nowcast (Open-Meteo, NOAA HRRR), updated every 15 min. Not a radar reading.</p>
    </section>`;
}

/* ---------- FEMA flood zone for the spot ---------- */
function zoneRow(zone) {
  if (!zone) return `<h3 class="near-h">FEMA flood zone</h3><p class="near-note">Checking FEMA's flood map…</p>`;
  if (zone.failed) return `<h3 class="near-h">FEMA flood zone</h3><p class="near-note">FEMA's flood map isn't responding right now.</p>`;
  return `<h3 class="near-h">FEMA flood zone</h3>
    <div class="near-zone" data-risk="${esc(zone.risk)}">
      <span class="nz-label">${esc(zone.label)}</span>
      <span class="nz-note">${esc(zone.note)}</span>
    </div>`;
}

/* ---------- Rain chance, next 12 hours ---------- */
function rainChart(w) {
  if (!w?.next12?.length) return "";
  const W = 320, H = 92, B = 18, T = 14, n = w.next12.length, gap = 4;
  const bw = (W - gap * (n - 1)) / n;
  const bars = w.next12
    .map((p, i) => {
      const h = Math.max(2, ((H - B - T) * p.pop) / 100);
      const x = i * (bw + gap), y = H - B - h;
      const hour = new Date(p.t).toLocaleTimeString([], { hour: "numeric" }).replace(" ", "").toLowerCase();
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${p.pop >= 50 ? "hi" : ""}"/>
        ${p.pop >= 20 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" class="v">${p.pop}</text>` : ""}
        ${i % 3 === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${hour}</text>` : ""}`;
    })
    .join("");
  const peak = Math.max(...w.next12.map((p) => p.pop));
  return `<h3 class="near-h">Rain chance, next 12 hours <span class="near-h-note">${peak ? `peak ${peak}%` : "none expected"}</span></h3>
    <div class="near-rain"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly rain chance, next 12 hours, peak ${peak} percent">${bars}</svg></div>`;
}

/* ---------- Panel ---------- */
export function initNearPanel({ map, metro, getAlertsFC, getGauges, openGauge, openAlerts, locate }) {
  const panel = document.getElementById("near");
  const body = document.getElementById("near-body");
  let mode = "center"; // "center" | "me" | "pin"
  let mePoint = null;
  let pinPoint = null;
  let pinMarker = null;
  let timer = null;
  let renderToken = 0;

  const spot = () =>
    mode === "pin" && pinPoint ? pinPoint : mode === "me" && mePoint ? mePoint : map.getCenter().toArray();

  panel.querySelector("#near-toggle").addEventListener("click", () => panel.classList.toggle("expanded"));
  panel.querySelector("#near-mode-center").addEventListener("click", () => setMode("center"));
  panel.querySelector("#near-mode-me").addEventListener("click", () => locate());

  function setMode(m) {
    mode = m;
    panel.querySelector("#near-mode-center").setAttribute("aria-pressed", String(m === "center"));
    panel.querySelector("#near-mode-me").setAttribute("aria-pressed", String(m === "me"));
    document.body.classList.toggle("near-me-mode", m !== "center");
    if (m !== "pin" && pinMarker) pinMarker.remove();
    render();
  }

  map.on("moveend", () => {
    if (mode !== "center") return;
    clearTimeout(timer);
    timer = setTimeout(render, 500);
  });

  async function render() {
    const token = ++renderToken;
    const pt = spot();
    const fc = getAlertsFC();
    const gauges = getGauges();

    // Warnings: here (point inside the polygon) vs nearby (within 10 miles).
    const here = new Map(), near = new Map();
    for (const f of fc.features) {
      const p = f.properties;
      if (contains(f.geometry, pt)) here.set(p.id, p);
      else if (!here.has(p.id) && milesToGeom(f.geometry, pt) <= 10) near.set(p.id, p);
    }
    for (const id of here.keys()) near.delete(id);
    const hereList = [...here.values()].sort((a, b) => b.rank - a.rank);
    const nearList = [...near.values()].sort((a, b) => b.rank - a.rank);

    let verdict, tone, color = null;
    if (hereList.length) {
      verdict = `${hereList[0].event} here`;
      tone = "here";
      color = hereList[0].color;
    } else if (nearList.length) {
      verdict = `${nearList[0].event} nearby`;
      tone = "near";
      color = nearList[0].color;
    } else {
      verdict = "No NWS warnings here";
      tone = "none";
    }

    // Gauges sorted by distance, with headroom to flood stage.
    const ranked = gauges
      .map((g) => ({ g, mi: milesBetween(pt, [g.lng, g.lat]) }))
      .sort((a, b) => a.mi - b.mi)
      .slice(0, 3);

    const gaugeRows = ranked
      .map(({ g, mi }) => {
        const cat = CATEGORY[g.category];
        const flood = g.stages.minor;
        const gap =
          g.stage == null ? "No recent reading"
          : flood == null ? (g.kind === "lake" ? `Lake level ${g.stage.toFixed(1)} ft` : `${g.stage.toFixed(1)} ft`)
          : g.stage >= flood ? `${(g.stage - flood).toFixed(1)} ft over flood stage`
          : `${(flood - g.stage).toFixed(1)} ft below flood stage`;
        return `<li><button type="button" class="near-gauge" data-lid="${esc(g.lid)}">
          <span class="ng-dot" style="background:${cat.color}"></span>
          <span class="ng-text"><span class="ng-name">${esc(g.short || g.name)}</span><span class="ng-gap">${esc(gap)}</span></span>
          <span class="ng-dist">${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi</span>
        </button></li>`;
      })
      .join("");

    // Draw what we have now; weather fills in when it arrives.
    let info = null, rain = null, zone = null;
    const args = () => ({ verdict, tone, color, hereList, nearList, gaugeRows, info, rain, zone, pt });
    paint(args());
    await Promise.all([
      pointInfo(pt).then((x) => (info = x)).catch(() => (info = { failed: true })),
      loadRainNow(pt).then((x) => (rain = x)).catch(() => (rain = { failed: true })),
      femaZone(pt).then((x) => (zone = x)).catch(() => (zone = { failed: true })),
    ]);
    if (token === renderToken) paint(args());
  }

  function paint({ verdict, tone, color, hereList, nearList, gaugeRows, info, rain, zone, pt }) {
    const inPilot = pt[0] >= metro.bounds[0] && pt[0] <= metro.bounds[2] && pt[1] >= metro.bounds[1] && pt[1] <= metro.bounds[3];
    const where = mode === "pin" ? "Dropped pin" : mode === "me" ? "Your location" : "Map center";
    const place = info?.place ? `${info.place} · ${where}` : where;
    const w = info?.hourly;
    const weather = w
      ? `<div class="near-stats">
          <div><span class="st-l">Alerts here</span><span class="st-v${hereList.length ? " alert" : ""}">${hereList.length}</span></div>
          <div><span class="st-l">Rain, 6 hr</span><span class="st-v">${esc(w.rainMax6)}<small>%</small></span></div>
          <div><span class="st-l">Temp</span><span class="st-v">${esc(w.temp)}<small>°${esc(w.unit)}</small></span></div>
        </div>
        <p class="near-sky">${esc(w.sky)} · wind ${esc(w.wind)}</p>`
      : info?.failed
        ? `<p class="near-note">Forecast unavailable right now.</p>`
        : `<p class="near-note">Loading forecast…</p>`;

    const alertItems = [...hereList.map((a) => ({ a, where: "Here" })), ...nearList.slice(0, 3).map((a) => ({ a, where: "Nearby" }))]
      .map(({ a, where }) => `<li><button type="button" class="near-alert" data-id="${esc(a.id)}" style="--alert:${a.color}">
          <span class="na-swatch"></span><span class="na-event">${esc(a.event)}</span><span class="na-where">${where}</span></button></li>`)
      .join("");

    panel.dataset.tone = tone;
    panel.style.setProperty("--verdict", color || "var(--line)");
    document.getElementById("near-peek").innerHTML =
      `<span class="np-dot"></span><span class="np-text"><strong>${esc(verdict)}</strong><span class="np-place">${esc(place)}</span></span>`;

    body.innerHTML = `
      <p class="near-place">${esc(place)}${inPilot ? "" : ' <span class="near-out">outside pilot area</span>'}</p>
      <h2 class="near-verdict">${esc(verdict)}</h2>
      ${tone === "none" ? `<p class="near-note">From National Weather Service alerts. Conditions can change fast. Keep Wireless Emergency Alerts on.</p>` : ""}
      ${alertItems ? `<ul class="near-list">${alertItems}</ul>` : ""}
      ${rainCard(rain)}
      ${weather}
      ${zoneRow(zone)}
      ${rainChart(w)}
      <div class="near-actions">
        <a class="near-btn" href="https://www.google.com/maps/dir/?api=1&destination=${pt[1].toFixed(5)},${pt[0].toFixed(5)}" target="_blank" rel="noopener">Directions</a>
        <button type="button" class="near-btn" id="near-share">Copy link</button>
        ${mode === "pin" ? '<button type="button" class="near-btn" id="near-clear">Clear pin</button>' : ""}
      </div>
      <h3 class="near-h">Nearest gauges</h3>
      <ul class="near-list">${gaugeRows || '<li class="near-note">Loading gauges…</li>'}</ul>
      <p class="near-911">In danger now? Call <strong>911</strong>.</p>`;

    body.querySelector("#near-share")?.addEventListener("click", async (e) => {
      const url = `${location.origin}${location.pathname}#at=${pt[1].toFixed(5)},${pt[0].toFixed(5)}`;
      try { await navigator.clipboard.writeText(url); e.target.textContent = "Link copied"; }
      catch (_) { prompt("Copy this link:", url); }
    });
    body.querySelector("#near-clear")?.addEventListener("click", () => setMode("center"));
    body.querySelectorAll(".near-gauge").forEach((b) => b.addEventListener("click", () => openGauge(b.dataset.lid)));
    body.querySelectorAll(".near-alert").forEach((b) => b.addEventListener("click", () => openAlerts(b.dataset.id)));
  }

  return {
    render,
    setMe(pt) { mePoint = pt; setMode("me"); },
    setPin(pt) {
      pinPoint = pt;
      if (!pinMarker) {
        const el = document.createElement("div");
        el.className = "pin-drop";
        el.setAttribute("aria-label", "Dropped pin");
        pinMarker = new maplibregl.Marker({ element: el, anchor: "bottom" });
      }
      pinMarker.setLngLat(pt).addTo(map);
      setMode("pin");
      panel.classList.add("expanded");
    },
  };
}
