// Map key: explains every mark and color on the map, built from the same color tables
// the layers use, so the key can't drift from the map.
import { CATEGORY } from "./data/gauges.js";
import { alertStyle } from "./data/alerts.js";
import { RAIN_BANDS } from "./radar.js";
import { SPC_LEVELS } from "./storms.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const row = (swatch, label, note = "") =>
  `<li class="key-row">${swatch}<span class="key-text"><span class="key-label">${esc(label)}</span>${
    note ? `<span class="key-note">${esc(note)}</span>` : ""
  }</span></li>`;

const area = (color) => `<span class="key-sw key-area" style="--c:${color}"></span>`;
const dot = (color, faded = false) => `<span class="key-sw key-dot${faded ? " faded" : ""}" style="--c:${color}"></span>`;
const drop = (color) => `<span class="key-sw key-drop" style="--c:${color}"></span>`;

const WARNINGS = [
  ["Tornado Emergency", "Rare. A confirmed, damaging tornado heading for people. Take shelter now."],
  ["Tornado Warning", "Tornado seen or on radar. Take shelter now."],
  ["Flash Flood Warning", "Flash flooding happening or about to. Move to higher ground; never drive into water."],
  ["Severe Thunderstorm Warning", "Damaging wind or large hail."],
  ["Flood Warning", "River or area flooding expected or happening."],
  ["Winter Storm Warning", "Heavy snow, sleet or ice."],
  ["Freeze Warning", "Freezing temperatures. Protect pipes, plants and pets."],
  ["Tornado Watch", "Conditions could produce tornadoes. Be ready."],
  ["Flood Watch", "Flooding is possible. Be ready."],
  ["Flood Advisory", "Minor flooding or ponding. Use caution."],
];

export function renderKey() {
  const gaugeRows = [
    ["major", "Major flooding", "Widespread flooding; evacuations possible."],
    ["moderate", "Moderate flooding", "Some roads and buildings flood."],
    ["minor", "Minor flooding", "Low roads and parks flood."],
    ["action", "Near flood stage", "Rising toward flooding. Watch it."],
    ["no_flooding", "Below flood stage", "Normal for this river. Not a promise roads are clear."],
    ["not_defined", "Lake level", "Lakes have no flood stages here; tap for the level."],
  ]
    .map(([k, label, note]) => row(dot(CATEGORY[k].color), label, note))
    .join("");

  const rainRows = [...RAIN_BANDS]
    .reverse()
    .map((b) => row(drop(b.color), b.label))
    .join("");

  return `
    <p class="key-rule"><strong>The color rule:</strong> red and purple mean danger, orange and yellow mean watch out, blue means water or rain, and gray means no data. Gray never means "safe."</p>

    <h3 class="key-h">Warnings and watches</h3>
    <p class="key-lead">Shaded areas from the National Weather Service, in its official colors. A pulsing outline means the warning or watch is active now.</p>
    <ul class="key-list">${WARNINGS.map(([e, note]) => row(area(alertStyle(e).color), e, note)).join("")}</ul>

    <h3 class="key-h">Storm outlook (Storms layer)</h3>
    <p class="key-lead">NOAA's Storm Prediction Center forecast for severe storms, in its own colors. A wide-area chance, not a warning.</p>
    <ul class="key-list">${SPC_LEVELS.map((l) => row(area(l.fill), l.n ? `${l.n} · ${l.name}` : l.name, l.note)).join("")}</ul>

    <h3 class="key-h">Rivers and lakes</h3>
    <p class="key-lead">Each dot is an official gauge, colored by NWS flood stage. A pulsing ring means it's at or near flood stage.</p>
    <ul class="key-list">${gaugeRows}${row(dot(CATEGORY.unknown.color, true), "No recent reading", "The gauge hasn't reported in over 2 hours.")}</ul>

    <h3 class="key-h">Rain radar</h3>
    <p class="key-lead">Drops show where rain is falling now, from live NEXRAD radar. They don't show water on the ground.</p>
    <ul class="key-list key-cols">${rainRows}</ul>

    <h3 class="key-h">Flood maps</h3>
    <ul class="key-list">
      ${row(area("#4a90e2"), "FEMA flood zones", "Long-term flood risk, in FEMA's own map colors. Zoom in to see them; tap a spot for its zone.")}
      ${row(area("#2f6fd6"), "Modeled flooding", "From a gauge's detail panel: where water would reach at each flood level. A model, not observed flooding.")}
    </ul>

    <h3 class="key-h">Neighbor reports</h3>
    <p class="key-lead">Faint with a dashed edge until a second neighbor confirms. Reports fade after 6 hours (ice: 12).</p>
    <ul class="key-list">
      ${row(dot("#7fd4ff"), "Flooded road, shallow", "Ankle-deep to over the curb.")}
      ${row(dot("#2f7fe0"), "Flooded road, knee-deep")}
      ${row(dot("#ff3b3b"), "Flooded road, waist-deep or more", "Life-threatening.")}
      ${row(dot("#c9f1ff"), "Iced road")}
      ${row(area("#ffb020"), "Power out", "Neighborhood-sized area; stronger with more neighbors.")}
      ${row(area("#d94cff"), "Hail", "Neighborhood-sized area, with the reported size. Fades after 3 hours.")}
      ${row(dot("#ff8fa3"), "Storm damage", "Trees down, roof damage or power lines down. Fades after 24 hours.")}
    </ul>

    <h3 class="key-h">Rail (DART)</h3>
    <ul class="key-list">
      ${row('<span class="key-sw key-rail" style="--c:#198BC3"></span>', "Rail lines", "In each line's own color.")}
      ${row(dot("#e8edf2"), "Station")}
      ${row(dot("#ff3b3b"), "Station inside a warning", "A flood or tornado warning covers it. Check DART before you go.")}
      ${row(dot("#4fb3ff"), "Flooding confirmed nearby", "Neighbors confirm a flooded road within a few blocks.")}
    </ul>

    <h3 class="key-h">Marks on the map</h3>
    <ul class="key-list">
      ${row('<span class="key-sw key-pin"></span>', "Dropped pin", "The spot the side panel is describing. Tap the map anywhere to move it.")}
      ${row('<span class="key-sw key-me"></span>', "Your location", "From Near me.")}
      ${row('<span class="key-sw key-cross"></span>', "Map center", "The panel follows this when no pin is dropped.")}
      ${row('<span class="key-sw key-pilot"></span>', "Pilot area edge", "Coverage is best inside this line.")}
    </ul>`;
}
