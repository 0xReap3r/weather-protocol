// NWS active alerts for the metro, as GeoJSON for the map.
// Storm-based warnings (tornado, flash flood, severe t-storm) come with their own polygon.
// County- or zone-based alerts (flood watch, freeze, winter storm) have no polygon, so we
// fetch the county/zone outline from the NWS zones API and cache it for the session.

import { fetchJSON } from "./fetch.js";
import { loadCounties } from "./counties.js";

const NWS = "https://api.weather.gov";

// Severity ranking + colors, following NWS map colors where they're well known.
// Higher rank draws on top and wins the banner color.
const STYLE = [
  { match: /tornado emergency|flash flood emergency/i, color: "#ff2fa8", rank: 100 },
  { match: /^tornado warning/i, color: "#ff2b2b", rank: 90 },
  { match: /^flash flood warning/i, color: "#e0352b", rank: 85 },
  { match: /^severe thunderstorm warning/i, color: "#ffa500", rank: 80 },
  { match: /^ice storm warning/i, color: "#b34dff", rank: 75 },
  { match: /^winter storm warning|^blizzard warning/i, color: "#ff69b4", rank: 74 },
  { match: /^flood warning/i, color: "#22c55e", rank: 70 },
  { match: /^extreme cold warning|^hard freeze warning|^freeze warning/i, color: "#6a5acd", rank: 60 },
  { match: /^tornado watch/i, color: "#ffe14d", rank: 55 },
  { match: /^severe thunderstorm watch/i, color: "#db7093", rank: 50 },
  { match: /^flood watch|^flash flood watch/i, color: "#2e8b57", rank: 45 },
  { match: /watch$/i, color: "#7d8fa3", rank: 30 },
  { match: /advisory$/i, color: "#6b7f94", rank: 20 },
  { match: /./, color: "#5a6b7d", rank: 10 },
];
export function alertStyle(event) {
  return STYLE.find((s) => s.match.test(event || "")) || STYLE[STYLE.length - 1];
}

const zoneCache = new Map(); // zone URL -> geometry | null

async function zoneGeometry(url) {
  if (zoneCache.has(url)) return zoneCache.get(url);
  try {
    const z = await fetchJSON(url, { timeout: 12000 });
    zoneCache.set(url, z.geometry || null);
  } catch (_) {
    zoneCache.set(url, null); // don't hammer a failing zone
  }
  return zoneCache.get(url);
}

function bboxOfGeometry(g) {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
    } else c.forEach(walk);
  };
  if (g.type === "GeometryCollection") g.geometries.forEach((x) => walk(x.coordinates));
  else walk(g.coordinates);
  return [w, s, e, n];
}
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export async function loadAlerts(metro) {
  const [data, counties] = await Promise.all([
    fetchJSON(`${NWS}/alerts/active?area=${metro.nwsAlertArea}`, { timeout: 15000 }),
    loadCounties(metro).catch(() => []),
  ]);
  // Zone-based alerts (watches, winter, heat, flood watches) carry county FIPS codes ("SAME"
  // codes like 048113); we draw them with the county outline instead of fetching each zone.
  const byFips = new Map(counties.map((c) => [`0${c.geoid}`, c.geometry]));
  const out = [];

  for (const f of data.features || []) {
    const p = f.properties || {};
    if (p.status && p.status !== "Actual") continue;          // skip tests/exercises
    if (p.messageType === "Cancel") continue;

    let geometries = [];
    if (f.geometry) {
      if (!overlaps(bboxOfGeometry(f.geometry), metro.maxBounds)) continue;
      geometries = [f.geometry];
    } else {
      const same = p.geocode?.SAME || [];
      geometries = same.map((code) => byFips.get(code)).filter(Boolean);
      if (!geometries.length) {
        // No county codes we know (marine zones, or the county list didn't load): fall back to
        // the NWS zone outlines, a few at most.
        const zones = (p.affectedZones || []).slice(0, 12);
        const geoms = await Promise.all(zones.map(zoneGeometry));
        geometries = geoms.filter((g) => g && overlaps(bboxOfGeometry(g), metro.maxBounds));
      }
      if (!geometries.length) continue;
    }

    const st = alertStyle(p.event);
    const props = {
      id: p.id,
      event: p.event,
      headline: p.headline || p.event,
      severity: p.severity,
      urgency: p.urgency,
      areaDesc: p.areaDesc,
      sent: p.sent,
      onset: p.onset || p.effective,
      expires: p.ends || p.expires,
      description: p.description || "",
      instruction: p.instruction || "",
      sender: p.senderName,
      color: st.color,
      rank: st.rank,
      storm: !!f.geometry, // true = storm-based polygon
    };
    for (const g of geometries) out.push({ type: "Feature", geometry: g, properties: props });
  }

  // Lower rank first so higher-rank polygons draw on top.
  out.sort((a, b) => a.properties.rank - b.properties.rank);
  return { type: "FeatureCollection", features: out };
}

// One entry per alert (polygons for multi-zone alerts collapsed), highest rank first.
export function uniqueAlerts(fc) {
  const seen = new Map();
  for (const f of fc.features) if (!seen.has(f.properties.id)) seen.set(f.properties.id, f.properties);
  return [...seen.values()].sort((a, b) => b.rank - a.rank);
}

// Alerts issued in the last `hours` for the metro, newest first (for the "What's happened" feed).
// Lighter than loadAlerts: no zone outlines; a zone alert counts if it names one of our counties.
export async function loadRecentAlerts(metro, hours = 24) {
  const start = new Date(Date.now() - hours * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
  const data = await fetchJSON(`${NWS}/alerts?area=${metro.nwsAlertArea}&start=${start}&limit=500`, { timeout: 15000 });
  const names = metro.counties;
  const countyRe = names.length ? new RegExp(`\\b(${names.join("|")})\\b`, "i") : /$^/;
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (p.status && p.status !== "Actual") continue;
    const inMetro = f.geometry ? overlaps(bboxOfGeometry(f.geometry), metro.maxBounds) && countyRe.test(p.areaDesc || "") : countyRe.test(p.areaDesc || "");
    if (!inMetro) continue;
    const st = alertStyle(p.event);
    out.push({
      id: p.id, event: p.event, headline: p.headline || p.event, areaDesc: p.areaDesc,
      sent: p.sent, expires: p.ends || p.expires, messageType: p.messageType,
      description: p.description || "", color: st.color, rank: st.rank,
    });
  }
  return out.sort((a, b) => Date.parse(b.sent) - Date.parse(a.sent));
}
