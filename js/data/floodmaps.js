// Modeled flood maps and FEMA flood zones (ArcGIS map services, keyless, CORS-enabled).
import { fetchJSON } from "./fetch.js";

/* ---------- NWS flood inundation maps (per gauge) ---------- */
const fimCache = new Map(); // service url -> { categories: {minor: id,...}, levels: [{elev, id}] }

export async function fimLayers(serviceUrl) {
  if (fimCache.has(serviceUrl)) return fimCache.get(serviceUrl);
  const svc = await fetchJSON(`${serviceUrl}?f=json`, { timeout: 12000 });
  const categories = {};
  const levels = [];
  for (const l of svc.layers || []) {
    const name = String(l.name).trim().toLowerCase();
    if (["low", "near", "minor", "moderate", "major"].includes(name)) categories[name] = l.id;
    else if (/^\d+(\.\d+)?$/.test(name)) levels.push({ elev: Number(name), id: l.id });
  }
  levels.sort((a, b) => a.elev - b.elev);
  const out = { categories, levels };
  fimCache.set(serviceUrl, out);
  return out;
}

// Raster tile URL for one or more layers of an ArcGIS MapServer (MapLibre fills in {bbox-epsg-3857}).
export const exportTiles = (serviceUrl, layerIds) =>
  `${serviceUrl}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256` +
  `&format=png32&transparent=true&layers=show:${layerIds.join(",")}&f=image`;

/* ---------- FEMA National Flood Hazard Layer ---------- */
export const NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
export const NFHL_ZONES_LAYER = 28;

const zoneCache = new Map();
export async function femaZone([lng, lat]) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (zoneCache.has(key)) return zoneCache.get(key);
  const url =
    `${NFHL}/${NFHL_ZONES_LAYER}/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF&returnGeometry=false&f=json`;
  const j = await fetchJSON(url, { timeout: 12000 });
  const a = j.features?.[0]?.attributes || null;
  const out = a ? describeZone(a) : { zone: null, label: "No FEMA flood map here", risk: "unmapped", note: "FEMA hasn't mapped flood zones at this spot." };
  zoneCache.set(key, out);
  return out;
}

// Plain-language reading of FEMA zones. We describe FEMA's mapping; we never call a zone "safe".
function describeZone({ FLD_ZONE: z, ZONE_SUBTY: sub, SFHA_TF: sfha }) {
  const subtype = (sub || "").toUpperCase();
  if (sfha === "T") {
    const floodway = subtype.includes("FLOODWAY");
    return {
      zone: z,
      label: `Zone ${z}${floodway ? " · floodway" : ""}`,
      risk: "high",
      note: floodway
        ? "High-risk area: the channel that carries floodwater. FEMA maps a 1% or greater chance of flooding each year."
        : "High-risk area. FEMA maps a 1% or greater chance of flooding each year (the \"100-year\" floodplain).",
    };
  }
  if (z === "X" && subtype.includes("0.2 PCT")) {
    return { zone: z, label: "Zone X (shaded)", risk: "moderate", note: "Moderate-risk area: about a 0.2% chance of flooding each year (the \"500-year\" floodplain)." };
  }
  if (z === "X") {
    return { zone: z, label: "Zone X", risk: "minimal", note: "Outside FEMA's mapped high-risk floodplain. Flash flooding can still happen here, especially on streets and in low spots." };
  }
  if (z === "D") return { zone: z, label: "Zone D", risk: "unmapped", note: "Flood risk here is undetermined; FEMA hasn't studied it." };
  return { zone: z, label: `Zone ${z}`, risk: "other", note: sub ? sub.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "" };
}
