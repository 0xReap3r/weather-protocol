// Texas-only data served by our Worker (sources without browser access): lakes, TexMesonet, burn bans.
import { APP } from "../config.js";
import { fetchJSON } from "./fetch.js";

const API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api/tx" : `${APP.apiBase}/api/tx`;

// [{ name, short, at:[lng,lat], pct, elev, pool, flood, date }]
export async function loadLakes() {
  const j = await fetchJSON(`${API}/lakes`, { timeout: 15000 });
  return (j.lakes || []).map(([name, short, lng, lat, pct, elev, pool, flood, date]) => ({ name, short, at: [lng, lat], pct, elev, pool, flood: !!flood, date }));
}
// [{ id, name, at, r24, r48, r72, tempF, wind, gust, soil, time }] (inches, mph, % soil water)
export async function loadMesonet() {
  const j = await fetchJSON(`${API}/mesonet`, { timeout: 15000 });
  return (j.stations || []).map(([id, name, lng, lat, r24, r48, r72, tempF, wind, gust, soil, time]) => ({ id, name, at: [lng, lat], r24, r48, r72, tempF, wind, gust, soil, time }));
}
// Map of county FIPS (3 digits) -> { name, since } for counties under a burn ban
export async function loadBurnBans() {
  const j = await fetchJSON(`${API}/burnbans`, { timeout: 15000 });
  const out = new Map();
  for (const [name, fips, banned, since] of j.counties || []) if (banned) out.set(fips, { name, since });
  return { at: j.at, total: (j.counties || []).length, banned: out };
}
