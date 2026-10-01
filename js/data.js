/* Data ingestion. Skill: skills/data-ingestion/SKILL.md
   All endpoints are free, keyless and CORS-enabled (verified 2026-10-01). */
(function (root) {
  const AA = root.AA, M = AA.math;
  const D = {};
  const cache = new Map();

  D.fetchJSON = async (url, { timeout = 15000, cacheTtl = 5 * 60e3, ...init } = {}) => {
    const key = url + (init.body || '');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < cacheTtl) return hit.v;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} from ${new URL(url).host}`);
      const v = await r.json();
      cache.set(key, { t: Date.now(), v });
      return v;
    } finally { clearTimeout(timer); }
  };

  // ---------------- live hazards ----------------
  const GDACS = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist';
  D.gdacsLive = async () => {
    const j = await D.fetchJSON(`${GDACS}/EVENTS4APP`, { cacheTtl: 60e3 });
    return (j.features || []).map((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      return {
        src: 'GDACS', prov: 'live', id: `${p.eventtype}-${p.eventid}`, hazard: p.eventtype, lat, lon,
        name: p.name, country: p.country || (p.affectedcountries || []).map((c) => c.countryname).join(', ') || 'Offshore',
        iso2: (p.affectedcountries || [])[0]?.iso2 || '', alertscore: p.alertscore, alertlevel: p.alertlevel, episodealertscore: p.episodealertscore, episodealertlevel: p.episodealertlevel,
        severity: p.severitydata?.severity, severityUnit: p.severitydata?.severityunit, severityText: p.severitydata?.severitytext,
        from: p.fromdate, to: p.todate, current: p.iscurrent === 'true' || p.iscurrent === true,
        url: p.url?.report, eventid: p.eventid, episodeid: p.episodeid,
      };
    });
  };
  D.usgsLive = async () => {
    const j = await D.fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson', { cacheTtl: 60e3 });
    return (j.features || []).map((f) => {
      const p = f.properties, [lon, lat, depth] = f.geometry.coordinates;
      return { src: 'USGS', prov: 'live', id: f.id, hazard: 'EQ', lat, lon, depth, magnitude: p.mag, mmi: p.mmi, pager: p.alert, tsunami: p.tsunami, name: p.title, country: (p.place || '').split(', ').pop(), from: new Date(p.time).toISOString(), to: new Date(p.time).toISOString(), current: true, url: p.url };
    });
  };
  const EONET_MAP = { severeStorms: 'TC', wildfires: 'WF', volcanoes: 'VO', floods: 'FL', earthquakes: 'EQ', drought: 'DR' };
  D.eonetLive = async () => {
    const j = await D.fetchJSON('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=20', { cacheTtl: 60e3 });
    return (j.events || []).map((e) => {
      const hz = EONET_MAP[e.categories?.[0]?.id]; if (!hz) return null;
      const g = e.geometry[e.geometry.length - 1];
      const c = g.type === 'Point' ? g.coordinates : g.coordinates[0][0];
      if (hz === 'WF' && /prescribed|\bRX\b/i.test(e.title)) return null; // planned burns are not disasters
      let sev = g.magnitudeValue, unit = g.magnitudeUnit;
      if (hz === 'TC' && unit === 'kts') { sev = sev * 1.852; unit = 'km/h'; }
      if (hz === 'WF' && /acre/i.test(unit || '')) { sev = sev * 0.4047; unit = 'ha'; }
      return { src: 'NASA EONET', prov: 'live', id: e.id, hazard: hz, lat: c[1], lon: c[0], name: e.title, country: '', severity: sev, severityUnit: unit, from: e.geometry[0].date, to: g.date, current: true, url: e.sources?.[0]?.url, alertscore: null };
    }).filter(Boolean);
  };

  /** Unified Severity Index (skill: modes). */
  D.usi = (e) => {
    const PAGER = { green: 0, yellow: 0.33, orange: 0.67, red: 1 };
    // agency alert: GDACS blends the event alert with the current episode (a decayed storm keeps its old Red),
    // USGS PAGER (absent = below alert threshold), EONET has no alert → small prior
    let A;
    if (e.alertscore != null) {
      const ev = M.clamp((e.alertscore - 1) / 2, 0, 1), ep = e.episodealertscore != null ? M.clamp((e.episodealertscore - 1) / 2, 0, 1) : ev;
      A = 0.3 * ev + 0.7 * ep;
    } else if (e.src === 'USGS') A = e.pager ? PAGER[e.pager] : 0;
    else A = 0.1;
    let m = 0;
    const s = e.severity;
    if (e.hazard === 'EQ') m = M.clamp(((e.magnitude ?? s) - 4) / 5, 0, 1);
    else if (e.hazard === 'TC') m = M.clamp((s || 0) / 300, 0, 1);
    else if (e.hazard === 'WF') m = M.clamp(Math.log10(Math.max(1, s || 1)) / 6, 0, 1);
    else if (e.hazard === 'DR') m = M.clamp(Math.log10(Math.max(1, s || 1)) / 6.5, 0, 1);
    else m = A;
    const h = AA.HAZARDS[e.hazard]?.lethal ?? 0.5;
    const usi = 0.5 * A + 0.35 * m + 0.15 * h;
    return { usi, A, m, h };
  };

  D.liveEvents = async () => {
    const [g, u, n] = await Promise.allSettled([D.gdacsLive(), D.usgsLive(), D.eonetLive()]);
    const gd = g.status === 'fulfilled' ? g.value : [];
    const us = u.status === 'fulfilled' ? u.value : [];
    const eo = n.status === 'fulfilled' ? n.value : [];
    const errors = [g, u, n].map((x, k) => (x.status === 'rejected' ? ['GDACS', 'USGS', 'EONET'][k] + ': ' + x.reason.message : null)).filter(Boolean);
    const now = Date.now();
    const age = (e) => (e.to ? now - new Date(e.to.endsWith('Z') ? e.to : e.to + 'Z').getTime() : 0);
    const recent = (e) => (e.current && age(e) < 14 * 864e5) || age(e) < 7 * 864e5; // GDACS marks long droughts not-current while still updating them
    let all = gd.filter(recent).map((e) => ({ ...e, magnitude: e.hazard === 'EQ' ? parseFloat(e.severity) : undefined }));
    us.forEach((q) => { // merge USGS detail into GDACS EQ, or add
      const twin = all.find((e) => e.hazard === 'EQ' && M.haversine(e, q) < 100 && Math.abs(new Date(e.from + (e.from.endsWith('Z') ? '' : 'Z')) - new Date(q.from)) < 2 * 36e5);
      if (twin) Object.assign(twin, { magnitude: q.magnitude, depth: q.depth, mmi: q.mmi, pager: q.pager, usgsUrl: q.url, src: 'GDACS + USGS' });
      else all.push(q);
    });
    eo.forEach((e) => { if (!all.some((x) => x.hazard === e.hazard && M.haversine(x, e) < 150)) all.push(e); });
    all.forEach((e) => Object.assign(e, D.usi(e)));
    all.sort((a, b) => b.usi - a.usi || new Date(b.to) - new Date(a.to));
    return { events: all, errors, counts: { gdacs: gd.length, usgs: us.length, eonet: eo.length } };
  };

  /** Agency-reported human impact for a GDACS event (Sendai-framework entries in geteventdata).
   *  Each entry is a running total for one place and one kind, so take the maximum per (kind, place, wording)
   *  and add across places. "Out of contact" / "missing" count as missing; "evacuated" as displaced. */
  D.parseSendai = (list) => {
    const best = new Map();
    (list || []).forEach((x) => {
      const v = parseFloat(String(x.sendaivalue).replace(/[^0-9.]/g, '')); if (!(v > 0)) return;
      const name = (x.sendainame || '').toLowerCase(), desc = (x.description || '').toLowerCase();
      if (!/\[people\]|people|persons/.test(desc) && !/death|injur|missing|displac|affect|evacu/.test(name)) return;
      let kind = null;
      if (/death|dead|fatalit|killed/.test(name + ' ' + desc)) kind = 'deaths';
      else if (/missing|out of contact/.test(name + ' ' + desc)) kind = 'missing';
      else if (/injur/.test(name)) kind = 'injured';
      else if (/displac|evacu|homeless|shelter/.test(name + ' ' + desc)) kind = 'displaced';
      else if (/affect/.test(name)) kind = 'affected';
      if (!kind) return;
      const wording = desc.replace(/^[\d,.\s]+/, '').replace(/\s+in\s+.*$/, '');
      const key = [kind, x.country, x.region, wording].join('|');
      best.set(key, Math.max(best.get(key) || 0, v));
    });
    const out = { deaths: 0, missing: 0, injured: 0, displaced: 0, affected: 0 };
    best.forEach((v, key) => (out[key.split('|')[0]] += v));
    const dates = (list || []).map((x) => x.dateinsert).filter(Boolean).sort();
    out.asOf = dates.length ? dates[dates.length - 1].slice(0, 10) : null;
    return out.deaths + out.missing + out.injured + out.displaced + out.affected > 0 ? out : null;
  };
  D.gdacsImpacts = async (type, id) => {
    const j = await D.fetchJSON(`https://www.gdacs.org/gdacsapi/api/events/geteventdata?eventtype=${type}&eventid=${id}`, { timeout: 15000, cacheTtl: 30 * 60e3 });
    const r = D.parseSendai(j?.properties?.sendai);
    if (r) { r.source = 'GDACS (Sendai impact reports)'; r.url = j?.properties?.url?.report; }
    return r;
  };
  /** Terrain relief (m) within ~20 km: max − min of a 5×5 elevation grid (Open-Meteo, Copernicus DEM). */
  D.relief = async (c) => {
    const la = [], lo = [];
    for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) { la.push((c.lat + i * 0.09).toFixed(3)); lo.push((c.lon + k * 0.1).toFixed(3)); }
    const j = await D.elevation(la, lo);
    const e = (j.elevation || []).filter((x) => x != null && x > -100);
    return e.length ? Math.max(...e) - Math.min(...e) : null;
  };

  /** GDACS event outline (MultiPolygon/Polygon features only) → array of polygons in GeoJSON order. */
  D.gdacsGeometry = async (type, id, episode = 1) => {
    const j = await D.fetchJSON(`https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=${type}&eventid=${id}&episodeid=${episode || 1}`, { timeout: 20000, cacheTtl: 30 * 60e3 });
    const polys = [];
    (j.features || []).forEach((f) => {
      const g = f.geometry || {};
      if (g.type === 'Polygon') polys.push(g.coordinates);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => polys.push(p));
    });
    return polys.length ? polys : null;
  };

  /** River-flow ratio at many points (GloFAS via Open-Meteo): max daily discharge in the last 7 days + next 7 days
   *  ÷ median daily discharge over the previous 365 days. ratio ≥ 2 ≈ out-of-bank flow. */
  D.flowRatios = async (pts) => {
    if (!pts.length) return [];
    const day = (d) => d.toISOString().slice(0, 10), now = new Date();
    const start = day(new Date(now - 372 * 864e5)), end = day(new Date(+now + 7 * 864e5));
    const j = await D.fetchJSON(`https://flood-api.open-meteo.com/v1/flood?latitude=${pts.map((p) => p.lat.toFixed(3)).join(',')}&longitude=${pts.map((p) => p.lon.toFixed(3)).join(',')}&daily=river_discharge&start_date=${start}&end_date=${end}`, { timeout: 40000, cacheTtl: 30 * 60e3 });
    const arr = Array.isArray(j) ? j : [j];
    return arr.map((loc) => D.flowRatio(loc?.daily?.time || [], loc?.daily?.river_discharge || [], day(new Date(now - 7 * 864e5))));
  };
  D.flowRatio = (time, q, recentFrom) => {
    const past = [], recent = [];
    time.forEach((t, i) => { const v = q[i]; if (v == null || !(v >= 0)) return; (t >= recentFrom ? recent : past).push(v); });
    if (past.length < 60 || !recent.length) return null;
    const med = M.quantile(past, 0.5);
    if (!(med > 0.5)) return null; // dry channel or no river at this cell: ratio meaningless
    return { ratio: Math.max(...recent) / med, median: med, peak: Math.max(...recent) };
  };

  /** WorldPop 2020 population inside a polygon ring (sync call; falls back to polling the task). */
  D.worldpop = async (ring, year = 2020) => {
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] });
    const base = 'https://api.worldpop.org/v1';
    let j = await D.fetchJSON(`${base}/services/stats?dataset=wpgppop&year=${year}&geojson=${encodeURIComponent(gj)}&runasync=false`, { timeout: 35000, cacheTtl: 864e5 });
    for (let k = 0; k < 6 && j && j.status !== 'finished' && j.taskid; k++) {
      await new Promise((r) => setTimeout(r, 2500));
      j = await D.fetchJSON(`${base}/tasks/${j.taskid}`, { timeout: 15000, cacheTtl: 0 });
    }
    const v = j?.data?.total_population;
    if (!(v >= 0)) throw new Error('WorldPop: no result');
    return v;
  };

  /** USGS PAGER loss estimate for an earthquake: fatality probability bins, median fatalities, population exposure by MMI. */
  D.pagerLosses = async (usgsId) => {
    const det = await D.fetchJSON(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/${usgsId}.geojson`, { timeout: 20000, cacheTtl: 30 * 60e3 });
    const pr = det?.properties?.products?.losspager?.[0];
    const c = pr?.contents || {};
    const url = (k) => c[k]?.url;
    if (!url('json/alerts.json')) return null;
    const [al, lo, ex] = await Promise.allSettled([D.fetchJSON(url('json/alerts.json'), { timeout: 20000 }), url('json/losses.json') ? D.fetchJSON(url('json/losses.json'), { timeout: 20000 }) : null, url('json/exposures.json') ? D.fetchJSON(url('json/exposures.json'), { timeout: 20000 }) : null]);
    const fat = al.status === 'fulfilled' ? al.value?.fatality : null;
    if (!fat?.bins) return null;
    const out = { level: fat.level, bins: fat.bins.map((b) => ({ min: +b.min, max: +b.max, p: +b.probability })), source: 'USGS PAGER', url: det?.properties?.url ? det.properties.url + '/pager' : null };
    if (lo.status === 'fulfilled' && lo.value?.empirical_fatality) out.median = +lo.value.empirical_fatality.total_fatalities;
    const pe = ex.status === 'fulfilled' ? ex.value?.population_exposure : null;
    if (pe?.mmi && pe?.aggregated_exposure) out.exposure = pe.mmi.map((m, i) => ({ mmi: +m, pop: +pe.aggregated_exposure[i] || 0 }));
    return out;
  };
  /** USGS event id from a USGS event page URL or id. */
  D.usgsIdOf = (e) => (e?.src === 'USGS' && e.id) || (/eventpage\/([a-z0-9]+)/i.exec(e?.usgsUrl || e?.url || '') || [])[1] || null;

  /** Text fetch (CSV inventories, published Google Sheets). */
  D.fetchText = async (url, timeout = 20000) => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`); return await r.text(); }
    finally { clearTimeout(t); }
  };
  /** Turn a Google Sheets link into its CSV export link (sheet must be shared "anyone with the link" or published). */
  D.sheetCsvUrl = (u) => {
    const m = /docs\.google\.com\/spreadsheets\/d\/(e\/)?([\w-]+)/.exec(u || ''); if (!m) return u;
    if (m[1]) return /output=csv/.test(u) ? u : `https://docs.google.com/spreadsheets/d/e/${m[2]}/pub?output=csv`;
    const gid = (/[#&?]gid=(\d+)/.exec(u) || [])[1];
    return `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
  };

  // ---------------- history ----------------
  D.usgsHistory = async (lat, lon, radiusKm = 300, minMag = 5.5, start = '1900-01-01') => {
    const j = await D.fetchJSON(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=${radiusKm}&minmagnitude=${minMag}&starttime=${start}&orderby=time&limit=200`, { timeout: 25000 });
    return (j.features || []).map((f) => ({ src: 'USGS', prov: 'historical', id: f.id, hazard: 'EQ', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2], magnitude: f.properties.mag, mmi: f.properties.mmi, pager: f.properties.alert, name: f.properties.title, from: new Date(f.properties.time).toISOString(), url: f.properties.url }));
  };
  D.gdacsHistory = async (country, from = '2000-01-01') => {
    const to = new Date().toISOString().slice(0, 10);
    const j = await D.fetchJSON(`${GDACS}/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&fromDate=${from}&toDate=${to}&alertlevel=Orange;Red&country=${encodeURIComponent(country)}`, { timeout: 25000 });
    return (j.features || []).map((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      return { src: 'GDACS', prov: 'historical', id: `${p.eventtype}-${p.eventid}`, hazard: p.eventtype, lat, lon, name: p.name, country: p.country, alertscore: p.alertscore, alertlevel: p.alertlevel, severity: p.severitydata?.severity, severityUnit: p.severitydata?.severityunit, from: p.fromdate, to: p.todate, url: p.url?.report, magnitude: p.eventtype === 'EQ' ? p.severitydata?.severity : undefined };
    });
  };
  D.eonetHistory = async (bbox, start = '2000-01-01') => {
    const [w, s, e, n] = bbox; // minLon,minLat,maxLon,maxLat
    const j = await D.fetchJSON(`https://eonet.gsfc.nasa.gov/api/v3/events?status=all&bbox=${w},${n},${e},${s}&start=${start}&limit=300`, { timeout: 30000 });
    return (j.events || []).map((ev) => {
      const hz = EONET_MAP[ev.categories?.[0]?.id]; if (!hz) return null;
      const g = ev.geometry[0]; const c = g.type === 'Point' ? g.coordinates : g.coordinates[0][0];
      let sev = g.magnitudeValue; if (hz === 'TC' && g.magnitudeUnit === 'kts') sev *= 1.852;
      return { src: 'NASA EONET', prov: 'historical', id: ev.id, hazard: hz, lat: c[1], lon: c[0], name: ev.title, severity: sev, severityUnit: g.magnitudeUnit, from: g.date, url: ev.sources?.[0]?.url };
    }).filter(Boolean);
  };

  // ---------------- geocoding (Nominatim, ≤ 1 req/s) ----------------
  let lastNom = 0;
  const nomThrottle = async () => { const w = 1100 - (Date.now() - lastNom); if (w > 0) await new Promise((r) => setTimeout(r, w)); lastNom = Date.now(); };
  D.geocode = async (q) => {
    await nomThrottle();
    const j = await D.fetchJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&addressdetails=1`, { cacheTtl: 36e5 });
    return j.map((r) => ({ name: r.display_name, short: r.name || r.display_name.split(',')[0], lat: +r.lat, lon: +r.lon, country: r.address?.country, iso2: (r.address?.country_code || '').toUpperCase(), bbox: r.boundingbox?.map(Number) }));
  };
  D.reverse = async (lat, lon) => {
    await nomThrottle();
    const r = await D.fetchJSON(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`, { cacheTtl: 36e5 });
    return { name: r.display_name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, short: r.address?.city || r.address?.town || r.address?.county || r.address?.state || r.name || 'Selected point', country: r.address?.country || '', iso2: (r.address?.country_code || '').toUpperCase() };
  };

  // ---------------- OSM Overpass (raced mirrors) ----------------
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  D.overpass = async (ql, timeout = 30000) => {
    const key = 'ovp:' + ql; const hit = cache.get(key); if (hit) return hit.v;
    const body = 'data=' + encodeURIComponent(ql);
    const v = await Promise.any(OVERPASS.map((u) => D.fetchJSON(u, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout, cacheTtl: 0 }).then((j) => { if (!j.elements) throw new Error('bad'); return j; })));
    cache.set(key, { t: Date.now(), v }); return v;
  };
  const bboxOf = (c, km) => { const dLat = km / 110.57, dLon = km / (111.32 * Math.cos(M.toRad(c.lat))); return [c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon]; };
  D.bboxOf = bboxOf;
  D.places = async (c, km) => {
    const b = bboxOf(c, km).join(',');
    const types = km > 80 ? 'city|town' : 'city|town|village';
    const j = await D.overpass(`[out:json][timeout:25];node["place"~"^(${types})$"](${b});out 400;`);
    return j.elements.map((e) => ({ name: e.tags?.name || e.tags?.['name:en'] || 'Unnamed', lat: e.lat, lon: e.lon, type: e.tags.place, population: parseInt(String(e.tags.population || '').replace(/[^0-9]/g, ''), 10) || 0, src: 'OSM' }));
  };
  /** Fallback facility search via Nominatim (bounded viewbox), used when Overpass is slow or down. */
  D.facilitiesNominatim = async (c, km) => {
    const [s, w, n, e] = bboxOf(c, km);
    const kinds = [['hospital', 'hospital'], ['fire station', 'fire_station'], ['police', 'police'], ['warehouse', 'warehouse']];
    const out = [];
    for (const [q, type] of kinds) {
      await nomThrottle();
      try {
        const j = await D.fetchJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=25&bounded=1&viewbox=${w},${n},${e},${s}`, { cacheTtl: 36e5, timeout: 12000 });
        j.forEach((r) => out.push({ name: r.name || r.display_name.split(',')[0], type, lat: +r.lat, lon: +r.lon, beds: 0, src: 'OSM (Nominatim)', osm: `${r.osm_type}/${r.osm_id}` }));
      } catch (err) { /* keep what we have */ }
    }
    return out;
  };
  D.facilitiesAny = async (c, km) => {
    try { const f = await D.facilities(c, km, 20000); if (f.length) return f; } catch (e) { /* fall through */ }
    return D.facilitiesNominatim(c, km);
  };
  D.facilities = async (c, km, timeout = 30000) => {
    const b = bboxOf(c, km).join(',');
    const q = `[out:json][timeout:25];(nwr["amenity"~"^(hospital|fire_station|police)$"](${b});nwr["building"="warehouse"]["name"](${b});nwr["industrial"="warehouse"](${b});nwr["shop"="wholesale"](${b}););out center 300;`;
    const j = await D.overpass(q, timeout);
    return j.elements.map((e) => {
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon; if (lat == null) return null;
      const t = e.tags || {};
      const type = t.amenity === 'hospital' ? 'hospital' : t.amenity === 'fire_station' ? 'fire_station' : t.amenity === 'police' ? 'police' : 'warehouse';
      return { name: t.name || t['name:en'] || ({ hospital: 'Hospital', fire_station: 'Fire station', police: 'Police station', warehouse: 'Warehouse' })[type], type, lat, lon, beds: parseInt(t.beds, 10) || 0, src: 'OSM', osm: `${e.type}/${e.id}` };
    }).filter(Boolean);
  };

  // ---------------- OSRM ----------------
  const OSRM = 'https://router.project-osrm.org';
  const pts = (ps) => ps.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  D.osrmTable = async (points) => {
    const j = await D.fetchJSON(`${OSRM}/table/v1/driving/${pts(points)}?annotations=duration,distance`, { timeout: 20000, cacheTtl: 10 * 60e3 });
    if (j.code !== 'Ok') throw new Error('OSRM table: ' + j.code);
    return { dur: j.durations, dist: j.distances, snapped: j.sources.map((s) => ({ lat: s.location[1], lon: s.location[0], offKm: s.distance / 1000 })) };
  };
  let osrmQueue = Promise.resolve();
  D.osrmRoute = (points) => { // serialised, ≥ 250 ms apart, to respect the public demo server
    const run = async () => {
      const alt = points.length === 2 ? '&alternatives=2' : '';
      const j = await D.fetchJSON(`${OSRM}/route/v1/driving/${pts(points)}?overview=full&geometries=geojson${alt}`, { timeout: 20000, cacheTtl: 10 * 60e3 });
      if (j.code !== 'Ok') throw new Error('OSRM route: ' + j.code);
      return j.routes;
    };
    const p = osrmQueue.then(() => new Promise((r) => setTimeout(r, 250))).then(run);
    osrmQueue = p.catch(() => {});
    return p;
  };
  D.osrmNearest = async (p) => {
    const j = await D.fetchJSON(`${OSRM}/nearest/v1/driving/${p.lon.toFixed(5)},${p.lat.toFixed(5)}?number=1`, { timeout: 10000, cacheTtl: 36e5 });
    const w = j.waypoints?.[0]; if (!w) return null;
    return { lat: w.location[1], lon: w.location[0], offKm: w.distance / 1000 };
  };

  // ---------------- weather, floods, elevation ----------------
  D.forecast = (lat, lon) => D.fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,wind_gusts_10m_max&forecast_days=7&timezone=auto`, { cacheTtl: 30 * 60e3 });
  D.floodSeries = (lats, lons, start, end) => D.fetchJSON(`https://flood-api.open-meteo.com/v1/flood?latitude=${lats.join(',')}&longitude=${lons.join(',')}&daily=river_discharge&start_date=${start}&end_date=${end}`, { timeout: 40000, cacheTtl: 36e5 });
  D.floodNow = (lat, lon) => D.fetchJSON(`https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge,river_discharge_median,river_discharge_max&past_days=3&forecast_days=7`, { cacheTtl: 30 * 60e3 });
  D.elevation = (lats, lons) => D.fetchJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`, { cacheTtl: 36e5 });

  // ---------------- socio-economic (World Bank) ----------------
  D.countryIndex = async (iso2) => {
    const out = { beds: null, gdppc: null, vul: 0.5, lcc: 0.5, prov: 'assumed' };
    if (!iso2) return out;
    try {
      const get = async (ind) => { const j = await D.fetchJSON(`https://api.worldbank.org/v2/country/${iso2}/indicator/${ind}?format=json&mrnev=1`, { cacheTtl: 864e5 }); return j?.[1]?.[0]?.value ?? null; };
      const [beds, gdppc] = await Promise.all([get('SH.MED.BEDS.ZS'), get('NY.GDP.PCAP.CD')]);
      out.beds = beds; out.gdppc = gdppc;
      const gN = gdppc ? M.clamp((Math.log10(gdppc) - 2.6) / 2.4, 0, 1) : 0.5;
      const bN = beds != null ? M.clamp(beds / 8, 0, 1) : 0.5;
      out.vul = M.clamp(0.5 * (1 - gN) + 0.5 * (1 - bN), 0.05, 0.95);
      out.lcc = M.clamp(1 - bN, 0.05, 0.95);
      out.prov = 'World Bank';
    } catch (e) { /* keep defaults */ }
    return out;
  };

  AA.data = D;
})(typeof window !== 'undefined' ? window : globalThis);
