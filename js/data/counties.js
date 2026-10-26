// County outlines for the whole state, served by our Worker from the Census Bureau's TIGERweb
// (simplified to ~500 m, cached a week at the edge). Used for zone-based alerts (matched by
// county FIPS code), county totals, push alert matching and region lists.
import { APP } from "../config.js";
import { fetchJSON } from "./fetch.js";

const API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api" : `${APP.apiBase}/api`;
let cache = null;

export function loadCounties(metro) {
  if (!cache) {
    cache = fetchJSON(`${API}/geo/counties?state=${metro.stateFips || "48"}`, { timeout: 20000 })
      .then((fc) => {
        const rows = (fc.features || []).map((f) => ({
          name: f.properties.name,
          geoid: f.properties.geoid,
          center: [f.properties.lng, f.properties.lat],
          geometry: f.geometry,
          bbox: bboxOf(f.geometry),
        }));
        metro.setCounties?.(rows);
        return rows;
      })
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

// Counties touching a [w, s, e, n] box, nearest the box center first, at most `max`.
export function countiesIn(rows, [w, s, e, n], max = 40) {
  const cx = (w + e) / 2, cy = (s + n) / 2;
  return rows
    .filter((c) => c.bbox[0] <= e && c.bbox[2] >= w && c.bbox[1] <= n && c.bbox[3] >= s)
    .sort((a, b) => Math.hypot(a.center[0] - cx, a.center[1] - cy) - Math.hypot(b.center[0] - cx, b.center[1] - cy))
    .slice(0, max);
}

function bboxOf(g) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
    else c.forEach(walk);
  };
  walk(g.coordinates);
  return [w, s, e, n];
}
