/* engine.js — propagates every catalogued object around the sighting time and
 * works out where each one was, whether it was sunlit, how bright it could be,
 * and whether it had flare (specular glint) geometry toward the observer. */
(function (global) {
  'use strict';
  const { D2R, R2D } = Astro;

  // Field layout of the per-object frame buffer
  const F = 7, AZ = 0, EL = 1, RNG = 2, FLG = 3, GLINT = 4, MAG = 5, PHASE = 6;
  const LIT = 1, UP = 2;
  const R_SHADOW = 6371 + 15;       // effective Earth-shadow radius (km)
  // Specular "flare" model for a flat Earth-facing panel: reflected sunlight is
  // spread into a Gaussian lobe of width FLARE_SIGMA around the mirror direction.
  // Flux ratio to the Sun = rho * A_projected * lobe / (Omega * r^2).
  const FLARE_SIGMA = 2.5;          // glint lobe width (deg) — panels aren't perfect mirrors
  const FLARE_RHO = 0.15;           // effective specular reflectivity
  const OMEGA = 2 * Math.PI * (FLARE_SIGMA * D2R) ** 2;
  const SUN_MAG = -26.74;

  const tick = () => new Promise((r) => setTimeout(r, 0));

  function frameSun(obs, ms) {
    const g = Astro.gmst(ms);
    const s = Astro.eciToEcf(Astro.sunEci(ms), g);
    const len = Math.hypot(s.x, s.y, s.z);
    const t = Astro.topo(obs, s);
    return { g, cg: Math.cos(g), sg: Math.sin(g), u: { x: s.x / len, y: s.y / len, z: s.z / len }, az: t.az, el: t.el + Astro.refraction(t.el, obs) };
  }

  function bodiesAt(obs, ms, g) {
    const out = [];
    const app = (t) => ({ az: t.az, el: t.el + Astro.refraction(t.el, obs) });
    const sun = Astro.eciToEcf(Astro.sunEci(ms), g);
    const moonE = Astro.eciToEcf(Astro.moonEci(ms), g);
    const mt = Astro.topo(obs, moonE);
    // Moon phase angle (sun–moon–observer) for magnitude
    const ms_ = { x: sun.x - moonE.x, y: sun.y - moonE.y, z: sun.z - moonE.z };
    const mo = { x: obs.ecf.x - moonE.x, y: obs.ecf.y - moonE.y, z: obs.ecf.z - moonE.z };
    const ci = (ms_.x * mo.x + ms_.y * mo.y + ms_.z * mo.z) / (Math.hypot(ms_.x, ms_.y, ms_.z) * Math.hypot(mo.x, mo.y, mo.z));
    const i = Math.acos(Math.max(-1, Math.min(1, ci))) * R2D;
    out.push(Object.assign({ name: 'Moon', kind: 'moon', mag: -12.73 + 0.026 * i + 4e-9 * i ** 4, illum: (1 + Math.cos(i * D2R)) / 2 }, app(mt)));
    for (const p of Astro.planetsEci(ms)) {
      const t = Astro.topo(obs, Astro.eciToEcf(p.eci, g));
      out.push(Object.assign({ name: p.name, kind: 'planet', mag: p.mag }, app(t)));
    }
    return out;
  }

  function starsAt(obs, ms, g) {
    return Astro.starsEci(ms).map((s) => {
      const t = Astro.topoDir(obs, Astro.eciToEcf(s.eci, g));
      return { name: s.name, kind: 'star', mag: s.mag, az: t.az, el: t.el + Astro.refraction(t.el, obs) };
    });
  }

  function ecfOf(pos, cg, sg) {
    return { x: pos.x * cg + pos.y * sg, y: -pos.x * sg + pos.y * cg, z: pos.z };
  }

  /**
   * cfg: { records, lat, lon, altKm, t0 (ms, sighting start), durSec (sighting length), padSec (± clock uncertainty) }
   * The analysed span runs from t0 − pad to t0 + duration + pad.
   * progress(fraction, text)
   */
  async function analyze(cfg, progress = () => {}) {
    const { records, lat, lon, altKm, t0 } = cfg;
    const durSec = Math.max(0, cfg.durSec || 0), padSec = Math.max(0, cfg.padSec || 0);
    const spanSec = durSec + 2 * padSec;
    const obs = Astro.makeObserver(lat, lon, altKm);
    const minEl = -obs.dip - 0.3;

    // ---- coarse pass: which objects get anywhere near the observer's sky? ----
    const cStep = Math.max(20, Math.ceil(spanSec / 45));
    const cT = [];
    for (let t = t0 - (padSec + cStep) * 1000; t <= t0 + (durSec + padSec + cStep) * 1000; t += cStep * 1000) {
      const g = Astro.gmst(t);
      cT.push({ d: new Date(t), cg: Math.cos(g), sg: Math.sin(g) });
    }
    const candidates = [];
    const CH = 400;
    let failed = 0;
    for (let i = 0; i < records.length; i += CH) {
      const end = Math.min(records.length, i + CH);
      for (let j = i; j < end; j++) {
        const r = records[j];
        let hit = false, ok = false;
        for (const c of cT) {
          let pv;
          try { pv = satellite.propagate(r.satrec, c.d); } catch { pv = null; }
          if (!pv || !pv.position) continue;
          ok = true;
          const t = Astro.topo(obs, ecfOf(pv.position, c.cg, c.sg));
          if (t.el > minEl - 12) { hit = true; break; }
        }
        if (!ok) failed++;
        if (hit) candidates.push(r);
      }
      progress((end / records.length) * 0.6, `Scanning ${end.toLocaleString()} / ${records.length.toLocaleString()} objects…`);
      await tick();
    }

    // ---- fine pass on candidates ----
    // Frames are aligned so the sighting start (K) and end (KE) fall on frames.
    const fStep = Math.max(2, Math.ceil(spanSec / 360));
    const K = Math.ceil(padSec / fStep);
    const KE = K + Math.ceil(durSec / fStep);
    const nF = KE + Math.ceil(padSec / fStep) + 1;
    const times = new Float64Array(nF);
    const sun = [], bodies = [], stars = [];
    for (let k = 0; k < nF; k++) {
      const t = t0 + (k - K) * fStep * 1000;
      times[k] = t;
      const s = frameSun(obs, t);
      sun.push(s);
      bodies.push(bodiesAt(obs, t, s.g));
      if (k % 10 === 0 || k === nF - 1) stars[k] = starsAt(obs, t, s.g);
    }
    // fill star frames (they barely move over a few minutes)
    for (let k = 0; k < nF; k++) if (!stars[k]) stars[k] = stars[k - (k % 10)];

    const objs = [];
    for (let i = 0; i < candidates.length; i += 100) {
      const end = Math.min(candidates.length, i + 100);
      for (let j = i; j < end; j++) {
        const r = candidates[j];
        const buf = new Float32Array(nF * F);
        let anyUp = false;
        for (let k = 0; k < nF; k++) {
          const o = k * F;
          let pv;
          try { pv = satellite.propagate(r.satrec, new Date(times[k])); } catch { pv = null; }
          if (!pv || !pv.position) { buf[o + EL] = -90; buf[o + MAG] = 99; buf[o + GLINT] = 180; continue; }
          const S = sun[k];
          const p = ecfOf(pv.position, S.cg, S.sg);
          const tp = Astro.topo(obs, p);
          const elApp = tp.el + (tp.el > minEl - 3 ? Astro.refraction(tp.el, obs) : 0);
          let flags = 0;
          if (elApp > minEl) { flags |= UP; anyUp = true; }

          // Earth shadow (cylinder with soft edge)
          const u = S.u;
          const dot = p.x * u.x + p.y * u.y + p.z * u.z;
          const pr = Math.hypot(p.x, p.y, p.z);
          let frac = 1;
          if (dot < 0) {
            const perp = Math.sqrt(Math.max(0, pr * pr - dot * dot));
            frac = Math.max(0, Math.min(1, (perp - (R_SHADOW - 30)) / 60));
          }
          if (frac > 0.05) flags |= LIT;

          // Unit vector satellite -> observer
          const v = { x: (obs.ecf.x - p.x) / tp.range, y: (obs.ecf.y - p.y) / tp.range, z: (obs.ecf.z - p.z) / tp.range };
          const cphi = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z));
          const phi = Math.acos(cphi);

          // Earth-facing flat panel glint (Starlink-style "horizon flare")
          let glint = 180;
          const n = { x: -p.x / pr, y: -p.y / pr, z: -p.z / pr };
          const sn = u.x * n.x + u.y * n.y + u.z * n.z;
          if (sn > 0) {
            const rx = 2 * sn * n.x - u.x, ry = 2 * sn * n.y - u.y, rz = 2 * sn * n.z - u.z;
            glint = Math.acos(Math.max(-1, Math.min(1, rx * v.x + ry * v.y + rz * v.z))) * R2D;
          }

          let mag = 99;
          if (flags & LIT) {
            // diffuse (Lambertian) brightness, as a flux relative to mag 0
            let flux = Math.pow(10, -0.4 * (r.M0 + 5 * Math.log10(tp.range / 1000) - 2.5 * Math.log10(Astro.phaseFn(phi))));
            if (r.nadirPanel && glint < 20) {
              const lobe = Math.exp(-(glint * glint) / (2 * FLARE_SIGMA * FLARE_SIGMA));
              const rM = tp.range * 1000;
              const ratio = (FLARE_RHO * r.panelArea * sn * lobe) / (OMEGA * rM * rM);
              flux += Math.pow(10, -0.4 * SUN_MAG) * ratio;
            }
            mag = -2.5 * Math.log10(flux) + Astro.extinction(elApp, obs) - 2.5 * Math.log10(frac);
          }
          buf[o + AZ] = tp.az; buf[o + EL] = elApp; buf[o + RNG] = tp.range; buf[o + FLG] = flags;
          buf[o + GLINT] = glint; buf[o + MAG] = mag; buf[o + PHASE] = phi * R2D;
        }
        if (anyUp) objs.push({ rec: r, buf });
      }
      progress(0.6 + (end / Math.max(1, candidates.length)) * 0.4, `Tracing ${end} / ${candidates.length} nearby objects…`);
      await tick();
    }

    return { obs, minEl, t0, durSec, padSec, fStep, K, KE, nF, times, sun, bodies, stars, objs, total: records.length, failed };
  }

  // Angular separation (deg) between two az/el directions
  function sep(az1, el1, az2, el2) {
    const a = el1 * D2R, b = el2 * D2R, d = (az1 - az2) * D2R;
    const c = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(d);
    return Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
  }

  function sepLook(look, az, el) {
    if (look.el == null) return Math.abs(Astro.wrap180(az - look.az));
    return sep(az, el, look.az, look.el);
  }

  // Faintest magnitude that the sky allows (twilight washes out faint objects)
  function skyLimit(sunEl) {
    if (sunEl > 0) return -3;
    if (sunEl > -6) return 1.5;
    if (sunEl > -12) return 4;
    return 99;
  }

  /** Classify every traced object against the look direction. Fast — re-run on every heading drag. */
  function summarize(res, look, magLimitUser) {
    const { nF, K, objs, minEl } = res;
    const KE = res.KE != null ? res.KE : K;
    const out = [];
    const sunEl0 = res.sun[K].el;
    // use the darkest sky during the sighting for the detection limit
    let sunMin = sunEl0;
    for (let k = K; k <= KE; k++) sunMin = Math.min(sunMin, res.sun[k].el);
    const lim = Math.min(magLimitUser, skyLimit(sunMin));
    for (const o of objs) {
      const b = o.buf;
      let minS = 999, minK = -1, inFov = 0, litFov = 0, best = 99, bestK = -1, minG = 180, minGK = -1, first = -1, last = -1;
      let during = false, durBest = 99, durK = -1;
      for (let k = 0; k < nF; k++) {
        const i = k * F;
        if (!(b[i + FLG] & UP)) continue;
        const s = sepLook(look, b[i + AZ], b[i + EL]);
        if (s < minS) { minS = s; minK = k; }
        if (s <= look.tol) {
          inFov++;
          if (first < 0) first = k;
          last = k;
          if (b[i + FLG] & LIT) {
            litFov++;
            if (b[i + MAG] < best) { best = b[i + MAG]; bestK = k; }
            if (k >= K && k <= KE && b[i + MAG] <= lim) {
              during = true;
              if (b[i + MAG] < durBest) { durBest = b[i + MAG]; durK = k; }
            }
            if (o.rec.nadirPanel && b[i + GLINT] < minG) { minG = b[i + GLINT]; minGK = k; }
          }
        }
      }
      let cat = 'outside';
      if (inFov) cat = litFov ? (best <= lim ? 'visible' : 'faint') : 'shadow';
      const i0 = K * F;
      out.push({
        o, cat, minSep: minS, minK, inFov, litFov, best, bestK, minGlint: minG, minGK, first, last, during, durBest, durK,
        flare: litFov > 0 && minG <= 6,
        at0: { up: !!(b[i0 + FLG] & UP), lit: !!(b[i0 + FLG] & LIT), az: b[i0 + AZ], el: b[i0 + EL], mag: b[i0 + MAG],
          inFov: !!(b[i0 + FLG] & UP) && sepLook(look, b[i0 + AZ], b[i0 + EL]) <= look.tol },
      });
    }
    const rank = { visible: 0, faint: 1, shadow: 2, outside: 3 };
    out.sort((a, b) => rank[a.cat] - rank[b.cat] || (a.flare === b.flare ? 0 : a.flare ? -1 : 1) || a.best - b.best || a.minSep - b.minSep);

    // Moon / planets / stars inside the view at any point during the sighting
    const cel = new Map();
    for (let k = K; k <= KE; k += Math.max(1, Math.floor((KE - K) / 30)) || 1) {
      for (const b of res.bodies[k].concat(res.stars[k])) {
        if (b.el < minEl) continue;
        const s = sepLook(look, b.az, b.el);
        if (s > look.tol || (b.kind === 'star' && b.mag > Math.min(lim, 2.5))) continue;
        const cur = cel.get(b.name);
        if (!cur || s < cur.sep) cel.set(b.name, Object.assign({ sep: s, k }, b));
      }
      if (KE === K) break;
    }
    const celestial = [...cel.values()].sort((a, b) => a.mag - b.mag);
    return { list: out, celestial, lim, sunEl: sunEl0, sunMin };
  }

  global.Engine = { analyze, summarize, sep, sepLook, skyLimit, F, AZ, EL, RNG, FLG, GLINT, MAG, PHASE, LIT, UP };
})(window);
