# Stormline (weather-protocol) — project notes

Live severe-weather situational map for Dallas–Fort Worth, inspired by the Bangkok flood map
(situational-bangkok-flood.web.app). Working name "Stormline"; the name lives in `js/config.js`,
`manifest.webmanifest` and `<title>` in `index.html`.

## Ground rules
- Free, public data only for v1. No API keys in the repo.
- Official data first; neighbor reports fill gaps. Never label a place or road "safe".
  Gray / no data means "no data", not "no flooding".
- Every reading shows its time; stale data is visibly faded.
- SOS is a 911 link only — no in-app rescue requests.
- Respect `prefers-reduced-motion` for all animation.

## Stack
Plain HTML/CSS/JS ES modules, no build step. MapLibre GL 4.7.1 from unpkg, CARTO Dark Matter basemap.
Run locally: `npx serve .` then open http://localhost:3000.

## Data sources (all verified Oct 24, 2026)
- NWS alerts: `api.weather.gov/alerts/active?area=TX` (zone outlines from `affectedZones`)
- NWS point + hourly forecast: `api.weather.gov/points/{lat},{lon}`
- NOAA NWPS gauges: `api.water.noaa.gov/nwps/v1/gauges/{lid}` and `/stageflow`
- Rain now: Open-Meteo `minutely_15` (HRRR model nowcast, non-commercial use)
- Dead: the TxDOT ArcGIS DriveTexas service (0 features, last edited 2017). DriveTexas.org has no public feed.
- ERCOT dashboard JSON is CORS-blocked in browsers; fetch it server-side.

## Layout
- `js/config.js` — app name, basemap, metro config (DFW counties, gauges, refresh rates)
- `js/layers.js` — layer chips and which phase connects each
- `js/app.js` — map, layers, status badge, sheets, pulse animation, PWA
- `js/near.js` — "Near you" area panel (verdict, rain now, 12-hr rain chance, nearest gauges)
- `js/data/` — one module per data source; `fetch.js` adds timeouts
- `sw.js` — offline app shell; bump `VERSION` whenever shell files change

## Debugging
In the browser console: `stormlineMap`, `stormlineNear`, and `stormlineDemo()` (fake flood warning + gauge to see pulsing).
