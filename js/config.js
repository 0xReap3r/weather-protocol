// App + metro configuration.
// Renaming the app later = change APP.name here (and in manifest.webmanifest + index.html <title>).
// Adding a metro later = add another entry to METROS. No other code changes needed.

export const APP = {
  name: "Stormline",            // working name — final name TBD
  tagline: "What's happening on your block",
  disclaimer:
    "Not an official warning service. Follow National Weather Service warnings and local officials. Turn around, don't drown.",
  // Free basemap. CARTO Dark Matter is free for low-volume / non-commercial use (check terms before scaling).
  // Fully open alternative: "https://tiles.openfreemap.org/styles/liberty"
  basemapStyle: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
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
