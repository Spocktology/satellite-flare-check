/* catalog.js — loads orbital element sets (TLE) from CelesTrak or user files,
 * caches them in IndexedDB, classifies objects and estimates brightness. */
(function (global) {
  'use strict';

  const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';
  const MAX_AGE_MS = 2 * 3600 * 1000; // CelesTrak updates every ~2 h — don't re-download sooner

  const GROUPS = [
    { id: 'active', label: 'All active satellites', hint: '~16,000 — Starlink, OneWeb, Kuiper, Qianfan, ISS…', on: true },
    { id: 'visual', label: 'Brightest objects', hint: '~150, includes big rocket bodies', on: true },
    { id: 'analyst', label: 'Analyst objects', hint: 'tracked but unidentified', on: false },
    { id: 'fengyun-1c-debris', label: 'Fengyun-1C debris', hint: '~6,000 small fragments', on: false },
    { id: 'cosmos-2251-debris', label: 'Cosmos 2251 debris', hint: '~1,700 fragments', on: false },
    { id: 'iridium-33-debris', label: 'Iridium 33 debris', hint: '~300 fragments', on: false },
  ];

  // ---------- IndexedDB ----------
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('satflare', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('tle');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  async function cacheGet(key) {
    try {
      const d = await db();
      return await new Promise((res) => {
        const q = d.transaction('tle').objectStore('tle').get(key);
        q.onsuccess = () => res(q.result || null);
        q.onerror = () => res(null);
      });
    } catch { return null; }
  }
  async function cachePut(key, val) {
    try {
      const d = await db();
      d.transaction('tle', 'readwrite').objectStore('tle').put(val, key);
    } catch { /* storage unavailable — fine */ }
  }

  // ---------- Parsing ----------
  function tleEpochMs(l1) {
    const yy = parseInt(l1.substring(18, 20), 10);
    const doy = parseFloat(l1.substring(20, 32));
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    return Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
  }

  function parseTLE(text, source) {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l1 = lines[i];
      if (!l1.startsWith('1 ') || l1.length < 64) continue;
      const l2 = lines[i + 1] || '';
      if (!l2.startsWith('2 ')) continue;
      let name = '';
      const prev = lines[i - 1] || '';
      if (i > 0 && !prev.startsWith('1 ') && !prev.startsWith('2 ')) name = prev.replace(/^0 /, '').trim();
      const id = l1.substring(2, 7).trim();
      out.push({ name: name || 'NORAD ' + id, id, l1, l2, epochMs: tleEpochMs(l1), src: source });
      i++;
    }
    return out;
  }

  // ---------- Classification ----------
  const NADIR_PANEL = /^(STARLINK|ONEWEB|KUIPER|QIANFAN|GUOWANG|HULIANWANG|BLUEBIRD|SPACEMOBILE|AST SPACEMOBILE)/i;
  const KNOWN_MAG = [
    [/^ISS \(ZARYA\)/i, -1.8], [/^CSS \(TIANHE\)|^TIANHE/i, -1.0], [/^HST$/i, 2.2],
    [/^BLUEBIRD|SPACEMOBILE/i, 3.0], [/^STARLINK/i, 5.5], [/^ONEWEB/i, 7.5], [/^KUIPER/i, 6.0],
    [/^(QIANFAN|GUOWANG|HULIANWANG)/i, 6.0],
  ];

  function classify(rec) {
    const n = rec.name.toUpperCase();
    let type = 'payload';
    if (/R\/B|ROCKET BODY|\bAKM\b|\bPKM\b/.test(n)) type = 'rocket body';
    else if (/\bDEB\b|DEBRIS|COOLANT|\bOBJECT [A-Z]+\b/.test(n) && !/^ISS/.test(n)) type = /\bDEB\b|DEBRIS/.test(n) ? 'debris' : 'object';
    else if (/^UNKNOWN|^NORAD /.test(n)) type = 'unknown';
    let M0 = type === 'rocket body' ? 4.5 : type === 'debris' ? 8.5 : 6.5;
    for (const [re, m] of KNOWN_MAG) if (re.test(n)) { M0 = m; break; }
    let family = 'other';
    const fm = n.match(/^(STARLINK|ONEWEB|KUIPER|QIANFAN|GUOWANG|HULIANWANG|IRIDIUM|GLOBALSTAR|ORBCOMM|COSMOS|BLUEBIRD)/);
    if (fm) family = fm[1];
    // Approximate area (m²) of the flat Earth-facing surface, for the flare model
    let panelArea = 0;
    if (NADIR_PANEL.test(n)) {
      panelArea = /^STARLINK/.test(n) ? 11 : /BLUEBIRD|SPACEMOBILE/.test(n) ? 64 : /^ONEWEB/.test(n) ? 1.5 : 4;
    }
    return { type, M0, nadirPanel: panelArea > 0, panelArea, family };
  }

  // ---------- Store ----------
  const Catalog = {
    GROUPS,
    sources: new Map(), // key -> {label, records, fetched, kind}

    async loadGroup(id, { force = false } = {}) {
      const key = 'ct:' + id;
      const cached = await cacheGet(key);
      const fresh = cached && Date.now() - cached.fetched < MAX_AGE_MS;
      let text, fetched, note = '';
      if (cached && (fresh || !force)) {
        if (fresh || !navigator.onLine) { text = cached.text; fetched = cached.fetched; }
      }
      if (!text) {
        try {
          const r = await fetch(`${CELESTRAK}?GROUP=${encodeURIComponent(id)}&FORMAT=tle`);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          text = await r.text();
          if (!/^1 /m.test(text)) throw new Error(text.trim().slice(0, 80) || 'no data');
          fetched = Date.now();
          cachePut(key, { text, fetched });
        } catch (e) {
          if (cached) { text = cached.text; fetched = cached.fetched; note = 'using cached copy (' + e.message + ')'; }
          else throw e;
        }
      }
      const records = parseTLE(text, 'CelesTrak:' + id);
      const g = GROUPS.find((x) => x.id === id);
      this.sources.set(key, { label: g ? g.label : id, records, fetched, kind: 'celestrak', note });
      return this.sources.get(key);
    },

    addFile(name, text) {
      const records = parseTLE(text, 'file:' + name);
      if (!records.length) throw new Error('No TLE records found in ' + name);
      this.sources.set('file:' + name, { label: name, records, fetched: Date.now(), kind: 'file' });
      return this.sources.get('file:' + name);
    },

    remove(key) { this.sources.delete(key); },

    /* Build the working set for a sighting time: one element set per NORAD id,
     * choosing the epoch closest to the sighting (lets historical files win). */
    select(t0, activeKeys) {
      const best = new Map();
      for (const [key, s] of this.sources) {
        if (activeKeys && !activeKeys.has(key)) continue;
        for (const r of s.records) {
          const cur = best.get(r.id);
          const d = Math.abs(r.epochMs - t0);
          if (!cur || d < Math.abs(cur.epochMs - t0) - 1 || (d <= Math.abs(cur.epochMs - t0) + 1 && r.src.startsWith('file:') && !cur.src.startsWith('file:'))) {
            best.set(r.id, r);
          }
        }
      }
      const out = [];
      for (const r of best.values()) {
        let satrec;
        try { satrec = satellite.twoline2satrec(r.l1, r.l2); } catch { continue; }
        if (!satrec || satrec.error) continue;
        out.push(Object.assign({}, r, classify(r), { satrec, ageDays: (t0 - r.epochMs) / 86400000 }));
      }
      return out;
    },

    classify, parseTLE,
  };

  global.Catalog = Catalog;
})(window);
