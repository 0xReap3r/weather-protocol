// Map markers: one visual language for every point on the map, so a glance tells you what it is.
// Each marker is a small round badge: a dark core, a colored ring that carries the status
// (flood stage, % full, warning), and a white line pictogram that names the kind (river gauge,
// lake, rain gauge, crossing, fire, station, report). Drawn once per style on a canvas and
// registered as MapLibre images at 2x, so they stay crisp and cost nothing per frame.
// The same pictograms are exported as SVG for legends, the map key and panels.

// 24×24 line pictograms (stroke), Lucide-like weight.
export const GLYPHS = {
  gauge: "M5 4v16M5 7h3M5 11h3M5 15h3 M11 13c1.6-1.4 3.4-1.4 5 0s3.4 1.4 5 0 M11 17.5c1.6-1.4 3.4-1.4 5 0s3.4 1.4 5 0",
  lake: "M3.5 9.5c2.2-1.6 4.3-1.6 6.5 0s4.3 1.6 6.5 0 4.3-1.6 4 0 M3.5 14c2.2-1.6 4.3-1.6 6.5 0s4.3 1.6 6.5 0 4.3-1.6 4 0 M3.5 18.5c2.2-1.6 4.3-1.6 6.5 0s4.3 1.6 6.5 0 4.3-1.6 4 0",
  drop: "M12 3.5s-6 6.6-6 10.6a6 6 0 0 0 12 0C18 10.1 12 3.5 12 3.5z",
  crossing: "M7.5 4 5 20 M16.5 4 19 20 M5.6 13c2.1-1.5 4.3-1.5 6.4 0s4.3 1.5 6.4 0",
  train: "M7 3.5h10a2 2 0 0 1 2 2V14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5.5a2 2 0 0 1 2-2z M5 10.5h14 M9 14h.01 M15 14h.01 M8.5 17 6.5 20.5 M15.5 17l2 3.5",
  flood: "M3 15.5c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0 M3 19.5c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0 M6.5 11.5 8 8h8l1.5 3.5 M6.5 11.5h11",
  ice: "M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M9.5 4.5 12 6l2.5-1.5 M9.5 19.5 12 18l2.5 1.5",
  power: "M13 2.5 5.5 13.5h6l-1 8 8-11h-6z",
  hail: "M7 15.5a4.5 4.5 0 0 1 .3-9A6 6 0 0 1 18.5 8.5a3.5 3.5 0 0 1-.5 7z M8 19h.01 M12 20.5h.01 M16 19h.01",
  tree: "M12 3 7 10h3l-4 6h12l-4-6h3z M12 16v5",
  roof: "M3.5 11.5 12 4.5l8.5 7 M6 10v9.5h12V10 M11 14l2 2-2 2",
  lines: "M5 3.5v17 M19 3.5v17 M3 7h4 M17 7h4 M5 7c4 5 10 5 14 0 M10.5 13.5 9 17h3l-1.5 3.5",
  flame: "M12 2.6c.8 3-1.4 4.6-1.4 6.8 0 1.2.9 2.3 2.1 2.3 1.5 0 2.2-1.3 1.9-2.8 2.4 1.9 3.7 4.2 3.7 6.7A6.3 6.3 0 0 1 12 21.8a6.3 6.3 0 0 1-6.3-6.1c0-4 3.4-6.9 6.3-13.1z",
};

const CORE = "#0f1823";
const cache = new Set();

// Badge as an ImageData. opts: { glyph, ring, fill, ink, dashed, size, filled }
function draw({ glyph, ring, fill = CORE, ink = "#f2f6fa", dashed = false, filledGlyph = false, ringWidth = 2.6 }) {
  const px = 56, c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d");
  const cx = px / 2, r = px / 2 - 5;
  // soft drop shadow so the badge lifts off busy maps without a heavy outline
  g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 6; g.shadowOffsetY = 1.5;
  g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  g.shadowColor = "transparent";
  if (ring) {
    g.lineWidth = ringWidth * 2; g.strokeStyle = ring;
    if (dashed) g.setLineDash([7, 5]);
    g.beginPath(); g.arc(cx, cx, r - ringWidth, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
  }
  const s = 1.25; // 24-unit glyph into a ~30px box at 2x
  g.translate(cx - 12 * s, cx - 12 * s); g.scale(s, s);
  g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = 2.1;
  const path = new Path2D(GLYPHS[glyph]);
  if (filledGlyph) { g.fillStyle = ink; g.fill(path); }
  else { g.strokeStyle = ink; g.stroke(path); }
  return g.getImageData(0, 0, px, px);
}

// Register (once per style) and return the image id.
export function badge(map, id, opts) {
  const key = `mk-${id}`;
  if (!map.hasImage(key)) map.addImage(key, draw(opts), { pixelRatio: 2 });
  cache.add(key);
  return key;
}

// Standard size ramp: small when zoomed out, comfortable to tap when zoomed in.
export const ICON_SIZE = ["interpolate", ["linear"], ["zoom"], 5, 0.62, 9, 0.8, 13, 1];

// Same badge as inline SVG for legends and panels.
export function badgeSVG({ glyph, ring, fill = CORE, ink = "#f2f6fa", dashed = false, filledGlyph = false }, size = 18) {
  const g = GLYPHS[glyph];
  return `<svg class="mk-ico" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true">
    <circle cx="14" cy="14" r="12.2" fill="${fill}" ${ring ? `stroke="${ring}" stroke-width="2.2"${dashed ? ' stroke-dasharray="3.5 2.6"' : ""}` : ""}/>
    <g transform="translate(5.2 5.2) scale(.733)"><path d="${g}" ${filledGlyph ? `fill="${ink}"` : `fill="none" stroke="${ink}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"`}/></g></svg>`;
}
