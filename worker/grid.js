// ERCOT grid condition, shared by /api/grid and the 10-minute health check.
// ERCOT sometimes refuses requests from cloud servers for a few minutes (HTTP 403), so the last
// good reading is kept in D1 and served (marked stale) for up to 30 minutes when that happens.

const ERCOT = "https://www.ercot.com/api/1/services/read/dashboards/daily-prc.json";
const UA = "Stormline/1.0 (public severe-weather map)";
const STALE_OK_MS = 30 * 60e3;

let ready = false;
async function schema(db) {
  if (ready) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)").run();
  ready = true;
}

function trim(j) {
  const c = j.current_condition || {};
  return {
    state: c.state || null,                // normal | weather | vcn | conservation | eea1 | eea2 | eea3 | eeatest
    title: c.title || null,                // e.g. "Normal Conditions"
    note: c.condition_note || null,        // e.g. "There is enough power for current demand."
    eea: typeof c.eea_level === "number" ? c.eea_level : null,
    reservesMW: c.prc_value ? Number(String(c.prc_value).replace(/,/g, "")) : null,
    at: c.datetime ? new Date(c.datetime * 1000).toISOString() : null,
    source: "ERCOT",
  };
}

// Returns { data, fresh, error } — data is null only if ERCOT failed and nothing recent is saved.
export async function getGrid(env) {
  let error = null;
  try {
    const r = await fetch(ERCOT, { headers: { Accept: "application/json", "User-Agent": UA }, cf: { cacheTtl: 60 } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = trim(await r.json());
    if (!data.state) throw new Error("Unexpected response");
    if (env.DB) { await schema(env.DB); await env.DB.prepare("INSERT OR REPLACE INTO kv (k, v, at) VALUES ('grid', ?, ?)").bind(JSON.stringify(data), Date.now()).run(); }
    return { data, fresh: true, error: null };
  } catch (e) {
    error = e.message || "Unreachable";
  }
  if (env.DB) {
    await schema(env.DB);
    const row = await env.DB.prepare("SELECT v, at FROM kv WHERE k = 'grid'").first();
    if (row && Date.now() - row.at < STALE_OK_MS) return { data: { ...JSON.parse(row.v), stale: true }, fresh: false, error, savedAt: row.at };
  }
  return { data: null, fresh: false, error };
}
