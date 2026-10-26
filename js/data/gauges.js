// River and lake gauges from NOAA's National Water Prediction Service (NWPS).
// Verified live Oct 24, 2026: /nwps/v1/gauges/{lid} and /nwps/v1/gauges/{lid}/stageflow.

import { fetchJSON } from "./fetch.js";

import { APP, GAUGE_NAMES } from "../config.js";

const NWPS = "https://api.water.noaa.gov/nwps/v1/gauges";

// NWS flood-category colors. "No flooding" is a neutral blue on purpose:
// a normal river reading is not the same as "safe to drive".
export const CATEGORY = {
  major:       { label: "Major flooding",    color: "#cc33ff", rank: 5 },
  moderate:    { label: "Moderate flooding", color: "#ff2b2b", rank: 4 },
  minor:       { label: "Minor flooding",    color: "#ff9a1f", rank: 3 },
  action:      { label: "Near flood stage",  color: "#ffe14d", rank: 2 },
  no_flooding: { label: "Below flood stage", color: "#5fa8d3", rank: 1 },
  not_defined: { label: "Lake level",        color: "#8aa0b4", rank: 0 },
  unknown:     { label: "No recent reading", color: "#5a6572", rank: -1 },
};

const STALE_MS = 2 * 60 * 60 * 1000; // a reading older than 2h is shown as stale

const num = (v) => (typeof v === "number" && v > -900 ? v : null); // NWPS uses -999/-9999 for "none"

function parseGauge(g, cfg) {
  const obs = g.status?.observed || {};
  const fc = g.status?.forecast || {};
  const cats = g.flood?.categories || {};
  const observedAt = obs.validTime && !obs.validTime.startsWith("0001") ? obs.validTime : null;
  const stale = !observedAt || Date.now() - Date.parse(observedAt) > STALE_MS;
  let category = obs.floodCategory || "unknown";
  if (!CATEGORY[category]) category = category === "low_threshold" ? "no_flooding" : "unknown";
  if (stale) category = "unknown";

  return {
    lid: g.lid,
    name: cfg.name || g.name,
    short: cfg.short || cfg.name || g.name,
    officialName: g.name,
    kind: cfg.kind || "river",
    lng: g.longitude,
    lat: g.latitude,
    stage: num(obs.primary),
    stageUnit: obs.primaryUnit || "ft",
    flow: num(obs.secondary),
    flowUnit: obs.secondaryUnit || "",
    category,
    observedAt,
    stale,
    forecastCategory: fc.floodCategory && fc.floodCategory !== "fcst_not_current" ? fc.floodCategory : null,
    forecastStage: num(fc.primary),
    forecastAt: fc.validTime && !fc.validTime.startsWith("0001") ? fc.validTime : null,
    stages: {
      action: num(cats.action?.stage),
      minor: num(cats.minor?.stage),
      moderate: num(cats.moderate?.stage),
      major: num(cats.major?.stage),
    },
    pageUrl: `https://water.noaa.gov/gauges/${g.lid.toLowerCase()}`,
    // NWS flood inundation map service, where one exists for this gauge (modeled extents)
    fimUrl: g.inundation?.enabled && g.inundation?.url ? g.inundation.url : null,
    zeroDatum: num(g.inundation?.zeroDatum?.value ?? g.datums?.zeroDatum?.value),
  };
}

// Every NOAA gauge in the state (Phase 9), from our Worker: one cached request instead of one per
// gauge. Flood stages aren't in the statewide list, so they're filled in from each gauge's own
// record for gauges near flood stage, and when someone opens a gauge.
const API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api" : `${APP.apiBase}/api`;
const detailCache = new Map(); // lid -> parsed gauge with stages

function fromRow([lid, name, lng, lat, stage, unit, cat, observedAt]) {
  const cfg = GAUGE_NAMES[lid] || {};
  const stale = !observedAt || Date.now() - Date.parse(observedAt) > STALE_MS;
  let category = cat;
  if (!CATEGORY[category]) category = category === "low_threshold" ? "no_flooding" : "unknown";
  if (stale) category = "unknown";
  const kind = cfg.kind || (cat === "not_defined" ? "lake" : "river");
  const base = {
    lid, name: cfg.name || name, short: cfg.short || name, officialName: name, kind, lng, lat,
    stage, stageUnit: unit || "ft", flow: null, flowUnit: "", category, observedAt, stale,
    forecastCategory: null, forecastStage: null, forecastAt: null,
    stages: { action: null, minor: null, moderate: null, major: null },
    pageUrl: `https://water.noaa.gov/gauges/${lid.toLowerCase()}`, fimUrl: null, zeroDatum: null, partial: true,
  };
  const d = detailCache.get(lid);
  // Keep the fresh reading from the statewide list, take stages and links from the detail record.
  return d ? { ...d, stage: base.stage ?? d.stage, category: base.category, observedAt: base.observedAt || d.observedAt, stale: base.stale, partial: false } : base;
}

// Full record for one gauge (stages, forecast, flood map link); cached for the visit.
export async function loadGaugeDetail(lid) {
  if (detailCache.has(lid)) return detailCache.get(lid);
  const g = parseGauge(await fetchJSON(`${NWPS}/${lid}`, { timeout: 12000 }), GAUGE_NAMES[lid] || {});
  detailCache.set(lid, g);
  return g;
}

function feature(g) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [g.lng, g.lat] },
    properties: {
      lid: g.lid,
      color: CATEGORY[g.category].color,
      rank: CATEGORY[g.category].rank,
      stale: g.stale,
      short: g.short,
      // A raw stage means little on its own (each gauge has its own datum; lakes read in
      // elevation), so pair it with that gauge's flood stage when it's known.
      label:
        g.stage == null
          ? "No recent reading"
          : g.stages.minor != null
            ? `${g.stage.toFixed(1)} ft · flood ${g.stages.minor.toFixed(0)}`
            : `${g.stage.toFixed(1)} ft${g.kind === "lake" ? " elev." : ""}`,
    },
  };
}
export const gaugeFeatures = (gauges) => ({ type: "FeatureCollection", features: gauges.map(feature) });

export async function loadGauges(metro) {
  const j = await fetchJSON(`${API}/gauges?state=${metro.stateAbbr || "TX"}`, { timeout: 20000 });
  const rows = (j.gauges || []).filter((r) => r[6] !== "out_of_service");
  if (!rows.length) throw new Error("No gauges in the statewide list");
  let gauges = rows.map(fromRow);
  // Fill in flood stages for gauges at or near flood stage (few), plus our named DFW gauges.
  const want = gauges.filter((g) => (CATEGORY[g.category]?.rank ?? -1) >= 2 || GAUGE_NAMES[g.lid]).filter((g) => !detailCache.has(g.lid)).slice(0, 25);
  await Promise.allSettled(want.map((g) => loadGaugeDetail(g.lid)));
  gauges = rows.map(fromRow);
  return { gauges, fc: gaugeFeatures(gauges), failed: 0 };
}

// Last 48h of observations (+ forecast, when NWS has issued one) for the detail chart.
export async function loadStageflow(lid) {
  const sf = await fetchJSON(`${NWPS}/${lid}/stageflow`, { timeout: 12000 });
  const since = Date.now() - 48 * 3600 * 1000;
  const pts = (arr) =>
    (arr || [])
      .map((d) => ({ t: Date.parse(d.validTime), v: num(d.primary) }))
      .filter((d) => d.v != null && Number.isFinite(d.t));
  return {
    observed: pts(sf.observed?.data).filter((d) => d.t >= since),
    forecast: pts(sf.forecast?.data).filter((d) => d.t >= Date.now() - 3600 * 1000),
    unit: sf.observed?.primaryUnits || "ft",
  };
}
