// App + metro configuration.
// Renaming the app later = change APP.name here (and in manifest.webmanifest + index.html <title>).
// Adding a metro later = add another entry to METROS. No other code changes needed.

export const APP = {
  name: "Stormline",            // working name — final name TBD
  tagline: "What's happening on your block",
  disclaimer:
    "Not an official warning service. Information can be wrong or late. Follow National Weather Service warnings and local officials. In danger? Call 911.",
  // Free basemap. CARTO Dark Matter is free for low-volume / non-commercial use (check terms before scaling).
  // Fully open alternative: "https://tiles.openfreemap.org/styles/liberty"
  basemapStyle: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  // Neighbor reports database (Supabase). Leave blank for demo mode (reports stay on this device).
  // The publishable/anon key is meant to be public; row-level security in supabase/schema.sql
  // decides what anyone can do with it. Never put the service_role or secret key here.
  // The live site, for its /api routes (the Worker) when running somewhere else, like localhost.
  apiBase: "https://weather-protocol.protocolxv-dev.workers.dev",
  reports: {
    supabaseUrl: "https://iiozdkcgxqvzukziovhq.supabase.co",
    supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlpb3pka2NneHF2enVremlvdmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NDczODksImV4cCI6MjEwODUyMzM4OX0.VHGVKkFDdN89dtlohVJ04pZDJ50hN4m0qUVx9SeB1OQ",
  },
};

export const METROS = {
  dfw: {
    id: "dfw",
    name: "Dallas–Fort Worth",
    center: [-96.95, 32.85],          // [lng, lat]
    zoom: 9,
    // [west, south, east, north] — matches the NWPS bbox tested in Phase 0
    bounds: [-97.6, 32.5, -96.3, 33.3],
    maxBounds: [-98.6, 31.9, -95.3, 33.9],
    nwsAlertArea: "TX",
    // Counties used to pick out zone-based alerts (watches, freeze, winter storm) for this metro
    counties: ["Collin", "Dallas", "Denton", "Ellis", "Hood", "Hunt", "Johnson", "Kaufman", "Parker", "Rockwall", "Tarrant", "Wise"],
    refresh: { alertsMs: 2 * 60 * 1000, gaugesMs: 5 * 60 * 1000 },
    // City centers for the "Nearby cities" list in the area panel: [name, lat, lng]
    cities: [
      ["Dallas", 32.7767, -96.797], ["Fort Worth", 32.7555, -97.3308], ["Arlington", 32.7357, -97.1081],
      ["Plano", 33.0198, -96.6989], ["Garland", 32.9126, -96.6389], ["Irving", 32.814, -96.9489],
      ["Grand Prairie", 32.746, -96.9978], ["McKinney", 33.1972, -96.6398], ["Frisco", 33.1507, -96.8236],
      ["Mesquite", 32.7668, -96.5992], ["Denton", 33.2148, -97.1331], ["Carrollton", 32.9756, -96.89],
      ["Richardson", 32.9483, -96.7299], ["Lewisville", 33.0462, -96.9942], ["Allen", 33.1032, -96.6706],
      ["Flower Mound", 33.0146, -97.097], ["Mansfield", 32.5632, -97.1417], ["North Richland Hills", 32.8343, -97.2289],
      ["Rowlett", 32.9029, -96.5639], ["Euless", 32.8371, -97.082], ["Grapevine", 32.9343, -97.0781],
      ["Bedford", 32.844, -97.1431], ["Cedar Hill", 32.5885, -96.9561], ["Wylie", 33.0151, -96.5389],
      ["Sachse", 32.9762, -96.5953], ["Murphy", 33.0151, -96.6131], ["Rockwall", 32.9312, -96.4597],
      ["Lavon", 33.0276, -96.4342], ["Princeton", 33.1801, -96.498], ["Prosper", 33.2362, -96.8011],
      ["Little Elm", 33.1626, -96.9375], ["The Colony", 33.0807, -96.8928], ["Coppell", 32.9546, -97.015],
      ["Farmers Branch", 32.9265, -96.8961], ["Addison", 32.9612, -96.8292], ["Duncanville", 32.6518, -96.9083],
      ["DeSoto", 32.5899, -96.857], ["Lancaster", 32.5921, -96.7561], ["Forney", 32.7482, -96.4719],
      ["Keller", 32.9346, -97.2517], ["Southlake", 32.9412, -97.1342], ["Weatherford", 32.7593, -97.7972],
      ["Burleson", 32.5421, -97.3208], ["Haltom City", 32.7996, -97.2692], ["Hurst", 32.8235, -97.1706],
      ["Benbrook", 32.6732, -97.4606], ["Midlothian", 32.4824, -96.9945], ["Waxahachie", 32.3866, -96.8483],
      ["Terrell", 32.736, -96.2753], ["Fate", 32.9415, -96.3811], ["Royse City", 32.9751, -96.3325],
      ["Celina", 33.3246, -96.7844], ["Anna", 33.349, -96.5486], ["Melissa", 33.2859, -96.5728],
      ["Saginaw", 32.8601, -97.3639], ["Crowley", 32.579, -97.3625], ["Balch Springs", 32.7287, -96.6228],
      ["Seagoville", 32.6393, -96.5383], ["Sunnyvale", 32.7965, -96.5608], ["Heath", 32.8366, -96.475],
      ["Highland Park", 32.8335, -96.792], ["University Park", 32.8501, -96.8003],
    ],
    // Pilot river/lake gauges (NOAA NWPS IDs), verified live Oct 24, 2026
    gauges: [
      { lid: "DALT2", short: "Trinity · Dallas", name: "Trinity River at Dallas", usgs: "08057000" },
      { lid: "FWOT2", short: "West Fork · Fort Worth", name: "West Fork Trinity at Fort Worth" },
      { lid: "GPRT2", short: "West Fork · Grand Prairie", name: "West Fork Trinity at Grand Prairie" },
      { lid: "CART2", short: "Elm Fork · Carrollton", name: "Elm Fork Trinity near Carrollton" },
      { lid: "DWRT2", short: "White Rock Creek", name: "White Rock Creek at Dallas" },
      { lid: "MCKT2", short: "East Fork · McKinney", name: "East Fork Trinity at McKinney" },
      { lid: "SHCT2", short: "Rowlett Creek · Sachse", name: "Rowlett Creek near Sachse" },
      { lid: "LVNT2", short: "Lake Lavon", name: "Lake Lavon", kind: "lake" },
      { lid: "FRHT2", short: "Lake Ray Hubbard", name: "Lake Ray Hubbard", kind: "lake" },
    ],
    transitGtfs: [
      { agency: "DART", url: "http://www.dart.org/transitdata/latest/google_transit.zip" },
      { agency: "Trinity Metro", url: "https://gtfsdata.ridetm.org/gtfs/fwtatransitdata.zip" },
    ],
  },
};

export const DEFAULT_METRO = "dfw";

// Phase 9: the map covers all of Texas. The state block holds what's statewide; REGIONS are
// named areas for the region picker, the "What's coming" city list and the top-bar name.
// `grid`: "ercot" where ERCOT runs the grid, "mixed" where part of the area is on another
// grid, null where none of it is (El Paso is on WECC, the Panhandle and Texarkana on SPP,
// Beaumont on MISO). Region centers are approximate; radius is in km.
export const STATE = {
  id: "tx",
  name: "Texas",
  abbr: "TX",
  fips: "48",
  nwsAlertArea: "TX",
  bounds: [-106.7, 25.8, -93.5, 36.6],
  maxBounds: [-112, 17, -80, 38.5], // wide enough to follow Gulf and eastern Pacific storms toward Texas
  view: { center: [-99.3, 31.3], zoom: 5.4 },
  refresh: { alertsMs: 2 * 60 * 1000, gaugesMs: 5 * 60 * 1000 },
};

export const REGIONS = [
  { id: "dfw", name: "Dallas–Fort Worth", center: [-96.95, 32.85], zoom: 9, radius: 110, grid: "ercot" },
  { id: "houston", name: "Houston", center: [-95.37, 29.76], zoom: 9, radius: 110, grid: "ercot" },
  { id: "san-antonio", name: "San Antonio", center: [-98.49, 29.42], zoom: 9.3, radius: 90, grid: "ercot" },
  { id: "austin", name: "Austin", center: [-97.74, 30.27], zoom: 9.3, radius: 80, grid: "ercot" },
  { id: "el-paso", name: "El Paso", center: [-106.44, 31.76], zoom: 9.5, radius: 100, grid: null },
  { id: "rgv", name: "Rio Grande Valley", center: [-97.9, 26.2], zoom: 9, radius: 100, grid: "ercot" },
  { id: "corpus", name: "Corpus Christi", center: [-97.4, 27.8], zoom: 9.3, radius: 90, grid: "ercot" },
  { id: "laredo", name: "Laredo", center: [-99.5, 27.53], zoom: 9.5, radius: 80, grid: "ercot" },
  { id: "victoria", name: "Victoria", center: [-97.0, 28.8], zoom: 9.5, radius: 80, grid: "ercot" },
  { id: "bcs", name: "Bryan–College Station", center: [-96.33, 30.63], zoom: 9.5, radius: 70, grid: "ercot" },
  { id: "waco", name: "Waco–Killeen", center: [-97.4, 31.3], zoom: 9.2, radius: 90, grid: "ercot" },
  { id: "tyler", name: "Tyler–Longview", center: [-95.0, 32.4], zoom: 9, radius: 100, grid: "mixed" },
  { id: "beaumont", name: "Beaumont–Port Arthur", center: [-94.1, 30.0], zoom: 9.3, radius: 80, grid: null },
  { id: "texarkana", name: "Texarkana", center: [-94.05, 33.43], zoom: 9.5, radius: 70, grid: null },
  { id: "wichita-falls", name: "Wichita Falls", center: [-98.49, 33.91], zoom: 9.5, radius: 80, grid: "ercot" },
  { id: "abilene", name: "Abilene", center: [-99.73, 32.45], zoom: 9.5, radius: 90, grid: "ercot" },
  { id: "san-angelo", name: "San Angelo", center: [-100.44, 31.46], zoom: 9.5, radius: 90, grid: "ercot" },
  { id: "midland", name: "Midland–Odessa", center: [-102.2, 31.9], zoom: 9.3, radius: 110, grid: "ercot" },
  { id: "lubbock", name: "Lubbock", center: [-101.85, 33.58], zoom: 9.5, radius: 100, grid: "mixed" },
  { id: "amarillo", name: "Amarillo and the Panhandle", center: [-101.83, 35.22], zoom: 8.6, radius: 150, grid: null },
];

// Friendlier names for some gauges; any NOAA gauge in the state shows without one.
export const GAUGE_NAMES = Object.fromEntries(METROS.dfw.gauges.map((g) => [g.lid, g]));
