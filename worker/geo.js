// Statewide reference data, fetched server-side, trimmed and cached for everyone (Phase 9).
//   GET /api/gauges?state=TX        every NOAA river/lake gauge in the state with its latest reading (5 min)
//   GET /api/geo/counties?state=48  county outlines, simplified (7 days)
//   GET /api/geo/cities?state=48    towns and cities with 2,500+ people, from the 2020 Census (7 days)
// Each keeps its last good copy in D1 `kv`, so a source outage serves the previous data instead of nothing.

const UA = "Stormline/1.0 (public severe-weather map; https://weather-protocol.protocolxv-dev.workers.dev)";
const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
// State bounding boxes for gauge queries (add states here when expanding).
const BBOX = { TX: [-106.7, 25.8, -93.5, 36.6] };
const FIPS = { TX: "48" };

let ready = false;
async function schema(db) {
  if (ready) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)").run();
  ready = true;
}

async function cached(env, ctx, req, key, maxAge, build) {
  const cache = caches.default;
  const ck = new Request(new URL(`/__cache/${key}`, req.url).toString());
  const hit = await cache.match(ck);
  if (hit) return hit;
  let body = null;
  try {
    body = JSON.stringify(await build());
    if (env.DB) { await schema(env.DB); await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v, at) VALUES (?, ?, ?)").bind(key, body, Date.now()).run(); }
  } catch (e) {
    if (env.DB) {
      await schema(env.DB);
      const row = await env.DB.prepare("SELECT v FROM kv WHERE k = ?").bind(key).first();
      if (row) body = row.v;
    }
    if (!body) return null;
    maxAge = 60; // serve the saved copy briefly, then try the source again
  }
  const res = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${maxAge}`, "Access-Control-Allow-Origin": "*" } });
  ctx.waitUntil(cache.put(ck, res.clone()));
  return res;
}

const num = (v) => (typeof v === "number" && v > -900 ? v : null);

async function gauges(state) {
  const [w, s, e, n] = BBOX[state];
  const r = await fetch(`https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=${w}&bbox.ymin=${s}&bbox.xmax=${e}&bbox.ymax=${n}&srid=EPSG_4326`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`NWPS ${r.status}`);
  const j = await r.json();
  // Compact rows: [lid, name, lng, lat, stage, unit, category, observedAt]
  return {
    at: new Date().toISOString(),
    gauges: (j.gauges || []).map((g) => {
      const o = g.status?.observed || {};
      const t = o.validTime && !o.validTime.startsWith("0001") ? o.validTime : null;
      return [g.lid, g.name, Math.round(g.longitude * 1e4) / 1e4, Math.round(g.latitude * 1e4) / 1e4, num(o.primary), o.primaryUnit || "ft", o.floodCategory || "unknown", t];
    }),
  };
}

async function counties(fips) {
  const q = `${TIGER}/State_County/MapServer/1/query?where=${encodeURIComponent(`STATE='${fips}'`)}&outFields=BASENAME,GEOID,CENTLAT,CENTLON&outSR=4326&geometryPrecision=3&maxAllowableOffset=0.005&f=geojson`;
  const r = await fetch(q, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`TIGERweb ${r.status}`);
  const j = await r.json();
  if (!j.features?.length) throw new Error("No counties");
  return { type: "FeatureCollection", features: j.features.map((f) => ({ type: "Feature", geometry: f.geometry,
    properties: { name: f.properties.BASENAME, geoid: f.properties.GEOID, lat: Number(f.properties.CENTLAT), lng: Number(f.properties.CENTLON) } })) };
}

async function cities(fips) {
  const q = `${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/25/query?where=${encodeURIComponent(`STATE='${fips}' AND POP100>=2500`)}&outFields=BASENAME,POP100,CENTLAT,CENTLON&returnGeometry=false&orderByFields=${encodeURIComponent("POP100 DESC")}&resultRecordCount=2000&f=json`;
  const r = await fetch(q, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`TIGERweb ${r.status}`);
  const j = await r.json();
  if (!j.features?.length) throw new Error("No places");
  // Rows: [name, lat, lng, population], biggest first
  return j.features.map((f) => [f.attributes.BASENAME, Number(Number(f.attributes.CENTLAT).toFixed(4)), Number(Number(f.attributes.CENTLON).toFixed(4)), f.attributes.POP100]);
}

export async function handleGeo(req, env, ctx, url, json) {
  if (url.pathname === "/api/gauges") {
    const st = (url.searchParams.get("state") || "TX").toUpperCase();
    if (!BBOX[st]) return json({ error: "Unknown state" }, 400);
    return (await cached(env, ctx, req, `gauges-${st}`, 300, () => gauges(st))) || json({ error: "River gauges are unavailable right now." }, 502);
  }
  const fips = url.searchParams.get("state") || "48";
  if (!Object.values(FIPS).includes(fips)) return json({ error: "Unknown state" }, 400);
  if (url.pathname === "/api/geo/counties") return (await cached(env, ctx, req, `counties-${fips}`, 7 * 86400, () => counties(fips))) || json({ error: "County outlines are unavailable right now." }, 502);
  if (url.pathname === "/api/geo/cities") return (await cached(env, ctx, req, `cities-${fips}`, 7 * 86400, () => cities(fips))) || json({ error: "Town list is unavailable right now." }, 502);
  return json({ error: "Not found" }, 404);
}
