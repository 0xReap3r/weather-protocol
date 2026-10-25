// Side menu: every view in one place, "Show me" presets that switch the map to one kind of
// weather, and the Simple / Normal / Advanced view modes. Our own layout and wording.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const MODE_KEY = "stormline.viewMode.v1";

// Layer sets for "Show me". Grid isn't live yet, so presets leave it alone.
export const PRESETS = [
  { id: "all", label: "Everything", note: "All official layers and neighbor reports", layers: ["alerts", "rivers", "rain", "storms", "reports"] },
  { id: "flood", label: "Flooding", note: "Warnings, rivers, radar, flood zones, reports", layers: ["alerts", "rivers", "rain", "zones", "reports", "satflood", "raintotal"] },
  { id: "storms", label: "Tornadoes and storms", note: "Warnings, storm outlook, radar, hail and damage reports", layers: ["alerts", "storms", "rain", "reports"] },
  { id: "winter", label: "Winter and ice", note: "Warnings, iced-road and power reports, rail", layers: ["alerts", "rain", "reports", "transit"] },
  { id: "power", label: "Power outages", note: "Warnings and neighbor power reports", layers: ["alerts", "reports"] },
  { id: "travel", label: "Getting around", note: "Warnings, radar, roads to avoid, rail", layers: ["alerts", "rain", "reports", "transit"] },
];

const MODES = [
  { id: "simple", label: "Simple", note: "Just what matters right now: warnings, rain, roads to avoid and what to do. Hides the layer chips and details." },
  { id: "normal", label: "Normal", note: "The full map with layer chips, details and neighbor reports." },
  { id: "advanced", label: "Advanced", note: "Everything in Normal, plus when each data source last updated." },
];

// Newest first. Keep entries short and in plain words.
const CHANGES = [
  ["Oct 25, 2026", "What's happened (last 24 hours), My places, and Check a route against warnings and neighbor reports."],
  ["Oct 25, 2026", "Flood from space (NASA satellite flood map with flooded acres per county) and Rain totals for the last hour, 24 hours and 3 days."],
  ["Oct 25, 2026", "Side menu with Show me presets and Simple / Normal / Advanced views."],
  ["Oct 25, 2026", "Storms layer (NOAA storm outlook), faster warning checks during active weather, and a bar that tells you when you're inside a warning."],
  ["Oct 25, 2026", "Hail and storm damage reports. Trees and power lines down show in Roads to avoid."],
  ["Oct 25, 2026", "Roads to avoid list and DART rail with flagged stations."],
  ["Oct 25, 2026", "Neighbor reports for flooded roads, iced roads and power outages."],
  ["Oct 24, 2026", "What's coming: risk levels for today, the next 3 days and the week."],
  ["Oct 24, 2026", "Rain radar as drops, FEMA flood zones and modeled river flood maps."],
];

const ICON = {
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  warn: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  coming: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  area: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  avoid: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  report: '<path d="M12 3v12M6 9l6-6 6 6"/><path d="M5 20h14"/>',
  rail: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l-2 2M15 20l2 2M9 13h.01M15 13h.01"/>',
  rivers: '<path d="M3 8c3-2 6 2 9 0s6-2 9 0M3 14c3-2 6 2 9 0s6-2 9 0"/>',
  key: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  layers: '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12 9.5 5 9.5-5M2.5 16l9.5 5 9.5-5"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  install: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  guide: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  news: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

export function initMenu({ appName, getLayerState, applyPreset, actions, getFeeds, canInstall }) {
  const drawer = document.getElementById("menu");
  const scrim = document.getElementById("menu-scrim");
  const body = document.getElementById("menu-body");
  let mode = "normal";
  try { mode = localStorage.getItem(MODE_KEY) || "normal"; } catch (_) {}
  if (!MODES.some((m) => m.id === mode)) mode = "normal";
  document.body.dataset.viewMode = mode;

  const item = (act, ic, label, extra = "") =>
    `<li><button type="button" class="mn-item" data-act="${act}">${icon(ic)}<span>${esc(label)}</span>${extra}</button></li>`;

  function activePreset() {
    const st = getLayerState();
    return PRESETS.find((p) => ["alerts", "rivers", "rain", "storms", "zones", "transit", "reports", "satflood", "raintotal"].every((id) => !!st[id] === p.layers.includes(id)))?.id || null;
  }

  function render() {
    const active = activePreset();
    const feeds = getFeeds();
    body.innerHTML = `
      <section class="mn-sec">
        <h3 class="mn-h">Show me</h3>
        <ul class="mn-presets">${PRESETS.map((p) => `<li><button type="button" class="mn-preset" data-preset="${p.id}" aria-pressed="${active === p.id}">
          <span class="mn-p-l">${esc(p.label)}</span><span class="mn-p-n">${esc(p.note)}</span></button></li>`).join("")}</ul>
      </section>
      <div class="mn-cols">
        <section class="mn-sec">
          <h3 class="mn-h">Right now</h3>
          <ul class="mn-list">
            ${item("map", "map", "Map")}
            ${item("warnings", "warn", "Warnings")}
            ${item("coming", "coming", "What's coming")}
            ${item("feed", "news", "What's happened")}
            ${item("area", "area", "This area")}
            ${item("avoid", "avoid", "Roads to avoid")}
            ${item("rail", "rail", "Rail (DART)")}
          </ul>
        </section>
        <section class="mn-sec">
          <h3 class="mn-h">Neighbors</h3>
          <ul class="mn-list">
            ${item("report", "report", "Send a report")}
            ${item("reports", "rivers", "Reports near here")}
          </ul>
          <h3 class="mn-h">Tools</h3>
          <ul class="mn-list">
            ${item("places", "area", "My places")}
            ${item("route", "rail", "Check a route")}
            ${item("locate", "locate", "Near me")}
            ${item("share", "share", "Share this view")}
            ${item("layers", "layers", "Layers")}
            ${item("key", "key", "Map key")}
            ${canInstall() ? item("install", "install", "Install app") : ""}
          </ul>
        </section>
        <section class="mn-sec">
          <h3 class="mn-h">About this map</h3>
          <ul class="mn-list">
            ${item("guide", "guide", "How to use it")}
            ${item("news", "news", "What's new")}
            ${item("about", "info", "Sources and terms")}
          </ul>
          <a class="mn-911" href="tel:911">${icon("phone")}<span>In danger? Call <strong>911</strong></span></a>
        </section>
      </div>
      <section class="mn-sec adv-only">
        <h3 class="mn-h">Data status</h3>
        <ul class="mn-feeds">${feeds.map((f) => `<li class="${f.ok === false ? "bad" : f.at ? "" : "wait"}"><span>${esc(f.name)}</span><span>${esc(f.text)}</span></li>`).join("")}</ul>
      </section>
      <section class="mn-sec mn-modes-sec">
        <h3 class="mn-h">View</h3>
        <div class="mn-modes" role="group" aria-label="View mode">${MODES.map((m) => `<button type="button" data-mode="${m.id}" aria-pressed="${mode === m.id}">${m.label}</button>`).join("")}</div>
        <p class="mn-mode-note">${esc(MODES.find((m) => m.id === mode).note)}</p>
      </section>`;
  }

  function open() {
    render();
    drawer.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => { drawer.classList.add("open"); scrim.classList.add("open"); });
    document.getElementById("menu-btn").setAttribute("aria-expanded", "true");
    drawer.querySelector(".mn-close").focus();
  }
  function close() {
    drawer.classList.remove("open");
    scrim.classList.remove("open");
    document.getElementById("menu-btn").setAttribute("aria-expanded", "false");
    setTimeout(() => { if (!drawer.classList.contains("open")) { drawer.hidden = true; scrim.hidden = true; } }, 200);
  }

  function setMode(m) {
    mode = m;
    document.body.dataset.viewMode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (_) {}
    render();
  }

  document.getElementById("menu-btn").addEventListener("click", open);
  drawer.querySelector(".mn-close").addEventListener("click", close);
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => e.key === "Escape" && !drawer.hidden && close());

  body.addEventListener("click", (e) => {
    const p = e.target.closest("[data-preset]");
    if (p) {
      const preset = PRESETS.find((x) => x.id === p.dataset.preset);
      applyPreset(preset.layers);
      render();
      actions.toast?.(`Showing: ${preset.label.toLowerCase()}.`);
      return;
    }
    const m = e.target.closest("[data-mode]");
    if (m) { setMode(m.dataset.mode); return; }
    const a = e.target.closest("[data-act]");
    if (a && actions[a.dataset.act]) { close(); actions[a.dataset.act](); }
  });

  // Guide and What's new live in the bottom sheet like everything else.
  function guideHTML() {
    return `
      <ol class="guide-list">
        <li><strong>Read the panel.</strong> It describes the map center, your location (Near me) or a spot you tap. The top line is the most serious official warning there.</li>
        <li><strong>Pick what to see.</strong> Open the menu and choose a Show me option, or switch layers on and off with the chips along the top.</li>
        <li><strong>Check before you drive.</strong> Roads to avoid lists flooded, iced or blocked roads neighbors reported. Turn around, don't drown.</li>
        <li><strong>Report what you see.</strong> Tap Report for a flooded or iced road, a power outage, hail or storm damage. We keep only a block or neighborhood, never your exact spot.</li>
        <li><strong>Watch the colors.</strong> Red and purple mean danger, orange and yellow mean watch out, blue means water or rain. Gray means no data, never "safe."</li>
        <li><strong>In danger?</strong> Call 911. This map doesn't reach emergency services and can lag behind official warnings.</li>
      </ol>`;
  }
  function newsHTML() {
    return `<ul class="news-list">${CHANGES.map(([d, t]) => `<li><span class="news-d">${esc(d)}</span><span>${esc(t)}</span></li>`).join("")}</ul>`;
  }

  return { open, close, render, guideHTML, newsHTML, getMode: () => mode };
}
