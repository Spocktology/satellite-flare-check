/* app.js — UI wiring. */
(function () {
  'use strict';

  // If this page is embedded in another site, set that page's URL here so
  // "Copy link to this case" points visitors to your site (see README).
  const SHARE_BASE = '';

  const $ = (id) => document.getElementById(id);
  const E = Engine;
  const st = {
    res: null, summary: { list: [], celestial: [] }, sumById: new Map(),
    look: { az: 270, el: null, tol: 10 }, frame: 0, playing: false, selected: null,
    showShadow: false, labels: true, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    altKm: 0, clockText: '', magLimit: 4.5, placeLabel: '',
  };

  // ---------------- time zone helpers ----------------
  function tzOffsetMs(utcMs, tz) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).forEach((x) => { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
  }
  function zonedToUtc(str, tz) {
    const [d, t = '00:00'] = str.split('T');
    const [Y, M, D] = d.split('-').map(Number);
    const [h, m, s = 0] = t.split(':').map(Number);
    const guess = Date.UTC(Y, M - 1, D, h, m, Math.floor(s));
    const off = tzOffsetMs(guess, tz);
    let utc = guess - off;
    const off2 = tzOffsetMs(utc, tz);
    if (off2 !== off) utc = guess - off2;
    return utc;
  }
  function utcToZonedInput(ms, tz) {
    const z = new Date(ms + tzOffsetMs(ms, tz));
    return z.toISOString().slice(0, 19);
  }
  const fmtTime = (ms, opts = {}) => new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: st.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }, opts)).format(new Date(ms));
  const fmtFull = (ms) => new Intl.DateTimeFormat(undefined, { timeZone: st.tz, dateStyle: 'medium', timeStyle: 'long' }).format(new Date(ms));
  const rel = (ms, t0) => { const s = Math.round((ms - t0) / 1000); const a = Math.abs(s); return (s < 0 ? '−' : '+') + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0'); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const compass16 = (az) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16];
  const fmtMag = (m) => (m >= 50 ? '—' : (m < 0 ? '−' : '') + Math.abs(m).toFixed(1));

  // ---------------- init form ----------------
  function initTz() {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney']; }
    if (!zones.includes('UTC')) zones.unshift('UTC');
    if (!zones.includes(st.tz)) zones.unshift(st.tz);
    $('tz').innerHTML = zones.map((z) => `<option${z === st.tz ? ' selected' : ''}>${z}</option>`).join('');
  }

  function initGroups() {
    $('groups').innerHTML = Catalog.GROUPS.map((g) => `
      <label class="group"><input type="checkbox" data-group="${g.id}"${g.on ? ' checked' : ''}>
        <span class="gl">${esc(g.label)}</span><span class="gs" id="gs-${g.id}">${esc(g.hint)}</span></label>`).join('');
  }

  function groupStatus(id, text, cls) { const el = $('gs-' + id); if (el) { el.textContent = text; el.className = 'gs ' + (cls || ''); } }

  function readLook() {
    const h = parseFloat($('heading').value);
    const decl = $('magnetic').checked ? parseFloat($('decl').value) || 0 : 0;
    const e = $('elev').value.trim() === '' ? null : parseFloat($('elev').value);
    const tol = Math.max(0.5, parseFloat($('tol').value) || 10);
    st.look = { az: Astro.norm360((isFinite(h) ? h : 0) + decl), el: e == null || !isFinite(e) ? null : e, tol };
  }

  function writeLook(az, el) {
    const decl = $('magnetic').checked ? parseFloat($('decl').value) || 0 : 0;
    $('heading').value = Astro.norm360(az - decl).toFixed(1);
    if (st.look.el != null && el != null) $('elev').value = el.toFixed(1);
    readLook();
  }

  function updateUtcEcho() {
    const v = $('when').value;
    if (!v) { $('utcEcho').textContent = ''; return; }
    try {
      const ms = zonedToUtc(v, $('tz').value);
      $('utcEcho').textContent = new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    } catch { $('utcEcho').textContent = ''; }
  }

  // ---------------- places ----------------
  async function findPlace() {
    const q = $('place').value.trim();
    const list = $('placeResults');
    if (!q) return;
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) { setPlace(+m[1], +m[2], `${(+m[1]).toFixed(4)}, ${(+m[2]).toFixed(4)}`); list.hidden = true; return; }
    const query = /^[A-Za-z]{3,4}$/.test(q) ? q + ' airport' : q;
    list.innerHTML = '<li>Searching…</li>'; list.hidden = false;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`, { headers: { 'Accept-Language': navigator.language || 'en' } });
      const js = await r.json();
      if (!js.length) { list.innerHTML = '<li>No matches — try adding the state or country, or enter lat, lon.</li>'; return; }
      list.innerHTML = js.map((p, i) => `<li data-i="${i}">${esc(p.display_name)}</li>`).join('');
      list.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
        const p = js[+li.dataset.i];
        setPlace(+p.lat, +p.lon, p.display_name);
        list.hidden = true;
      }));
    } catch (e) {
      list.innerHTML = `<li>Search failed (${esc(e.message)}). Enter latitude and longitude instead.</li>`;
    }
  }

  function setPlace(lat, lon, label) {
    $('lat').value = lat.toFixed(5); $('lon').value = lon.toFixed(5);
    st.placeLabel = label || '';
    $('placeName').textContent = label ? '📍 ' + label : '';
    if (label) $('place').value = label.split(',').slice(0, 2).join(',');
  }

  // ---------------- data ----------------
  function activeKeys() {
    const keys = new Set();
    document.querySelectorAll('[data-group]').forEach((c) => { if (c.checked) keys.add('ct:' + c.dataset.group); });
    for (const k of Catalog.sources.keys()) if (k.startsWith('file:')) keys.add(k);
    return keys;
  }

  async function ensureData(progress) {
    const wanted = [...document.querySelectorAll('[data-group]')].filter((c) => c.checked).map((c) => c.dataset.group);
    let i = 0;
    for (const id of wanted) {
      progress(0, `Loading satellite data: ${Catalog.GROUPS.find((g) => g.id === id).label}…`);
      const s0 = Catalog.sources.get('ct:' + id);
      if (!s0 || Date.now() - s0.fetched > 2 * 3600e3) {
        try {
          const s = await Catalog.loadGroup(id);
          const ago = Math.round((Date.now() - s.fetched) / 60000);
          groupStatus(id, `✓ ${s.records.length.toLocaleString()} objects · fetched ${ago < 1 ? 'just now' : ago + ' min ago'}${s.note ? ' · ' + s.note : ''}`, 'ok');
        } catch (e) {
          groupStatus(id, '✗ ' + e.message, 'err');
        }
      }
      i++;
    }
  }

  function renderFiles() {
    const ul = $('fileList');
    ul.innerHTML = '';
    for (const [k, s] of Catalog.sources) {
      if (!k.startsWith('file:')) continue;
      const ep = s.records.map((r) => r.epochMs).sort((a, b) => a - b);
      const li = document.createElement('li');
      li.innerHTML = `<span>✓ ${esc(s.label)} — ${s.records.length.toLocaleString()} sets, epochs ${new Date(ep[0]).toISOString().slice(0, 10)} → ${new Date(ep[ep.length - 1]).toISOString().slice(0, 10)}</span><button type="button" title="Remove">✕</button>`;
      li.querySelector('button').onclick = () => { Catalog.remove(k); renderFiles(); };
      ul.appendChild(li);
    }
  }

  // ---------------- analysis ----------------
  function progress(f, text) {
    $('progress').hidden = false;
    $('progBar').style.width = Math.round(f * 100) + '%';
    $('progText').textContent = text;
  }

  async function run(ev) {
    if (ev) ev.preventDefault();
    const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
    if (!isFinite(lat) || !isFinite(lon)) {
      if ($('place').value.trim()) { await findPlace(); }
      showVerdict('warn', 'Location needed', '<p>Pick a place from the search list, use the location button, or type a latitude and longitude.</p>');
      return;
    }
    if (!$('when').value) { showVerdict('warn', 'Date and time needed', '<p>Enter when the sighting happened.</p>'); return; }
    st.tz = $('tz').value;
    const t0 = zonedToUtc($('when').value, st.tz);
    const altFt = parseFloat($('alt').value);
    st.altKm = isFinite(altFt) && altFt > 0 ? altFt * 0.0003048 : 0;
    st.magLimit = parseFloat($('detect').value);
    readLook();
    const padSec = (parseFloat($('win').value) || 0) * 60;
    const durSec = Math.min(240, Math.max(0, parseFloat($('dur').value) || 0)) * 60;

    $('runBtn').disabled = true;
    stop();
    try {
      await ensureData(progress);
      const records = Catalog.select(t0, activeKeys());
      if (!records.length) throw new Error('No satellite data loaded. Tick a CelesTrak group or load a TLE file under "Satellite data".');
      const res = await E.analyze({ records, lat, lon, altKm: st.altKm, t0, durSec, padSec: Math.max(padSec, durSec ? 0 : 30) }, progress);
      // data age stats
      const ages = records.map((r) => Math.abs(r.ageDays)).sort((a, b) => a - b);
      res.medianAge = ages[Math.floor(ages.length / 2)];
      res.signedAge = records.length ? records.map((r) => r.ageDays).sort((a, b) => a - b)[Math.floor(records.length / 2)] : 0;
      res.place = st.placeLabel || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      res.lat = lat; res.lon = lon;
      st.res = res;
      st.frame = res.K;
      st.selected = null;
      st.allRows = false;
      $('scrub').max = res.nF - 1;
      $('scrub').value = res.K;
      $('copyReport').disabled = false;
      renderTimeline();
      resummarize();
      updateHash();
      $('progress').hidden = true;
      // Live use: if the sighting is happening now, play along in real time
      const nowK = (Date.now() - res.times[0]) / (res.fStep * 1000);
      if (nowK >= 0 && nowK < res.nF - 1 && Date.now() - t0 < 30 * 60e3) {
        st.frame = nowK; $('scrub').value = nowK; $('speed').value = '1'; st.live = true; play();
      } else st.live = false;
    } catch (e) {
      console.error(e);
      $('progress').hidden = true;
      showVerdict('warn', 'Could not complete the analysis', `<p>${esc(e.message)}</p>`);
    } finally {
      $('runBtn').disabled = false;
    }
  }

  function resummarize() {
    if (!st.res) { render(); return; }
    st.summary = E.summarize(st.res, st.look, st.magLimit);
    st.sumById = new Map(st.summary.list.map((it) => [it.o.rec.id, it]));
    renderVerdict();
    renderTable();
    renderCelestial();
    renderDetail();
    render();
    setTimeout(postHeight, 30);
  }

  // ---------------- verdict ----------------
  function showVerdict(cls, head, body) {
    const v = $('verdict');
    v.className = 'panel verdict ' + (cls || '');
    $('vHead').textContent = head;
    $('vBody').innerHTML = body;
  }

  function lookText() {
    const l = st.look;
    return `${l.az.toFixed(0)}° (${compass16(l.az)})${l.el != null ? `, ${l.el.toFixed(0)}° up` : ', any elevation'}, ±${l.tol}°`;
  }

  function verdictModel() {
    const res = st.res, S = st.summary;
    const L = S.list;
    const visible = L.filter((x) => x.cat === 'visible');
    const vFlares = visible.filter((x) => x.flare);
    const faint = L.filter((x) => x.cat === 'faint');
    const shadow = L.filter((x) => x.cat === 'shadow');
    const now = L.filter((x) => x.during);
    const tumblers = visible.filter((x) => x.o.rec.type !== 'payload' || !x.o.rec.nadirPanel);
    let cls, head;
    if (!visible.length) { cls = 'good'; head = 'No catalogued satellite could have been seen there'; }
    else if (vFlares.length) { cls = 'flare'; head = vFlares.length === 1 ? 'Possible satellite flare in your field of view' : `${vFlares.length} possible satellite flares in your field of view`; }
    else { cls = 'warn'; head = `${visible.length} satellite${visible.length > 1 ? 's were' : ' was'} visible in that direction`; }
    return { res, S, visible, vFlares, faint, shadow, now, tumblers, cls, head };
  }

  function renderVerdict() {
    const m = verdictModel();
    const { res, S } = m;
    const sunEl = S.sunEl;
    const tw = Astro.twilightName(sunEl);
    let html = `<p>${esc(res.place)}${st.altKm ? ` at ${Math.round(st.altKm / 0.0003048).toLocaleString()} ft` : ''} · ${esc(fmtFull(res.t0))} · looking ${lookText()} · ${spanText()}</p>`;
    html += `<div class="stats">
      <div class="stat"><b>${m.visible.length}</b><span>bright enough to see</span></div>
      <div class="stat"><b>${m.vFlares.length}</b><span>with flare geometry</span></div>
      <div class="stat"><b>${m.faint.length}</b><span>sunlit but too faint</span></div>
      <div class="stat"><b>${m.shadow.length}</b><span>in Earth's shadow (invisible)</span></div>
      <div class="stat"><b>${m.now.length}</b><span>${res.durSec ? 'visible during the sighting' : 'visible at the exact time'}</span></div>
    </div>`;
    const pts = [];
    if (!m.visible.length) {
      pts.push(`Of ${res.total.toLocaleString()} catalogued objects checked, none was both <b>sunlit and bright enough</b> (mag ≤ ${S.lim.toFixed(1)}) inside your field of view during the window.`);
      if (m.shadow.length) pts.push(`${m.shadow.length} passed through but were in Earth's shadow, so they were invisible.`);
      if (m.faint.length) pts.push(`${m.faint.length} were sunlit but too faint for how it was seen (brightest ${fmtMag(Math.min(...m.faint.map((x) => x.best)))}).`);
    } else {
      const pool = m.now.length ? m.now : m.visible;
      const top = pool.filter((x) => x.flare)[0] || pool.slice().sort((a, b) => a.best - b.best)[0];
      const tk = top.during ? top.durK : top.bestK, tm = top.during ? top.durBest : top.best;
      pts.push(`Brightest candidate${top.during && res.durSec ? ' during the sighting' : ''}: <b>${esc(top.o.rec.name)}</b>, est. mag ${fmtMag(tm)} at ${fmtTime(st.res.times[tk])} (${relSighting(st.res.times[tk])})${top.flare ? `, flare angle ${top.minGlint.toFixed(1)}°` : ''}.`);
      if (res.durSec && m.now.length > 1) pts.push(`During the ${Math.round(res.durSec / 60)}-minute sighting, ${m.now.length} different satellites were visible in that direction. A series of objects appearing one after another is typical of Starlink flares.`);
      if (m.vFlares.length) pts.push(`Flare geometry means the Sun's reflection off the satellite's flat Earth-facing underside pointed close to you. This produces the bright, slow "horizon flare" seen low in the sky toward the Sun after sunset or before sunrise.`);
      const tb = m.tumblers.filter((x) => x.o.rec.type === 'rocket body' || x.o.rec.type === 'debris');
      if (tb.length) pts.push(`${tb.length} rocket bod${tb.length > 1 ? 'ies/debris' : 'y/debris'} in view. These tumble and can flash unpredictably.`);
      const fam = {};
      m.visible.forEach((x) => { const f = x.o.rec.family === 'other' ? x.o.rec.type : x.o.rec.family; fam[f] = (fam[f] || 0) + 1; });
      pts.push('By type: ' + Object.entries(fam).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') + '.');
    }
    if (S.celestial.length) pts.push('Also in your field of view: ' + S.celestial.slice(0, 5).map((c) => `<b>${esc(c.name)}</b> (mag ${fmtMag(c.mag)})`).join(', ') + '.');
    pts.push(`Sky: Sun ${sunEl.toFixed(1)}° (${tw}).${sunEl > -6 ? ' In a bright sky, only very bright objects or flares stand out.' : ''}`);
    html += '<ul>' + pts.map((p) => `<li>${p}</li>`).join('') + '</ul>';

    const age = res.medianAge;
    if (age > 3) {
      html += `<div class="caveat${age < 7 ? ' mild' : ''}"><b>Orbital data is ${age.toFixed(0)} days ${res.signedAge > 0 ? 'older than' : 'newer than'} your sighting.</b> Low-orbit satellites, Starlink especially, may be far from their predicted spots, so specific identifications are unreliable${age > 14 ? '. Treat this result only as a rough idea of how busy that part of the sky usually is' : ''}. Load historical element sets for the sighting date (<a href="#" class="histLink">how</a>).</div>`;
    }
    if (res.failed > res.total * 0.05) html += `<div class="caveat mild">${res.failed.toLocaleString()} objects couldn't be propagated to this date (decayed, or data too old).</div>`;
    showVerdict(m.cls, m.head, html);
    document.querySelectorAll('.histLink').forEach((a) => a.addEventListener('click', openHist));
  }

  function spanText() {
    const res = st.res;
    const hm = (ms) => fmtTime(ms, { second: undefined });
    const s = res.durSec ? `sighting ${hm(res.t0)}–${hm(res.t0 + res.durSec * 1000)}` : `sighting ${fmtTime(res.t0)}`;
    return `${s} · checked ${hm(res.times[0])}–${hm(res.times[res.nF - 1])}`;
  }

  // Time relative to the sighting period: "2:10 before", "+4:30 into sighting", "1:00 after end"
  function relSighting(ms) {
    const res = st.res;
    const end = res.t0 + res.durSec * 1000;
    const mmss = (s) => { s = Math.round(Math.abs(s) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
    if (ms < res.t0 - 500) return mmss(res.t0 - ms) + ' before sighting';
    if (!res.durSec) return ms - res.t0 < 500 ? 'at sighting time' : mmss(ms - res.t0) + ' after sighting';
    if (ms <= end + 500) return mmss(ms - res.t0) + ' into sighting';
    return mmss(ms - end) + ' after sighting ended';
  }

  function renderTimeline() {
    const res = st.res, n = res.nF - 1;
    const band = $('band');
    band.style.left = (res.K / n) * 100 + '%';
    band.style.width = ((res.KE - res.K) / n) * 100 + '%';
    const hm = (ms) => fmtTime(ms);
    $('timelabels').innerHTML = `<span>${hm(res.times[0])}</span><span><b>${res.durSec ? `sighting ${hm(res.t0)} → ${hm(res.t0 + res.durSec * 1000)}` : `sighting ${hm(res.t0)}`}</b></span><span>${hm(res.times[n])}</span>`;
  }

  // ---------------- table / details ----------------
  function typeLabel(r) {
    if (r.family !== 'other' && r.type === 'payload') return r.family[0] + r.family.slice(1).toLowerCase();
    return r.type[0].toUpperCase() + r.type.slice(1);
  }

  function renderTable() {
    const tb = $('table').querySelector('tbody');
    const nearby = $('showNearby').checked;
    let rows = st.summary.list.filter((x) => x.cat !== 'outside');
    if (nearby) rows = rows.concat(st.summary.list.filter((x) => x.cat === 'outside' && x.minSep < 60).sort((a, b) => a.minSep - b.minSep).slice(0, 60));
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="9" class="empty">Nothing crossed your field of view. Widen the tolerance or tick "also show nearby objects".</td></tr>`; return; }
    const res = st.res;
    const total = rows.length;
    rows = rows.slice(0, st.allRows ? 600 : 40);
    tb.innerHTML = rows.map((x) => {
      const r = x.o.rec;
      const k = x.bestK >= 0 ? x.bestK : x.minK;
      const i = k * E.F, b = x.o.buf;
      const status = (x.during && res.durSec ? '<span class="pill visible" title="Visible inside your view during the sighting period">● during</span> ' : '') + (x.flare && x.cat !== 'shadow' ? `<span class="pill flare">flare geometry</span>` : `<span class="pill ${x.cat}">${{ visible: 'visible', faint: 'too faint', shadow: 'in shadow', outside: 'outside view' }[x.cat]}</span>`);
      const glint = x.cat === 'shadow' ? '—' : r.nadirPanel ? (x.minGlint < 180 ? x.minGlint.toFixed(1) + '°' : (b[i + E.GLINT] < 180 ? b[i + E.GLINT].toFixed(0) + '°' : '—')) : '<span title="Unknown attitude — may tumble">n/a</span>';
      return `<tr data-id="${esc(r.id)}" class="${r.id === st.selected ? 'sel' : ''}">
        <td><b>${esc(r.name)}</b> <span class="hint">#${esc(r.id)}</span></td>
        <td>${esc(typeLabel(r))}</td>
        <td>${status}</td>
        <td>${fmtTime(res.times[k])} <span class="hint">${relSighting(res.times[k])} ·${E.sepLook(st.look, b[i + E.AZ], b[i + E.EL]).toFixed(1)}° off</span></td>
        <td>${b[i + E.AZ].toFixed(0)}° / ${b[i + E.EL].toFixed(1)}°</td>
        <td>${x.best < 50 ? fmtMag(x.best) : x.cat === 'shadow' ? 'dark' : fmtMag(b[i + E.MAG])}</td>
        <td>${glint}</td>
        <td>${Math.round(b[i + E.RNG]).toLocaleString()} km</td>
        <td${Math.abs(r.ageDays) > 3 ? ' style="color:var(--bad)"' : ''}>${r.ageDays.toFixed(1)} d</td></tr>`;
    }).join('') + (total > rows.length ? `<tr><td colspan="9" class="empty"><button type="button" class="btn small" id="moreRows">Show all ${total} objects</button></td></tr>` : '');
    tb.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => select(tr.dataset.id, true)));
    const more = $('moreRows');
    if (more) more.addEventListener('click', () => { st.allRows = true; renderTable(); setTimeout(postHeight, 30); });
  }

  function select(id, jump) {
    st.selected = id;
    const it = id && st.sumById.get(id);
    if (it && jump) { st.frame = it.bestK >= 0 ? it.bestK : it.minK; $('scrub').value = st.frame; }
    document.querySelectorAll('#table tr[data-id]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.id === id));
    renderDetail();
    render();
  }

  function renderDetail() {
    const el = $('detail');
    const it = st.selected && st.sumById.get(st.selected);
    if (!it || !st.res) { el.innerHTML = '<p class="hint">Click a satellite in the view or a row in the table.</p>'; return; }
    const r = it.o.rec, s = Views.at(it.o.buf, st.frame, st.res.nF);
    const lit = s.flags & E.LIT, up = s.flags & E.UP;
    el.innerHTML = `<dl class="kv">
      <dt>Name</dt><dd><b>${esc(r.name)}</b></dd>
      <dt>NORAD #</dt><dd>${esc(r.id)} · <a href="https://celestrak.org/satcat/table-satcat.php?CATNR=${encodeURIComponent(r.id)}" target="_blank" rel="noopener">catalog entry</a></dd>
      <dt>Type</dt><dd>${esc(typeLabel(r))}${r.nadirPanel ? ' · Earth-facing panel (flare model on)' : ' · attitude unknown'}</dd>
      <dt>At ${fmtTime(st.res.times[0] + (st.frame) * st.res.fStep * 1000)}</dt><dd>${up ? `az ${s.az.toFixed(1)}° (${compass16(s.az)}), el ${s.el.toFixed(1)}°` : 'below your horizon'}</dd>
      <dt>Range</dt><dd>${Math.round(s.range).toLocaleString()} km</dd>
      <dt>Lighting</dt><dd>${lit ? 'sunlit' : "in Earth's shadow"}</dd>
      <dt>Est. magnitude</dt><dd>${lit ? fmtMag(s.mag) : '—'}${r.nadirPanel && s.glint < 180 ? ` · flare angle ${s.glint.toFixed(1)}°` : ''}</dd>
      <dt>In your view</dt><dd>${it.inFov ? `${fmtTime(st.res.times[it.first])} → ${fmtTime(st.res.times[it.last])}` : `no (closest ${it.minSep.toFixed(1)}°)`}</dd>
      <dt>Orbit data</dt><dd>epoch ${new Date(r.epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC (${r.ageDays.toFixed(1)} d) · ${esc(r.src)}</dd>
    </dl>`;
  }

  function renderCelestial() {
    const c = st.summary.celestial;
    $('celestial').innerHTML = c.length
      ? '<ul class="celist">' + c.map((b) => `<li><b>${esc(b.name)}</b> · mag ${fmtMag(b.mag)} · az ${b.az.toFixed(0)}°, el ${b.el.toFixed(1)}° · ${b.sep.toFixed(1)}° from your point</li>`).join('') + '</ul>'
      : '<p class="hint">No Moon, planets or bright stars in your field of view at the sighting time.</p>';
  }

  // ---------------- rendering / playback ----------------
  const dome = new Views.Dome($('dome'), {
    onLook: (az, el) => { writeLook(az, el); resummarizeSoon(); render(); },
    onLookEnd: () => { resummarize(); updateHash(); },
  });
  const horizon = new Views.Horizon($('horizon'), { onSelect: (id) => select(id, false) });

  let rsTimer = null;
  function resummarizeSoon() {
    if (!st.res) return;
    if (rsTimer) return;
    rsTimer = setTimeout(() => { rsTimer = null; resummarize(); }, 120);
  }

  function render() {
    if (st.res) {
      const ms = st.res.times[0] + st.frame * st.res.fStep * 1000;
      st.clockText = `${fmtTime(ms)} ${tzAbbr(ms)} · ${st.live && Math.abs(ms - Date.now()) < 3000 ? 'LIVE' : relSighting(ms)}`;
    } else st.clockText = '';
    dome.draw(st);
    horizon.draw(st);
  }
  function tzAbbr(ms) {
    try { return new Intl.DateTimeFormat('en-US', { timeZone: st.tz, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName').value; } catch { return ''; }
  }

  let last = 0;
  function loop(ts) {
    if (!st.playing) return;
    const dt = last ? (ts - last) / 1000 : 0; last = ts;
    const speed = parseFloat($('speed').value);
    st.frame += (dt * speed) / st.res.fStep;
    if (st.frame >= st.res.nF - 1) { st.frame = st.res.nF - 1; stop(); }
    $('scrub').value = st.frame;
    render();
    if (st.selected) renderDetail();
    if (st.playing) requestAnimationFrame(loop);
  }
  function play() {
    if (!st.res) return;
    if (st.frame >= st.res.nF - 1) st.frame = 0;
    st.playing = true; last = 0; $('playBtn').textContent = '❚❚';
    requestAnimationFrame(loop);
  }
  function stop() { st.playing = false; $('playBtn').textContent = '▶'; }

  // ---------------- report & sharing ----------------
  function report() {
    const m = verdictModel(), res = st.res, S = m.S;
    const lines = [
      'SATELLITE FLARE CHECK — sighting analysis',
      `Location: ${res.place} (${res.lat.toFixed(4)}, ${res.lon.toFixed(4)})${st.altKm ? `, altitude ${Math.round(st.altKm / 0.0003048)} ft` : ', ground level'}`,
      `Time: ${fmtFull(res.t0)}  (${new Date(res.t0).toISOString()})${res.durSec ? `, lasting ${res.durSec / 60} min` : ''}; clock uncertainty ±${res.padSec / 60} min (${spanText()})`,
      `Looking: ${lookText()}`,
      `Sun: ${S.sunEl.toFixed(1)}° (${Astro.twilightName(S.sunEl)}); detection limit mag ${S.lim.toFixed(1)}`,
      `Objects checked: ${res.total}; orbital data median age ${res.medianAge.toFixed(1)} days`,
      '',
      `RESULT: ${m.head}`,
      `  visible: ${m.visible.length} · flare geometry: ${m.vFlares.length} · too faint: ${m.faint.length} · in shadow: ${m.shadow.length} · visible during the sighting itself: ${m.now.length}`,
    ];
    const rows = S.list.filter((x) => x.cat === 'visible' || x.cat === 'faint').slice(0, 40);
    if (rows.length) {
      lines.push('', 'Sunlit objects in the field of view:');
      for (const x of rows) {
        const k = x.bestK;
        lines.push(`  ${x.o.rec.name} #${x.o.rec.id} [${typeLabel(x.o.rec)}] best mag ${fmtMag(x.best)} at ${fmtTime(res.times[k])} (${relSighting(res.times[k])}), az ${x.o.buf[k * E.F].toFixed(0)}° el ${x.o.buf[k * E.F + 1].toFixed(1)}°${x.flare ? `, flare angle ${x.minGlint.toFixed(1)}°` : ''}`);
      }
    }
    if (S.celestial.length) lines.push('', 'Natural objects in view: ' + S.celestial.map((c) => `${c.name} (mag ${fmtMag(c.mag)}, az ${c.az.toFixed(0)}° el ${c.el.toFixed(1)}°)`).join('; '));
    lines.push('', 'Brightness and flare estimates are approximate. Orbits: CelesTrak/NORAD, SGP4.');
    return lines.join('\n');
  }

  function params() {
    const p = new URLSearchParams();
    if ($('lat').value) p.set('lat', $('lat').value);
    if ($('lon').value) p.set('lon', $('lon').value);
    if (st.placeLabel) p.set('place', st.placeLabel.slice(0, 80));
    if ($('alt').value) p.set('alt', $('alt').value);
    if ($('when').value) p.set('t', $('when').value);
    p.set('tz', $('tz').value);
    p.set('w', $('win').value);
    if ($('dur').value) p.set('d', $('dur').value);
    p.set('az', $('heading').value);
    if ($('elev').value) p.set('el', $('elev').value);
    p.set('tol', $('tol').value);
    if ($('magnetic').checked) p.set('decl', $('decl').value);
    p.set('mag', $('detect').value);
    return p.toString();
  }
  function updateHash() { try { history.replaceState(null, '', '#' + params()); } catch { /* sandboxed */ } }

  function readHash() {
    const h = location.hash.slice(1);
    if (!h) return false;
    const p = new URLSearchParams(h);
    const set = (id, k) => { if (p.has(k)) $(id).value = p.get(k); };
    set('lat', 'lat'); set('lon', 'lon'); set('alt', 'alt'); set('when', 't'); set('win', 'w'); set('dur', 'd');
    set('heading', 'az'); set('elev', 'el'); set('tol', 'tol'); set('detect', 'mag');
    if (p.has('tz')) { st.tz = p.get('tz'); if (![...$('tz').options].some((o) => o.value === st.tz)) $('tz').add(new Option(st.tz)); $('tz').value = st.tz; }
    if (p.has('decl')) { $('magnetic').checked = true; $('declWrap').hidden = false; $('decl').value = p.get('decl'); }
    if (p.has('place')) { st.placeLabel = p.get('place'); $('placeName').textContent = '📍 ' + st.placeLabel; $('place').value = st.placeLabel.split(',').slice(0, 2).join(','); }
    return p.has('lat') && p.has('t');
  }

  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); $('copyMsg').textContent = msg; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); $('copyMsg').textContent = msg; } catch { $('copyMsg').textContent = 'Copy failed'; }
      ta.remove();
    }
    setTimeout(() => { $('copyMsg').textContent = ''; }, 2500);
  }

  function openHist(e) { if (e) e.preventDefault(); $('info').showModal(); $('histTitle').scrollIntoView(); }

  // ---------------- events ----------------
  function wire() {
    $('form').addEventListener('submit', run);
    $('placeBtn').addEventListener('click', findPlace);
    $('place').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findPlace(); } });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-box') && e.target.id !== 'placeBtn') $('placeResults').hidden = true; });
    $('gpsBtn').addEventListener('click', () => {
      if (!navigator.geolocation) return;
      $('placeName').textContent = 'Getting your location…';
      navigator.geolocation.getCurrentPosition(
        (p) => { setPlace(p.coords.latitude, p.coords.longitude, `My location (${p.coords.latitude.toFixed(3)}, ${p.coords.longitude.toFixed(3)})`); if (p.coords.altitude > 100) $('alt').value = Math.round(p.coords.altitude / 0.3048); },
        (err) => { $('placeName').textContent = 'Location unavailable: ' + err.message + '. Enter it manually.'; },
        { enableHighAccuracy: true, timeout: 15000 });
    });
    ['heading', 'elev', 'tol', 'decl'].forEach((id) => $(id).addEventListener('input', () => { readLook(); resummarizeSoon(); render(); }));
    $('magnetic').addEventListener('change', () => { $('declWrap').hidden = !$('magnetic').checked; readLook(); resummarize(); });
    $('detect').addEventListener('change', () => { st.magLimit = parseFloat($('detect').value); resummarize(); });
    $('when').addEventListener('input', updateUtcEcho);
    $('tz').addEventListener('change', updateUtcEcho);
    $('alt').addEventListener('input', () => { if (!st.res) { const f = parseFloat($('alt').value); st.altKm = f > 0 ? f * 0.0003048 : 0; render(); } });

    $('playBtn').addEventListener('click', () => (st.playing ? stop() : play()));
    $('nowBtnForm').addEventListener('click', () => {
      $('when').value = utcToZonedInput(Date.now(), $('tz').value);
      updateUtcEcho();
    });
    setupAim();
    $('scrub').addEventListener('input', () => { stop(); st.live = false; st.frame = parseFloat($('scrub').value); render(); renderDetail(); });
    $('nowBtn').addEventListener('click', () => { if (!st.res) return; stop(); st.live = false; st.frame = st.res.K; $('scrub').value = st.frame; render(); renderDetail(); });
    $('spanSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      horizon.span = +b.dataset.span;
      $('spanSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      render();
    });
    $('showShadow').addEventListener('change', () => { st.showShadow = $('showShadow').checked; render(); });
    $('labels').addEventListener('change', () => { st.labels = $('labels').checked; render(); });
    $('showNearby').addEventListener('change', renderTable);

    $('tleFile').addEventListener('change', async () => {
      for (const f of $('tleFile').files) {
        try { Catalog.addFile(f.name, await f.text()); } catch (e) { alert(e.message); }
      }
      $('tleFile').value = '';
      renderFiles();
    });
    $('infoBtn').addEventListener('click', () => $('info').showModal());
    $('histHelp').addEventListener('click', openHist);
    $('copyReport').addEventListener('click', () => st.res && copy(report(), 'Report copied ✓'));
    $('copyLink').addEventListener('click', () => {
      const base = SHARE_BASE || location.href.split('#')[0];
      copy(base + '#' + params(), 'Link copied ✓');
    });
    let rz = null;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 80); });
  }

  // ---------------- aim with phone (device orientation) ----------------
  // Hold the phone as if photographing the object (back camera toward it).
  function setupAim() {
    const btn = $('aimBtn'), msg = $('aimMsg');
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (!('DeviceOrientationEvent' in window) || !touch) return;
    btn.hidden = false;
    let listening = false, reading = null, evName = null;
    const D = Math.PI / 180;
    function onOri(e) {
      let alpha = e.alpha;
      if (typeof e.webkitCompassHeading === 'number') alpha = 360 - e.webkitCompassHeading; // iOS
      else if (!e.absolute && e.type !== 'deviceorientationabsolute') return;
      if (alpha == null || e.beta == null || e.gamma == null) return;
      const a = alpha * D, b = e.beta * D, g = e.gamma * D;
      // direction of the back camera (device −Z) in East/North/Up
      const Ex = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
      const Ny = Math.cos(a) * Math.sin(b) * Math.cos(g) - Math.sin(a) * Math.sin(g);
      const Uz = -Math.cos(b) * Math.cos(g);
      reading = { az: Astro.norm360(Math.atan2(Ex, Ny) / D), el: Math.asin(Math.max(-1, Math.min(1, Uz))) / D };
      msg.textContent = `Pointing at ${reading.az.toFixed(0)}° (${compass16(reading.az)}), ${reading.el.toFixed(0)}° up. Tap "Lock direction" when aimed at the object.`;
    }
    function stopListening() { if (evName) window.removeEventListener(evName, onOri); listening = false; btn.textContent = '📱 Aim with phone'; }
    btn.addEventListener('click', async () => {
      if (listening) {
        stopListening();
        if (reading) {
          $('magnetic').checked = true; $('declWrap').hidden = false;
          $('heading').value = reading.az.toFixed(1); $('elev').value = reading.el.toFixed(1);
          readLook(); resummarize(); updateHash();
          msg.textContent = `Locked: ${reading.az.toFixed(0)}°, ${reading.el.toFixed(0)}° up. Phone compasses read magnetic north and can be off by 5–15°. Enter your declination and keep the tolerance generous.`;
        }
        return;
      }
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          const p = await DeviceOrientationEvent.requestPermission();
          if (p !== 'granted') throw new Error('permission denied');
        }
      } catch (e) { msg.hidden = false; msg.textContent = 'Motion sensors unavailable: ' + e.message; return; }
      evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      window.addEventListener(evName, onOri);
      listening = true; reading = null; msg.hidden = false; btn.textContent = '🎯 Lock direction';
      msg.textContent = 'Point the back of your phone at the object…';
      setTimeout(() => { if (listening && !reading) msg.textContent = 'No compass reading from this device or browser. Enter the heading by hand.'; }, 4000);
    });
  }

  // ---------------- iframe embedding: tell the host page our height ----------------
  let lastH = 0;
  function postHeight() {
    if (window.parent === window) return;
    const h = Math.ceil(document.body.getBoundingClientRect().height + 2);
    if (Math.abs(h - lastH) > 4) { lastH = h; window.parent.postMessage({ type: 'flarecheck-height', height: h }, '*'); }
  }
  if (window.parent !== window) {
    if ('ResizeObserver' in window) new ResizeObserver(postHeight).observe(document.body);
    window.addEventListener('load', postHeight);
    document.addEventListener('toggle', () => setTimeout(postHeight, 50), true); // <details> open/close
  }

  // ---------------- boot ----------------
  initTz();
  initGroups();
  wire();
  const auto = readHash();
  if (!$('when').value) $('when').value = utcToZonedInput(Date.now(), $('tz').value);
  readLook();
  updateUtcEcho();
  render();
  // Show cache status for groups without downloading
  if (auto) run();
})();
