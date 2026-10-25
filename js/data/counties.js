// County outlines for the metro, from the Census Bureau's TIGERweb service (keyless, CORS OK).
// Simplified to ~300 m, which is plenty for totals and labels. Cached for the visit.
import { fetchJSON } from "./fetch.js";

const URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query";
const STATE_FIPS = { TX: "48" };
let cache = null;

export function loadCounties(metro) {
  if (!cache) {
    const st = STATE_FIPS[metro.nwsAlertArea] || "48";
    const where = `STATE='${st}' AND BASENAME IN (${metro.counties.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")})`;
    const q = `${URL}?where=${encodeURIComponent(where)}&outFields=BASENAME,GEOID,CENTLAT,CENTLON&outSR=4326&geometryPrecision=4&maxAllowableOffset=0.003&f=geojson`;
    cache = fetchJSON(q, { timeout: 15000 })
      .then((fc) => (fc.features || []).map((f) => ({
        name: f.properties.BASENAME,
        geoid: f.properties.GEOID,
        center: [Number(f.properties.CENTLON), Number(f.properties.CENTLAT)],
        geometry: f.geometry,
        bbox: bboxOf(f.geometry),
      })))
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
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
