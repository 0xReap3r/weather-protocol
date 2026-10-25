// Stormline Worker: serves the static site, plus a tiny /api for data browsers can't fetch directly.
//   GET /api/grid → ERCOT grid condition (normal … EEA 3), trimmed, cached 60 s at the edge.
// ERCOT's dashboard JSON has no CORS headers, so the browser can't read it; this route can.
// Keep it read-only and keyless (CLAUDE.md ground rules).

import { handlePush, checkAlerts } from "./push.js";

const ERCOT = "https://www.ercot.com/api/1/services/read/dashboards/daily-prc.json";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra } });

async function grid(ctx, req) {
  const cache = caches.default;
  const key = new Request(new URL("/api/grid", req.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  let res;
  try {
    const r = await fetch(ERCOT, { headers: { Accept: "application/json", "User-Agent": "Stormline/1.0 (public severe-weather map)" }, cf: { cacheTtl: 60 } });
    if (!r.ok) throw new Error(`ERCOT ${r.status}`);
    const j = await r.json();
    const c = j.current_condition || {};
    res = json({
      state: c.state || null,                // normal | weather | vcn | conservation | eea1 | eea2 | eea3 | eeatest
      title: c.title || null,                // e.g. "Normal Conditions"
      note: c.condition_note || null,        // e.g. "There is enough power for current demand."
      eea: typeof c.eea_level === "number" ? c.eea_level : null,
      reservesMW: c.prc_value ? Number(String(c.prc_value).replace(/,/g, "")) : null,
      at: c.datetime ? new Date(c.datetime * 1000).toISOString() : null,
      source: "ERCOT",
    }, 200, { "Cache-Control": "public, max-age=60" });
  } catch (e) {
    return json({ error: "ERCOT grid status is unavailable right now." }, 502, { "Cache-Control": "no-store" });
  }
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (req.method !== "GET" && !url.pathname.startsWith("/api/push/")) return json({ error: "Method not allowed" }, 405);
      if (url.pathname === "/api/grid") return grid(ctx, req);
      if (url.pathname.startsWith("/api/push/")) return handlePush(req, env, url, json);
      return json({ error: "Not found" }, 404);
    }
    return env.ASSETS.fetch(req);
  },
  // Every minute: look for new warnings that cover someone's saved places and push them.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAlerts(env));
  },
};
