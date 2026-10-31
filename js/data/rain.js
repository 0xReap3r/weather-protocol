// Rain falling at a spot right now, plus the next two hours, from Open-Meteo.
// Open-Meteo blends NOAA's HRRR model at 15-minute steps for the US. It's a model nowcast,
// not a radar reading, and the panel says so. Free, no key; non-commercial use only.
import { fetchJSON } from "./fetch.js";

const cache = new Map(); // grid key -> { at, data }
const TTL = 5 * 60 * 1000;

// US rain-rate categories (inches per hour)
export const RAIN_LEVELS = [
  { min: 1.0, key: "extreme", label: "Very heavy", bars: 4,
    advice: "Flash flooding is possible. Stay off the roads if you can, and never drive into moving or standing water." },
  { min: 0.3, key: "heavy", label: "Heavy", bars: 3,
    advice: "Street water can rise fast. Avoid underpasses, low-water crossings and creek-side roads." },
  { min: 0.1, key: "moderate", label: "Moderate", bars: 2,
    advice: "Water may pond on roads and in low spots. Slow down and leave extra room." },
  { min: 0.005, key: "light", label: "Light", bars: 1,
    advice: "Roads get slick fast, especially the first rain after dry weather." },
];
export const levelFor = (inPerHr) => RAIN_LEVELS.find((l) => inPerHr >= l.min) || null;

// Precip type from Open-Meteo's WMO weather_code: "freezing" (freezing drizzle/rain — ice on
// contact, the most dangerous of the three even when light), "snow" (snow or snow showers), or
// the "rain" default. Only matters in the colder months, but costs nothing extra: weather_code
// comes back on the same HRRR-backed call we already make for rain-now.
const FREEZING_CODES = new Set([56, 57, 66, 67]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const ptypeFor = (code) => (FREEZING_CODES.has(code) ? "freezing" : SNOW_CODES.has(code) ? "snow" : "rain");

export async function loadRainNow([lng, lat]) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&current=precipitation,weather_code&minutely_15=precipitation,weather_code&forecast_minutely_15=8&precipitation_unit=inch&timezone=auto`;
  const j = await fetchJSON(url, { timeout: 10000 });

  const nowRate = (j.current?.precipitation ?? 0) * (3600 / (j.current?.interval || 900)); // in/hr
  const times = j.minutely_15?.time || [];
  const vals = j.minutely_15?.precipitation || [];
  const codes = j.minutely_15?.weather_code || [];
  const next = times.map((t, i) => ({ t, rate: (vals[i] ?? 0) * 4, code: codes[i] })); // 15-min amount -> in/hr
  const nowIdx = next.findIndex((p) => p.t >= (j.current?.time || ""));
  const upcoming = next.slice(Math.max(0, nowIdx + 1));
  const starts = upcoming.find((p) => levelFor(p.rate));
  const peak = upcoming.reduce((m, p) => Math.max(m, p.rate), 0);

  const data = {
    rate: nowRate,
    level: levelFor(nowRate),
    ptype: nowRate > 0 ? ptypeFor(j.current?.weather_code) : null,
    startsAt: !levelFor(nowRate) && starts ? starts.t : null, // local time string from timezone=auto
    startPtype: starts ? ptypeFor(starts.code) : null,
    peakNext2h: peak,
    peakLevel: levelFor(peak),
    observedAt: j.current?.time,
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}
