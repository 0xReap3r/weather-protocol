// Texas grid status from ERCOT (normal … EEA 3), via our Worker's /api/grid (ERCOT's own JSON
// can't be read from a browser). Shown as a small pill under the warnings banner; tap for details.
// ERCOT's wording is used for the condition; we only add plain-language steps.
import { APP } from "./config.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ERCOT's seven levels, lowest to highest (state names from ERCOT's grid conditions dashboard).
export const GRID_LEVELS = [
  { state: "normal", short: "Normal", color: "#3ddc97", what: "Enough power for current demand." },
  { state: "weather", short: "Weather Watch", color: "#ffe14d", what: "Weather may push demand high or cut supply in the coming days. No action needed yet." },
  { state: "vcn", short: "Conservation notice", color: "#ffd23f", what: "Voluntary conservation notice: using less power helps." },
  { state: "conservation", short: "Conservation appeal", color: "#ff9a1f", what: "ERCOT is asking everyone to cut power use now." },
  { state: "eea1", short: "Emergency level 1", color: "#ff7a3d", what: "Energy Emergency Alert 1: reserves are low. Outages aren't happening, but conserve now." },
  { state: "eea2", short: "Emergency level 2", color: "#ff3b3b", what: "Energy Emergency Alert 2: reserves are very low. Conserve and be ready for outages." },
  { state: "eea3", short: "Emergency level 3", color: "#ff2fa8", what: "Energy Emergency Alert 3: rotating outages may be ordered or under way." },
];
const levelOf = (state) => Math.max(0, GRID_LEVELS.findIndex((l) => l.state === state));

// On the live site the Worker is same-origin; anywhere else (localhost) use the live site's API.
const API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api/grid" : `${APP.apiBase}/api/grid`;

export function initGrid({ isOn, openSheet }) {
  const pill = document.getElementById("grid-pill");
  let status = null, failedAt = null, timer = null;

  async function load() {
    try {
      const r = await fetch(API, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `grid ${r.status}`);
      status = j; failedAt = null;
    } catch (_) { failedAt = Date.now(); }
    render();
    clearTimeout(timer);
    // Every 5 minutes normally; every minute once ERCOT is above normal.
    timer = setTimeout(load, status && levelOf(status.state) > 0 ? 60e3 : 5 * 60e3);
  }

  function render() {
    if (!isOn() || (!status && !failedAt)) { pill.hidden = true; return; }
    pill.hidden = false;
    if (!status) {
      pill.dataset.level = "0";
      pill.style.setProperty("--gc", "var(--text-dim)");
      pill.innerHTML = `<span class="gp-dot"></span><span>Texas grid: <strong>unavailable</strong></span>`;
      return;
    }
    const n = levelOf(status.state), L = GRID_LEVELS[n];
    const old = status.at && Date.now() - Date.parse(status.at) > 20 * 60e3;
    pill.dataset.level = String(n);
    pill.classList.toggle("stale", !!old || !!failedAt);
    pill.style.setProperty("--gc", L.color);
    pill.innerHTML = `<span class="gp-dot"></span><span>Texas grid: <strong>${esc(status.title || L.short)}</strong></span><span class="gp-src">ERCOT${status.at ? ` · ${esc(new Date(status.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}` : ""}</span>`;
  }

  function sheetHTML() {
    if (!status) return `<p class="sheet-lead">ERCOT's grid status isn't loading right now. Check <a href="https://www.ercot.com/gridmktinfo/dashboards/gridconditions" target="_blank" rel="noopener">ERCOT's grid conditions page</a>.</p>`;
    const n = levelOf(status.state), L = GRID_LEVELS[n];
    const tips = n >= 3
      ? `<h3 class="near-h">How to help right now</h3>
         <ul class="guide-list"><li>Set the thermostat a few degrees closer to the outside temperature.</li><li>Hold off on laundry, dishwashers and EV charging until the alert ends.</li><li>Turn off lights and electronics you're not using.</li><li>Charge phones and keep flashlights handy in case of outages.</li></ul>`
      : n >= 1 ? `<p class="near-note">Nothing to do yet. Watch for a conservation appeal if conditions get tighter.</p>` : "";
    return `
      <div style="--gc:${L.color}">
        <p class="near-verdict" style="color:${L.color}">${esc(status.title || L.short)}</p>
        <p class="near-note">${esc(status.note || L.what)}</p>
        <div class="grid-meter">${GRID_LEVELS.map((_, i) => `<span class="${i <= n ? "on" : ""}"></span>`).join("")}</div>
        <ul class="grid-steps">${GRID_LEVELS.map((l, i) => `<li class="${i === n ? "cur" : ""}">${i === n ? "● " : ""}${esc(l.short)}</li>`).join("")}</ul>
        ${status.reservesMW != null ? `<p class="near-note" style="margin-top:12px">Operating reserves: ${status.reservesMW.toLocaleString()} MW · updated ${esc(new Date(status.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</p>` : ""}
        ${tips}
        <p class="near-note">Grid emergencies cause rotating outages across Texas; they're different from storm damage. Report a local outage with Report → Power out, and call Oncor at 1-888-313-6862.</p>
        <p class="sheet-small">From <a href="https://www.ercot.com/gridmktinfo/dashboards/gridconditions" target="_blank" rel="noopener">ERCOT grid conditions</a>. Not an official alert.</p>
      </div>`;
  }

  pill.addEventListener("click", () => {
    document.getElementById("grid-body").innerHTML = sheetHTML();
    openSheet("grid", "Texas power grid");
  });

  load();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && (!status || Date.now() - Date.parse(status.at || 0) > 5 * 60e3)) load(); });
  return { render, get: () => status, layerIds: [] };
}
