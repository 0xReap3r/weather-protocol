// Forecast data for the "What's coming" view. All keyless, all CORS-enabled (verified Oct 25, 2026).
//   NWS 7-day forecast           api.weather.gov/points → forecast
//   SPC severe-storm outlook      spc.noaa.gov day{1,2,3}otlk_cat.lyr.geojson   (TSTM…HIGH)
//   WPC excessive-rainfall (ERO)  mapservices.weather.noaa.gov wpc_precip_hazards layers 0–2 (Marginal…High)
//   Rain next 12 hours by city    Open-Meteo hourly, many locations in one request
import { fetchJSON } from "./fetch.js";

const TTL = 15 * 60 * 1000;
let cache = null; // { at, metroId, data }

const SPC = (d) => `https://www.spc.noaa.gov/products/outlook/day${d}otlk_cat.lyr.geojson`;
const ERO = (layer) =>
  `https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer/${layer}/query` +
  `?where=1%3D1&outFields=outlook,dn,valid_time&returnGeometry=true&outSR=4326&f=geojson`;

const empty = { type: "FeatureCollection", features: [] };
const soft = (p) => p.catch(() => null); // one failed source shouldn't sink the view

async function nwsForecast([lng, lat]) {
  const p = await fetchJSON(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, { timeout: 12000 });
  const f = await fetchJSON(p.properties.forecast, { timeout: 12000 });
  return (f.properties?.periods || []).map((x) => ({
    name: x.name,
    start: x.startTime,
    day: x.isDaytime,
    temp: x.temperature,
    unit: x.temperatureUnit,
    pop: x.probabilityOfPrecipitation?.value ?? 0,
    short: x.shortForecast,
    detail: x.detailedForecast,
  }));
}

async function cityRain(cities) {
  const lat = cities.map((c) => c[1].toFixed(3)).join(",");
  const lng = cities.map((c) => c[2].toFixed(3)).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&hourly=precipitation_probability,precipitation&forecast_hours=12&precipitation_unit=inch&timezone=America%2FChicago`;
  const j = await fetchJSON(url, { timeout: 15000 });
  const rows = Array.isArray(j) ? j : [j];
  return rows.map((r) => ({
    times: r.hourly?.time || [],
    pop: (r.hourly?.precipitation_probability || []).map((v) => v ?? 0),
    inches: (r.hourly?.precipitation || []).map((v) => v ?? 0),
  }));
}

export async function loadOutlook(metro, { force = false } = {}) {
  const cities = metro.regionCities; // snapshot: the region can change while this loads
  if (!force && cache && cache.metroId === metro.id && cache.n === cities.length && Date.now() - cache.at < TTL) return cache.data;
  const [spc1, spc2, spc3, ero1, ero2, ero3, forecast, rain] = await Promise.all([
    soft(fetchJSON(SPC(1), { timeout: 15000 })),
    soft(fetchJSON(SPC(2), { timeout: 15000 })),
    soft(fetchJSON(SPC(3), { timeout: 15000 })),
    soft(fetchJSON(ERO(0), { timeout: 15000 })),
    soft(fetchJSON(ERO(1), { timeout: 15000 })),
    soft(fetchJSON(ERO(2), { timeout: 15000 })),
    soft(nwsForecast(metro.center)),
    soft(cities.length ? cityRain(cities) : Promise.resolve([])),
  ]);
  const data = {
    at: new Date(),
    spc: [spc1 || empty, spc2 || empty, spc3 || empty],
    ero: [ero1 || empty, ero2 || empty, ero3 || empty],
    forecast: forecast || [],
    rain: rain || [], // same order as cities
    cities,
    failed: [
      !spc1 && "SPC outlook",
      !ero1 && "rainfall outlook",
      !forecast && "NWS forecast",
      !rain && "rain forecast",
    ].filter(Boolean),
  };
  cache = { at: Date.now(), metroId: metro.id, n: cities.length, data };
  return data;
}
