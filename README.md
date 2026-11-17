# Satellite Flare Check

A static web tool for UFO sighting analysis. Enter **where** you were, **when**, and **which way you were looking**. It lists every catalogued orbital object (Starlink, other satellites, rocket bodies, debris), plus the Moon, planets and bright stars, that was in that direction at that moment. For each object it says whether it was sunlit, roughly how bright it was, and whether it had Starlink-style horizon-flare geometry.

It's built to **rule out** satellites for a specific sighting. It does not predict when flares will happen.

## Features

- Sighting-specific: exact start time (to the second), how long it lasted, and ± clock uncertainty, in any time zone. The animation covers the whole sighting (highlighted on the timeline).
- Live use: "Happening now" sets the current time, "Aim with phone" reads heading and elevation from the phone's compass and tilt sensors, and the animation plays along in real time.
- Look direction: heading and elevation with a ± tolerance. Drag the compass or type the numbers; magnetic declination supported. Changing the direction after analysis re-checks instantly, with no re-computation.
- All orbital objects, not just Starlink: all ~16k active satellites, the brightest objects (including big rocket bodies), and optional debris clouds. You can also load any TLE file, including historical data from Space-Track.
- Physics for every object: SGP4 propagation, Earth-shadow test, horizon dip at altitude (pilots), refraction, atmospheric extinction, diffuse brightness by phase angle.
- Horizon-flare model for Earth-facing flat-panel satellites (Starlink, OneWeb, Kuiper, Qianfan, Guowang, BlueBird): specular reflection of the Sun off the underside, with a "flare angle" (how close the reflection came to your eye) and estimated flare magnitude.
- Natural objects: Moon, Mercury–Saturn and ~60 bright stars, all common UFO misidentifications.
- Animated "view along your heading" and an all-sky map, a sortable results table, a copyable text report and shareable case links.

## Files

```
index.html        page + "How this works" dialog
css/style.css
js/astro.js       Sun, Moon, planets, stars, observer frames, refraction, extinction
js/catalog.js     CelesTrak download + IndexedDB cache, TLE parsing, object classification
js/engine.js      propagation, shadow, brightness, flare geometry, field-of-view summary
js/views.js       canvas renderers (horizon view, sky dome / compass)
js/app.js         UI wiring, share links, iframe auto-height
```

No build step. Plain HTML/JS, with satellite.js (MIT) loaded from jsDelivr.

## Run locally

```bash
python -m http.server 8765
```

Then open http://localhost:8765. Opening `index.html` directly as a file also mostly works, but the location button and caching need http.

## Deploy to GitHub Pages

Live at **https://spocktology.github.io/satellite-flare-check/**

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. The workflow in `.github/workflows/deploy.yml` deploys the site on every push to `main` and every 3 hours. Each run downloads fresh CelesTrak data into `data/` (via `scripts/fetch_tle.py`) and publishes it with the site.
3. To redeploy by hand: **Actions → Deploy site with fresh satellite data → Run workflow**.

If `SITE_URL` in the workflow changes (e.g. a custom domain), update it so the fetch script can reuse the previous copy when CelesTrak refuses a download.

## Embed on UFOwizard.com

```html
<iframe id="flarecheck"
        src="https://<your-user>.github.io/flare-check/"
        style="width:100%; height:2200px; border:0;"
        allow="geolocation; clipboard-write; accelerometer; gyroscope; magnetometer"
        title="Satellite Flare Check"></iframe>
<script>
  (function () {
    var f = document.getElementById('flarecheck');
    // Pass case links (yourpage#lat=...&t=...) through to the tool
    if (location.hash.length > 1) f.src = f.src.split('#')[0] + location.hash;
    // Auto-size the iframe to the tool's content
    window.addEventListener('message', function (e) {
      if (e.origin === 'https://<your-user>.github.io' && e.data && e.data.type === 'flarecheck-height') {
        f.style.height = e.data.height + 'px';
      }
    });
  })();
</script>
```

- `allow="geolocation"` is needed for the "use my location" button inside an iframe, and `accelerometer; gyroscope; magnetometer` for "Aim with phone".
- To make **Copy link to this case** point at your UFOwizard page instead of github.io, set `SHARE_BASE` at the top of `js/app.js`, e.g. `const SHARE_BASE = 'https://ufowizard.com/tools/flare-check';`. The snippet above forwards the `#…` part into the iframe.

## Data sources and etiquette

- **CelesTrak** (orbital elements): a GitHub Action downloads them every 3 hours and publishes them with the site (`data/`), so visitors never hit CelesTrak's limit of one download per group every 2 hours per internet connection. If the site copy is missing or over 6 hours old, the browser falls back to CelesTrak directly. If data still fails to load, the result says **"Check incomplete"** instead of giving a false all-clear.
- **Nominatim / OpenStreetMap** (place search): fine for light use (max ~1 request/second). If the tool gets heavy traffic, switch to a paid geocoder or self-host.
- **Daily archive** (built from the CelesTrak mirror, starting 2026-11-17): once per UTC day, the workflow saves a compressed snapshot of every mirrored object (~19k objects, ~1 MB) to the `history` branch, as `YYYY/YYYY-MM-DD.tle.gz` plus `index.json`. For sightings more than 2 days old, the app loads the snapshots around the sighting date from `raw.githubusercontent.com`. It also leaves out objects missing from that day's archive, which were not yet launched or had already re-entered. The archive grows by roughly 400 MB per year; past ~1 GB, move older years to a separate repo.
- **Space-Track** (historical / full catalogue): requires a free account. For sightings before the archive starts, users download a TLE file and load it in the page. Instructions are in the in-app help. Space-Track's user agreement restricts redistributing its data, so Space-Track history is **not** republished on this site.

## Accuracy and limitations

- Current orbital data is accurate to roughly a few days either side of its epoch. For older sightings, load historical element sets; the tool warns when the data is too far from the sighting date.
- The free CelesTrak groups don't include every rocket body and piece of debris. A full Space-Track file closes that gap.
- Brightness and flare magnitudes are estimates (typical sizes, assumed reflectivity). Attitude of tumbling objects is unknown, so they're flagged as "possible flash sources" rather than predicted.
- Aircraft, balloons and drones are not included.

## Possible next steps

- A tiny server-side proxy (e.g. Cloudflare Worker) holding a Space-Track account, to fetch historical data automatically for any date.
- Historical ADS-B aircraft positions (requires a paid data source).
- Auto time zone from location.

Credits: flare concept inspired by Mick West's Sitrec / Metabunk horizon-flare analysis. Orbit propagation by [satellite.js](https://github.com/shashwatak/satellite-js) (MIT).
