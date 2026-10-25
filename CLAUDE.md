# Stormline (weather-protocol) — project notes

Live severe-weather situational map for Dallas–Fort Worth, inspired by the Bangkok flood map
(situational-bangkok-flood.web.app). Working name "Stormline"; the name lives in `js/config.js`,
`manifest.webmanifest` and `<title>` in `index.html`.

## Ground rules
- Free, public data only for v1. No secret keys in the repo. The Supabase publishable (anon) key is the one exception: it is public by design; row-level security in `supabase/schema.sql` controls access.
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
- Radar: IEM NEXRAD tiles `mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913[-mNNm]/{z}/{x}/{y}.png`
- Flood inundation maps: NWS FIM MapServer per gauge (url from NWPS gauge `inundation.url`); category layers Minor/Moderate/Major
- FEMA flood zones: NFHL MapServer layer 28 (query for the zone at a point; export for the map layer, zoom 11+)
- Dead: the TxDOT ArcGIS DriveTexas service (0 features, last edited 2017). DriveTexas.org has no public feed.
- SPC severe outlook: `spc.noaa.gov/products/outlook/day{1,2,3}otlk_cat.lyr.geojson` (LABEL TSTM…HIGH)
- WPC excessive rainfall: `mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer/{0,1,2}` (dn 1–4)
- Open-Meteo multi-location hourly rain for all cities in one request
- DART rail lines + stations (from DART GTFS): City of Dallas ArcGIS `services2.arcgis.com/rwnOSbfKSwyTBcwN/ArcGIS/rest/services/dart_rail/FeatureServer/{0 stops,1 routes}` (CORS OK). No TEXRail feed found yet.
- Road names: nearest named line in the CARTO basemap's own z14 vector tile (`roads` layer), decoded in `js/data/roadnames.js`
- ERCOT dashboard JSON is CORS-blocked in browsers; fetch it server-side.

## Layout
- `js/config.js` — app name, disclaimer, basemap, metro config (DFW counties, gauges, cities, refresh rates)
- `js/layers.js` — layer chips and which phase connects each
- `js/app.js` — map, layers, status badge, sheets, pulse animation, PWA
- `js/near.js` — "Near you" area panel (verdict, rain now, 12-hr rain chance, nearest gauges)
- `js/radar.js` — radar as rain drops: reads IEM tile pixels, palette index → dBZ (index×0.5−32.5), drops on a map-anchored grid, 6-frame loop
- `js/key.js` — map key, built from the same color tables the layers use
- `js/outlook.js` — "What's coming" view (opened from the warnings banner): risk levels Low/Elevated/High/Extreme from NWS alerts, gauges, SPC, WPC ERO and city rain
- `js/reports.js` — neighbor reports: report flow, map layers, "How deep is it?" scene, area-panel summary
- `js/data/reports.js` — report store: demo (this browser) or Supabase (anonymous auth + REST); reports keep only an H3 cell (res 10 roads, res 8 power)
- `js/reports.js` also builds "Roads to avoid" (area-panel card + full list sheet), grouped by street name
- `js/transit.js` / `js/data/transit.js` — Rail chip: DART lines and stations; stations flagged by NWS flood/tornado/winter warnings or confirmed flooding within 0.3 mi
- `supabase/schema.sql` — tables, RLS, rate limit, expiry, flags, public `report_cells` view
- `js/data/` — one module per data source; `fetch.js` adds timeouts
- `sw.js` — offline app shell; bump `VERSION` whenever shell files change

## Debugging
In the browser console: `stormlineMap`, `stormlineNear`, `stormlineDemo()` (fake flood warning + gauge to see pulsing), and in demo mode `stormlineReports.store.simulate([lng,lat], 'flood', 2, 3)` to add fake neighbors.
