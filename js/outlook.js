// "What's coming": a forward-looking view for the whole metro (like Bangkok's warnings view).
// Today:   overall risk with reasons, rain chance by hour, cities ranked by risk with the reason
// 3 days:  SPC severe-storm and WPC flood-rain outlooks plus the NWS forecast, per day
// Week:    the NWS 7-day forecast
//
// Risk levels are ours, built only from official products: Low, Elevated, High, Extreme.
// "Low" never means safe; it means no official product points at trouble.

import { loadOutlook } from "./data/outlook.js";
import { CATEGORY } from "./data/gauges.js";
import { contains, milesBetween } from "./near.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const LEVELS = [
  { key: "low", label: "Low", color: "#8aa0b4" },
  { key: "elevated", label: "Elevated", color: "#ffd23f" },
  { key: "high", label: "High", color: "#ff9a1f" },
  { key: "extreme", label: "Extreme", color: "#ff3b3b" },
];

const SPC_LEVEL = { TSTM: 0, MRGL: 1, SLGT: 1, ENH: 2, MDT: 3, HIGH: 3 };
const SPC_TEXT = {
  TSTM: "Thunderstorms possible",
  MRGL: "Marginal risk of severe storms",
  SLGT: "Slight risk of severe storms",
  ENH: "Enhanced risk of severe storms",
  MDT: "Moderate risk of severe storms",
  HIGH: "High risk of severe storms",
};
const ERO_LEVEL = { 1: 1, 2: 1, 3: 2, 4: 3 };
const ERO_TEXT = {
  1: "Marginal risk of flash flooding from rain",
  2: "Slight risk of flash flooding from rain",
  3: "Moderate risk of flash flooding from rain",
  4: "High risk of flash flooding from rain",
};

/* ---------- Scoring ---------- */
function topIn(fc, pt, pick) {
  let best = null;
  for (const f of fc.features || []) {
    if (!f.geometry || !contains(f.geometry, pt)) continue;
    const v = pick(f.properties || {});
    if (v && (!best || v.score > best.score)) best = v;
  }
  return best;
}
const spcAt = (fc, pt) =>
  topIn(fc, pt, (p) => (p.LABEL in SPC_LEVEL ? { code: p.LABEL, level: SPC_LEVEL[p.LABEL], score: Object.keys(SPC_LEVEL).indexOf(p.LABEL) } : null));
const eroAt = (fc, pt) =>
  topIn(fc, pt, (p) => (ERO_LEVEL[p.dn] != null ? { code: p.dn, level: ERO_LEVEL[p.dn], score: p.dn } : null));

function alertLevel(rank) {
  if (rank >= 85) return 3; // tornado / flash flood warnings and emergencies
  if (rank >= 60) return 2; // other warnings
  if (rank >= 20) return 1; // watches and advisories
  return 0;
}

function scoreCity(city, i, ctx) {
  const [name, lat, lng] = city;
  const pt = [lng, lat];
  const reasons = [];
  const add = (level, score, text, source) => reasons.push({ level, score: level * 1000 + score, text, source });

  // 1. Active NWS alerts covering the city
  for (const f of ctx.alertsFC.features) {
    if (f.properties.rank >= 20 && contains(f.geometry, pt)) {
      add(alertLevel(f.properties.rank), f.properties.rank, `${f.properties.event} in effect`, "NWS");
    }
  }
  // 2. A gauge within 6 miles at or above action stage
  for (const g of ctx.gauges) {
    const r = CATEGORY[g.category]?.rank ?? -1;
    if (r >= 2 && milesBetween(pt, [g.lng, g.lat]) <= 6) {
      add(r >= 4 ? 3 : r === 3 ? 2 : 1, r * 10, `${g.short || g.name}: ${CATEGORY[g.category].label.toLowerCase()}`, "NWS river gauge");
    }
  }
  // 3. Today's outlooks
  const spc = spcAt(ctx.data.spc[0], pt);
  if (spc) add(spc.level, spc.score, SPC_TEXT[spc.code], "SPC");
  const ero = eroAt(ctx.data.ero[0], pt);
  if (ero) add(ero.level, ero.score * 2, ERO_TEXT[ero.code], "WPC");
  // 4. Rain in the next 12 hours
  const r = ctx.data.rain[i];
  if (r) {
    const total = r.inches.reduce((a, b) => a + b, 0);
    const maxPop = Math.max(0, ...r.pop);
    if (total >= 2) add(2, Math.round(total * 10), `About ${total.toFixed(1)} in of rain in 12 hr`, "Open-Meteo");
    else if (total >= 1) add(1, Math.round(total * 10), `About ${total.toFixed(1)} in of rain in 12 hr`, "Open-Meteo");
    else if (maxPop >= 60) add(1, maxPop / 10, `Rain likely (up to ${maxPop}%)`, "Open-Meteo");
    else if (maxPop >= 30) add(0, maxPop / 10, `Rain chance up to ${maxPop}%`, "Open-Meteo");
  }

  reasons.sort((a, b) => b.score - a.score);
  const level = reasons.length ? Math.max(...reasons.map((x) => x.level)) : 0;
  return { name, pt, level, score: reasons[0]?.score ?? 0, reasons };
}

/* ---------- Forecast grouping ---------- */
function byDay(periods) {
  const days = new Map();
  for (const p of periods) {
    const d = p.start.slice(0, 10);
    if (!days.has(d)) days.set(d, { date: d, periods: [] });
    days.get(d).periods.push(p);
  }
  return [...days.values()].map((d) => {
    const day = d.periods.find((p) => p.day);
    const night = d.periods.find((p) => !p.day);
    const first = d.periods[0];
    return {
      date: d.date,
      name: day?.name || first.name,
      hi: day?.temp ?? null,
      lo: night?.temp ?? null,
      unit: first.unit,
      pop: Math.max(...d.periods.map((p) => p.pop || 0)),
      short: (day || first).short,
      nightShort: night && day ? night.short : null,
      storms: d.periods.some((p) => /thunder/i.test(p.short)),
      stormsWhen: (() => {
        const dayT = day && /thunder/i.test(day.short), nightT = night && /thunder/i.test(night.short);
        return dayT && nightT ? "" : dayT ? "day" : nightT ? "night" : "";
      })(),
    };
  });
}

const dayLabel = (iso, i) =>
  i === 0 ? "Today" : new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

/* ---------- Rendering ---------- */
const pill = (lvl, text = LEVELS[lvl].label) =>
  `<span class="ok-pill" style="--lvl:${LEVELS[lvl].color}">${esc(text)}</span>`;

function hourlyChart(data) {
  const rows = data.rain.filter((r) => r.times.length);
  if (!rows.length) return "";
  const n = Math.min(...rows.map((r) => r.times.length));
  const hours = Array.from({ length: n }, (_, h) => ({
    t: rows[0].times[h],
    pop: Math.max(...rows.map((r) => r.pop[h] || 0)),
    inches: Math.max(...rows.map((r) => r.inches[h] || 0)),
  }));
  const W = 340, H = 104, B = 18, T = 16, gap = 4, bw = (W - gap * (n - 1)) / n;
  const peak = hours.reduce((m, h) => (h.pop > m.pop ? h : m), hours[0]);
  const hourWord = (t) => {
    const h = Number(t.slice(11, 13));
    return `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  };
  const bars = hours
    .map((h, i) => {
      const bh = Math.max(2, ((H - B - T) * h.pop) / 100), x = i * (bw + gap), y = H - B - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" class="${h.pop >= 60 ? "hi" : h.pop >= 30 ? "mid" : ""}"/>
        ${h.pop >= 20 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="v">${h.pop}</text>` : ""}
        ${i % 3 === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${hourWord(h.t)}</text>` : ""}`;
    })
    .join("");
  return `<h3 class="ok-h">Rain, next 12 hours <span class="ok-h-note">${peak.pop ? `peak ${peak.pop}% around ${hourWord(peak.t)}` : "none expected"}</span></h3>
    <div class="ok-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Highest hourly rain chance anywhere in the metro, next 12 hours">${bars}</svg></div>
    <p class="ok-note">Highest chance anywhere in the metro each hour.</p>`;
}

function renderToday(ctx, cities) {
  const level = Math.max(0, ...cities.map((c) => c.level));
  // Metro-wide reasons: the distinct reasons behind the top level, with how many cities they touch.
  const counts = new Map();
  for (const c of cities) for (const r of c.reasons) {
    if (level > 0 && r.level < 1) continue; // when something is elevated, skip the background notes
    const k = r.text;
    const e = counts.get(k) || { ...r, n: 0 };
    e.n++;
    counts.set(k, e);
  }
  const reasons = [...counts.values()].sort((a, b) => b.score - a.score || b.n - a.n).slice(0, 4);
  const day = byDay(ctx.data.forecast)[0];
  const ranked = cities.filter((c) => c.level > 0 || c.reasons.length).sort((a, b) => b.score - a.score);
  const quiet = cities.length - ranked.length;

  return `
    <div class="ok-hero" style="--lvl:${LEVELS[level].color}">
      <span class="ok-hero-label">Risk today and tonight</span>
      <span class="ok-hero-level">${LEVELS[level].label}</span>
      ${day ? `<span class="ok-hero-wx">${esc(day.short)}${day.hi != null ? ` · high ${day.hi}°` : ""}${day.lo != null ? ` · low ${day.lo}°` : ""}</span>` : ""}
    </div>
    ${
      reasons.length
        ? `<ul class="ok-reasons">${reasons
            .map((r) => `<li>${pill(r.level, "")}<span>${esc(r.text)}<span class="ok-src"> · ${esc(r.source)}${r.n > 1 ? ` · ${r.n} cities` : ""}</span></span></li>`)
            .join("")}</ul>`
        : `<p class="ok-note">No official warnings, outlooks or heavy rain forecast for the metro right now. Conditions can change; this view refreshes every 15 minutes.</p>`
    }
    ${ctx.alertCount ? `<button type="button" class="ok-link" data-open="alerts">${ctx.alertCount} active NWS alert${ctx.alertCount > 1 ? "s" : ""} for ${esc(ctx.metro.name)} · read them</button>` : ""}
    ${hourlyChart(ctx.data)}
    <h3 class="ok-h">Cities</h3>
    ${
      ranked.length
        ? `<ul class="ok-cities">${ranked
            .slice(0, 12)
            .map(
              (c) => `<li><button type="button" class="ok-city" data-lng="${c.pt[0]}" data-lat="${c.pt[1]}">
                <span class="okc-name">${esc(c.name)}</span>
                <span class="okc-why">${esc(c.reasons[0].text)}</span>
                ${pill(c.level)}
              </button></li>`
            )
            .join("")}</ul>
          ${quiet ? `<p class="ok-note">${quiet} other cities: nothing flagged.</p>` : ""}`
        : `<p class="ok-note">Nothing flagged for any of ${cities.length} DFW cities.</p>`
    }`;
}

function renderThreeDays(ctx) {
  const days = byDay(ctx.data.forecast).slice(0, 3);
  const cityPts = ctx.metro.cities.map((c) => [c[2], c[1]]);
  return `<ul class="ok-days">${[0, 1, 2]
    .map((d) => {
      let spc = null, ero = null;
      for (const pt of cityPts) {
        const s = spcAt(ctx.data.spc[d], pt);
        if (s && (!spc || s.score > spc.score)) spc = s;
        const e = eroAt(ctx.data.ero[d], pt);
        if (e && (!ero || e.score > ero.score)) ero = e;
      }
      const lvl = Math.max(spc?.level ?? 0, ero?.level ?? 0);
      const f = days[d];
      return `<li class="ok-day" style="--lvl:${LEVELS[lvl].color}">
        <div class="okd-head"><span class="okd-name">${esc(f ? dayLabel(f.date, d) : `Day ${d + 1}`)}</span>${pill(lvl)}</div>
        ${f ? `<p class="okd-wx">${esc(f.short)}${f.nightShort ? `, then ${esc(f.nightShort.toLowerCase())}` : ""}</p>
        <p class="okd-nums">${f.hi != null ? `High ${f.hi}°` : ""}${f.lo != null ? `${f.hi != null ? " · " : ""}Low ${f.lo}°` : ""} · Rain ${f.pop}%</p>` : ""}
        <p class="okd-row"><span>Severe storms</span><span>${spc ? esc(SPC_TEXT[spc.code].replace(" of severe storms", "").replace("Thunderstorms possible", "Thunderstorms only")) : "None outlined"}</span></p>
        <p class="okd-row"><span>Flash-flood rain</span><span>${ero ? esc(ERO_TEXT[ero.code].replace(" of flash flooding from rain", "")) : "None outlined"}</span></p>
      </li>`;
    })
    .join("")}</ul>
    <p class="ok-note">Severe-storm risk from the NOAA Storm Prediction Center; flash-flood rain risk from the NOAA Weather Prediction Center; forecast from the National Weather Service for Dallas.</p>`;
}

function renderWeek(ctx) {
  const days = byDay(ctx.data.forecast);
  if (!days.length) return `<p class="ok-note">The NWS forecast isn't available right now.</p>`;
  return `<ul class="ok-week">${days
    .slice(0, 7)
    .map(
      (d, i) => `<li>
        <span class="okw-day">${esc(i === 0 ? "Today" : new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: "short" }))}</span>
        <span class="okw-wx">${d.storms ? `<span class="okw-storm">${d.stormsWhen === "night" ? "Storms tonight" : "Storms"}</span>` : ""}${esc(d.short)}</span>
        <span class="okw-temp">${d.hi != null ? `${d.hi}°` : "–"} <span>${d.lo != null ? `${d.lo}°` : ""}</span></span>
        <span class="okw-pop"><span style="width:${d.pop}%"></span><em>${d.pop}%</em></span>
      </li>`
    )
    .join("")}</ul>
    <p class="ok-note">National Weather Service forecast for Dallas. High and low in °F; bar shows the chance of rain.</p>`;
}

/* ---------- Controller ---------- */
export function initOutlook({ metro, getAlertsFC, getGauges, getAlertCount, onPickCity, openAlerts }) {
  const root = document.getElementById("outlook-body");
  let tab = "today";
  let token = 0;

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) { tab = t.dataset.tab; render(); return; }
    const c = e.target.closest(".ok-city");
    if (c) { onPickCity([Number(c.dataset.lng), Number(c.dataset.lat)]); return; }
    if (e.target.closest("[data-open='alerts']")) openAlerts();
  });

  async function render({ force = false } = {}) {
    const my = ++token;
    if (!root.dataset.ready) root.innerHTML = `<p class="ok-note">Loading the outlook…</p>`;
    let data;
    try {
      data = await loadOutlook(metro, { force });
    } catch (_) {
      root.innerHTML = `<p class="ok-note">The outlook couldn't load. Check your connection and try again.</p>`;
      return;
    }
    if (my !== token) return;
    const ctx = { metro, data, alertsFC: getAlertsFC(), gauges: getGauges(), alertCount: getAlertCount() };
    const cities = metro.cities.map((c, i) => scoreCity(c, i, ctx));
    const body = tab === "today" ? renderToday(ctx, cities) : tab === "3day" ? renderThreeDays(ctx) : renderWeek(ctx);
    const time = data.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    root.dataset.ready = "1";
    root.innerHTML = `
      <p class="ok-lead">Advance outlook for ${esc(metro.name)} from official forecasts. Updated ${esc(time)}.${
        data.failed.length ? ` <span class="ok-warn">Missing right now: ${esc(data.failed.join(", "))}.</span>` : ""
      }</p>
      <div class="ok-tabs" role="tablist" aria-label="Outlook period">
        ${[["today", "Today"], ["3day", "3 days"], ["week", "Week"]]
          .map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`)
          .join("")}
      </div>
      <div class="ok-panel" role="tabpanel">${body}</div>
      <p class="ok-legal">Risk levels summarize official NWS, SPC and WPC products; they are not official warnings. "Low" doesn't mean safe.</p>`;
  }

  // Debug/testing: the scored cities for the current data
  async function scored() {
    const data = await loadOutlook(metro);
    const ctx = { metro, data, alertsFC: getAlertsFC(), gauges: getGauges(), alertCount: getAlertCount() };
    return metro.cities.map((c, i) => scoreCity(c, i, ctx)).sort((a, b) => b.score - a.score);
  }

  return { render, scored, setTab: (t) => { tab = t; render(); } };
}
