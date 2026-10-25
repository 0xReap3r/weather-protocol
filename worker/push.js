// Push alerts for saved places (Phase 7). Free-tier friendly:
//   - Subscriptions live in Cloudflare D1 (binding DB), created on first use.
//   - Every minute (cron) we check NWS for NEW storm-based warnings and match them to saved places.
//   - Pushes carry no payload (no encryption needed): the service worker wakes up and fetches its
//     waiting messages from /api/push/inbox. VAPID private key is a Worker secret, never in the repo.
// Saved places are stored rounded to ~100 m, with their county name for zone-based alerts.

const NWS = "https://api.weather.gov/alerts/active";
const UA = "Stormline/1.0 (public severe-weather map; https://weather-protocol.protocolxv-dev.workers.dev)";
const MAX_PUSHES_PER_RUN = 35;   // free plan allows 50 subrequests per invocation
const MAX_PLACES = 10;

// Alert kinds people can choose, and the NWS events in each.
export const KINDS = {
  tornado: ["Tornado Warning", "Tornado Emergency", "Extreme Wind Warning"],
  flood: ["Flash Flood Warning", "Flash Flood Emergency", "Flood Warning"],
  severe: ["Severe Thunderstorm Warning"],
  winter: ["Winter Storm Warning", "Ice Storm Warning", "Blizzard Warning", "Extreme Cold Warning", "Hard Freeze Warning"],
};
const ALL_EVENTS = [...new Set(Object.values(KINDS).flat())];
const kindOf = (event) => Object.keys(KINDS).find((k) => KINDS[k].includes(event));

/* ---------- Schema (created on first use) ---------- */
let schemaReady = false;
async function schema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS subs (
      id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, places TEXT NOT NULL, kinds TEXT NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0, tests TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS seen (alert_id TEXT PRIMARY KEY, at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sub_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      url TEXT NOT NULL, tag TEXT, created INTEGER NOT NULL, pushed INTEGER NOT NULL DEFAULT 0, read INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS inbox_sub ON inbox (sub_id, read)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS inbox_push ON inbox (pushed)`),
  ]);
  schemaReady = true;
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function idFor(endpoint) {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint))).slice(0, 32);
}

/* ---------- VAPID (RFC 8292) ---------- */
const jwtCache = new Map(); // audience -> { jwt, exp }
async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  const now = Math.floor(Date.now() / 1000);
  if (hit && hit.exp - now > 3600) return hit.header;
  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const exp = now + 12 * 3600;
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp, sub: env.VAPID_SUBJECT || "https://weather-protocol.protocolxv-dev.workers.dev" })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  const header = `vapid t=${unsigned}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
  jwtCache.set(aud, { header, exp });
  return header;
}

// Empty push: wakes the service worker, which fetches /api/push/inbox. Returns false if the
// subscription is gone (404/410) so we can delete it.
async function sendPush(env, endpoint) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: await vapidHeader(env, endpoint), TTL: "1800", Urgency: "high", "Content-Length": "0" },
  });
  if (r.status === 404 || r.status === 410) return "gone";
  return r.ok ? "ok" : `err ${r.status}`;
}

/* ---------- Geometry ---------- */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function contains(g, pt) {
  if (!g) return false;
  if (g.type === "Polygon") return inRing(pt, g.coordinates[0]) && !g.coordinates.slice(1).some((h) => inRing(pt, h));
  if (g.type === "MultiPolygon") return g.coordinates.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));
  return false;
}

/* ---------- API ---------- */
const clean = (places) =>
  (Array.isArray(places) ? places : []).slice(0, MAX_PLACES).map((p) => ({
    name: String(p.name || "Place").slice(0, 40),
    lat: Math.round(Number(p.at?.[1]) * 1000) / 1000,
    lng: Math.round(Number(p.at?.[0]) * 1000) / 1000,
    county: p.county ? String(p.county).slice(0, 40) : null,
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat > 24 && p.lat < 50 && p.lng > -125 && p.lng < -66);

export async function handlePush(req, env, url, json) {
  if (!env.DB || !env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return json({ error: "Push alerts aren't set up on the server yet." }, 503);
  await schema(env.DB);
  const path = url.pathname.replace("/api/push", "");

  if (path === "/key" && req.method === "GET") return json({ key: env.VAPID_PUBLIC_KEY });

  if (req.method === "GET" && path === "/inbox") {
    const endpoint = url.searchParams.get("endpoint") || "";
    const id = await idFor(endpoint);
    const { results } = await env.DB.prepare("SELECT id, title, body, url, tag, created FROM inbox WHERE sub_id = ? AND read = 0 ORDER BY id DESC LIMIT 5").bind(id).all();
    if (results.length) await env.DB.prepare(`UPDATE inbox SET read = 1 WHERE sub_id = ? AND id <= ?`).bind(id, results[0].id).run();
    return json({ messages: results });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await req.json(); } catch (_) { return json({ error: "Bad request" }, 400); }
  const endpoint = body?.subscription?.endpoint || body?.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return json({ error: "Bad subscription" }, 400);
  const id = await idFor(endpoint);
  const now = Date.now();

  if (path === "/subscribe") {
    const places = clean(body.places);
    const kinds = (Array.isArray(body.kinds) ? body.kinds : ["tornado", "flood"]).filter((k) => k in KINDS);
    await env.DB.prepare(`INSERT INTO subs (id, endpoint, places, kinds, created, updated) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET places = excluded.places, kinds = excluded.kinds, updated = excluded.updated, fails = 0`)
      .bind(id, endpoint, JSON.stringify(places), JSON.stringify(kinds), now, now).run();
    return json({ ok: true, places: places.length, kinds });
  }
  if (path === "/unsubscribe") {
    await env.DB.batch([env.DB.prepare("DELETE FROM subs WHERE id = ?").bind(id), env.DB.prepare("DELETE FROM inbox WHERE sub_id = ?").bind(id)]);
    return json({ ok: true });
  }
  if (path === "/test") {
    const sub = await env.DB.prepare("SELECT tests FROM subs WHERE id = ?").bind(id).first();
    if (!sub) return json({ error: "Turn on alerts first." }, 404);
    const recent = JSON.parse(sub.tests || "[]").filter((t) => now - t < 3600e3);
    if (recent.length >= 3) return json({ error: "That's 3 tests this hour. Try again later." }, 429);
    await env.DB.batch([
      env.DB.prepare("UPDATE subs SET tests = ? WHERE id = ?").bind(JSON.stringify([...recent, now]), id),
      env.DB.prepare("INSERT INTO inbox (sub_id, title, body, url, tag, created, pushed) VALUES (?, ?, ?, ?, ?, ?, 1)")
        .bind(id, "Stormline test alert", "Alerts are working. You'll hear from us when a warning covers one of your places.", "/", "test", now),
    ]);
    const r = await sendPush(env, endpoint);
    return r === "ok" ? json({ ok: true }) : json({ error: `The push service said no (${r}).` }, 502);
  }
  return json({ error: "Not found" }, 404);
}

/* ---------- Cron: new warnings → inbox → pushes ---------- */
export async function checkAlerts(env) {
  if (!env.DB || !env.VAPID_PRIVATE_KEY) return;
  await schema(env.DB);
  const now = Date.now();
  const q = `${NWS}?area=TX&status=actual&message_type=alert&event=${encodeURIComponent(ALL_EVENTS.join(","))}`;
  const r = await fetch(q, { headers: { Accept: "application/geo+json", "User-Agent": UA } });
  if (!r.ok) return;
  const data = await r.json();
  const fresh = (data.features || []).filter((f) => f.properties?.sent && now - Date.parse(f.properties.sent) < 30 * 60e3);
  if (fresh.length) {
    const ids = fresh.map((f) => f.properties.id);
    const seen = new Set((await env.DB.prepare(`SELECT alert_id FROM seen WHERE alert_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results.map((x) => x.alert_id));
    const todo = fresh.filter((f) => !seen.has(f.properties.id));
    if (todo.length) {
      const subs = (await env.DB.prepare("SELECT id, places, kinds FROM subs").all()).results.map((s) => ({ ...s, places: JSON.parse(s.places), kinds: JSON.parse(s.kinds) }));
      const stmts = [];
      for (const f of todo) {
        const p = f.properties;
        stmts.push(env.DB.prepare("INSERT OR IGNORE INTO seen (alert_id, at) VALUES (?, ?)").bind(p.id, now));
        const kind = kindOf(p.event);
        if (!kind) continue;
        const counties = (p.areaDesc || "").split(/;\s*/).map((c) => c.replace(/,\s*[A-Z]{2}$/, "").trim().toLowerCase());
        const until = p.ends || p.expires ? new Date(p.ends || p.expires).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) : null;
        for (const s of subs) {
          if (!s.kinds.includes(kind)) continue;
          const hits = s.places.filter((pl) => (f.geometry ? contains(f.geometry, [pl.lng, pl.lat]) : pl.county && counties.includes(pl.county.toLowerCase())));
          if (!hits.length) continue;
          const names = hits.map((h) => h.name).join(", ");
          const first = hits[0];
          stmts.push(env.DB.prepare("INSERT INTO inbox (sub_id, title, body, url, tag, created) VALUES (?, ?, ?, ?, ?, ?)").bind(
            s.id, `${p.event}: ${names}`,
            `${f.geometry ? "Covers" : "Issued for the county of"} ${names}${until ? ` until ${until}` : ""}. ${p.event.startsWith("Tornado") ? "Take shelter now." : p.event.startsWith("Flash Flood") ? "Move to higher ground. Never drive into water." : "Check the map for details."}`,
            `/#at=${first.lat},${first.lng}`, p.id, now));
        }
      }
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    }
  }
  // Send pushes for anything waiting (also retries from earlier runs).
  const pending = (await env.DB.prepare(`SELECT DISTINCT inbox.sub_id AS id, subs.endpoint AS endpoint FROM inbox JOIN subs ON subs.id = inbox.sub_id
    WHERE inbox.pushed = 0 AND inbox.created > ? LIMIT ?`).bind(now - 60 * 60e3, MAX_PUSHES_PER_RUN).all()).results;
  for (const s of pending) {
    const res = await sendPush(env, s.endpoint).catch(() => "err");
    if (res === "gone") await env.DB.batch([env.DB.prepare("DELETE FROM subs WHERE id = ?").bind(s.id), env.DB.prepare("DELETE FROM inbox WHERE sub_id = ?").bind(s.id)]);
    else if (res === "ok") await env.DB.prepare("UPDATE inbox SET pushed = 1 WHERE sub_id = ? AND pushed = 0").bind(s.id).run();
  }
  // Housekeeping: forget old alerts and messages after 2 days.
  if (new Date().getUTCMinutes() === 0) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM seen WHERE at < ?").bind(now - 2 * 864e5),
      env.DB.prepare("DELETE FROM inbox WHERE created < ?").bind(now - 2 * 864e5),
    ]);
  }
}
