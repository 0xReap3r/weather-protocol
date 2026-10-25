// Stormline Worker: serves the static site, plus a tiny /api for data browsers can't fetch directly.
//   GET /api/grid → ERCOT grid condition (normal … EEA 3), trimmed, cached 60 s at the edge.
// ERCOT's dashboard JSON has no CORS headers, so the browser can't read it; this route can.
// Keep it read-only and keyless (CLAUDE.md ground rules).

import { handlePush, checkAlerts } from "./push.js";
import { runHealth, statusJSON } from "./health.js";
import { getGrid } from "./grid.js";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra } });

async function grid(ctx, req, env) {
  const cache = caches.default;
  const key = new Request(new URL("/api/grid", req.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  const { data, fresh } = await getGrid(env);
  if (!data) return json({ error: "ERCOT grid status is unavailable right now." }, 502, { "Cache-Control": "no-store" });
  const res = json(data, 200, { "Cache-Control": `public, max-age=${fresh ? 60 : 30}` });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (req.method !== "GET" && !url.pathname.startsWith("/api/push/")) return json({ error: "Method not allowed" }, 405);
      if (url.pathname === "/api/grid") return grid(ctx, req, env);
      if (url.pathname.startsWith("/api/push/")) return handlePush(req, env, url, json);
      if (url.pathname === "/api/status") return json(await statusJSON(env), 200, { "Cache-Control": "public, max-age=60" });
      return json({ error: "Not found" }, 404);
    }
    return env.ASSETS.fetch(req);
  },
  // Every minute: look for new warnings that cover someone's saved places and push them.
  // Every 10 minutes (second cron): check every data source and run the report cleanup.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === "*/10 * * * *" ? runHealth(env) : checkAlerts(env));
  },
};
