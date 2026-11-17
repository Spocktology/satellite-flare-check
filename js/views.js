/* views.js — canvas renderers: the all-sky compass dome and the horizon view. */
(function (global) {
  'use strict';
  const { D2R, R2D, wrap180, norm360 } = Astro;
  const E = Engine;

  const COL = {
    flare: '#ff8a3d', visible: '#ffd36b', faint: '#b9c6e6', lit: '#dfe7ff', shadow: '#55648a',
    fov: '#7cc4ff', needle: '#ffb547', grid: 'rgba(140,165,220,0.18)', text: '#9fb0d6', sun: '#ffcc33', planet: '#ffe9b3',
  };

  // Interpolated state of an object at fractional frame fk
  function at(buf, fk, nF) {
    const k0 = Math.max(0, Math.min(nF - 1, Math.floor(fk)));
    const k1 = Math.min(nF - 1, k0 + 1), f = fk - k0;
    const a = k0 * E.F, b = k1 * E.F;
    const daz = wrap180(buf[b + E.AZ] - buf[a + E.AZ]);
    const near = f < 0.5 ? a : b;
    return {
      az: norm360(buf[a + E.AZ] + daz * f), el: buf[a + E.EL] + (buf[b + E.EL] - buf[a + E.EL]) * f,
      mag: Math.min(buf[a + E.MAG], 99) + (Math.min(buf[b + E.MAG], 99) - Math.min(buf[a + E.MAG], 99)) * f,
      flags: buf[near + E.FLG], glint: buf[near + E.GLINT], range: buf[near + E.RNG],
    };
  }

  // Point at angular distance d (deg) from (az,el) toward bearing th (deg)
  function dest(az, el, d, th) {
    const la = el * D2R, lo = az * D2R, dd = d * D2R, t = th * D2R;
    const la2 = Math.asin(Math.sin(la) * Math.cos(dd) + Math.cos(la) * Math.sin(dd) * Math.cos(t));
    const lo2 = lo + Math.atan2(Math.sin(t) * Math.sin(dd) * Math.cos(la), Math.cos(dd) - Math.sin(la) * Math.sin(la2));
    return { az: norm360(lo2 * R2D), el: la2 * R2D };
  }

  function dotRadius(mag, dpr) { return Math.max(0.9, Math.min(5.5, 3.4 - 0.5 * (mag - 1))) * dpr; }

  function satColor(item, s) {
    if (!(s.flags & E.LIT)) return COL.shadow;
    if (item && item.flare && s.glint < 8) return COL.flare;
    if (item && item.cat === 'visible') return COL.visible;
    return COL.lit;
  }

  function sizeCanvas(c, aspect) {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 300;
    const h = aspect ? Math.round(w / aspect) : c.clientHeight;
    if (aspect) c.style.height = h + 'px';
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    return dpr;
  }

  function skyColors(sunEl) {
    if (sunEl > 0) return ['#2d5d9c', '#7fb2e5'];
    if (sunEl > -6) return ['#1a2c5c', '#c0704a'];
    if (sunEl > -12) return ['#0c1534', '#3c3f6a'];
    if (sunEl > -18) return ['#070c22', '#17213f'];
    return ['#04070f', '#0b1128'];
  }

  // =================== Dome (map-style compass of the whole sky) ===================
  class Dome {
    constructor(canvas, handlers) {
      this.c = canvas; this.h = handlers; this.ctx = canvas.getContext('2d');
      this.geom = null;
      let dragging = false;
      const pick = (ev) => {
        if (!this.geom) return;
        const r = this.c.getBoundingClientRect();
        const dpr = this.geom.dpr;
        const x = (ev.clientX - r.left) * dpr - this.geom.cx, y = (ev.clientY - r.top) * dpr - this.geom.cy;
        const az = norm360(Math.atan2(x, -y) * R2D);
        const el = 90 * (1 - Math.hypot(x, y) / this.geom.R);
        this.h.onLook(az, Math.max(this.geom.minEl, Math.min(89.5, el)));
      };
      canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); pick(e); });
      canvas.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
      const stop = () => { if (dragging) { dragging = false; this.h.onLookEnd && this.h.onLookEnd(); } };
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointercancel', stop);
    }

    draw(st) {
      const c = this.c, ctx = this.ctx, dpr = sizeCanvas(c, 1);
      const W = c.width, H = c.height;
      const res = st.res;
      const minEl = res ? res.minEl : -Astro.makeObserver(0, 0, st.altKm || 0).dip;
      const lowEl = Math.min(minEl - 1, -2);
      const cx = W / 2, cy = H / 2;
      const R = (Math.min(W, H) / 2 - 30 * dpr) / ((90 - lowEl) / 90);
      const rOf = (el) => (R * (90 - el)) / 90;
      const xy = (az, el) => { const r = rOf(el); return [cx + r * Math.sin(az * D2R), cy - r * Math.cos(az * D2R)]; };
      this.geom = { cx, cy, R, dpr, minEl };
      ctx.clearRect(0, 0, W, H);

      const fk = st.frame;
      const sun = res ? res.sun[Math.round(fk)] : null;
      const [c1, c2] = skyColors(sun ? sun.el : -30);

      // below-horizon ring (visible from altitude)
      ctx.beginPath(); ctx.arc(cx, cy, rOf(lowEl), 0, 2 * Math.PI); ctx.fillStyle = '#060912'; ctx.fill();
      if (minEl < -0.5) {
        ctx.beginPath(); ctx.arc(cx, cy, rOf(minEl), 0, 2 * Math.PI); ctx.fillStyle = '#0b1226'; ctx.fill();
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rOf(0));
      g.addColorStop(0, c1); g.addColorStop(1, c2);
      ctx.beginPath(); ctx.arc(cx, cy, rOf(0), 0, 2 * Math.PI); ctx.fillStyle = g; ctx.fill();

      // grid
      ctx.strokeStyle = COL.grid; ctx.lineWidth = dpr;
      for (const el of [30, 60]) { ctx.beginPath(); ctx.arc(cx, cy, rOf(el), 0, 2 * Math.PI); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(140,165,220,0.55)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, rOf(0), 0, 2 * Math.PI); ctx.stroke();
      for (let az = 0; az < 360; az += 10) {
        const [x1, y1] = xy(az, 0), [x2, y2] = xy(az, az % 30 === 0 ? -2.5 : -1.2);
        ctx.strokeStyle = 'rgba(140,165,220,0.5)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        if (az % 30 === 0) {
          ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.stroke();
        }
      }
      ctx.font = `600 ${13 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      names.forEach((n, i) => {
        const r = rOf(lowEl) + 14 * dpr, a = i * 45 * D2R;
        ctx.fillStyle = n === 'N' ? '#ff9b6b' : n.length === 1 ? '#dbe5ff' : COL.text;
        ctx.fillText(n, cx + r * Math.sin(a), cy - r * Math.cos(a));
      });
      ctx.font = `${10 * dpr}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(160,180,220,0.6)';
      ctx.fillText('30°', cx + 3 * dpr, cy - rOf(30) + 8 * dpr);
      ctx.fillText('60°', cx + 3 * dpr, cy - rOf(60) + 8 * dpr);

      // FOV region
      const look = st.look;
      ctx.beginPath();
      if (look.el == null) {
        ctx.moveTo(cx, cy);
        for (let a = look.az - look.tol; a <= look.az + look.tol + 0.01; a += 1) { const [x, y] = xy(a, minEl); ctx.lineTo(x, y); }
        ctx.closePath();
      } else {
        for (let th = 0; th <= 360; th += 5) { const p = dest(look.az, look.el, look.tol, th); const [x, y] = xy(p.az, Math.max(p.el, lowEl)); th ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(124,196,255,0.13)'; ctx.fill();
      ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeStyle = COL.fov; ctx.lineWidth = 1.3 * dpr; ctx.stroke(); ctx.setLineDash([]);

      if (res) {
        // stars + bodies
        const k = Math.round(fk);
        for (const s of res.stars[k]) {
          if (s.el < minEl || s.mag > 2.6) continue;
          const [x, y] = xy(s.az, s.el);
          ctx.fillStyle = 'rgba(200,215,255,0.55)';
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, 1.6 - s.mag * 0.4) * dpr, 0, 7); ctx.fill();
        }
        ctx.font = `${10 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'left';
        for (const b of res.bodies[k]) {
          if (b.el < minEl) continue;
          const [x, y] = xy(b.az, b.el);
          ctx.fillStyle = b.kind === 'moon' ? '#f2f2e6' : COL.planet;
          ctx.beginPath(); ctx.arc(x, y, (b.kind === 'moon' ? 5 : 2.6) * dpr, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,233,179,0.85)'; ctx.fillText(b.name, x + 6 * dpr, y);
        }
        // tracks for objects that cross the field of view
        for (const it of st.summary.list) {
          if (it.cat !== 'visible' && it.o.rec.id !== st.selected) continue;
          const b = it.o.buf;
          const full = it.o.rec.id === st.selected;
          ctx.beginPath(); let pen = false;
          for (let j = 0; j < res.nF; j++) {
            const i = j * E.F;
            if (!(b[i + E.FLG] & E.UP) || !(b[i + E.FLG] & E.LIT) ||
              (!full && E.sepLook(look, b[i + E.AZ], b[i + E.EL]) > look.tol * 2.5)) { pen = false; continue; }
            const [x, y] = xy(b[i + E.AZ], b[i + E.EL]);
            pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
          }
          const sel = it.o.rec.id === st.selected;
          ctx.strokeStyle = sel ? '#ffffff' : it.cat === 'shadow' ? 'rgba(85,100,138,0.5)' : it.flare ? 'rgba(255,138,61,0.65)' : 'rgba(255,211,107,0.45)';
          ctx.lineWidth = (sel ? 2 : 1) * dpr; ctx.stroke();
        }
        // current positions
        const sumById = st.sumById;
        for (const o of res.objs) {
          const s = at(o.buf, fk, res.nF);
          if (!(s.flags & E.UP)) continue;
          const lit = s.flags & E.LIT;
          if (!lit && !st.showShadow) continue;
          const it = sumById.get(o.rec.id);
          const [x, y] = xy(s.az, s.el);
          ctx.fillStyle = satColor(it, s);
          ctx.globalAlpha = lit ? 1 : 0.6;
          ctx.beginPath(); ctx.arc(x, y, lit ? Math.max(1, dotRadius(s.mag, dpr) * 0.6) : 0.9 * dpr, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
          if (o.rec.id === st.selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, 7); ctx.stroke(); }
        }
        // Sun
        if (sun) {
          const el = Math.max(sun.el, lowEl + 0.5);
          const [x, y] = xy(sun.az, el);
          ctx.fillStyle = COL.sun; ctx.beginPath(); ctx.arc(x, y, 6 * dpr, 0, 7); ctx.fill();
          if (sun.el < minEl) {
            ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center';
            const r = rOf(lowEl) - 34 * dpr;
            ctx.fillStyle = COL.sun;
            ctx.fillText(`Sun ${sun.el.toFixed(0)}°`, cx + r * Math.sin(sun.az * D2R), cy - r * Math.cos(sun.az * D2R));
          }
        }
      }

      // heading needle
      const tip = xy(look.az, look.el == null ? minEl : look.el);
      const ang = Math.atan2(tip[1] - cy, tip[0] - cx);
      ctx.strokeStyle = COL.needle; ctx.fillStyle = COL.needle; ctx.lineWidth = 3 * dpr; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tip[0] + Math.cos(ang) * 4 * dpr, tip[1] + Math.sin(ang) * 4 * dpr);
      ctx.lineTo(tip[0] - Math.cos(ang - 0.45) * 14 * dpr, tip[1] - Math.sin(ang - 0.45) * 14 * dpr);
      ctx.lineTo(tip[0] - Math.cos(ang + 0.45) * 14 * dpr, tip[1] - Math.sin(ang + 0.45) * 14 * dpr);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8eefc'; ctx.beginPath(); ctx.arc(cx, cy, 5 * dpr, 0, 7); ctx.fill();
    }
  }

  // =================== Horizon (what you'd see looking along the heading) ===================
  class Horizon {
    constructor(canvas, handlers) {
      this.c = canvas; this.h = handlers; this.ctx = canvas.getContext('2d'); this.span = 90; this.map = null;
      canvas.addEventListener('click', (ev) => {
        if (!this.map) return;
        const r = canvas.getBoundingClientRect(), dpr = this.map.dpr;
        const x = (ev.clientX - r.left) * dpr, y = (ev.clientY - r.top) * dpr;
        let best = null, bd = 14 * dpr;
        for (const p of this.map.pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
        this.h.onSelect(best ? best.id : null);
      });
    }

    draw(st) {
      const c = this.c, ctx = this.ctx;
      const narrow = (c.clientWidth || 600) < 560;
      const dpr = sizeCanvas(c, narrow ? 1.45 : 2.6);
      const W = c.width, H = c.height;
      const res = st.res, look = st.look;
      const minEl = res ? res.minEl : 0;
      const ppd = W / this.span;
      const elRange = H / ppd;
      let elBottom = Math.min(minEl, 0) - Math.max(1.5, elRange * 0.11);
      if (look.el != null && look.el + look.tol > elBottom + elRange - 1) elBottom = look.el - elRange / 2;
      const X = (az) => W / 2 + wrap180(az - look.az) * ppd;
      const Y = (el) => H - (el - elBottom) * ppd;
      const inView = (az) => Math.abs(wrap180(az - look.az)) <= this.span / 2 + 2;
      ctx.clearRect(0, 0, W, H);

      const fk = st.frame;
      const k = res ? Math.round(fk) : 0;
      const sun = res ? res.sun[k] : null;
      const [c1, c2] = skyColors(sun ? sun.el : -30);
      const g = ctx.createLinearGradient(0, 0, 0, Y(minEl));
      g.addColorStop(0, c1); g.addColorStop(1, c2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (sun && sun.el > -18 && Math.abs(wrap180(sun.az - look.az)) < this.span / 2 + 60) {
        const sx = X(sun.az), sy = Y(minEl);
        const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.45);
        const a = Math.max(0, Math.min(0.55, (sun.el + 18) / 30));
        rg.addColorStop(0, `rgba(255,140,70,${a})`); rg.addColorStop(1, 'rgba(255,140,70,0)');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      }
      // ground
      ctx.fillStyle = '#05070d'; ctx.fillRect(0, Y(minEl), W, H - Y(minEl));
      ctx.strokeStyle = 'rgba(120,150,210,0.8)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(0, Y(minEl)); ctx.lineTo(W, Y(minEl)); ctx.stroke();

      // grid
      const step = this.span <= 45 ? 5 : 10;
      ctx.font = `${10 * dpr}px system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      for (let el = Math.ceil(elBottom / step) * step; el < elBottom + elRange; el += step) {
        if (el < minEl) continue;
        ctx.strokeStyle = el === 0 && minEl < -0.5 ? 'rgba(160,180,230,0.35)' : COL.grid; ctx.lineWidth = dpr;
        if (el === 0 && minEl < -0.5) ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath(); ctx.moveTo(0, Y(el)); ctx.lineTo(W, Y(el)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(160,180,220,0.7)'; ctx.fillText(el === 0 && minEl < -0.5 ? '0° eye level' : el + '°', W - 6 * dpr, Y(el) - 7 * dpr);
      }
      const azStep = this.span <= 45 ? 5 : this.span <= 120 ? 10 : 30;
      const cardinal = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
      ctx.textAlign = 'center';
      for (let a = 0; a < 360; a += azStep) {
        if (!inView(a)) continue;
        const x = X(a), y0 = Y(minEl);
        ctx.strokeStyle = 'rgba(140,165,220,0.5)'; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + 5 * dpr); ctx.stroke();
        const lab = cardinal[a];
        ctx.fillStyle = lab ? '#dbe5ff' : 'rgba(160,180,220,0.7)';
        ctx.font = lab ? `600 ${12 * dpr}px system-ui, sans-serif` : `${10 * dpr}px system-ui, sans-serif`;
        if (lab || a % (azStep * (this.span > 120 ? 1 : 3)) === 0) ctx.fillText(lab || a + '°', x, Math.min(H - 8 * dpr, y0 + 16 * dpr));
      }

      // FOV
      ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeStyle = COL.fov; ctx.lineWidth = 1.3 * dpr;
      ctx.fillStyle = 'rgba(124,196,255,0.08)';
      ctx.beginPath();
      if (look.el == null) {
        ctx.rect(X(look.az - look.tol), 0, look.tol * 2 * ppd, Y(minEl));
      } else {
        for (let th = 0; th <= 360; th += 5) {
          const p = dest(look.az, look.el, look.tol, th);
          const x = X(p.az), y = Y(p.el);
          th ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
      }
      ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      if (look.el != null) {
        ctx.strokeStyle = COL.needle; ctx.lineWidth = 1.5 * dpr; const x = X(look.az), y = Y(look.el);
        ctx.beginPath(); ctx.moveTo(x - 8 * dpr, y); ctx.lineTo(x + 8 * dpr, y); ctx.moveTo(x, y - 8 * dpr); ctx.lineTo(x, y + 8 * dpr); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,181,71,0.5)'; ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.moveTo(X(look.az), 0); ctx.lineTo(X(look.az), Y(minEl)); ctx.stroke();
      }

      const pts = [];
      if (res) {
        // stars, planets, moon
        ctx.textAlign = 'left'; ctx.font = `${10 * dpr}px system-ui, sans-serif`;
        for (const s of res.stars[k]) {
          if (s.el < minEl || !inView(s.az)) continue;
          const x = X(s.az), y = Y(s.el);
          ctx.fillStyle = 'rgba(210,222,255,0.8)';
          ctx.beginPath(); ctx.arc(x, y, Math.max(0.7, 2 - s.mag * 0.5) * dpr, 0, 7); ctx.fill();
          if (s.mag < 1.6 && st.labels) { ctx.fillStyle = 'rgba(190,205,240,0.75)'; ctx.fillText(s.name, x + 5 * dpr, y); }
        }
        for (const b of res.bodies[k]) {
          if (b.el < minEl - 1 || !inView(b.az)) continue;
          const x = X(b.az), y = Y(b.el);
          const r = b.kind === 'moon' ? Math.max(4 * dpr, 0.25 * ppd) : 2.8 * dpr;
          ctx.fillStyle = b.kind === 'moon' ? '#f2f2e6' : COL.planet;
          ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,233,179,0.95)'; ctx.fillText(`${b.name} ${b.mag.toFixed(1)}`, x + r + 4 * dpr, y);
        }
        // satellites
        const trail = Math.max(3, Math.round(30 / res.fStep));
        const sumById = st.sumById;
        for (const o of res.objs) {
          const s = at(o.buf, fk, res.nF);
          if (!(s.flags & E.UP) || !inView(s.az)) continue;
          const lit = s.flags & E.LIT;
          const sel = o.rec.id === st.selected;
          if (!lit && !st.showShadow && !sel) continue;
          const it = sumById.get(o.rec.id);
          const x = X(s.az), y = Y(s.el);
          if (y < -10 || y > H + 10) continue;
          const col = satColor(it, s);
          // trail
          ctx.beginPath();
          let started = false;
          for (let j = Math.max(0, Math.floor(fk) - trail); j <= Math.floor(fk); j++) {
            const i = j * E.F;
            if (!(o.buf[i + E.FLG] & E.UP)) continue;
            const tx = X(o.buf[i + E.AZ]), ty = Y(o.buf[i + E.EL]);
            if (started && Math.abs(tx - x) > W / 2) { started = false; }
            started ? ctx.lineTo(tx, ty) : ctx.moveTo(tx, ty); started = true;
          }
          const lim = st.summary.lim != null ? st.summary.lim : 4.5;
          const dim = !lit || s.mag > lim + 1;
          if (started && (!dim || sel)) { ctx.lineTo(x, y); ctx.strokeStyle = lit ? (it && it.flare ? 'rgba(255,160,90,0.4)' : 'rgba(220,230,255,0.25)') : 'rgba(85,100,138,0.3)'; ctx.lineWidth = dpr; ctx.stroke(); }

          if (lit && dim && !sel) {
            ctx.fillStyle = 'rgba(200,210,240,0.28)';
            ctx.beginPath(); ctx.arc(x, y, 0.9 * dpr, 0, 7); ctx.fill();
          } else if (lit) {
            const rr = dotRadius(s.mag, dpr);
            if (s.mag < 2.5 && (it && it.flare ? s.glint < 10 : s.mag < 1)) {
              const gg = ctx.createRadialGradient(x, y, 0, x, y, rr * 5);
              gg.addColorStop(0, 'rgba(255,170,90,0.75)'); gg.addColorStop(1, 'rgba(255,170,90,0)');
              ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, rr * 5, 0, 7); ctx.fill();
            }
            ctx.fillStyle = col; ctx.globalAlpha = Math.max(0.35, Math.min(1, 1.2 - (s.mag - 2) * 0.12));
            ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
          } else {
            ctx.strokeStyle = COL.shadow; ctx.lineWidth = dpr;
            ctx.beginPath(); ctx.arc(x, y, 2 * dpr, 0, 7); ctx.stroke();
          }
          if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(x, y, 8 * dpr, 0, 7); ctx.stroke(); }
          if (st.labels && (sel || (lit && it && it.cat === 'visible' && s.mag <= st.summary.lim + 1))) {
            ctx.fillStyle = sel ? '#fff' : 'rgba(255,225,170,0.9)'; ctx.font = `${10 * dpr}px system-ui, sans-serif`;
            ctx.fillText(o.rec.name, x + 7 * dpr, y - 7 * dpr);
          }
          pts.push({ x, y, id: o.rec.id });
        }
        // Sun
        if (sun && inView(sun.az)) {
          if (sun.el > minEl) {
            ctx.fillStyle = COL.sun; ctx.beginPath(); ctx.arc(X(sun.az), Y(sun.el), 8 * dpr, 0, 7); ctx.fill();
          } else {
            const x = X(sun.az), y = Math.min(Y(minEl) + 6 * dpr, H - 26 * dpr);
            ctx.fillStyle = COL.sun; ctx.textAlign = 'center'; ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
            ctx.beginPath(); ctx.moveTo(x, y + 9 * dpr); ctx.lineTo(x - 5 * dpr, y); ctx.lineTo(x + 5 * dpr, y); ctx.fill();
            ctx.fillText(`Sun ${sun.el.toFixed(1)}°`, x, y + 20 * dpr);
          }
        }
      }
      // clock
      if (st.clockText) {
        ctx.textAlign = 'left'; ctx.font = `600 ${13 * dpr}px ui-monospace, Consolas, monospace`;
        ctx.fillStyle = 'rgba(5,8,18,0.55)'; ctx.fillRect(8 * dpr, 8 * dpr, ctx.measureText(st.clockText).width + 16 * dpr, 24 * dpr);
        ctx.fillStyle = '#e8eefc'; ctx.fillText(st.clockText, 16 * dpr, 20 * dpr);
      }
      this.map = { pts, dpr };
    }
  }

  global.Views = { Dome, Horizon, at };
})(window);
