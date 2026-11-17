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

1. Create a repo (e.g. `flare-check`), push these files to `main`.
2. Repo **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. The tool will be at `https://<your-user>.github.io/flare-check/`.

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

- **CelesTrak** (orbital elements): fetched directly by each visitor's browser and cached for 2 hours in IndexedDB, per CelesTrak's request not to re-download faster than they update.
- **Nominatim / OpenStreetMap** (place search): fine for light use (max ~1 request/second). If the tool gets heavy traffic, switch to a paid geocoder or self-host.
- **Space-Track** (historical / full catalogue): requires a free account. Users download a TLE file and load it in the page. Instructions are in the in-app help.

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
