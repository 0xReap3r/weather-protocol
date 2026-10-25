// DART rail lines and stations (light rail, TRE, Silver Line, streetcar, M-Line trolley).
// Source: DART's GTFS, published as a public layer on the City of Dallas ArcGIS Online.
// Loaded once per visit; rail lines don't change hour to hour.
import { fetchJSON } from "./fetch.js";

const BASE = "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/ArcGIS/rest/services/dart_rail/FeatureServer";
export const DART_ALERTS_URL = "https://www.dart.org/trip/trip-planner/service-alerts";
export const DART_WINTER_URL = "https://www.dart.org/trip/trip-planner/severe-winter-weather-operating-plans";

const LINE_NAMES = { BLUE: "Blue", RED: "Red", GREEN: "Green", ORANGE: "Orange", SILVER: "Silver", TRE: "TRE", 620: "Streetcar", 425: "M-Line" };
const ACRONYMS = new Set(["DFW", "UNT", "TRE", "UTD", "UTSW", "CBD", "VA", "II", "NW"]);

const titleCase = (s) =>
  s.toLowerCase().replace(/[a-z0-9]+/g, (w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)));

const query = (layer, extra = "") =>
  `${BASE}/${layer}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&geometryPrecision=5${extra}`;

// Distance in meters from a point to a polyline, using a flat projection (fine at city scale).
function metersToLine([lng, lat], coords) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  let best = Infinity;
  const walk = (line) => {
    for (let i = 1; i < line.length; i++) {
      const ax = (line[i - 1][0] - lng) * kx, ay = (line[i - 1][1] - lat) * ky;
      const bx = (line[i][0] - lng) * kx, by = (line[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  };
  if (typeof coords[0][0] === "number") walk(coords); else coords.forEach(walk);
  return best;
}

let cached = null;
export function loadTransit() {
  if (!cached) {
    cached = (async () => {
      const [lines, stops] = await Promise.all([
        fetchJSON(query(1, "&maxAllowableOffset=0.00003"), { timeout: 20000 }),
        fetchJSON(query(0), { timeout: 20000 }),
      ]);
      const lineFeatures = (lines.features || []).map((f) => {
        const p = f.properties;
        return {
          type: "Feature",
          geometry: f.geometry,
          properties: {
            line: LINE_NAMES[p.route_short_name] || titleCase(p.route_long_name || ""),
            color: `#${p.route_color || "8899aa"}`,
            rail: p.route_type !== 5, // 5 = streetcar / trolley
          },
        };
      });
      const stations = [];
      const seen = new Set();
      for (const f of stops.features || []) {
        const raw = f.properties.stop_name || "";
        if (/ @ |YARD|POCKET TRACK/i.test(raw)) continue; // trolley curb stops and rail yards
        const name = titleCase(raw);
        const at = f.geometry.coordinates;
        const key = name.replace(/ Station$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        const served = [];
        for (const l of lineFeatures) {
          if (served.some((s) => s.line === l.properties.line)) continue;
          if (metersToLine(at, l.geometry.coordinates) < 120) served.push({ line: l.properties.line, color: l.properties.color });
        }
        stations.push({ id: String(f.properties.stop_id), name, at, lines: served });
      }
      return { lines: { type: "FeatureCollection", features: lineFeatures }, stations };
    })().catch((e) => { cached = null; throw e; });
  }
  return cached;
}
