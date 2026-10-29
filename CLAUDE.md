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
- Browser-OK (CORS): NIFC WFIGS `services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0` (`POOState='US-TX'`; names starting "Rx" are prescribed burns); NHC `mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer`; TxDOT evacuation routes `services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Evacuation_Routes/FeatureServer/0`; statewide low-water crossings from TxGIO (used in Phase 14c; Austin and San Antonio city layers are smaller subsets).
- Worker needed (no CORS, built in Phase 14b): TWDB reservoirs `waterdatafortexas.org/reservoirs/statewide/recent-conditions.geojson`; TexMesonet `www.texmesonet.org/api/CurrentData` (XML; rain 24/48/72 hr, soil moisture).
- TFS burn bans `gis.tfs.tamu.edu/arcgis/rest/services/EOC/BurnBan/FeatureServer/0` work from the Worker (fields County, FIPS, BurnBan Yes/No, StartDate). Ignore the stale third-party "Texas_Count_Burn_Bans" copy.
- No public feed (outreach, don't scrape): LCRA Hydromet, Harris County FWS, ATXfloods live status.

## Layout
- `js/i18n.js` + `js/i18n/es.js` — Spanish (Phase 11). Language from localStorage `stormline.lang.v1`, else the browser language; switch in the menu (Language) or the footer button, which reloads. In Spanish a MutationObserver translates text nodes and aria-label/title/placeholder/alt through `ES` (keys = English text as shown; numbers become {0},{1}…), then `ES_PATTERNS` (sentences with names), then piece by piece across " · ". `t()` for map labels built in code, `eventName()` + `ES_EVENTS` for NWS event names (NWS's own Spanish). Mark names/user text `translate="no"`. NWS alert text stays English (labeled). Dates/numbers with no locale follow the language. Push subscriptions carry `lang`; worker/push.js writes Spanish alert text. `privacy-es.html` / `terms-es.html` are courtesy translations (English prevails). New UI text: add its Spanish to es.js; `stormlineI18n.misses()` in Spanish mode lists what's untranslated
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
- `js/tropical.js` — Hurricanes chip (Phase 14a): NHC `NHC_tropical_weather_summary` MapServer layers 3 outlook areas, 5 forecast points, 6 track, 7 cone, 8 coastal watch/warning (`tcww` HWR/HWA/TWR/TWA), 11 past track; strength colors by max wind; TxDOT evacuation routes loaded on first toggle; `nearHTML` says when a spot is in a cone
- `js/fires.js` — Fires chip (Phase 14a): NIFC WFIGS current locations + perimeters (`POOState='US-TX'`), dots sized by acres, flame symbols (wildfire red-orange; planned burns RX = gold flame in a dashed ring, drawn on a canvas in `addFireIcons`), no update in 3 days = faded; `nearHTML` lists wildfires within 25 mi. Both modules load with the chip off so the area panel can warn (`getTopHTML` in near.js)
- `worker/texas.js` — Phase 14b, Texas sources without CORS, cached with D1 fallback (`cached` in geo.js): `/api/tx/lakes` (TWDB recent-conditions, 1 hr), `/api/tx/mesonet` (TexMesonet CurrentData as JSON via Accept header, 5 min; mm→in, m/s→mph), `/api/tx/burnbans` (TFS `gis.tfs.tamu.edu/.../EOC/BurnBan/FeatureServer/0`, reachable from the Worker, 1 hr). Front-end loaders in `js/data/texas.js`
- `js/lakes.js` — Lakes chip: reservoirs colored by % full; "above full" (elevation over conservation pool) glows cyan; flood-control-only reservoirs (no %) are never flagged
- Rain totals chip also draws TexMesonet stations (24 h / 3 day measured rain; hidden for 1 h) with a station sheet; Fires chip also draws county burn bans, and the area panel names a burn ban for the spot's county
- `js/crossings.js` — Phase 14c: statewide low-water crossing inventory (8,339 points) from TxGIO `feature.geographic.texas.gov/arcgis/rest/services/Basemap/Low_Water_Crossing/MapServer/0` (CORS OK, max 2,000 per query), loaded in 0.25° cells; drawn with the Rivers chip from zoom 10 as yellow diamond signs, red + glow inside a Flood/Flash Flood warning or emergency; area panel lists crossings within 2 mi (moves under the verdict when one is inside a flood warning). Locations only: never show "open"/"safe"
- Map `maxBounds` (config `STATE`) is wide on purpose ([-124, 10, -76, 39]) so Gulf and eastern Pacific storms can be followed
- `js/app.js` also: fast alert polling (60 s during active weather), "you're inside the warning" bar (`#danger-bar`) from the Near me location
- `supabase/migrations/` — run in order on an existing project (002 adds hail + damage kinds)
- `supabase/schema.sql` — tables, RLS, rate limit, expiry, flags, public `report_cells` view
- `js/data/` — one module per data source; `fetch.js` adds timeouts
- `sw.js` — offline app shell (network first); bump `VERSION` whenever shell files change. A new version shows open pages a "new version ready · Refresh" bar (`#update-bar`, app.js)

## Debugging
In the browser console: `stormlineMap`, `stormlineNear`, `stormlineDemo()` / `stormlineDemo('tornado')` (fake warning around the map center + gauge; with Near me inside it, shows the danger bar), `stormlinePolling()`, `stormlineTropical.storms()`, `stormlineFires.list()`, `stormlineLakes`, `stormlineCrossings.warned()`, `stormlineI18n.misses()`, `stormlineStorms.demo()` (made-up Marginal→High outlook around the region, with the Storms chip on), and in demo mode `stormlineReports.store.simulate([lng,lat], 'flood', 2, 3)` to add fake neighbors.

## Revisit later (full list in the build plan doc, "Revisit later" section)
- No free feed yet: TEXRail / Trinity Metro lines, low-water crossings (Fort Worth HWWS is on OneRain), TxDOT closures (DriveTexas), DART live service alerts, Oncor outages. Don't scrape; outreach is deferred.
- Report photos/moderation history not built. Push: free plan caps ~35 pushes per minute-run (50 subrequests); fine for the pilot, revisit if subscribers grow.
- Mobile pass 1 done Oct 25 (`js/legends.js` folds legend cards, folded by default < 720 px; status row; icon-only FABs). Real-phone use confirmed by the owner (Oct 28, a week of daily use).
- Housekeeping: final name; lawyer review of privacy.html/terms.html. (Report cleanup + Supabase keep-alive now run from the Worker every 10 min.)
