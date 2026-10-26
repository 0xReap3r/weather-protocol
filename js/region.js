// Statewide map with a "current region" (Phase 9). Everything that used to read the DFW config
// reads this object instead, so the same code works anywhere in Texas:
//   metro.name / id / center / zoom   the region nearest the map center (or "Texas")
//   metro.bounds / maxBounds          the whole state
//   metro.cities                      every town of 2,500+ in the state [name, lat, lng, pop]
//   metro.regionCities                the biggest towns in the current region (What's coming, polling)
//   metro.counties                    county names in the current region (feed wording)
//   metro.gridErcot                   false where ERCOT doesn't run the grid
import { APP, STATE, REGIONS } from "./config.js";
import { fetchJSON } from "./data/fetch.js";

const API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api" : `${APP.apiBase}/api`;
const KEY = "stormline.region.v1";

const km = ([lng1, lat1], [lng2, lat2]) => {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export function createRegion() {
  let cities = [];
  let countyRows = []; // [{ name, geoid, center }]
  let current = null;  // a REGIONS entry, or null when the map center isn't near one
  let center = null;
  const listeners = new Set();

  let saved = null;
  try { saved = REGIONS.find((r) => r.id === localStorage.getItem(KEY)) || null; } catch (_) {}
  current = saved || REGIONS[0];
  center = current.center;

  function pick(pt) {
    let best = null, bestD = Infinity;
    for (const r of REGIONS) {
      const d = km(pt, r.center);
      if (d <= r.radius * 1.4 && d < bestD) { best = r; bestD = d; }
    }
    return best;
  }

  const metro = {
    get id() { return current?.id || STATE.id; },
    get name() { return current?.name || STATE.name; },
    get center() { return current?.center || center; },
    get zoom() { return current?.zoom || 8; },
    get radius() { return current?.radius || 120; },
    get gridErcot() { return current ? current.grid !== null : true; },
    get gridMixed() { return current?.grid === "mixed"; },
    bounds: STATE.bounds,
    maxBounds: STATE.maxBounds,
    nwsAlertArea: STATE.nwsAlertArea,
    stateFips: STATE.fips,
    stateName: STATE.name,
    stateAbbr: STATE.abbr,
    refresh: STATE.refresh,
    get cities() { return cities; },
    // Biggest towns within the region (or near the map center when outside every region).
    get regionCities() {
      const c = metro.center, r = metro.radius;
      return cities.filter((x) => km(c, [x[2], x[1]]) <= r).slice(0, 30);
    },
    get counties() {
      const c = metro.center, r = metro.radius + 30;
      return countyRows.filter((x) => km(c, x.center) <= r).map((x) => x.name);
    },
    regions: REGIONS,
    state: STATE,
    // Called on map moves: switches the current region when the center moves into another.
    // Zoomed out past a region (below zoom 7), the whole state is the "region".
    setCenter(pt, zoom = 9) {
      center = pt;
      const next = zoom < 7 ? null : pick(pt);
      if (next?.id === current?.id && (next || !current)) return;
      current = next;
      try { if (current) localStorage.setItem(KEY, current.id); } catch (_) {}
      listeners.forEach((f) => f(metro));
    },
    onChange(f) { listeners.add(f); },
    km,
  };

  // Towns load once (cached a week at the edge); counties come from data/counties.js.
  metro.ready = fetchJSON(`${API}/geo/cities?state=${STATE.fips}`, { timeout: 15000 })
    .then((rows) => { cities = rows; listeners.forEach((f) => f(metro)); })
    .catch(() => {});
  metro.setCounties = (rows) => { countyRows = rows.map((c) => ({ name: c.name, geoid: c.geoid, center: c.center })); };

  return metro;
}
