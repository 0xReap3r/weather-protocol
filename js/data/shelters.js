// Shelter data for Texas, two sources:
//  - Year-round registered shelter sites (schools, churches, community centers) from the HIFLD
//    National Shelter System Facilities layer, browser-direct (Esri hosted service, public CORS).
//    This is a historical inventory of places that CAN serve as a shelter, not a live status feed.
//  - Shelters FEMA currently shows as open, from the FEMA ESF#6 Shelter System ("Open Shelters"),
//    routed through our Worker since gis.fema.gov is a self-hosted ArcGIS instance (CORS unclear).
import { APP } from "../config.js";
import { fetchJSON } from "./fetch.js";

const API = /workers\.dev$|^stormline/.test(location.hostname) ? "/api/tx" : `${APP.apiBase}/api/tx`;
const SITES_URL = "https://services.arcgis.com/XG15cJAlne2vxtgt/ArcGIS/rest/services/Critical_Infrastructure_Map_Service/FeatureServer/0/query";
const FIELDS = "NAME,ADDRESS,CITY,COUNTY,ZIP,EVAC_CAP,POSTIM_CAP,S_TYPE,PETFACILIT";

const title = (s) => String(s || "").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const cap = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };

// Year-round candidate shelter sites in Texas. [{ name, address, city, county, at:[lng,lat], evacCap, postCap, type, pets }]
export async function loadShelterSites() {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 6; page++) { // up to 6000 records, far more than Texas needs
    const q = `${SITES_URL}?where=STATE%3D%27TX%27&outFields=${FIELDS}&returnGeometry=true&f=geojson&resultRecordCount=1000&resultOffset=${offset}`;
    const fc = await fetchJSON(q, { timeout: 15000 });
    const feats = fc.features || [];
    for (const f of feats) {
      const c = f.geometry?.coordinates;
      const p = f.properties;
      if (!c || !p?.NAME) continue;
      out.push({
        name: title(p.NAME), address: title(p.ADDRESS), city: title(p.CITY), county: title(p.COUNTY),
        at: [c[0], c[1]], evacCap: cap(p.EVAC_CAP), postCap: cap(p.POSTIM_CAP),
        type: p.S_TYPE && p.S_TYPE !== "OTHER" ? title(p.S_TYPE) : null, pets: /^y/i.test(p.PETFACILIT || ""),
      });
    }
    if (feats.length < 1000) break;
    offset += 1000;
  }
  return out;
}

// Shelters FEMA currently lists as open, Texas only. [{ name, address, city, county, at, cap, org, pets, since }]
export async function loadOpenShelters() {
  const j = await fetchJSON(`${API}/shelters`, { timeout: 15000 });
  return (j.open || []).map(([name, address, city, county, lng, lat, capacity, org, pets, since]) => ({
    name, address, city, county, at: [lng, lat], cap: cap(capacity), org, pets: !!pets, since,
  }));
}
