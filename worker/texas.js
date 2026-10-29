// Texas-only sources that browsers can't read directly (no CORS), fetched here, trimmed and cached
// for everyone, with the last good copy kept in D1 (see `cached` in geo.js). Phase 14b.
//   GET /api/tx/lakes      Texas Water Development Board: major reservoirs, daily level and % full (1 hr)
//   GET /api/tx/mesonet    TexMesonet (TWDB) weather stations: latest rain 24/48/72 hr, wind, soil water (5 min)
//   GET /api/tx/burnbans   Texas A&M Forest Service county burn bans (1 hr), if its map service answers
import { cached } from "./geo.js";

const UA = "Stormline/1.0 (public severe-weather map; https://weather-protocol.protocolxv-dev.workers.dev)";
const n = (v, d = 2) => {
  const x = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(x) && x > -900 ? Number(x.toFixed(d)) : null;
};

async function lakes() {
  const r = await fetch("https://waterdatafortexas.org/reservoirs/statewide/recent-conditions.geojson", { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`TWDB ${r.status}`);
  const j = await r.json();
  if (!j.features?.length) throw new Error("No reservoirs");
  // Rows: [name, short, lng, lat, percentFull, elevationFt, conservationPoolFt, floodControl, date]
  return {
    at: new Date().toISOString(),
    lakes: j.features.filter((f) => f.geometry?.coordinates).map((f) => {
      const p = f.properties;
      return [p.full_name, p.short_name, n(f.geometry.coordinates[0], 4), n(f.geometry.coordinates[1], 4), n(p.percent_full, 1), n(p.elevation, 2),
        n(p.conservation_pool_elevation, 2), p.flood_control_lake === "Y" ? 1 : 0, p.timestamp || null];
    }),
  };
}

async function mesonet() {
  const r = await fetch("https://www.texmesonet.org/api/CurrentData", { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`TexMesonet ${r.status}`);
  const j = await r.json();
  if (!j.data?.length) throw new Error("No stations");
  const mmToIn = (v) => { const x = n(v, 3); return x == null || x < 0 ? null : Number((x / 25.4).toFixed(2)); };
  const msToMph = (v) => { const x = n(v, 2); return x == null || x < 0 ? null : Math.round(x * 2.23694); };
  const cToF = (v) => { const x = n(v, 2); return x == null ? null : Math.round(x * 9 / 5 + 32); };
  const soil = (v) => { const x = n(v, 3); return x == null || x < 0 || x > 1 ? null : Math.round(x * 100); };
  // Rows: [id, name, lng, lat, rain24in, rain48in, rain72in, tempF, windMph, gustMph, soilPct, recordedTime]
  return {
    at: new Date().toISOString(),
    stations: j.data.filter((s) => Number.isFinite(s.longitude) && Number.isFinite(s.latitude)).map((s) => [
      s.displayId || String(s.stationId), s.name, n(s.longitude, 4), n(s.latitude, 4),
      mmToIn(s.precip24Hr), mmToIn(s.precip48Hr), mmToIn(s.precip72Hr), cToF(s.airTemp2m ?? s.airTemp),
      msToMph(s.windSpeed2m ?? s.windSpeed), msToMph(s.windGust2m ?? s.windGust), soil(s.soilMoisture), s.recordedTime || null,
    ]),
  };
}

async function burnbans() {
  const q = "https://gis.tfs.tamu.edu/arcgis/rest/services/EOC/BurnBan/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json";
  const r = await fetch(q, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`TFS ${r.status}`);
  const j = await r.json();
  if (j.error || !j.features) throw new Error("TFS burn ban service error");
  // Rows: [county, countyFips (3 digits), banned 0/1, startedMs]
  return {
    at: new Date().toISOString(),
    counties: j.features.map(({ attributes: a }) => [a.County, String(a.FIPS || "").trim().padStart(3, "0"), /^y/i.test(a.BurnBan || "") ? 1 : 0, a.StartDate || null]),
  };
}

export async function handleTexas(req, env, ctx, url, json) {
  const p = url.pathname;
  if (p === "/api/tx/lakes") return (await cached(env, ctx, req, "tx-lakes", 3600, lakes)) || json({ error: "Lake levels are unavailable right now." }, 502);
  if (p === "/api/tx/mesonet") return (await cached(env, ctx, req, "tx-mesonet", 300, mesonet)) || json({ error: "TexMesonet is unavailable right now." }, 502);
  if (p === "/api/tx/burnbans") return (await cached(env, ctx, req, "tx-burnbans-v2", 3600, burnbans)) || json({ error: "Burn bans are unavailable right now." }, 502);
  return json({ error: "Not found" }, 404);
}
