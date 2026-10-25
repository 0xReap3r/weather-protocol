// River and lake gauges from NOAA's National Water Prediction Service (NWPS).
// Verified live Oct 24, 2026: /nwps/v1/gauges/{lid} and /nwps/v1/gauges/{lid}/stageflow.

import { fetchJSON } from "./fetch.js";

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

export async function loadGauges(metro) {
  const results = await Promise.allSettled(
    metro.gauges.map((cfg) => fetchJSON(`${NWPS}/${cfg.lid}`, { timeout: 12000 }).then((g) => parseGauge(g, cfg)))
  );
  const gauges = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const failed = results.length - gauges.length;
  if (!gauges.length) throw new Error("No gauges responded");

  const fc = {
    type: "FeatureCollection",
    features: gauges.map((g) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.lng, g.lat] },
      properties: {
        lid: g.lid,
        color: CATEGORY[g.category].color,
        rank: CATEGORY[g.category].rank,
        stale: g.stale,
        short: g.short,
        // A raw stage means little on its own (each gauge has its own datum; lakes read in
        // elevation), so pair it with that gauge's flood stage when it has one.
        label:
          g.stage == null
            ? "No recent reading"
            : g.stages.minor != null
              ? `${g.stage.toFixed(1)} ft · flood ${g.stages.minor.toFixed(0)}`
              : `${g.stage.toFixed(1)} ft${g.kind === "lake" ? " elev." : ""}`,
      },
    })),
  };
  return { gauges, fc, failed };
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
