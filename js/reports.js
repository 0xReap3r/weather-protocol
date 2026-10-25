// Neighbor reports: the report flow, map layers, and helpers for the area panel.
// Rules from the plan: show areas, not people; one report stays faint until a second person
// confirms; reports fade out on their own; SOS is a 911 link only; never call a road "safe".

import { store, KINDS, DEPTHS, loadH3 } from "./data/reports.js";
import { milesBetween } from "./near.js";
import { roadNameAt } from "./data/roadnames.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} hr ago`;
};
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// Water color deepens with depth; red when it's dangerous to anyone.
const DEPTH_COLOR = [null, "#7fd4ff", "#4fb3ff", "#2f7fe0", "#ff7a3d", "#ff3b3b"];
const ICE_COLOR = "#c9f1ff";
const POWER_COLOR = "#ffb020";

/* ---------- "How deep is it?" scene (car, motorbike rider, two people; original drawing) ---------- */
export function depthScene(depth) {
  const W = 320, H = 120, ground = 108, pxPerIn = 1.25; // 6 ft person ≈ 90 px
  const d = depth ? DEPTHS[depth] : null;
  const water = d ? Math.round(d.inches * pxPerIn) : 0;
  const color = d ? DEPTH_COLOR[depth] : "transparent";
  return `<svg class="depth-scene" viewBox="0 0 ${W} ${H}" role="img" aria-label="${d ? `Water about ${d.inches} inches deep: ${esc(d.label)}` : "No water reported"}">
    <g class="ds-figures">
      <!-- sedan -->
      <path d="M18 ${ground - 8} h132 a6 6 0 0 0 6 -6 v-14 a8 8 0 0 0 -7 -8 l-26 -4 l-22 -18 a10 10 0 0 0 -7 -3 h-42 a10 10 0 0 0 -8 4 l-16 20 l-6 2 a6 6 0 0 0 -4 6 v15 a6 6 0 0 0 6 6z"/>
      <circle cx="46" cy="${ground - 8}" r="11"/><circle cx="128" cy="${ground - 8}" r="11"/>
      <!-- adult, about 5 ft 9 in -->
      <circle cx="214" cy="${ground - 80}" r="7"/>
      <path d="M206 ${ground - 70} h16 a4 4 0 0 1 4 4 v30 h-5 v36 h-5 v-36 h-4 v36 h-5 v-36 h-5 v-30 a4 4 0 0 1 4 -4z"/>
      <!-- child, about 4 ft -->
      <circle cx="262" cy="${ground - 55}" r="6"/>
      <path d="M256 ${ground - 47} h12 a3 3 0 0 1 3 3 v20 h-4 v24 h-4 v-24 h-2 v24 h-4 v-24 h-4 v-20 a3 3 0 0 1 3 -3z"/>
    </g>
    <line x1="0" y1="${ground}" x2="${W}" y2="${ground}" class="ds-ground"/>
    ${water ? `<rect x="0" y="${ground - water}" width="${W}" height="${water}" fill="${color}" fill-opacity="0.45"/>
      <line x1="0" y1="${ground - water}" x2="${W}" y2="${ground - water}" stroke="${color}" stroke-width="2"/>
      <text x="${W - 6}" y="${ground - water - 5}" text-anchor="end" class="ds-label">${d.inches >= 36 ? "3 ft+" : d.inches >= 24 ? "2–3 ft" : d.inches >= 12 ? "1–2 ft" : d.inches >= 6 ? "6–12 in" : "under 6 in"}</text>` : ""}
  </svg>`;
}

/* ---------- Map layers ---------- */
export function initReports({ map, metro, openSheet, closeSheet, getSpot, toast, onChange, onPick }) {
  let cells = [];
  const names = new Map(); // cell -> street name (or null when none found)

  map.addSource("reports", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("reports-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  // Power out: neighborhood hexagons, stronger with more neighbors.
  map.addLayer({
    id: "reports-power-fill", type: "fill", source: "reports", filter: ["==", ["get", "kind"], "power_out"],
    paint: { "fill-color": POWER_COLOR, "fill-opacity": ["case", [">=", ["get", "reporters"], 3], 0.32, [">=", ["get", "reporters"], 2], 0.2, 0.08] },
  });
  map.addLayer({
    id: "reports-power-line", type: "line", source: "reports", filter: ["==", ["get", "kind"], "power_out"],
    paint: { "line-color": POWER_COLOR, "line-width": 1.25, "line-opacity": ["case", [">=", ["get", "reporters"], 2], 0.9, 0.4], "line-dasharray": [2, 2] },
  });
  // Roads: a dot per block-sized hexagon; faint until a second person confirms.
  map.addLayer({
    id: "reports-road", type: "circle", source: "reports-points",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 10],
      "circle-color": ["get", "color"],
      "circle-opacity": ["case", ["get", "confirmed"], 0.95, 0.45],
      "circle-stroke-width": 2,
      "circle-stroke-color": ["case", ["get", "confirmed"], "#ffffff", "rgba(255,255,255,0.35)"],
    },
  });
  map.addLayer({
    id: "reports-road-label", type: "symbol", source: "reports-points", minzoom: 10,
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
      "text-size": 11, "text-offset": [0, 1.25], "text-anchor": "top", "text-letter-spacing": 0.04,
    },
    paint: { "text-color": ["get", "color"], "text-halo-color": "#0b0f14", "text-halo-width": 1.6, "text-opacity": ["case", ["get", "confirmed"], 1, 0.6] },
  });

  // The whole pilot area in one request (reports outside it are refused by the database),
  // so the "Roads to avoid" list covers DFW whatever the map is showing.
  async function refresh() {
    const [w, s, e, n] = metro.maxBounds ? metro.maxBounds.flat() : metro.bounds;
    try {
      cells = await store.cells([w, s, e, n]);
    } catch (_) {
      return; // keep what's shown; the status badge covers official feeds
    }
    const h3 = await loadH3().catch(() => null);
    const polys = [], points = [];
    for (const c of cells) {
      if (c.kind === "power_out" && h3) {
        const ring = h3.cellToBoundary(c.cell, true);
        ring.push(ring[0]);
        polys.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: c.kind, reporters: c.reporters } });
      } else if (c.kind === "flood" || c.kind === "ice") {
        const confirmed = c.reporters >= 2;
        const label = c.kind === "flood"
          ? `${DEPTHS[c.depth]?.label.toUpperCase() || "FLOODED"}${confirmed ? "" : " · 1 REPORT"}`
          : `ICED${confirmed ? "" : " · 1 REPORT"}`;
        points.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [c.cell_lng, c.cell_lat] },
          properties: { kind: c.kind, cell: c.cell, confirmed, label, color: c.kind === "ice" ? ICE_COLOR : DEPTH_COLOR[c.depth || 3] },
        });
      }
    }
    map.getSource("reports")?.setData({ type: "FeatureCollection", features: polys });
    map.getSource("reports-points")?.setData({ type: "FeatureCollection", features: points });
    onChange?.();
    if (avoidOpen()) renderAvoid();
    resolveNames();
  }

  setInterval(() => !document.hidden && refresh(), 60 * 1000);

  /* ---------- Street names (from the basemap's vector tiles) ---------- */
  let resolving = false;
  async function resolveNames() {
    if (resolving) return;
    const tileUrl = map.getStyle()?.sources?.protomaps?.tiles?.[0];
    if (!tileUrl) return;
    const todo = cells.filter((c) => (c.kind === "flood" || c.kind === "ice") && !names.has(c.cell));
    if (!todo.length) return;
    resolving = true;
    for (const c of todo.slice(0, 40)) {
      try { names.set(c.cell, await roadNameAt(tileUrl, c.cell, [c.cell_lng, c.cell_lat])); }
      catch (_) { names.set(c.cell, null); }
    }
    resolving = false;
    onChange?.();
    if (avoidOpen()) renderAvoid();
  }

  /* ---------- Roads to avoid ---------- */
  const nearestCity = (pt) => {
    let best = null, bestMi = Infinity;
    for (const [name, lat, lng] of metro.cities || []) {
      const mi = milesBetween(pt, [lng, lat]);
      if (mi < bestMi) { bestMi = mi; best = name; }
    }
    return best;
  };

  // One entry per street (several reported blocks on the same street group together).
  // Confirmed first, then deepest water, then ice, then most recent.
  function roads() {
    const groups = new Map();
    for (const c of cells) {
      if (c.kind !== "flood" && c.kind !== "ice") continue;
      const at = [c.cell_lng, c.cell_lat];
      const street = names.get(c.cell) || null;
      const city = nearestCity(at);
      const key = street ? `${street}|${city}|${c.kind}` : `${c.cell}|${c.kind}`;
      const g = groups.get(key) || { key, street, city, kind: c.kind, spots: 0, reporters: 0, depth: 0, last_at: c.last_at, at, mine: false };
      g.spots++;
      g.mine ||= !!c.mine;
      if (c.reporters > g.reporters || (c.reporters === g.reporters && (c.depth || 0) > g.depth)) { g.reporters = c.reporters; g.at = at; }
      g.depth = Math.max(g.depth, c.depth || 0);
      if (c.last_at > g.last_at) g.last_at = c.last_at;
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, confirmed: g.reporters >= 2 }))
      .sort((a, b) => (b.confirmed - a.confirmed) || ((b.kind === "flood") - (a.kind === "flood")) || (b.depth - a.depth) || (b.last_at > a.last_at ? 1 : -1));
  }

  function roadRow(r, from) {
    const color = r.kind === "flood" ? DEPTH_COLOR[r.depth || 3] : ICE_COLOR;
    const what = r.kind === "flood" ? `Flooded · ${DEPTHS[r.depth]?.label.toLowerCase() || "depth unknown"}` : "Iced";
    const who = r.confirmed ? `${r.reporters} neighbors` : "1 report, unconfirmed";
    const dist = from ? ` · ${milesBetween(from, r.at) < 0.1 ? "here" : `${milesBetween(from, r.at).toFixed(1)} mi`}` : "";
    return `<li><button type="button" class="nr-row road-row${r.confirmed ? "" : " faint"}" style="--rc:${color}" data-avoid-at="${r.at.join(",")}">
      <span class="nr-dot"></span>
      <span class="nr-text"><span class="nr-what">${esc(r.street || "Unnamed street")}${r.city ? ` <span class="road-city">${esc(r.city)}</span>` : ""}</span>
      <span class="nr-meta">${esc(what)} · ${esc(who)} · ${esc(ago(r.last_at))}${r.spots > 1 ? ` · ${r.spots} spots` : ""}${dist}</span></span>
      <span class="road-go" aria-hidden="true">›</span></button></li>`;
  }

  const avoidOpen = () => !document.getElementById("sheet").hidden && !avoidRoot.parentElement.hidden;
  const avoidRoot = document.getElementById("avoid-body");
  function renderAvoid() {
    const list = roads();
    const confirmed = list.filter((r) => r.confirmed).length;
    avoidRoot.innerHTML = `
      <p class="rp-911">Water over the road? <strong>Turn around, don't drown.</strong> A foot of moving water can float a car.</p>
      <p class="sheet-lead">${list.length
        ? `${list.length} road${list.length > 1 ? "s" : ""} reported flooded or iced across ${esc(metro.name)}${confirmed ? `, ${confirmed} confirmed by more than one neighbor` : ""}. Tap one to see it on the map.`
        : `No neighbor has reported a flooded or iced road in ${esc(metro.name)} right now.`}</p>
      ${list.length ? `<ul class="near-list">${list.map((r) => roadRow(r, null)).join("")}</ul>` : ""}
      <p class="near-note">From neighbor reports, not official closures. A road that isn't listed can still be flooded or iced.</p>
      <div class="near-actions">
        <a class="near-btn" href="https://drivetexas.org/" target="_blank" rel="noopener">Official closures: DriveTexas</a>
        <button type="button" class="near-btn rp-open" data-report-open="flood">Report a road</button>
      </div>`;
  }
  function openAvoid() {
    renderAvoid();
    openSheet("avoid", "Roads to avoid");
  }

  function avoidCardHTML(pt) {
    const list = roads();
    const close = list.filter((r) => milesBetween(pt, r.at) <= 3).sort((a, b) => (b.confirmed - a.confirmed) || milesBetween(pt, a.at) - milesBetween(pt, b.at));
    const n = list.length;
    return `
      <div class="avoid-card" data-level="${close.some((r) => r.confirmed) ? "on" : n ? "some" : "none"}">
        <p class="rc-head"><span>Roads to avoid</span><span>${store.mode === "demo" ? "demo · " : ""}neighbor reports</span></p>
        <p class="avoid-title">${close.length ? `${close.length} road${close.length > 1 ? "s" : ""} within 3 mi` : n ? "None reported within 3 mi" : "None reported in DFW"}</p>
        ${close.length ? `<ul class="near-list">${close.slice(0, 3).map((r) => roadRow(r, pt)).join("")}</ul>` : `<p class="near-note">That doesn't mean roads are clear. Never drive into water you can't see the bottom of.</p>`}
        ${n ? `<button type="button" class="avoid-all" data-avoid-open>See all ${n} across DFW ›</button>` : ""}
      </div>`;
  }

  /* ---------- Report flow ---------- */
  const root = document.getElementById("report-body");
  let draft = { kind: null, depth: null };

  function renderFlow() {
    const spot = getSpot();
    const where = `${spot.label}${spot.place ? ` · ${spot.place}` : ""}`;
    const kinds = [
      ["flood", "Flooded road", "Water over the road"],
      ["ice", "Iced road", "Ice or sleet on the road"],
      ["power_out", "Power out", "No electricity here"],
      ["power_back", "Power's back", "Electricity came back"],
    ];
    root.innerHTML = `
      ${store.mode === "demo" ? `<p class="rp-demo">Demo mode: reports stay on this device until the shared database is connected.</p>` : ""}
      <p class="rp-911">Someone in danger? Call <strong>911</strong>. This doesn't reach emergency services.</p>
      <h3 class="rp-h">What's happening?</h3>
      <div class="rp-kinds">${kinds
        .map(([k, l, n]) => `<button type="button" class="rp-kind" data-kind="${k}" aria-pressed="${draft.kind === k}"><span class="rp-k-icon rp-i-${k}" aria-hidden="true"></span><span class="rp-k-l">${l}</span><span class="rp-k-n">${n}</span></button>`)
        .join("")}</div>
      ${draft.kind === "flood" ? `<h3 class="rp-h">How deep is it?</h3>
        <div class="rp-depths">${DEPTHS.slice(1)
          .map((d) => `<button type="button" class="rp-depth" data-depth="${d.n}" aria-pressed="${draft.depth === d.n}" style="--dc:${DEPTH_COLOR[d.n]}">
            <span class="rp-d-bar"><span style="height:${Math.min(100, d.inches * 2.2)}%"></span></span>
            <span class="rp-d-text"><span class="rp-d-l">${d.label}</span><span class="rp-d-r">${d.range} · ${d.note}</span></span></button>`)
          .join("")}</div>
        <p class="rp-note">Never wade or drive in to check. Estimate from what's around it: curbs, tires, mailboxes.</p>` : ""}
      <h3 class="rp-h">Where</h3>
      <p class="rp-where">${esc(where)}</p>
      <p class="rp-note">Tap the map first to report a different spot. We store only a ${draft.kind === "power_out" || draft.kind === "power_back" ? "neighborhood-sized area (about a third of a mile)" : "block-sized area"}, never your exact location.</p>
      <button type="button" class="rp-send" id="rp-send" ${draft.kind && (draft.kind !== "flood" || draft.depth) ? "" : "disabled"}>Send report</button>
      <p class="rp-note">Reports fade after ${draft.kind === "ice" ? "12" : "6"} hours unless someone reports again. One report shows faintly until a second neighbor confirms it.</p>`;
  }

  root.addEventListener("click", async (e) => {
    const k = e.target.closest("[data-kind]");
    if (k) { draft = { kind: k.dataset.kind, depth: draft.kind === k.dataset.kind ? draft.depth : null }; renderFlow(); return; }
    const d = e.target.closest("[data-depth]");
    if (d) { draft.depth = Number(d.dataset.depth); renderFlow(); return; }
    if (e.target.closest("#rp-send")) {
      const btn = e.target.closest("#rp-send");
      btn.disabled = true;
      btn.textContent = "Sending…";
      try {
        await store.submit({ kind: draft.kind, depth: draft.depth, at: getSpot().at });
        const kind = draft.kind;
        draft = { kind: null, depth: null };
        closeSheet();
        await refresh();
        toast(
          kind === "power_out"
            ? "Report sent. Also tell your electric utility: Oncor serves most of DFW at 1-888-313-6862."
            : kind === "power_back"
              ? "Thanks. Your power-out report was cleared."
              : "Report sent. It shows faintly until a second neighbor confirms it."
        );
      } catch (err) {
        btn.disabled = false;
        btn.textContent = "Send report";
        toast(err.message || "Couldn't send the report. Try again.");
      }
    }
  });

  function openReport(kind = null) {
    draft = { kind, depth: null };
    renderFlow();
    openSheet("report", "Report");
  }

  /* ---------- Summary for the area panel ---------- */
  function near(pt, miles = 1) {
    const list = cells
      .map((c) => ({ ...c, mi: milesBetween(pt, [c.cell_lng, c.cell_lat]) }))
      .filter((c) => c.mi <= (c.kind === "power_out" || c.kind === "power_back" ? miles + 0.3 : miles))
      .sort((a, b) => a.mi - b.mi);
    const floods = list.filter((c) => c.kind === "flood");
    const nearestFlood = floods.find((c) => c.mi <= 0.5) || null;
    return { list, nearestFlood };
  }

  function summaryHTML(pt) {
    const { list, nearestFlood } = near(pt);
    const rows = list
      .filter((c) => c.kind !== "power_back")
      .slice(0, 5)
      .map((c) => {
        const who = c.reporters >= 2 ? `${c.reporters} neighbors` : "1 report, unconfirmed";
        const what = c.kind === "flood" ? `Flooded road · ${DEPTHS[c.depth]?.label.toLowerCase() || "depth unknown"}` : c.kind === "ice" ? "Iced road" : "Power out";
        const when = c.kind === "power_out" ? `since ${clock(c.first_at)}` : ago(c.last_at);
        const color = c.kind === "flood" ? DEPTH_COLOR[c.depth || 3] : c.kind === "ice" ? ICE_COLOR : POWER_COLOR;
        return `<li class="nr-row${c.reporters >= 2 ? "" : " faint"}" style="--rc:${color}">
          <span class="nr-dot"></span>
          <span class="nr-text"><span class="nr-what">${esc(what)}</span><span class="nr-meta">${esc(who)} · ${esc(when)} · ${c.mi < 0.1 ? "here" : `${c.mi.toFixed(1)} mi`}${c.mine ? " · includes yours" : ""}</span></span>
          <button type="button" class="nr-flag" data-flag-kind="${c.kind}" data-flag-cell="${c.cell}" title="Report this as wrong">Wrong?</button>
        </li>`;
      })
      .join("");
    const backs = list.filter((c) => c.kind === "power_back").reduce((n, c) => n + c.reporters, 0);
    return `
      ${avoidCardHTML(pt)}
      <h3 class="near-h">How deep is it? <span class="near-h-note">${nearestFlood ? `${esc(DEPTHS[nearestFlood.depth]?.label || "")} · ${nearestFlood.reporters >= 2 ? `${nearestFlood.reporters} neighbors` : "1 report"}` : "no water reported"}</span></h3>
      <div class="depth-wrap">${depthScene(nearestFlood?.depth || null)}</div>
      ${nearestFlood ? `<p class="near-note">${esc(DEPTHS[nearestFlood.depth].note)} Turn around, don't drown.</p>` : `<p class="near-note">No neighbor has reported water within half a mile. That doesn't mean roads are clear.</p>`}
      <h3 class="near-h">Neighbor reports <span class="near-h-note">within 1 mi${store.mode === "demo" ? " · demo" : ""}</span></h3>
      ${rows ? `<ul class="near-list">${rows}</ul>` : `<p class="near-note">No reports nearby yet.</p>`}
      ${backs ? `<p class="near-note">Power back reported by ${backs} neighbor${backs > 1 ? "s" : ""} nearby.</p>` : ""}
      <div class="near-actions"><button type="button" class="near-btn rp-open" data-report-open>Report here</button></div>`;
  }

  document.addEventListener("click", async (e) => {
    const open = e.target.closest("[data-report-open]");
    if (open) { openReport(open.dataset.reportOpen || null); return; }
    if (e.target.closest("[data-avoid-open]")) { openAvoid(); return; }
    const go = e.target.closest("[data-avoid-at]");
    if (go) { closeSheet(); onPick(go.dataset.avoidAt.split(",").map(Number)); return; }
    const f = e.target.closest("[data-flag-kind]");
    if (f) {
      try { await store.flag({ kind: f.dataset.flagKind, cell: f.dataset.flagCell }); f.textContent = "Flagged"; f.disabled = true; toast("Thanks. Reports flagged by enough neighbors are hidden."); }
      catch (err) { toast(err.message || "Couldn't flag that report."); }
    }
  });

  return {
    layerIds: ["reports-power-fill", "reports-power-line", "reports-road", "reports-road-label"],
    refresh,
    openReport,
    openAvoid,
    roads,
    getCells: () => cells,
    summaryHTML,
    store,
  };
}
