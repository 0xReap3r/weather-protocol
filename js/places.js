// My places: spots someone wants to keep an eye on (home, work, school), saved on this device
// only. Each shows what's happening there now. Later, push alerts (Phase 7) will use them.
import { contains, milesBetween } from "./near.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const KEY = "stormline.places.v1";
const MAX = 10;
const SUGGEST = ["Home", "Work", "School", "Family"];

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (_) { return false; }
}

export function initPlaces({ getSpot, getAlertsFC, getRoads, openSheet, onPick, onRoute, toast }) {
  const root = document.getElementById("places-body");
  let places = load();
  let draftName = "";

  function status(p) {
    const here = [];
    const seen = new Set();
    for (const f of getAlertsFC().features) {
      if (!f.geometry || seen.has(f.properties.id) || !contains(f.geometry, p.at)) continue;
      seen.add(f.properties.id);
      here.push(f.properties);
    }
    here.sort((a, b) => b.rank - a.rank);
    const roads = (getRoads() || []).filter((r) => milesBetween(p.at, r.at) <= 1);
    return { alerts: here, roads };
  }

  function render() {
    const spot = getSpot();
    const full = places.length >= MAX;
    root.innerHTML = `
      <p class="sheet-lead">Save the places you care about to check them at a glance. Saved on this device only; nothing is sent anywhere.</p>
      ${places.length ? `<ul class="near-list places-list">${places.map((p) => {
        const s = status(p);
        const top = s.alerts[0];
        const color = top ? top.color : s.roads.some((r) => r.confirmed) ? "#ff7a3d" : "var(--line)";
        return `<li class="place-row" style="--pc:${color}">
          <button type="button" class="place-main" data-place-go="${p.id}">
            <span class="place-name">${esc(p.name)}</span>
            <span class="place-status">${top ? `<strong style="color:${top.color}">${esc(top.event)}</strong>${s.alerts.length > 1 ? ` +${s.alerts.length - 1} more` : ""}` : "No NWS warnings here"}${s.roads.length ? ` · ${s.roads.length} road${s.roads.length > 1 ? "s" : ""} to avoid within 1 mi` : ""}</span>
          </button>
          <span class="place-actions">
            <button type="button" class="nr-flag" data-place-route="${p.id}">Route</button>
            <button type="button" class="nr-flag" data-place-del="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button>
          </span>
        </li>`;
      }).join("")}</ul>` : `<p class="near-note">No saved places yet.</p>`}
      <h3 class="near-h">Save the spot the panel is showing</h3>
      <p class="near-note">${esc(spot.label)}${spot.place ? ` · ${esc(spot.place)}` : ""}. Tap the map or use Near me first to save somewhere else.</p>
      ${full ? `<p class="near-note">You've saved ${MAX} places, the most this device keeps. Remove one to add another.</p>` : `
      <div class="place-form">
        <input id="place-name" class="place-input" type="text" maxlength="40" placeholder="Name, like Home" value="${esc(draftName)}" aria-label="Place name">
        <button type="button" class="near-btn rp-open" id="place-save">Save</button>
      </div>
      <div class="place-suggest">${SUGGEST.filter((n) => !places.some((p) => p.name === n)).map((n) => `<button type="button" class="sl-day" data-place-suggest="${n}">${n}</button>`).join("")}</div>`}`;
  }

  root.addEventListener("input", (e) => { if (e.target.id === "place-name") draftName = e.target.value; });
  root.addEventListener("keydown", (e) => { if (e.target.id === "place-name" && e.key === "Enter") root.querySelector("#place-save")?.click(); });
  root.addEventListener("click", (e) => {
    const sg = e.target.closest("[data-place-suggest]");
    if (sg) { draftName = sg.dataset.placeSuggest; render(); root.querySelector("#place-name")?.focus(); return; }
    if (e.target.closest("#place-save")) {
      const name = (draftName || "").trim() || `Place ${places.length + 1}`;
      const at = getSpot().at.map((v) => Number(v.toFixed(5)));
      places = [...places, { id: Math.random().toString(36).slice(2, 9), name, at }];
      if (!save(places)) toast("Couldn't save on this device. Private browsing can block it.");
      else toast(`Saved ${name}.`);
      draftName = "";
      render();
      return;
    }
    const del = e.target.closest("[data-place-del]");
    if (del) { places = places.filter((p) => p.id !== del.dataset.placeDel); save(places); render(); return; }
    const go = e.target.closest("[data-place-go]");
    if (go) { const p = places.find((x) => x.id === go.dataset.placeGo); if (p) onPick(p.at); return; }
    const rt = e.target.closest("[data-place-route]");
    if (rt) { const p = places.find((x) => x.id === rt.dataset.placeRoute); if (p) onRoute(p); }
  });

  return {
    open() { places = load(); render(); openSheet("places", "My places"); },
    list: () => places,
    refresh() { if (!document.getElementById("sheet").hidden && !root.parentElement.hidden) render(); },
  };
}
