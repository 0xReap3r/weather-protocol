// "What's happened": one timeline, newest first, of the last 3 days across sources:
// NWS warnings issued, updated or canceled; rivers at or near flood stage; neighbor reports.
// Every item shows its time and source.
import { loadRecentAlerts } from "./data/alerts.js";
import { CATEGORY } from "./data/gauges.js";
import { DEPTHS, HAIL, DAMAGE } from "./data/reports.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (iso) => {
  const d = new Date(iso), m = Math.round((Date.now() - d) / 60000);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (m < 60) return `${Math.max(m, 0)} min ago · ${t}`;
  const sameDay = d.toDateString() === new Date().toDateString();
  return `${sameDay ? "" : `${d.toLocaleDateString([], { weekday: "short" })} `}${t}`;
};

const FILTERS = [["all", "All"], ["alerts", "Warnings"], ["rivers", "Rivers"], ["reports", "Neighbors"]];
const VERB = { Alert: "issued", Update: "updated", Cancel: "canceled" };

export function initFeed({ metro, getGauges, getReports, openSheet, openAlerts, openGauge, onPick, isActiveAlert }) {
  const root = document.getElementById("feed-body");
  let filter = "all", alerts = null, alertsAt = 0, failed = false;

  async function loadAlerts(force) {
    if (!force && alerts && Date.now() - alertsAt < 3 * 60 * 1000) return;
    try { alerts = await loadRecentAlerts(metro, 72); alertsAt = Date.now(); failed = false; }
    catch (_) { failed = true; }
  }

  function items() {
    const out = [];
    for (const a of alerts || []) {
      out.push({ type: "alerts", at: a.sent, color: a.color, title: `${a.event} ${VERB[a.messageType] || "issued"}`,
        meta: `${a.areaDesc.split("; ").filter((x) => new RegExp(metro.counties.join("|"), "i").test(x)).slice(0, 4).join(", ") || a.areaDesc.slice(0, 80)}${a.expires ? ` · until ${new Date(a.expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`,
        src: "NWS", act: isActiveAlert(a.id) ? `data-feed-alert="${esc(a.id)}"` : "", faded: a.messageType === "Cancel" || (a.expires && Date.parse(a.expires) < Date.now()) });
    }
    for (const g of getGauges() || []) {
      const c = CATEGORY[g.category];
      if (!c || c.rank < 2 || !g.observedAt) continue;
      out.push({ type: "rivers", at: g.observedAt, color: c.color, title: `${g.name}: ${c.label.toLowerCase()}`,
        meta: `${g.stage != null ? `${g.stage.toFixed(1)} ${g.stageUnit}` : ""}${g.stages.minor != null ? ` · flood stage ${g.stages.minor} ft` : ""}`, src: "NOAA gauge", act: `data-feed-gauge="${esc(g.lid)}"` });
    }
    const { cells, roads } = getReports();
    const named = new Map();
    for (const r of roads) named.set(`${r.at.join(",")}`, r.street);
    for (const c of cells) {
      if (c.kind === "power_back") continue;
      const street = named.get(`${c.cell_lng},${c.cell_lat}`);
      const what = c.kind === "flood" ? `Flooded road · ${DEPTHS[c.depth]?.label.toLowerCase() || "depth unknown"}`
        : c.kind === "ice" ? "Iced road" : c.kind === "hail" ? `Hail · ${HAIL[c.depth]?.label.toLowerCase() || ""} size`
        : c.kind === "damage" ? DAMAGE[c.depth]?.label || "Storm damage" : "Power out";
      out.push({ type: "reports", at: c.first_at, color: { flood: "#4fb3ff", ice: "#c9f1ff", hail: "#d94cff", damage: "#ff8fa3", power_out: "#ffb020" }[c.kind],
        title: `${what}${street ? ` · ${street}` : ""}`, meta: `${c.reporters >= 2 ? `${c.reporters} neighbors` : "1 report, unconfirmed"}${c.last_at !== c.first_at ? ` · latest ${when(c.last_at)}` : ""}`,
        src: "Neighbors", act: `data-feed-at="${c.cell_lng},${c.cell_lat}"`, faded: c.reporters < 2 });
    }
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }

  function render() {
    const list = items().filter((i) => filter === "all" || i.type === filter);
    root.innerHTML = `
      <div class="sl-days feed-filters" role="group" aria-label="Show">${FILTERS.map(([id, l]) => `<button type="button" class="sl-day" data-feed-filter="${id}" aria-pressed="${filter === id}">${l}</button>`).join("")}</div>
      ${failed ? `<p class="near-note">Couldn't load recent NWS alerts. Showing what's loaded.</p>` : alerts == null ? `<p class="near-note">Loading the last 3 days…</p>` : ""}
      ${list.length ? `<ul class="feed-list">${list.map((i) => `<li><${i.act ? "button type=\"button\"" : "div"} class="feed-item${i.faded ? " faded" : ""}" style="--fc:${i.color}" ${i.act}>
          <span class="feed-dot"></span>
          <span class="feed-text"><span class="feed-title">${esc(i.title)}</span><span class="feed-meta">${esc(i.meta)}</span><span class="feed-src">${esc(when(i.at))} · ${esc(i.src)}</span></span>
        </${i.act ? "button" : "div"}></li>`).join("")}</ul>`
        : alerts == null ? "" : `<p class="near-note">Nothing in the last 3 days${filter === "all" ? "" : " for this filter"}. Quiet doesn't mean safe: keep Wireless Emergency Alerts on.</p>`}
      <p class="sheet-small">Last 3 days of NWS alerts for ${esc(metro.name)} counties, rivers now at or near flood stage, and active neighbor reports.</p>`;
  }

  root.addEventListener("click", (e) => {
    const f = e.target.closest("[data-feed-filter]");
    if (f) { filter = f.dataset.feedFilter; render(); return; }
    const a = e.target.closest("[data-feed-alert]");
    if (a) return openAlerts(a.dataset.feedAlert);
    const g = e.target.closest("[data-feed-gauge]");
    if (g) return openGauge(g.dataset.feedGauge);
    const p = e.target.closest("[data-feed-at]");
    if (p) return onPick(p.dataset.feedAt.split(",").map(Number));
  });

  async function open() {
    render();
    openSheet("feed", "What's happened");
    await loadAlerts();
    render();
  }
  return { open };
}
