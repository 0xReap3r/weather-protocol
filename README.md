# StormFront

A free, live severe-weather situational map for Texas — official data first, neighbor reports fill the
gaps. Built as a community page for Texans: no accounts, no paywall, funded by voluntary donations.
Started as a Dallas–Fort Worth pilot; now covers the whole state. See `CLAUDE.md` for the maintained,
up-to-date project notes — this file covers only the basics of running and deploying it.

## Run it locally

No build step. Any static server works:

```bash
cd stormline
npx serve .          # or: python3 -m http.server 8080
```

Open the URL it prints. Use `localhost` (not a file:// path) so the service worker and Near me work.

To test on your phone, open the same URL on your Wi-Fi using your computer's local IP, or deploy (below). Near me needs HTTPS on a phone.

## Deploy free

- **Cloudflare Pages:** connect the GitHub repo, framework preset "None", output directory `/`.
- **Firebase Hosting:** `npx firebase-tools init hosting` (public dir `.`), then `npx firebase-tools deploy`.
- **GitHub Pages:** Settings → Pages → deploy from `main` branch root.

## Rename the app

Change `APP.name` in `js/config.js`, plus `name`/`short_name` in `manifest.webmanifest` and `<title>` in `index.html`.

## Add a metro

Add an entry to `METROS` in `js/config.js` (center, bounds, gauge IDs, transit feeds). No other code changes.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page structure |
| `css/app.css` | Dark map UI |
| `js/config.js` | App name, basemap, metro config (DFW gauges verified Oct 24, 2026) |
| `js/layers.js` | Layer registry — chips, labels, sources, which phase connects each |
| `js/app.js` | Map, chips, status badge, Near me, sheets, pulse animation, install prompt |
| `js/near.js` | "Near you" area panel |
| `js/data/*.js` | Data sources: NWS alerts, NWPS gauges, Open-Meteo rain, shared fetch |
| `sw.js` | Offline app shell (live data is never cached) |
| `manifest.webmanifest` | Install-as-app settings |

## Data sources (all free)

NWS alerts · NOAA NWPS gauges · USGS Water Data API · NOAA SPC outlooks · IEM radar tiles · FEMA flood zones · ERCOT grid status · DART / Trinity Metro static GTFS · community reports.

Basemap: CARTO Dark Matter (free for low volume; check terms before scaling). Fully open alternative is in `js/config.js`.

## Safety

Not an official warning service. The app never says a road is "safe," shows timestamps on every reading, and points to 911 and NWS warnings.
