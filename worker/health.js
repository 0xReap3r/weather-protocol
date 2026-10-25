// Uptime checks for every data source the map depends on (Phase 8). Run from the minute cron
// every 10 minutes; results kept in D1 and served at /api/status for the in-app "Data status"
// sheet. Also runs the Supabase report cleanup each time, which keeps the free project from pausing.

const UA = "Stormline/1.0 (public severe-weather map; https://weather-protocol.protocolxv-dev.workers.dev)";
const today = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

// name, what it powers, url, and an optional check on the body.
const SOURCES = [
  ["NWS warnings", "Warnings, banner, push alerts", () => "https://api.weather.gov/alerts/active?area=TX", (j) => Array.isArray(j.features)],
  ["NOAA river gauges", "Rivers layer", () => "https://api.water.noaa.gov/nwps/v1/gauges/DALT2", (j) => !!j.lid],
  ["Radar (IEM)", "Rain radar drops", () => "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/8/59/104.png", null],
  ["Open-Meteo", "Rain now, city rain chances", () => "https://api.open-meteo.com/v1/forecast?latitude=32.78&longitude=-96.8&minutely_15=precipitation&forecast_minutely_15=4", (j) => !!j.minutely_15],
  ["NOAA rain totals", "Rain totals, Rain so far", () => "https://mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer?f=json", (j) => !!j.name],
  ["SPC storm outlook", "Storms layer, What's coming", () => "https://www.spc.noaa.gov/products/outlook/day1otlk_cat.lyr.geojson", (j) => Array.isArray(j.features)],
  ["NASA flood map", "Flood from space", () => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Flood_2-Day/default/${today()}/GoogleMapsCompatible_Level9/8/104/59.png`, null],
  ["ERCOT grid", "Texas grid pill", () => "https://www.ercot.com/api/1/services/read/dashboards/daily-prc.json", (j) => !!j.current_condition],
  ["DART rail", "Rail layer", () => "https://services2.arcgis.com/rwnOSbfKSwyTBcwN/ArcGIS/rest/services/dart_rail/FeatureServer?f=json", (j) => Array.isArray(j.layers)],
  ["Routing (OSRM)", "Check a route", () => "https://router.project-osrm.org/route/v1/driving/-96.80,32.78;-96.70,32.80?overview=false", (j) => j.code === "Ok"],
];

let ready = false;
async function schema(db) {
  if (ready) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS health (
    source TEXT PRIMARY KEY, powers TEXT, ok INTEGER NOT NULL, detail TEXT, ms INTEGER, at INTEGER NOT NULL, last_ok INTEGER)`).run();
  ready = true;
}

async function probe([name, powers, url, check]) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    // ERCOT rejects some user agents; it accepts the same plain one /api/grid uses.
    const ua = name.startsWith("ERCOT") ? "Stormline/1.0 (public severe-weather map)" : UA;
    const r = await fetch(url(), { headers: { "User-Agent": ua, Accept: check ? "application/json" : "*/*" }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return { name, powers, ok: false, detail: `HTTP ${r.status}`, ms: Date.now() - t0 };
    if (check) {
      const j = await r.json().catch(() => null);
      if (!j || !check(j)) return { name, powers, ok: false, detail: "Unexpected response", ms: Date.now() - t0 };
    } else {
      await r.arrayBuffer();
    }
    return { name, powers, ok: true, detail: null, ms: Date.now() - t0 };
  } catch (e) {
    return { name, powers, ok: false, detail: e.name === "AbortError" ? "Timed out" : "Unreachable", ms: Date.now() - t0 };
  }
}

export async function runHealth(env) {
  if (!env.DB) return;
  await schema(env.DB);
  const now = Date.now();
  const results = await Promise.all(SOURCES.map(probe));
  // Supabase: run the report cleanup (also counts as activity, so the free project doesn't pause).
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/reports_cleanup`, {
        method: "POST", body: "{}",
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
      });
      results.push({ name: "Neighbor reports (Supabase)", powers: "Reports, Roads to avoid", ok: r.ok, detail: r.ok ? null : `HTTP ${r.status}`, ms: Date.now() - t0 });
    } catch (_) {
      results.push({ name: "Neighbor reports (Supabase)", powers: "Reports, Roads to avoid", ok: false, detail: "Unreachable", ms: Date.now() - t0 });
    }
  }
  await env.DB.batch(results.map((x) => env.DB.prepare(`INSERT INTO health (source, powers, ok, detail, ms, at, last_ok) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source) DO UPDATE SET powers = excluded.powers, ok = excluded.ok, detail = excluded.detail, ms = excluded.ms, at = excluded.at,
    last_ok = CASE WHEN excluded.ok = 1 THEN excluded.at ELSE health.last_ok END`).bind(x.name, x.powers, x.ok ? 1 : 0, x.detail, x.ms, now, x.ok ? now : null)));
}

// Other jobs (the push checker) report their own health here.
export async function recordHealth(env, name, powers, ok, detail) {
  if (!env.DB) return;
  await schema(env.DB);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO health (source, powers, ok, detail, ms, at, last_ok) VALUES (?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(source) DO UPDATE SET powers = excluded.powers, ok = excluded.ok, detail = excluded.detail, at = excluded.at,
    last_ok = CASE WHEN excluded.ok = 1 THEN excluded.at ELSE health.last_ok END`).bind(name, powers, ok ? 1 : 0, detail, now, ok ? now : null).run();
}

export async function statusJSON(env) {
  if (!env.DB) return { sources: [] };
  await schema(env.DB);
  // Sources not checked in the last hour (removed from the list) are dropped.
  await env.DB.prepare("DELETE FROM health WHERE at < ?").bind(Date.now() - 3600e3).run();
  const { results } = await env.DB.prepare("SELECT source, powers, ok, detail, ms, at, last_ok FROM health ORDER BY ok ASC, source ASC").all();
  return { sources: results.map((r) => ({ ...r, ok: !!r.ok, at: new Date(r.at).toISOString(), last_ok: r.last_ok ? new Date(r.last_ok).toISOString() : null })) };
}
