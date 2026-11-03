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

// What a Watch/Warning/Advisory/etc. actually means, generalized across every hazard (tornado,
// flood, winter storm, heat, you name it) rather than hardcoded per hazard — NWS uses the same
// handful of alert "kinds" for all of them, so one small lookup on the last word of the event name
// covers every alert this app will ever show.
const KIND_INFO = {
  Warning: "This is happening, about to happen, or very likely — take action now.",
  Watch: "Conditions are coming together for this to happen. It hasn't yet — stay alert and be ready to act.",
  Advisory: "Expected to cause inconvenience and could be hazardous if you're not careful — less serious than a warning.",
  Emergency: "The most serious level: a severe, life-threatening situation already happening — take action immediately.",
  Statement: "An update on an alert already in effect, not a new hazard by itself.",
  Outlook: "An early heads-up that conditions may turn favorable for this later — not yet a watch or a warning.",
};
export function explainKind(event) {
  const m = /\b(Warning|Watch|Advisory|Emergency|Statement|Outlook)\s*$/i.exec(event || "");
  if (!m) return null;
  const kind = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return KIND_INFO[kind] ? { kind, text: KIND_INFO[kind] } : null;
}

// Storm-based warnings carry a free-text "TIME...MOT...LOC <HHMM>Z <DDD>DEG <SS>KT <lat*100> <lon*100>"
// line in their description (not a structured field). <DDD> is the compass heading the storm is
// COMING FROM, same convention as wind direction, so the arrow drawn on the map points the
// opposite way (+180) to show where the storm is actually headed.
function parseMotion(desc) {
  const m = /TIME\.\.\.MOT\.\.\.LOC\s+\d{3,4}Z\s+(\d{1,3})DEG\s+(\d{1,3})KT\s+(\d{3,4})\s+(\d{3,5})/.exec(desc || "");
  if (!m) return null;
  const from = Number(m[1]), kt = Number(m[2]), lat = Number(m[3]) / 100, lon = -(Number(m[4]) / 100);
  if (![from, kt, lat, lon].every(Number.isFinite)) return null;
  return { deg: (from + 180) % 360, kt, at: [lon, lat] };
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

    // Storm motion arrow: a separate point feature in the same source, independent of the
    // warning polygon's shape, so the arrow sits where the storm itself was actually reported.
    if (f.geometry) {
      const mot = parseMotion(p.description);
      if (mot) out.push({
        type: "Feature", geometry: { type: "Point", coordinates: mot.at },
        properties: { id: p.id, motionDeg: mot.deg, motionKt: mot.kt, color: st.color, rank: st.rank },
      });
    }
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
