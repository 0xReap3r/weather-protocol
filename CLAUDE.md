# Stormline (weather-protocol) — project notes

Live severe-weather situational map for Texas (started as a Dallas–Fort Worth pilot), inspired by the Bangkok flood map
(situational-bangkok-flood.web.app). Working name "Stormline"; the name lives in `js/config.js`,
`manifest.webmanifest` and `<title>` in `index.html`.

Decision Oct 28: Texas only. DFW pilot → all of Texas (Phase 9, done) → go deeper in Texas
(Texas-only data, Spanish, hurricane and wildfire seasons, Texas partners). No state-by-state
expansion planned, but keep the code national-ready: statewide settings live in `STATE`, named
areas in `REGIONS` (config.js); prefer national feeds so a neighbor state would be config, not rewrites.

## Ground rules
- Free, public data only for v1. No secret keys in the repo. The Supabase publishable (anon) key is the one exception: it is public by design; row-level security in `supabase/schema.sql` controls access.
- Official data first; neighbor reports fill gaps. Never label a place or road "safe".
  Gray / no data means "no data", not "no flooding".
- Every reading shows its time; stale data is visibly faded.
- SOS is a 911 link only — no in-app rescue requests.
- Respect `prefers-reduced-motion` for all animation.

## Design (v2, Oct 28)
- Storm-slate night palette (tokens in `css/app.css` `:root`), Archivo variable font (condensed for headlines/numbers, expanded for the wordmark), tabular figures for readings.
- Chrome is monochrome: selected = frost (`--text`). Hazard hues are for data only.
- The "storm line" rail carries state: before the wordmark (`--threat`, set from the top alert in `renderBanner`), down the area panel (`--verdict`), on banners and list rows.
- Lists are rows on hairlines; cards only for callouts. Section labels sentence case. The "Site design v2" block at the end of app.css overrides older rules.

## Stack
Plain HTML/CSS/JS ES modules, no build step. MapLibre GL 4.7.1 from unpkg, CARTO Dark Matter basemap.
Run locally: `npx serve .` then open http://localhost:3000.

## Data sources (all verified Oct 24, 2026)
- NWS alerts: `api.weather.gov/alerts/active?area=TX`; zone-based alerts are drawn with county outlines matched by `geocode.SAME` FIPS (048xxx), falling back to `affectedZones` only when no county matches
- NWS point + hourly forecast: `api.weather.gov/points/{lat},{lon}`
- NOAA NWPS gauges: statewide list `api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=…&srid=EPSG_4326` (via Worker), per-gauge `/gauges/{lid}` for flood stages (loaded for gauges near flood stage and on open), `/stageflow`
- Towns: TIGERweb `Places_CouSub_ConCity_SubMCD/MapServer/25` (Census 2020, POP100)
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
- NASA flood from space: GIBS WMTS `MODIS_Combined_Flood_2-Day` (GoogleMapsCompatible_Level9, max z9, date = yesterday UTC). Colors: flood 250,30,36 · recurring 255,255,0 · water 50,210,245 · insufficient 175,175,175. Recolored via a MapLibre `floodsat://` protocol in `js/satellite.js`
- NOAA rain totals: `mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer` — renderingRule `rft_1hr|rft_24hr|rft_72hr` for tiles/legend; items `conus_QPE_01H…72H` for identify (spot) and computeStatisticsHistograms (county mean/max)
- County outlines: Census TIGERweb `State_County/MapServer/1` (BASENAME + STATE FIPS), `js/data/counties.js`
- Routing: OSRM public demo `router.project-osrm.org` (fair-use only; self-host or pay before launch)
- ERCOT grid: `ercot.com/api/1/services/read/dashboards/daily-prc.json` → `current_condition` {state normal|weather|vcn|conservation|eea1|eea2|eea3, title, condition_note, eea_level, prc_value}. CORS-blocked, so the Worker serves it trimmed at `/api/grid` (60 s edge cache). ERCOT sometimes 403s cloud requests for a few minutes: `worker/grid.js` keeps the last good reading in D1 `kv` and serves it (stale: true) for up to 30 min

## Texas depth candidates (checked Oct 28; Phase 14 in the plan doc)
- Browser-OK (CORS): NIFC WFIGS `services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0` (`POOState='US-TX'`; names starting "Rx" are prescribed burns); NHC `mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer`; TxDOT evacuation routes `services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Evacuation_Routes/FeatureServer/0`; Austin low-water crossing gates `data.austintexas.gov/resource/q6kt-v2zm.json` and San Antonio `services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/LowWaterCrossings/FeatureServer` (locations only).
- Worker needed (no CORS): TWDB reservoirs `waterdatafortexas.org/reservoirs/statewide/recent-conditions.geojson`; TexMesonet `www.texmesonet.org/api/CurrentData` (XML; rain 24/48/72 hr, soil moisture).
- Unverified: TFS burn bans `gis.tfs.tamu.edu/arcgis/rest/services/EOC/BurnBan/FeatureServer/0` (unreachable from the dev box; try from the Worker). Ignore the stale third-party "Texas_Count_Burn_Bans" copy.
- No public feed (outreach, don't scrape): LCRA Hydromet, Harris County FWS, ATXfloods live status.

## Layout
- `js/config.js` — app name, disclaimer, basemap, `STATE` (Texas bounds, FIPS, refresh), `REGIONS` (20 named areas with radius and ERCOT flag), `GAUGE_NAMES` (friendly names for DFW gauges), legacy `METROS.dfw`
- `js/region.js` — `metro` facade used everywhere: current region by map center (name, center, radius, gridErcot), statewide bounds, `cities` (all towns 2,500+), `regionCities` (top 30 nearby), `counties` (names near the region)
- `worker/geo.js` — `/api/gauges?state=TX` (all NOAA gauges, 5 min), `/api/geo/counties?state=48`, `/api/geo/cities?state=48` (7 days), edge-cached with D1 fallback
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
- `js/menu.js` — side menu: "Show me" layer presets, all views, Simple / Normal / Advanced (`body[data-view-mode]`; simple hides `.chips`, `.nd-more`; advanced shows `.adv-only`)
- `js/satellite.js` — "Flood from space" chip: recolored NASA flood tiles + flooded acres per county labels (zoom < 11)
- `js/raintotals.js` — "Rain totals" chip: MRMS tiles, period buttons, county avg/max labels; `rainTotalsAt()` feeds "Rain so far" in the area panel
- `js/feed.js` — "What's happened": last 3 days of NWS alerts (`loadRecentAlerts`), rivers at action+, neighbor reports
- `js/places.js` — My places (localStorage `stormline.places.v1`, max 10) with live status
- `js/route.js` — Check a route: OSRM public demo router → warnings crossed + reported roads within 120 m
- `worker/index.js` — Cloudflare Worker for `/api/*` only (`run_worker_first`); everything else is static assets
- `js/grid.js` — Grid chip: ERCOT pill under the warnings banner + detail sheet; uses `APP.apiBase` off the live site
- `worker/push.js` — push alerts: D1 tables `subs`/`seen`/`inbox` (auto-created), cron every minute checks NWS for new storm warnings, empty VAPID pushes; SW fetches `/api/push/inbox`. Secret `VAPID_PRIVATE_KEY` (dashboard only), public key in `wrangler.jsonc` vars
- `worker/health.js` — every 10 min (second cron): probes each data source into D1 `health`, runs Supabase `reports_cleanup` (keeps the free project awake); `/api/status` feeds the Data status sheet
- `privacy.html`, `terms.html` (+ `css/legal.css`) — DRAFT legal pages, need lawyer review before public promotion
- `js/push.js` — "Alerts on this device" card in My places (subscribe/test/off, kinds)
- `js/legends.js` — tap a legend card's title row to fold it; cards live in `#legend-dock`
- `js/storms.js` — Storms chip: SPC day 1–3 outlooks as glowing risk contours (faint wash, blurred glow edge, crisp line, hatch on ENH+, labels along contours, breathing glow on MDT/HIGH); card with 1–5 scale for the current region, tornado/hail/wind chances, per-hazard views; `levelToday()` feeds fast polling
- `js/app.js` also: fast alert polling (60 s during active weather), "you're inside the warning" bar (`#danger-bar`) from the Near me location
- `supabase/migrations/` — run in order on an existing project (002 adds hail + damage kinds)
- `supabase/schema.sql` — tables, RLS, rate limit, expiry, flags, public `report_cells` view
- `js/data/` — one module per data source; `fetch.js` adds timeouts
- `sw.js` — offline app shell (network first); bump `VERSION` whenever shell files change. A new version shows open pages a "new version ready · Refresh" bar (`#update-bar`, app.js)

## Debugging
In the browser console: `stormlineMap`, `stormlineNear`, `stormlineDemo()` / `stormlineDemo('tornado')` (fake warning around the map center + gauge; with Near me inside it, shows the danger bar), `stormlinePolling()`, `stormlineStorms.demo()` (made-up Marginal→High outlook around the region, with the Storms chip on), and in demo mode `stormlineReports.store.simulate([lng,lat], 'flood', 2, 3)` to add fake neighbors.

## Revisit later (full list in the build plan doc, "Revisit later" section)
- No free feed yet: TEXRail / Trinity Metro lines, low-water crossings (Fort Worth HWWS is on OneRain), TxDOT closures (DriveTexas), DART live service alerts, Oncor outages. Don't scrape; outreach is deferred.
- Report photos/moderation history not built. Push: free plan caps ~35 pushes per minute-run (50 subrequests); fine for the pilot, revisit if subscribers grow.
- Mobile pass 1 done Oct 25 (`js/legends.js` folds legend cards, folded by default < 720 px; status row; icon-only FABs). Still test on a real iPhone, landscape, and very small phones.
- Housekeeping: final name; lawyer review of privacy.html/terms.html. (Report cleanup + Supabase keep-alive now run from the Worker every 10 min.)
