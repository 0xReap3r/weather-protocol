// Neighbor reports store. Two modes:
//   live: Supabase (anonymous sign-in + REST), set APP.reports.supabaseUrl / supabaseKey in config.js
//   demo: reports saved in this browser only, until the database is connected
// Either way a report holds only an H3 hexagon (never the exact tap point), its kind, and for
// floods a depth bucket. See supabase/schema.sql for the server-side rules.

import { APP } from "../config.js";

export const KINDS = {
  flood: { res: 10, label: "Flooded road", hours: 6 },
  ice: { res: 10, label: "Iced road", hours: 12 },
  power_out: { res: 8, label: "Power out", hours: 6 },
  power_back: { res: 8, label: "Power back", hours: 6 },
  hail: { res: 8, label: "Hail", hours: 3, detail: true },
  damage: { res: 10, label: "Storm damage", hours: 24, detail: true },
};
// Kinds that carry a 1–5 detail in the `depth` column (flood depth, hail size, damage type).
export const hasDetail = (kind) => kind === "flood" || !!KINDS[kind]?.detail;

// Hail size, by the everyday objects NWS spotters use. Quarter-size (1 in) is "severe".
export const HAIL = [
  null,
  { n: 1, label: "Pea", range: "¼ in", note: "Small hail." },
  { n: 2, label: "Quarter", range: "1 in", note: "Severe size. Dents cars and breaks some roof shingles." },
  { n: 3, label: "Golf ball", range: "1¾ in", note: "Damages roofs, cars and windows. Stay indoors." },
  { n: 4, label: "Tennis ball", range: "2½ in", note: "Dangerous to people outside. Stay away from windows." },
  { n: 5, label: "Softball", range: "4 in +", note: "Life-threatening. Stay indoors, away from windows." },
];

// Storm damage types. Downed power lines are the most dangerous, so they rank highest.
export const DAMAGE = [
  null,
  { n: 1, label: "Trees or limbs down", short: "TREE DOWN", note: "May block the road." },
  { n: 2, label: "Roof or building damage", short: "BUILDING DAMAGE", note: "" },
  { n: 3, label: "Power lines down", short: "POWER LINES DOWN", note: "Stay at least 35 ft away and call 911. Assume they're live." },
];

// Depth buckets, with the NWS "Turn Around Don't Drown" guidance for each.
export const DEPTHS = [
  null,
  { n: 1, key: "ankle", label: "Ankle-deep", range: "under 6 in", inches: 4, note: "Can stall a car." },
  { n: 2, key: "curb", label: "Over the curb", range: "6–12 in", inches: 9, note: "Enough to make a car lose control." },
  { n: 3, key: "knee", label: "Knee-deep", range: "1–2 ft", inches: 18, note: "A foot of moving water can float most cars." },
  { n: 4, key: "waist", label: "Waist-deep", range: "2–3 ft", inches: 30, note: "Two feet can sweep away SUVs and trucks." },
  { n: 5, key: "over", label: "Over a car", range: "3 ft or more", inches: 42, note: "Life-threatening. Stay out of it." },
];

/* ---------- H3 (loaded once from unpkg) ---------- */
let h3Promise = null;
export function loadH3() {
  if (window.h3) return Promise.resolve(window.h3);
  if (!h3Promise) {
    h3Promise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/h3-js@4.1.0/dist/h3-js.umd.js";
      s.onload = () => resolve(window.h3);
      s.onerror = () => { h3Promise = null; reject(new Error("Couldn't load the hexagon library")); };
      document.head.appendChild(s);
    });
  }
  return h3Promise;
}

function cellFor(h3, kind, [lng, lat]) {
  const cell = h3.latLngToCell(lat, lng, KINDS[kind].res);
  const [clat, clng] = h3.cellToLatLng(cell);
  return { cell, cell_lat: Number(clat.toFixed(5)), cell_lng: Number(clng.toFixed(5)) };
}

/* ---------- Demo store (this browser only) ---------- */
const DEMO_KEY = "stormline.demoReports.v1";
const now = () => new Date().toISOString();
function demoLoad() {
  try { return JSON.parse(localStorage.getItem(DEMO_KEY) || "[]"); } catch (_) { return []; }
}
function demoSave(rows) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(rows)); } catch (_) {}
}
function demoActive() {
  const t = Date.now();
  return demoLoad().filter((r) => Date.parse(r.expires_at) > t);
}

const demo = {
  mode: "demo",
  async submit({ kind, depth, at }) {
    const h3 = await loadH3();
    const c = cellFor(h3, kind, at);
    const rows = demoActive().filter((r) => !(r.user === "me" && r.kind === kind && r.cell === c.cell));
    if (kind === "power_back") {
      const outCell = cellFor(h3, "power_out", at).cell;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].user === "me" && rows[i].kind === "power_out" && rows[i].cell === outCell) rows.splice(i, 1);
    }
    rows.push({ user: "me", kind, depth: hasDetail(kind) ? depth : null, ...c, created_at: now(),
      expires_at: new Date(Date.now() + KINDS[kind].hours * 3600e3).toISOString() });
    demoSave(rows);
    return c;
  },
  async removeMine({ kind, cell }) {
    demoSave(demoActive().filter((r) => !(r.user === "me" && r.kind === kind && r.cell === cell)));
  },
  async flag() { /* no-op in demo */ },
  async cells([w, s, e, n]) {
    const groups = new Map();
    for (const r of demoActive()) {
      if (r.cell_lng < w || r.cell_lng > e || r.cell_lat < s || r.cell_lat > n) continue;
      const k = `${r.kind}|${r.cell}`;
      const g = groups.get(k) || { kind: r.kind, cell: r.cell, cell_lat: r.cell_lat, cell_lng: r.cell_lng, users: new Set(), depth: null, first_at: r.created_at, last_at: r.created_at };
      g.users.add(r.user);
      if (r.depth) g.depth = Math.max(g.depth || 0, r.depth);
      if (r.created_at < g.first_at) g.first_at = r.created_at;
      if (r.created_at > g.last_at) g.last_at = r.created_at;
      groups.set(k, g);
    }
    return [...groups.values()].map(({ users, ...g }) => ({ ...g, reporters: users.size, mine: users.has("me") }));
  },
  // Testing aid: add fake neighbors' reports around a spot.
  async simulate(at, kind = "flood", count = 2, depth = 3) {
    const h3 = await loadH3();
    const c = cellFor(h3, kind, at);
    const rows = demoActive();
    for (let i = 0; i < count; i++) {
      rows.push({ user: `neighbor-${i}-${Math.random().toString(36).slice(2, 6)}`, kind, depth: hasDetail(kind) ? depth : null, ...c,
        created_at: new Date(Date.now() - (i + 1) * 7 * 60e3).toISOString(),
        expires_at: new Date(Date.now() + KINDS[kind].hours * 3600e3).toISOString() });
    }
    demoSave(rows);
  },
  clear() { demoSave([]); },
};

/* ---------- Live store (Supabase REST + anonymous auth) ---------- */
function liveStore(url, key) {
  const SESSION_KEY = "stormline.session.v1";
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (_) {}
  const saveSession = (s) => { session = s; try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) {} };

  async function auth() {
    if (session && session.expires_at * 1000 > Date.now() + 60e3) return session.access_token;
    const path = session?.refresh_token ? "/auth/v1/token?grant_type=refresh_token" : "/auth/v1/signup";
    const body = session?.refresh_token ? { refresh_token: session.refresh_token } : {};
    let res = await fetch(url + path, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok && session?.refresh_token) {
      // Refresh token expired: start a fresh anonymous session.
      res = await fetch(url + "/auth/v1/signup", { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}" });
    }
    if (!res.ok) throw new Error("Couldn't start a reporting session. Anonymous sign-ins may be turned off.");
    const j = await res.json();
    saveSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) });
    return session.access_token;
  }

  async function rest(path, { method = "GET", body, prefer, signedIn = false } = {}) {
    const token = signedIn ? await auth() : key;
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = `Report server error (${res.status})`;
      try {
        const j = await res.json();
        if (j.message) msg = j.message;
        if (/reports_kind_check/.test(j.message || "")) msg = "Hail and damage reports aren't switched on yet. The database needs a one-time update.";
      } catch (_) {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  let myCells = new Set(); // "kind|cell" this device reported, for the "you reported this" note

  return {
    mode: "live",
    async submit({ kind, depth, at }) {
      const h3 = await loadH3();
      const c = cellFor(h3, kind, at);
      if (kind === "power_back") {
        const out = cellFor(h3, "power_out", at).cell;
        await rest(`reports?kind=eq.power_out&cell=eq.${out}`, { method: "DELETE", signedIn: true });
        myCells.delete(`power_out|${out}`);
      }
      await rest("reports?on_conflict=user_id,kind,cell", {
        method: "POST",
        signedIn: true,
        prefer: "resolution=merge-duplicates,return=minimal",
        body: { kind, depth: hasDetail(kind) ? depth : null, ...c, expires_at: new Date().toISOString() },
      });
      myCells.add(`${kind}|${c.cell}`);
      return c;
    },
    async removeMine({ kind, cell }) {
      await rest(`reports?kind=eq.${kind}&cell=eq.${cell}`, { method: "DELETE", signedIn: true });
      myCells.delete(`${kind}|${cell}`);
    },
    async flag({ kind, cell }) {
      await rest("report_flags", { method: "POST", signedIn: true, prefer: "resolution=ignore-duplicates,return=minimal", body: { kind, cell } });
    },
    async cells([w, s, e, n]) {
      const q = `report_cells?select=*&cell_lng=gte.${w}&cell_lng=lte.${e}&cell_lat=gte.${s}&cell_lat=lte.${n}`;
      const rows = (await rest(q)) || [];
      if (session) {
        try {
          const mine = (await rest("reports?select=kind,cell", { signedIn: true })) || [];
          myCells = new Set(mine.map((m) => `${m.kind}|${m.cell}`));
        } catch (_) {}
      }
      return rows.map((r) => ({ ...r, mine: myCells.has(`${r.kind}|${r.cell}`) }));
    },
  };
}

const cfg = APP.reports || {};
export const store = cfg.supabaseUrl && cfg.supabaseKey ? liveStore(cfg.supabaseUrl.replace(/\/$/, ""), cfg.supabaseKey) : demo;
