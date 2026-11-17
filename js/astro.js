/* astro.js — Sun, Moon, planets, bright stars, observer frames, refraction.
 * Low-precision formulas (Astronomical Almanac / JPL "approximate positions of
 * the planets"). Accuracy ~0.01–0.3°, plenty for sighting analysis.
 * All "ECI" vectors here are equatorial-of-date in km; ECF = Earth-fixed.
 */
(function (global) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const RE = 6378.137, RE_MEAN = 6371.0, F_WGS = 1 / 298.257223563;
  const AU = 149597870.7;

  const jd = (ms) => ms / 86400000 + 2440587.5;
  const norm360 = (x) => ((x % 360) + 360) % 360;
  const wrap180 = (x) => { x = norm360(x); return x > 180 ? x - 360 : x; };

  // Greenwich mean sidereal time (radians), IAU 1982 — same as SGP4 uses.
  function gmst(ms) {
    const tut1 = (jd(ms) - 2451545.0) / 36525.0;
    let t = -6.2e-6 * tut1 ** 3 + 0.093104 * tut1 ** 2 +
      (876600.0 * 3600 + 8640184.812866) * tut1 + 67310.54841;
    t = ((t * D2R) / 240.0) % (2 * Math.PI);
    return t < 0 ? t + 2 * Math.PI : t;
  }

  function eciToEcf(v, g) {
    const c = Math.cos(g), s = Math.sin(g);
    return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c, z: v.z };
  }

  // Observer: geodetic WGS84 -> ECF + local ENU basis
  function makeObserver(latDeg, lonDeg, altKm) {
    const lat = latDeg * D2R, lon = lonDeg * D2R;
    const e2 = F_WGS * (2 - F_WGS);
    const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
    const N = RE / Math.sqrt(1 - e2 * sl * sl);
    const ecf = { x: (N + altKm) * cl * co, y: (N + altKm) * cl * so, z: (N * (1 - e2) + altKm) * sl };
    const dip = Math.acos(RE_MEAN / (RE_MEAN + Math.max(0, altKm))) * R2D;
    return {
      lat: latDeg, lon: lonDeg, altKm, ecf, dip,
      e: { x: -so, y: co, z: 0 },
      n: { x: -sl * co, y: -sl * so, z: cl },
      u: { x: cl * co, y: cl * so, z: sl },
      pressure: Math.exp(-altKm / 8.4),
    };
  }

  // Topocentric az/el (geometric, degrees) + range (km) of an ECF point
  function topo(obs, p) {
    const dx = p.x - obs.ecf.x, dy = p.y - obs.ecf.y, dz = p.z - obs.ecf.z;
    const E = dx * obs.e.x + dy * obs.e.y + dz * obs.e.z;
    const N = dx * obs.n.x + dy * obs.n.y + dz * obs.n.z;
    const U = dx * obs.u.x + dy * obs.u.y + dz * obs.u.z;
    const h = Math.hypot(E, N);
    return { az: norm360(Math.atan2(E, N) * R2D), el: Math.atan2(U, h) * R2D, range: Math.hypot(h, U) };
  }

  // Topocentric for a direction only (very distant: stars)
  function topoDir(obs, d) {
    const E = d.x * obs.e.x + d.y * obs.e.y + d.z * obs.e.z;
    const N = d.x * obs.n.x + d.y * obs.n.y + d.z * obs.n.z;
    const U = d.x * obs.u.x + d.y * obs.u.y + d.z * obs.u.z;
    return { az: norm360(Math.atan2(E, N) * R2D), el: Math.atan2(U, Math.hypot(E, N)) * R2D };
  }

  // Atmospheric refraction (degrees) for a true elevation, scaled for observer pressure
  function refraction(elDeg, obs) {
    const h = Math.max(elDeg, -0.9);
    if (h > 89.9) return 0;
    const Rarcmin = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R);
    return Math.max(0, Rarcmin / 60) * (obs ? obs.pressure : 1);
  }

  // ---------- Sun ----------
  function sunEci(ms) {
    const n = jd(ms) - 2451545.0;
    const L = norm360(280.460 + 0.9856474 * n), g = norm360(357.528 + 0.9856003 * n) * D2R;
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
    const eps = (23.439 - 0.0000004 * n) * D2R;
    const R = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU;
    return { x: R * Math.cos(lam), y: R * Math.cos(eps) * Math.sin(lam), z: R * Math.sin(eps) * Math.sin(lam) };
  }

  // ---------- Moon ----------
  function moonEci(ms) {
    const T = (jd(ms) - 2451545.0) / 36525;
    const s = (x) => Math.sin(x * D2R), c = (x) => Math.cos(x * D2R);
    const lam = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) +
      0.66 * s(235.7 + 890534.22 * T) + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T) -
      0.11 * s(186.5 + 966404.03 * T);
    const bet = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) - 0.28 * s(318.3 + 6003.15 * T) -
      0.17 * s(217.6 - 407332.21 * T);
    const par = 0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T) +
      0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T);
    const r = RE / Math.sin(par * D2R);
    return eclToEq(r, lam * D2R, bet * D2R, (23.439 - 0.013 * T) * D2R);
  }

  function eclToEq(r, l, b, e) {
    const cb = Math.cos(b);
    return {
      x: r * cb * Math.cos(l),
      y: r * (Math.cos(e) * cb * Math.sin(l) - Math.sin(e) * Math.sin(b)),
      z: r * (Math.sin(e) * cb * Math.sin(l) + Math.cos(e) * Math.sin(b)),
    };
  }

  // ---------- Planets (JPL approximate elements, 1800–2050) ----------
  const EL = {
    mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,
      0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    venus: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
      0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
    earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
      0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
    mars: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
      0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
      -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
      -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  };

  function helio(name, T) {
    const k = EL[name];
    const a = k[0] + k[6] * T, e = k[1] + k[7] * T, I = (k[2] + k[8] * T) * D2R;
    const L = k[3] + k[9] * T, wb = k[4] + k[10] * T, Om = k[5] + k[11] * T;
    const w = (wb - Om) * D2R, O = Om * D2R;
    const M = wrap180(L - wb) * D2R;
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
    return {
      x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      z: sw * sI * xp + cw * sI * yp,
    };
  }

  // J2000 ecliptic cartesian -> equatorial of date, with precession in longitude
  function eclJ2000ToEqDate(v, T, scale) {
    const r = Math.hypot(v.x, v.y, v.z);
    const l = Math.atan2(v.y, v.x) + 1.396971 * T * D2R;
    const b = Math.asin(v.z / r);
    return eclToEq(r * scale, l, b, (23.439291 - 0.0130042 * T) * D2R);
  }

  const PLANET_MAG = {
    mercury: (r, d, i) => -0.42 + 5 * Math.log10(r * d) + 0.038 * i - 0.000273 * i * i + 0.000002 * i ** 3,
    venus: (r, d, i) => -4.40 + 5 * Math.log10(r * d) + 0.0009 * i + 0.000239 * i * i - 0.00000065 * i ** 3,
    mars: (r, d, i) => -1.52 + 5 * Math.log10(r * d) + 0.016 * i,
    jupiter: (r, d, i) => -9.40 + 5 * Math.log10(r * d) + 0.005 * i,
    saturn: (r, d, i) => -8.88 + 5 * Math.log10(r * d),
  };

  function planetsEci(ms) {
    const T = (jd(ms) - 2451545.0) / 36525;
    const earth = helio('earth', T);
    const out = [];
    for (const name of ['mercury', 'venus', 'mars', 'jupiter', 'saturn']) {
      const p = helio(name, T);
      const g = { x: p.x - earth.x, y: p.y - earth.y, z: p.z - earth.z };
      const r = Math.hypot(p.x, p.y, p.z), d = Math.hypot(g.x, g.y, g.z), re = Math.hypot(earth.x, earth.y, earth.z);
      const i = Math.acos(Math.max(-1, Math.min(1, (r * r + d * d - re * re) / (2 * r * d)))) * R2D;
      out.push({ name: name[0].toUpperCase() + name.slice(1), eci: eclJ2000ToEqDate(g, T, AU), mag: PLANET_MAG[name](r, d, i) });
    }
    return out;
  }

  // ---------- Bright stars (J2000 RA hours, Dec deg, V mag) ----------
  const STARS = [
    ['Sirius', 6.7525, -16.716, -1.46], ['Canopus', 6.3992, -52.696, -0.74], ['Rigil Kent.', 14.6600, -60.834, -0.27],
    ['Arcturus', 14.2610, 19.182, -0.05], ['Vega', 18.6156, 38.784, 0.03], ['Capella', 5.2782, 45.998, 0.08],
    ['Rigel', 5.2423, -8.202, 0.13], ['Procyon', 7.6550, 5.225, 0.34], ['Achernar', 1.6286, -57.237, 0.46],
    ['Betelgeuse', 5.9195, 7.407, 0.5], ['Hadar', 14.0637, -60.373, 0.61], ['Altair', 19.8464, 8.868, 0.76],
    ['Acrux', 12.4433, -63.099, 0.76], ['Aldebaran', 4.5987, 16.509, 0.86], ['Antares', 16.4901, -26.432, 0.96],
    ['Spica', 13.4199, -11.161, 0.97], ['Pollux', 7.7553, 28.026, 1.14], ['Fomalhaut', 22.9608, -29.622, 1.16],
    ['Deneb', 20.6905, 45.280, 1.25], ['Mimosa', 12.7954, -59.689, 1.25], ['Regulus', 10.1395, 11.967, 1.35],
    ['Adhara', 6.9771, -28.972, 1.5], ['Castor', 7.5767, 31.888, 1.58], ['Shaula', 17.5601, -37.104, 1.62],
    ['Gacrux', 12.5194, -57.113, 1.63], ['Bellatrix', 5.4189, 6.350, 1.64], ['Elnath', 5.4382, 28.608, 1.65],
    ['Miaplacidus', 9.2200, -69.717, 1.67], ['Alnilam', 5.6036, -1.202, 1.69], ['Alnair', 22.1372, -46.961, 1.73],
    ['Alnitak', 5.6793, -1.943, 1.77], ['Alioth', 12.9005, 55.960, 1.77], ['Dubhe', 11.0621, 61.751, 1.79],
    ['Mirfak', 3.4054, 49.861, 1.79], ['Wezen', 7.1399, -26.393, 1.83], ['Alkaid', 13.7923, 49.313, 1.86],
    ['Menkalinan', 5.9921, 44.948, 1.9], ['Alhena', 6.6285, 16.399, 1.93], ['Peacock', 20.4275, -56.735, 1.94],
    ['Polaris', 2.5302, 89.264, 1.98], ['Mirzam', 6.3783, -17.956, 1.98], ['Alphard', 9.4598, -8.659, 1.99],
    ['Hamal', 2.1196, 23.463, 2.0], ['Diphda', 0.7265, -17.987, 2.04], ['Nunki', 18.9211, -26.297, 2.05],
    ['Denebola', 11.8177, 14.572, 2.14], ['Alpheratz', 0.1398, 29.090, 2.06], ['Mirach', 1.1622, 35.621, 2.05],
    ['Kochab', 14.8451, 74.156, 2.08], ['Rasalhague', 17.5822, 12.560, 2.08], ['Algol', 3.1361, 40.956, 2.1],
    ['Almach', 2.0650, 42.330, 2.1], ['Schedar', 0.6751, 56.537, 2.24], ['Eltanin', 17.9434, 51.489, 2.23],
    ['Caph', 0.1530, 59.150, 2.28], ['Markab', 23.0793, 15.205, 2.49], ['Enif', 21.7364, 9.875, 2.39],
    ['Scheat', 23.0629, 28.083, 2.42], ['Menkar', 3.0380, 4.090, 2.54], ['Zubeneschamali', 15.2834, -9.383, 2.61],
  ];
  const EPS0 = 23.439291 * D2R;
  // Precompute J2000 ecliptic unit vectors for stars
  const STAR_ECL = STARS.map(([name, ra, dec, mag]) => {
    const a = ra * 15 * D2R, d = dec * D2R;
    const x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
    // equatorial -> ecliptic (J2000)
    return { name, mag, v: { x, y: Math.cos(EPS0) * y + Math.sin(EPS0) * z, z: -Math.sin(EPS0) * y + Math.cos(EPS0) * z } };
  });
  function starsEci(ms) {
    const T = (jd(ms) - 2451545.0) / 36525;
    return STAR_ECL.map((s) => ({ name: s.name, mag: s.mag, eci: eclJ2000ToEqDate(s.v, T, 1) }));
  }

  // Lambertian sphere phase function, normalised to 1 at 90°
  function phaseFn(phiRad) {
    return Math.max(1e-4, Math.sin(phiRad) + (Math.PI - phiRad) * Math.cos(phiRad));
  }

  // Extinction (mag) at apparent elevation for the observer's altitude
  function extinction(elDeg, obs) {
    const h = Math.max(elDeg, 0) * D2R;
    const X = 1 / (Math.sin(h) + 0.025 * Math.exp(-11 * Math.sin(h)));
    return 0.25 * X * (obs ? obs.pressure : 1);
  }

  function twilightName(sunEl) {
    if (sunEl > 0) return 'daytime';
    if (sunEl > -6) return 'civil twilight';
    if (sunEl > -12) return 'nautical twilight';
    if (sunEl > -18) return 'astronomical twilight';
    return 'full night';
  }

  global.Astro = {
    D2R, R2D, RE, RE_MEAN, AU, jd, norm360, wrap180, gmst, eciToEcf, makeObserver, topo, topoDir,
    refraction, sunEci, moonEci, planetsEci, starsEci, phaseFn, extinction, twilightName,
  };
})(window);
