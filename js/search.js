// Search: jump to a Texas city, ZIP code, county, region or street address.
//   - Cities (2,500+ people), counties and regions are matched on the device as you type.
//   - Smaller towns and Census places come from TIGERweb when the local list runs short.
//   - A 5-digit ZIP goes to the Census ZIP Code Tabulation Area's center (TIGERweb).
//   - Something that looks like a street address goes through our Worker to the Census geocoder.
// Picking a result moves the map there and drops the area panel's pin on it.
// Recent picks are kept on this device only.
import { APP } from "./config.js";
import { fetchJSON } from "./data/fetch.js";
import { loadCounties } from "./data/counties.js";
import { milesBetween } from "./near.js";
import { t } from "./i18n.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
const API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api/tx" : `${APP.apiBase}/api/tx`;
const RECENT_KEY = "stormline.search.v1";
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[–—-]/g, " ").trim();
const ICONS = {
  city: '<path d="M4 20V9l5-3v14M9 20V4l6 3v13M15 20v-9l5 2v7M3 20h18"/>',
  zip: '<path d="M12 21s-7-6.3-7-11.5A7 7 0 0 1 19 9.5C19 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>',
  county: '<path d="M4 5l6-2 5 2 5-2v16l-5 2-5-2-6 2z"/><path d="M10 3v16M15 5v16"/>',
  region: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  address: '<path d="M4 11l8-6 8 6v9h-5v-6H9v6H4z"/>',
  recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

export function initSearch({ map, metro, onPick }) {
  const btn = document.getElementById("search-btn");
  const box = document.getElementById("search");
  const input = document.getElementById("search-input");
  const list = document.getElementById("search-results");
  const scrim = document.getElementById("search-scrim");
  let results = [], active = -1, seq = 0, counties = [];
  loadCounties(metro).then((c) => (counties = c)).catch(() => {});

  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (_) { return []; } };
  const remember = (r) => {
    try {
      const rows = [{ ...r, kind: r.kind }, ...recent().filter((x) => x.label !== r.label)].slice(0, 5);
      localStorage.setItem(RECENT_KEY, JSON.stringify(rows));
    } catch (_) {}
  };

  const nearestCity = (at) => {
    let best = null, d = Infinity;
    for (const c of metro.cities) { const m = milesBetween(at, [c[2], c[1]]); if (m < d) { d = m; best = c; } }
    return best && d < 25 ? best[0] : null;
  };

  // Instant matches from what's already loaded.
  function local(q) {
    const f = fold(q);
    if (!f) return [];
    const score = (name) => { const n = fold(name); return n === f ? 0 : n.startsWith(f) ? 1 : n.includes(` ${f}`) ? 2 : n.includes(f) ? 3 : 9; };
    const out = [];
    for (const r of metro.regions) { const s = score(r.name); if (s < 9) out.push({ kind: "region", label: r.name, sub: t("Region"), at: r.center, zoom: r.zoom || 8.5, s: s - 0.5, region: r.id }); }
    for (const c of metro.cities) { const s = score(c[0]); if (s < 9) out.push({ kind: "city", label: c[0], sub: `${Number(c[3]).toLocaleString()} ${t("people")}`, at: [c[2], c[1]], zoom: 11.5, s: s - Math.min(0.4, c[3] / 2e6) }); }
    for (const c of counties) { const s = score(`${c.name} County`); const s2 = score(c.name); const b = Math.min(s, s2 + 0.2); if (b < 9) out.push({ kind: "county", label: `${c.name} County`, sub: t("County"), at: c.center, zoom: 9, s: b + 0.1 }); }
    out.sort((a, b) => a.s - b.s);
    // Mid-word matches ("Hidalgo" for "dal") only when nothing better turned up.
    const strong = out.filter((r) => r.s < 2.9);
    return (strong.length >= 3 ? strong : out).slice(0, 8);
  }

  // Smaller towns and Census places (TIGERweb) when the local list is short.
  async function places(q) {
    const like = q.replace(/'/g, "''").toUpperCase();
    const urls = [25, 26].map((id) => `${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/${id}/query?${new URLSearchParams({
      where: `STATE='${metro.stateFips || "48"}' AND UPPER(BASENAME) LIKE '${like}%'`, outFields: "BASENAME,POP100,CENTLAT,CENTLON", returnGeometry: "false", resultRecordCount: "6", f: "json" })}`);
    const rows = (await Promise.all(urls.map((u) => fetchJSON(u, { timeout: 8000 }).catch(() => ({ features: [] }))))).flatMap((j) => j.features || []);
    return rows.map(({ attributes: a }) => ({ kind: "city", label: a.BASENAME, sub: a.POP100 ? `${Number(a.POP100).toLocaleString()} ${t("people")}` : t("Town"), at: [Number(a.CENTLON), Number(a.CENTLAT)], zoom: 12.5 }));
  }
  async function zip(q) {
    const j = await fetchJSON(`${TIGER}/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query?${new URLSearchParams({ where: `ZCTA5='${q}'`, outFields: "ZCTA5,INTPTLAT,INTPTLON", returnGeometry: "false", f: "json" })}`, { timeout: 8000 });
    const a = j.features?.[0]?.attributes;
    if (!a) return [];
    const at = [Number(a.INTPTLON), Number(a.INTPTLAT)];
    const town = nearestCity(at);
    return [{ kind: "zip", label: a.ZCTA5, sub: town ? `${t("ZIP code")} · ${t("near")} ${town}` : t("ZIP code"), at, zoom: 12.5 }];
  }
  async function address(q) {
    const j = await fetchJSON(`${API}/geocode?q=${encodeURIComponent(q)}`, { timeout: 10000 });
    return (j.matches || []).map(([label, lng, lat]) => ({ kind: "address", label: label.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Tx)\b/, "TX").replace(/\b(Ne|Nw|Se|Sw|Fm|Rm|Cr|Us|Sh|Ih)\b/g, (m) => m.toUpperCase()).replace(/, TX, (\d{5})$/, ", TX $1"), sub: t("Address"), at: [lng, lat], zoom: 16 }));
  }

  function render(state) {
    const q = input.value.trim();
    const rows = results;
    if (!q) {
      const rec = recent();
      list.innerHTML = rec.length
        ? `<li class="sr-h">${t("Recent")}</li>${rec.map((r, i) => row({ ...r, kindIcon: "recent" }, i)).join("")}`
        : `<li class="sr-hint">${t("Try a city, a ZIP code like 75098, a county or a street address.")}</li>`;
      results = rec;
      return;
    }
    if (!rows.length) {
      list.innerHTML = `<li class="sr-hint">${state === "busy" ? t("Searching…") : state === "error" ? t("Search isn't available right now. Try again in a minute.") : t("No places in Texas match that.")}</li>`;
      return;
    }
    list.innerHTML = rows.map((r, i) => row(r, i)).join("") + (state === "busy" ? `<li class="sr-hint sr-more">${t("Searching…")}</li>` : "");
  }
  function row(r, i) {
    return `<li><button type="button" class="sr-row${i === active ? " on" : ""}" data-i="${i}" role="option" aria-selected="${i === active}">
      <span class="sr-ico">${icon(r.kindIcon || r.kind)}</span><span class="sr-text"><span class="sr-label" translate="no">${esc(r.label)}</span><span class="sr-sub">${esc(r.sub || "")}</span></span></button></li>`;
  }

  let timer = null;
  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    active = -1;
    if (!q) { results = []; return render(); }
    if (/^\d{5}$/.test(q)) {
      results = []; render("busy");
      try { results = await zip(q); } catch (_) { if (my === seq) return render("error"); }
      if (my === seq) render();
      return;
    }
    results = local(q);
    const looksAddress = /^\d+\s+\S+/.test(q) && /[a-z]{3}/i.test(q);
    const wantPlaces = !looksAddress && q.length >= 3 && results.filter((r) => r.kind === "city").length < 3;
    render(looksAddress || wantPlaces ? "busy" : undefined);
    clearTimeout(timer);
    if (!looksAddress && !wantPlaces) return;
    timer = setTimeout(async () => {
      try {
        const more = looksAddress ? await address(q) : await places(q);
        if (my !== seq) return;
        const seen = new Set(results.map((r) => `${r.kind}:${fold(r.label)}`));
        results = [...(looksAddress ? more : []), ...results, ...(looksAddress ? [] : more.filter((r) => !seen.has(`city:${fold(r.label)}`)))].slice(0, 8);
        render();
      } catch (_) { if (my === seq) render(results.length ? undefined : "error"); }
    }, looksAddress ? 450 : 250);
  }

  function pick(i) {
    const r = results[i];
    if (!r) return;
    remember({ kind: r.kind, label: r.label, sub: r.sub, at: r.at, zoom: r.zoom, region: r.region });
    close();
    onPick(r);
  }

  function open() {
    box.hidden = false; scrim.hidden = false;
    requestAnimationFrame(() => { box.classList.add("open"); scrim.classList.add("open"); });
    btn.setAttribute("aria-expanded", "true");
    input.value = ""; results = []; active = -1; render();
    setTimeout(() => input.focus(), 30);
  }
  function close() {
    box.classList.remove("open"); scrim.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    setTimeout(() => { if (!box.classList.contains("open")) { box.hidden = true; scrim.hidden = true; } }, 160);
  }

  btn.addEventListener("click", open);
  scrim.addEventListener("click", close);
  box.querySelector(".search-close").addEventListener("click", close);
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      list.querySelectorAll(".sr-row").forEach((el, i) => { el.classList.toggle("on", i === active); el.setAttribute("aria-selected", String(i === active)); });
      list.querySelector(".sr-row.on")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") { e.preventDefault(); pick(active >= 0 ? active : 0); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) pick(Number(b.dataset.i)); });
  // "/" opens search from anywhere (not while typing in a field).
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && box.hidden && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) { e.preventDefault(); open(); }
  });
  return { open, close };
}
