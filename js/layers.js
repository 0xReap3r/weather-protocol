// Layer registry. Each layer is a chip in the top bar.
// Phase 1 ships the chips and toggle state; data hooks (load/unload) arrive in later phases.
// `phase` = the build-plan phase that connects real data, shown in the layer sheet.

export const LAYERS = [
  {
    id: "alerts",
    label: "Warnings",
    hint: "Flood, tornado, winter and freeze warnings from the National Weather Service",
    source: "NWS",
    phase: 2,
    defaultOn: true,
  },
  {
    id: "rivers",
    label: "Rivers",
    hint: "River, creek and lake levels with official flood stages",
    source: "NOAA NWPS · USGS",
    phase: 2,
    defaultOn: true,
  },
  {
    id: "rain",
    label: "Radar",
    hint: "Rain drops from live radar, looping the last 50 minutes",
    source: "NEXRAD via Iowa Environmental Mesonet",
    phase: 3,
    defaultOn: true,
  },
  {
    id: "storms",
    label: "Storms",
    hint: "Severe-storm and tornado risk for today, tomorrow and day 3, in SPC's 1–5 levels. Watches and warnings are on the Warnings layer.",
    source: "NOAA Storm Prediction Center",
    phase: 4,
    defaultOn: false,
  },
  {
    id: "satflood",
    label: "Flood from space",
    hint: "Flood water seen by NASA satellites over the last 2 days, with flooded acres per county when zoomed out. Misses small streets and anything under cloud.",
    source: "NASA LANCE MODIS flood map (GIBS)",
    phase: 4,
    defaultOn: false,
  },
  {
    id: "raintotal",
    label: "Rain totals",
    hint: "How much rain has fallen in the last hour, 24 hours or 3 days, with county averages when zoomed out.",
    source: "NOAA MRMS radar estimates",
    phase: 4,
    defaultOn: false,
  },
  {
    id: "zones",
    label: "Flood zones",
    hint: "FEMA flood hazard zones (zoom in to see them)",
    source: "FEMA",
    phase: 3,
    defaultOn: false,
  },
  {
    id: "grid",
    label: "Grid",
    hint: "Texas power grid status from ERCOT, from Normal up to Energy Emergency level 3, shown under the warnings banner.",
    source: "ERCOT grid conditions",
    phase: 4,
    defaultOn: true,
  },
  {
    id: "transit",
    label: "Rail",
    hint: "DART light rail, TRE, Silver Line and streetcar. Stations are flagged when a flood or tornado warning covers them or neighbors confirm flooding nearby.",
    source: "DART schedule data (GTFS)",
    phase: 4,
    defaultOn: false,
  },
  {
    id: "reports",
    label: "Neighbors",
    hint: "Neighbor reports: flooded or iced roads, power out, hail, storm damage. One report stays faint until a second neighbor confirms.",
    source: "Community reports",
    phase: 5,
    defaultOn: true,
  },
];

const KEY = "stormline.layers.v1";

export function loadLayerState() {
  const state = Object.fromEntries(LAYERS.map((l) => [l.id, l.defaultOn]));
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const id of Object.keys(state)) if (typeof saved[id] === "boolean") state[id] = saved[id];
  } catch (_) { /* storage blocked: use defaults */ }
  return state;
}

export function saveLayerState(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
}
