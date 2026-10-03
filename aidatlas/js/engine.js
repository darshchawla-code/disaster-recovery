/* Orchestrator + dynamic response. Skills: orchestrator, dynamic-response */
(function (root) {
  const AA = root.AA, M = AA.math;
  const ENG = {};
  const listeners = new Set();
  ENG.on = (fn) => listeners.add(fn);
  const emit = (type, data) => listeners.forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } });

  // Assumed starting stocks by facility type (units per commodity) — labelled "assumed" in UI.
  ENG.STOCK = {
    warehouse: { stock: { water: 300, food: 80, shelter: 2000, medical: 100, staff: 20 }, fleet: { truck: 10, bus: 1, amb: 0 }, repl: 0.1 },
    staging: { stock: { water: 250, food: 60, shelter: 1500, medical: 120, staff: 50 }, fleet: { truck: 8, bus: 2, amb: 2 }, repl: 0.1 },
    hospital: { stock: { water: 40, food: 5, shelter: 0, medical: 300, staff: 80 }, fleet: { truck: 2, bus: 2, amb: 6 }, repl: 0.05 },
    fire_station: { stock: { water: 120, food: 5, shelter: 200, medical: 40, staff: 40 }, fleet: { truck: 4, bus: 1, amb: 2 }, repl: 0.05 },
    police: { stock: { water: 20, food: 5, shelter: 100, medical: 20, staff: 60 }, fleet: { truck: 2, bus: 2, amb: 0 }, repl: 0.02 },
    airlift: { stock: { water: 200, food: 60, shelter: 1000, medical: 150, staff: 40 }, fleet: { truck: 6, bus: 2, amb: 2 }, repl: 0 },
  };
  const TYPE_LABEL = { warehouse: 'Warehouse', staging: 'Staging site (modelled)', hospital: 'Hospital', fire_station: 'Fire station', police: 'Police station', airlift: 'New supply arrival' };
  ENG.TYPE_LABEL = TYPE_LABEL;

  // ---------------- situations ----------------
  const S0 = AA.prediction.ALERT_S0;
  ENG.situationFromEvent = (e) => {
    const sit = { hazard: e.hazard, lat: e.lat, lon: e.lon, name: e.name, country: e.country, iso2: e.iso2 || '', src: e.src, prov: e.prov || 'live', event: e, peakInHours: 0 };
    if (e.hazard === 'EQ') {
      sit.magnitude = +(e.magnitude ?? e.severity ?? 6); sit.depth = Math.max(5, +(e.depth ?? 10));
      if (e.mmi) sit.mmiA = M.clamp(e.mmi - 1.5 * sit.magnitude + 4.0 * Math.log10(sit.depth), 1.0, 4.0);
    } else if (e.hazard === 'TC') {
      sit.magnitude = Math.max(60, +(e.severity || 120));
      // GDACS reports the storm's lifetime maximum wind; cap it to the current episode's alert band
      const cap = { 1: 118, 2: 177 }[e.episodealertscore];
      if (cap && sit.magnitude > cap) { sit.windNote = `Reported ${Math.round(sit.magnitude)} km/h is the lifetime maximum; the current GDACS episode is ${e.episodealertlevel}, so planning uses ${cap} km/h.`; sit.magnitude = cap; }
    } else {
      sit.magnitude = S0[e.alertscore || 1] ?? 0.5;
      if (e.hazard === 'WF') sit.areaKm2 = Math.max(5, (+e.severity || 2000) / 100);
      if (e.hazard === 'DR') sit.areaKm2 = Math.max(500, +e.severity || 20000);
      if (e.hazard === 'FL') sit.radiusKm = 40;
    }
    return sit;
  };
  ENG.situationFromPlan = (p) => {
    const sit = { hazard: p.hazard, lat: p.lat, lon: p.lon, name: p.name, country: p.country, iso2: p.iso2, src: 'Planning scenario', prov: 'scenario', peakInHours: +p.peakInHours || 0 };
    if (p.hazard === 'EQ') { sit.magnitude = +p.magnitude; sit.depth = +p.depth || 10; }
    else if (p.hazard === 'TC') sit.magnitude = +p.magnitude;
    else { sit.magnitude = M.clamp(+p.magnitude, 0.1, 1); if (p.hazard === 'FL') sit.radiusKm = +p.radiusKm || 40; if (p.hazard === 'WF') sit.areaKm2 = +p.areaKm2 || 50; if (p.hazard === 'DR') sit.areaKm2 = +p.areaKm2 || 20000; }
    return sit;
  };

  // ---------------- depots ----------------
  const mkDepot = (f, sit, scale, kind) => {
    const t = ENG.STOCK[kind] || ENG.STOCK.warehouse;
    const I = AA.prediction.intensity(sit, M.haversine(sit, f));
    const sev = AA.prediction.impact(sit.hazard, I, sit.countryVul).sev;
    const stock = {}; Object.entries(t.stock).forEach(([k, v]) => (stock[k] = v * scale));
    return { id: '', name: f.name, type: kind, typeLabel: TYPE_LABEL[kind], lat: f.lat, lon: f.lon, sev, open: sev < 0.6, damaged: sev >= 0.6, stock, init: { ...stock }, fleet: { ...t.fleet }, repl: t.repl, prov: kind === 'staging' ? 'modelled' : kind === 'airlift' ? 'event' : 'osm-location / assumed-stock', osm: f.osm, beds: f.beds, address: f.address || '', unnamed: !!f.unnamed || kind === 'staging' };
  };
  ENG.pickDepots = (sit, facs, scale = 1) => {
    const c = sit.focus || sit, R = sit.radiusKm;
    const near = (type, n) => facs.filter((f) => f.type === type).map((f) => ({ f, d: M.haversine(c, f) })).filter((x) => x.d <= R + 30).sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.f);
    const chosen = [...near('warehouse', 3).map((f) => [f, 'warehouse']), ...near('hospital', 3).map((f) => [f, 'hospital']), ...near('fire_station', 2).map((f) => [f, 'fire_station']), ...near('police', 1).map((f) => [f, 'police'])];
    let depots = chosen.map(([f, k]) => mkDepot(f, sit, scale, k));
    // ensure capacity outside the damage footprint: staging sites on a ring when too few are usable
    if (depots.filter((d) => d.open).length < 3 || !depots.some((d) => d.type === 'warehouse')) {
      const ring = Math.min(R + 10, 80);
      [45, 135, 225, 315].forEach((b, k) => { const p = M.destination(c, b, ring); depots.push(mkDepot({ ...p, name: `Staging site ${'ABCD'[k]}` }, sit, scale, 'staging')); });
    }
    depots = depots.slice(0, 10);
    depots.forEach((d, j) => (d.id = 'D' + (j + 1)));
    return depots;
  };

  // ---------------- build a planning state ----------------
  ENG.state = null;
  const progress = (msg) => emit('progress', msg);

  const clone = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v instanceof Set ? [...v] : v)));

  ENG.build = async (sit, opts = {}) => {
    const D = AA.data, P = AA.prediction;
    const sit0 = clone(sit);
    // every external read goes through io(): recorded for saved plans, replayed from the snapshot when restoring
    const snap = opts.snapshot || null, inputs = {};
    const io = async (k, fn) => { if (snap && k in snap) { inputs[k] = snap[k]; if (snap[k] && snap[k].__error) throw new Error(snap[k].__error); return snap[k]; } try { const v = await fn(); inputs[k] = v; return v; } catch (e) { inputs[k] = { __error: e.message }; throw e; } };
    const notes = sit.windNote ? [sit.windNote] : [];
    const ev = sit.event || {};
    const isLive = ev.prov === 'live';
    progress('Reading country vulnerability');
    if (!sit.iso2 || !sit.country) { try { const r = await io('reverse', () => D.reverse(sit.lat, sit.lon)); sit.iso2 = sit.iso2 || r.iso2; sit.country = sit.country || r.country; sit.placeName = r.short; } catch (e) { notes.push('Reverse geocoding unavailable'); } }
    sit.countryIdx = await io('country', () => D.countryIndex(sit.iso2));
    sit.countryVul = sit.countryIdx.vul;
    progress('Locating the impact focus on land');
    try {
      const n = await io('nearest', () => D.osrmNearest(sit));
      if (n && n.offKm > 25) { sit.focus = { lat: n.lat, lon: n.lon, offKm: n.offKm }; notes.push(`Event centre is ${Math.round(n.offKm)} km from the nearest road; planning focus moved to the nearest reachable land point.`); }
    } catch (e) { notes.push('OSRM nearest unavailable'); }
    const gid = ev.eventid || (/^(EQ|TC|FL|VO|DR|WF)-(\d+)$/.exec(ev.id || '') || [])[2];
    const isGdacs = gid && /GDACS/.test(ev.src || '');
    // flood outline published by GDACS: decides where to look for people
    if (sit.hazard === 'FL' && isGdacs) {
      progress('Reading the flood outline (GDACS)');
      try {
        const polys = await io('footprint', () => D.gdacsGeometry('FL', gid, ev.episodeid));
        if (polys) {
          const bb = M.polysBBox(polys), half = Math.max(M.haversine({ lat: bb.s, lon: bb.c.lon }, { lat: bb.n, lon: bb.c.lon }), M.haversine({ lat: bb.c.lat, lon: bb.w }, { lat: bb.c.lat, lon: bb.e })) / 2;
          sit.footprint = polys; sit.footprintBox = bb;
          sit.radiusKm = M.clamp(half, 20, 120);
          if (!M.inPolys(sit.focus || sit, polys)) sit.focus = { ...bb.c, offKm: 0 };
          notes.push(`Flood outline from GDACS: about ${Math.round(2 * half)} km across; towns are searched inside it.`);
        }
      } catch (e) { notes.push('GDACS flood outline unavailable; a circle around the event point is used.'); }
    }
    sit.radiusKm = sit.hazard === 'FL' ? (sit.radiusKm || 40) : P.impactRadius(sit);
    const focus = sit.focus || sit;
    const searchKm = Math.min(sit.radiusKm, 120);
    progress('Finding towns, hospitals, fire stations and warehouses (OpenStreetMap)');
    const [pr, fr] = await Promise.allSettled([io('places', () => D.places(focus, searchKm)), io('facs', () => D.facilitiesAny(focus, Math.min(searchKm, 50) + 20))]);
    let places = pr.status === 'fulfilled' ? pr.value : [];
    const facs = fr.status === 'fulfilled' ? fr.value : [];
    if (sit.footprint && places.length) {
      const inside = places.filter((pl) => M.distToPolys(pl, sit.footprint) <= 5);
      if (inside.length >= 3) places = inside;
    }
    if (!places.length) notes.push('No populated places returned by OpenStreetMap; modelled population sectors used.');
    if (!facs.length) notes.push('No facilities returned by OpenStreetMap; modelled staging sites used.');
    if (sit.hazard === 'FL' && !sit.floodKind) {
      progress('Reading terrain to classify the flood (Open-Meteo elevation)');
      try { sit.reliefM = await io('relief', () => D.relief(focus)); } catch (e) { sit.reliefM = null; }
      sit.floodKind = P.floodKind(sit.name, sit.reliefM);
      notes.push(`Flood type: ${P.FLOOD[sit.floodKind].label}${sit.reliefM != null ? ` (terrain relief ${Math.round(sit.reliefM)} m within 20 km)` : ''}. Deaths are modelled at ${sit.floodKind === 'flash' ? '1 in 100' : '1 in 10,000'} people affected.`);
    }
    facs.forEach((f) => { if (!f.name) { f.name = `${TYPE_LABEL[f.type] || 'Facility'} (unnamed on the map)`; f.unnamed = true; } });
    const zones = P.buildZones({ ...sit, lat: sit.lat, lon: sit.lon, focus }, places, 12);
    // name modelled areas and city quarters after the real locality at that spot (Nominatim reverse geocoding)
    const addrCache = (snap && snap.addr) || {};
    inputs.addr = addrCache;
    const toName = zones.filter((z) => z.needsName);
    if (toName.length) {
      progress('Naming areas from the map (OpenStreetMap)');
      const used = new Set(zones.filter((z) => !z.needsName).map((z) => z.name));
      for (const z of toName) {
        const a = await ENG.lookup(z, 16, addrCache);
        if (a && a.locality) {
          let n = z.parent && a.locality !== z.parent ? `${a.locality}, ${z.parent}` : a.locality;
          if (used.has(n)) n = `${n} (${compass(focus, z)})`;
          z.name = n; z.address = a.address; z.locality = a.locality;
        }
        used.add(z.name);
      }
    }
    // population: WorldPop 100 m grid counts people around each zone (replaces OSM tags / defaults)
    if (AA.config.worldpop !== false && !AA.config.lowBandwidth && zones.length) {
      progress('Counting people around each area (WorldPop 100 m grid)');
      try {
        const pops = await io('worldpop', () => ENG.worldpopZones(zones));
        let n = 0;
        zones.forEach((z, i) => { const v = pops.counts[i]; if (v > 0) { z.popOSM = z.pop; z.pop = v; z.popProv = 'WorldPop 2020'; z.catchKm = pops.radii[i]; n++; } });
        if (n) notes.push(`Population from WorldPop 2020 (100 m grid) for ${n} of ${zones.length} areas; each area counts people within ${Math.round(Math.min(...pops.radii))}–${Math.round(Math.max(...pops.radii))} km.`);
        else notes.push('WorldPop returned no counts; OpenStreetMap populations used.');
      } catch (e) { notes.push('WorldPop unavailable; OpenStreetMap populations or defaults used.'); }
    }
    // observed river flow (live floods only): GloFAS discharge vs its yearly median at each zone
    if (sit.hazard === 'FL' && isLive && zones.length) {
      progress('Reading river flow at each area (GloFAS)');
      try {
        const fl = await io('flow', () => D.flowRatios(zones));
        let n = 0;
        zones.forEach((z, i) => { const f = fl[i]; if (f && f.ratio != null) { z.flow = f; z.sObs = P.flowToS(f.ratio); n++; } });
        if (n) notes.push(`River flow read at ${n} of ${zones.length} areas (GloFAS): flood intensity there comes from flow ÷ yearly median (2× = water leaves the river bed).`);
      } catch (e) { notes.push('River-flow data unavailable; flood intensity modelled from distance.'); }
    }
    zones.forEach((z) => { const I = z.sObs != null ? z.sObs : z.I; z.affEst = z.pop * P.impact(sit.hazard, I, sit.countryVul, 0, sit.floodKind).fAff; });
    progress('Forecasting impact (Monte Carlo)');
    const fcast = P.forecast(sit, zones);
    fcast.modelled = JSON.parse(JSON.stringify(fcast.summary));
    // agency evidence: USGS PAGER loss model for earthquakes, GDACS reported counts for any GDACS event
    if (sit.hazard === 'EQ') {
      const uid = D.usgsIdOf(ev);
      let pg = null;
      if (uid) { progress('Reading the USGS PAGER loss estimate'); try { pg = await io('pager', () => D.pagerLosses(uid)); } catch (e) { notes.push('USGS PAGER loss estimate unavailable.'); } }
      if (pg) {
        fcast.pagerLosses = P.applyPagerLosses(fcast, zones, pg, sit.countryVul); fcast.pagerLosses.url = pg.url; fcast.pagerLosses.median = pg.median;
        const q = fcast.pagerLosses.quantiles;
        notes.push(`USGS PAGER (${pg.level}): deaths most likely ${Math.round(q.p50).toLocaleString()} (10–90 % range ${Math.round(q.p10).toLocaleString()}–${Math.round(q.p90).toLocaleString()}); used instead of our curve${fcast.pagerLosses.aff ? `; people affected from PAGER shaking exposure ${Math.round(fcast.pagerLosses.aff).toLocaleString()}` : ''}.`);
      } else if (ev.pager) {
        const r = P.applyPager(fcast, zones, ev.pager);
        if (r && !r.kept) notes.push(`USGS PAGER alert is ${ev.pager}; fatalities were moved into its band (model ${Math.round(r.from)} → ${Math.round(r.to)}).`);
        fcast.pager = r;
      }
    }
    if (isGdacs) {
      progress('Reading agency-reported impact (GDACS)');
      try {
        const rep = await io('reported', () => D.gdacsImpacts(sit.hazard, gid));
        if (rep) {
          fcast.reported = rep; fcast.reportChanges = P.applyReported(fcast, zones, rep, sit.hazard === 'FL' ? P.FLOOD[sit.floodKind] : null);
          notes.push(`Reported by agencies (GDACS, ${rep.asOf || 'latest'}): ${['deaths', 'missing', 'injured', 'displaced', 'affected'].filter((k) => rep[k] > 0).map((k) => `${Math.round(rep[k]).toLocaleString()} ${k}`).join(', ')}. Forecast raised so it is never below these confirmed counts.`);
        }
      } catch (e) { notes.push('GDACS impact reports unavailable; figures are modelled only.'); }
    }
    const depots = ENG.pickDepots(sit, facs, opts.supplyScale || 1);
    const hospitals = facs.filter((f) => f.type === 'hospital').map((h) => ({ ...h, d: M.haversine(focus, h), sev: P.impact(sit.hazard, P.intensity(sit, M.haversine(sit, h)), sit.countryVul, 0, sit.floodKind).sev }))
      .filter((h) => h.sev < 0.6).sort((a, b) => a.d - b.d).slice(0, 5).map((h, k) => ({ ...h, id: 'H' + (k + 1), beds: Math.round((h.beds || 150) * 0.3), bedsProv: h.beds ? 'osm×30% free' : 'assumed 150×30% free' }));
    ENG.state = { sit, sit0, opts: { mode: opts.mode, supplyScale: opts.supplyScale || 1, warehouses: !!opts.warehouses }, inputs, zones, depots, hospitals, places, facs, fcast, epoch: 0, closures: [], shocks: [], congestion: 1, log: [], decisions: [], events: [], blocked: new Set(), transported: {}, notes, mode: opts.mode, supplyScale: opts.supplyScale || 1, routeCache: new Map(), restoring: !!snap };
    await ENG.refreshTable(snap ? (k, fn) => io(k, fn) : io);
    if (opts.warehouses) await ENG.planWarehouses();
    ENG.decide('build', {}, `Plan created: ${sit.name || 'scenario'}`);
    await ENG.solve('Initial plan');
    if (opts.addresses !== false && !AA.config.lowBandwidth) ENG.enrichAddresses(); // the API (server/api.js) skips the slow street-address lookups
    return ENG.state;
  };

  /** WorldPop counts for each zone's catchment circle; 3 requests at a time; overall budget ~60 s. */
  ENG.worldpopZones = async (zones) => {
    const radii = AA.prediction.catchments(zones), out = new Array(zones.length).fill(null);
    let next = 0; const t0 = Date.now();
    const worker = async () => { while (next < zones.length && Date.now() - t0 < 60000) { const i = next++; try { out[i] = await AA.data.worldpop(M.circleRing(zones[i], radii[i])); } catch (e) { out[i] = null; } } };
    await Promise.all([worker(), worker(), worker()]);
    if (!out.some((v) => v > 0)) throw new Error('WorldPop: no counts');
    return { counts: out, radii };
  };

  // ---------------- addresses ----------------
  const compass = (c, p) => { const b = (Math.atan2((p.lon - c.lon) * Math.cos(M.toRad(c.lat)), p.lat - c.lat) * 180 / Math.PI + 360) % 360; return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(b / 45) % 8]; };
  ENG.compass = compass;
  /** Reverse-geocode a point once; results kept in the plan (state.inputs.addr) so saved plans reopen without lookups. */
  ENG.lookup = async (p, zoom = 18, cache = ENG.state?.inputs?.addr || {}) => {
    const key = `${(+p.lat).toFixed(4)},${(+p.lon).toFixed(4)},${zoom}`;
    if (key in cache) return cache[key];
    try { const a = await AA.data.reverseDetail(p.lat, p.lon, zoom); cache[key] = a; return a; } catch (e) { return null; }
  };
  /** Fill in street addresses for storage sites, supply stores, hospitals and areas (in that order), in the background.
   *  Uses OSM address tags when present; otherwise Nominatim at ≤ 1 request/s. Emits 'addresses' after each group. */
  let enriching = null, enrichAgain = false;
  ENG.enrichAddresses = () => {
    if (enriching) { enrichAgain = true; return enriching; }
    enriching = (async () => {
      do {
        enrichAgain = false;
        const st = ENG.state; if (!st) break;
        const sites = st.warehouses ? st.warehouses.sizes.map((x) => st.warehouses.cand[x.j]) : [];
        const groups = [['storage', sites], ['stores', st.depots], ['hospitals', st.hospitals], ['areas', st.zones]];
        for (const [g, items] of groups) {
          let changed = false;
          for (const it of items) {
            if (ENG.state !== st) return;
            if (it.address && !it.unnamed) continue;
            const a = await ENG.lookup(it, g === 'areas' ? 17 : 18, st.inputs.addr);
            if (!a) { it.addressPending = false; changed = true; continue; }
            if (!it.address) it.address = a.address;
            it.locality = it.locality || a.locality;
            if (it.unnamed) {
              const where = a.road ? `${a.road}${a.locality ? `, ${a.locality}` : ''}` : a.locality;
              it.name = it.type === 'staging' ? `${it.name.split(' near ')[0]}${where ? ` near ${where}` : ''}` : `${TYPE_LABEL[it.type] || 'Facility'}${where ? ` on ${where}` : ''}`;
              it.unnamed = false;
            }
            changed = true;
          }
          if (changed) emit('addresses', g);
        }
      } while (enrichAgain);
    })().finally(() => { enriching = null; });
    return enriching;
  };

  // ---------------- decision log ----------------
  /** Append an entry to the decision log (who, when, what, why). */
  ENG.decide = (type, p = {}, reason = '', note = '') => {
    const st = ENG.state; if (!st) return;
    const who = AA.workspace ? AA.workspace.me() : { name: 'Local user', role: 'planner' };
    st.decisions.push({ at: new Date().toISOString(), epoch: st.epoch, by: who.name, role: who.role, type, reason, note: note || p.note || '' });
    emit('decision', st.decisions[st.decisions.length - 1]);
  };

  // ---------------- saved plans ----------------
  /** Everything needed to rebuild this plan later, offline: original situation, recorded inputs, and the event list. */
  ENG.snapshot = (name) => {
    const st = ENG.state; if (!st) return null;
    const sm = st.fcast.summary;
    return {
      v: 1, name: name || st.sit.name || 'Plan', savedAt: new Date().toISOString(), savedBy: AA.workspace ? AA.workspace.me().name : 'Local user',
      sit0: st.sit0, opts: st.opts, inputs: clone(st.inputs), events: clone(st.events), decisions: clone(st.decisions), collab: AA.collab ? AA.collab.snapshot(st) : undefined,
      summary: { hazard: st.sit.hazard, place: st.sit.placeName || st.sit.country || '', epoch: st.epoch, zones: st.zones.length, affected: Math.round(sm.aff.p50), displaced: Math.round(sm.dis.p50), deaths: Math.round(sm.fat.p50), cost: Math.round(st.lastRun?.alloc?.cost?.total || 0) },
    };
  };
  /** Rebuild a saved plan: same inputs (no new downloads unless missing), then replay every decision in order. */
  ENG.restore = async (snap) => {
    if (!snap || snap.v !== 1) throw new Error('Not an AidAtlas plan file');
    await ENG.build(clone(snap.sit0), { ...snap.opts, snapshot: snap.inputs || {} });
    const st = ENG.state;
    for (const e of snap.events || []) await ENG.event(e.type, clone(e.p), { replay: true });
    st.decisions = clone(snap.decisions || st.decisions);
    if (snap.collab && AA.collab) AA.collab.restore(st, snap.collab);
    st.restoring = false; st.savedName = snap.name;
    emit('restored', snap);
    return st;
  };

  ENG.refreshTable = async (io) => {
    const st = ENG.state;
    const pts = [...st.depots, ...st.zones, ...st.hospitals];
    progress('Building road travel-time matrix (OSRM)');
    try { st.table = io ? await io('table0', () => AA.data.osrmTable(pts)) : await AA.data.osrmTable(pts); st.tableProv = 'OSRM road network'; }
    catch (e) { st.table = null; st.tableProv = 'estimated (haversine × 1.35 at 40 km/h)'; st.notes.push('OSRM table unavailable; travel times estimated.'); }
    st.tableIdx = { d: st.depots.map((x) => x.id), z: st.zones.map((x) => x.id), h: st.hospitals.map((x) => x.id) };
  };
  const sub = (st, fromKind, fromList, toKind, toList) => {
    if (!st.table) return null;
    const ix = st.tableIdx; const nD = ix.d.length, nZ = ix.z.length;
    const off = { d: 0, z: nD, h: nD + nZ };
    const fi = fromList.map((x) => ix[fromKind].indexOf(x.id)), ti = toList.map((x) => ix[toKind].indexOf(x.id));
    if (fi.some((v) => v < 0) || ti.some((v) => v < 0)) return null;
    return { dur: fi.map((a) => ti.map((b) => st.table.dur[off[fromKind] + a]?.[off[toKind] + b])), dist: fi.map((a) => ti.map((b) => st.table.dist[off[fromKind] + a]?.[off[toKind] + b])) };
  };

  // ---------------- one optimisation pass ----------------
  let solving = Promise.resolve();
  ENG.solve = (reason) => (solving = solving.then(() => solveInner(reason)).catch((e) => { console.error(e); emit('error', e.message); }));

  const solveInner = async (reason, depth = 0, basePrev = null) => {
    const st = ENG.state, sit = st.sit, R = AA.routing, F = AA.fairness, E = AA.efficiency;
    progress('Optimising allocation');
    F.netDemand(st.zones, sit, st.epoch);
    const dz = R.adjustMatrix(sit, st, st.depots, st.zones, sub(st, 'd', st.depots, 'z', st.zones));
    const zz = R.adjustMatrix(sit, st, st.zones, st.zones, sub(st, 'z', st.zones, 'z', st.zones));
    const zh = R.adjustMatrix(sit, st, st.zones, st.hospitals, sub(st, 'z', st.zones, 'h', st.hospitals));
    st.depots.forEach((d, j) => st.zones.forEach((z, i) => { if (st.blocked.has(`${d.id}>${z.id}`)) dz.tau[j][i] = Infinity; }));
    // accessibility difficulty: nearest open depot time × (1 + access damage)
    const accRaw = st.zones.map((z, i) => {
      const ts = st.depots.map((d, j) => (d.open ? dz.tau[j][i] : Infinity)).filter(isFinite);
      z.theta = M.mean(st.depots.map((_, j) => dz.theta[j][i]));
      return (ts.length ? Math.min(...ts) : 12) * (1 + z.theta);
    });
    const accN = M.minmax(accRaw); st.zones.forEach((z, i) => { z.acc = accN[i]; z.accHours = accRaw[i]; });
    F.needScores(st.zones, sit);
    const pb = { zones: st.zones, depots: st.depots, tau: dz.tau, dist: dz.dist };
    const alloc = E.allocate(pb, { objective: st.objective });
    const cons = E.consolidate(pb, alloc, zz.tau);
    // casualties → hospitals
    const ramp = AA.prediction.rampAt(sit, (st.epoch + 1) * AA.config.epochHours);
    const cas = st.zones.map((z) => Math.max(0, 0.25 * z.fc.inj.p50 * ramp * (z.surge || 1) - (st.transported[z.id] || 0)));
    const A = M.sum(st.depots.filter((d) => d.open).map((d) => d.fleet.amb || 0));
    const casualty = E.casualties(cas, st.hospitals, zh.tau, A);
    const prev = depth ? basePrev : st.lastRun;
    st.lastRun = { reason, epoch: st.epoch, at: new Date().toISOString(), pb, alloc, cons, casualty, cas, ambulances: A, matrices: { dz, zz, zh }, legs: [], routing: 'pending' };
    st.lastRun.diff = diffRuns(prev, st.lastRun);
    if (depth) st.log.shift(); // a re-solve replaces its own entry
    st.log.unshift({ epoch: st.epoch, reason, diff: st.lastRun.diff, cost: alloc.cost.total, method: alloc.method });
    emit('solved', st.lastRun);
    // route legs progressively, then re-solve once if any (depot, zone) pair turned out isolated
    const newlyBlocked = await routeAll(st.lastRun);
    if (newlyBlocked && depth < 2) { await solveInner(`${reason.split(' → ')[0]} → re-solved without ${st.blocked.size} isolated road arc(s)`, depth + 1, prev); }
  };

  const routeAll = async (run) => {
    const st = ENG.state, sit = st.sit, R = AA.routing;
    const pairs = new Map();
    run.cons.tours.forEach((t, ti) => {
      let prev = { kind: 'd', idx: t.j };
      t.stops.forEach((i) => { const key = `${prev.kind}${prev.idx}>z${i}|${t.cls}`; if (!pairs.has(key)) pairs.set(key, { from: prev, to: { kind: 'z', idx: i }, cls: t.cls, tours: [] }); pairs.get(key).tours.push(ti); prev = { kind: 'z', idx: i }; });
    });
    const ptOf = (p) => (p.kind === 'd' ? st.depots[p.idx] : st.zones[p.idx]);
    let blocked = 0;
    const closuresKey = st.closures.map((c) => c.lat.toFixed(4) + c.lon.toFixed(4)).join('|') + '#' + st.epoch + '#' + st.shocks.length + '#' + st.congestion;
    for (const [key, p] of pairs) {
      if (st.lastRun !== run) return 0; // superseded by a newer solve
      const a = ptOf(p.from), b = ptOf(p.to);
      const ck = `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}|${p.cls}|${closuresKey}`;
      let res = st.routeCache.get(ck);
      if (!res) { res = await R.routeLeg(sit, st, a, b, p.cls); st.routeCache.set(ck, res); }
      const leg = { key, from: p.from, to: p.to, cls: p.cls, tours: p.tours, a, b, ...res };
      run.legs.push(leg);
      emit('leg', leg);
      if (res.airdrop && p.from.kind === 'd') { const k = `${st.depots[p.from.idx].id}>${st.zones[p.to.idx].id}`; if (!st.blocked.has(k)) { st.blocked.add(k); blocked++; } }
    }
    run.routing = 'done';
    emit('routed', run);
    return blocked;
  };

  const diffRuns = (a, b) => {
    if (!a) return null;
    const K = AA.config.commodities;
    const unmet = (r) => { const o = {}; K.forEach((k) => (o[k.key] = M.sum(r.alloc.unmet.map((u) => u[k.key] || 0)))); return o; };
    const ua = unmet(a), ub = unmet(b);
    const trips = (r) => { const o = {}; r.alloc.trips.forEach((t) => { const id = r.pb.zones[t.i].id; o[id] = (o[id] || 0) + t.n; }); return o; };
    const ta = trips(a), tb = trips(b);
    const ids = new Set([...Object.keys(ta), ...Object.keys(tb)]);
    const redirected = [...ids].map((id) => ({ id, before: ta[id] || 0, after: tb[id] || 0 })).filter((x) => x.before !== x.after);
    return { unmet: K.map((k) => ({ k: k.key, before: ua[k.key], after: ub[k.key] })), cost: { before: a.alloc.cost.total, after: b.alloc.cost.total }, redirected };
  };

  // ---------------- warehouses (pre-positioning) ----------------
  ENG.planWarehouses = async () => {
    const st = ENG.state, sit = st.sit, FL = AA.facility;
    progress('Choosing storage sites (MCLP)');
    const cand = FL.candidates(sit);
    st.depots.forEach((d) => cand.push({ lat: d.lat, lon: d.lon, sev: d.sev, safe: d.sev <= 0.3, kind: 'existing', name: d.name }));
    let base = null;
    try {
      const t = await AA.data.osrmTable([...cand, ...st.zones]);
      const n = cand.length;
      base = { dur: cand.map((_, a) => st.zones.map((_, b) => t.dur[a][n + b])), dist: cand.map((_, a) => st.zones.map((_, b) => t.dist[a][n + b])) };
      cand.forEach((c, k) => { if (c.kind === 'grid' && t.snapped[k] && t.snapped[k].offKm < 5) { c.lat = t.snapped[k].lat; c.lon = t.snapped[k].lon; } });
    } catch (e) { st.notes.push('Warehouse travel times estimated (OSRM unavailable).'); }
    const m = AA.routing.adjustMatrix(sit, st, cand, st.zones, base);
    const sol = FL.mclp(st.zones, cand, m.tau);
    const sizes = FL.size(st.zones, sol);
    st.warehouses = { cand, sol, sizes, tau: m.tau };
    emit('warehouses', st.warehouses);
    return st.warehouses;
  };

  // ---------------- dynamic events ----------------
  ENG.event = async (type, p = {}, meta = {}) => {
    const st = ENG.state; if (!st) return;
    if (!meta.replay && AA.workspace && !AA.workspace.can('edit')) { emit('error', `Your role (${AA.workspace.me().role}) can view plans but not change them.`); return; }
    if (type !== 'advance') st.events.push({ type, p: clone(p), at: new Date().toISOString() });
    const z = p.zoneId ? st.zones.find((x) => x.id === p.zoneId) : null;
    const d = p.depotId ? st.depots.find((x) => x.id === p.depotId) : null;
    let reason = '';
    switch (type) {
      case 'surge': z.surge = (z.surge || 1) * 1.5; z.served = false; reason = `Demand surge +50 % in ${z.name}`; break;
      case 'served': z.served = true; reason = `${z.name} marked sufficiently served`; break;
      case 'unserved': z.served = false; reason = `${z.name} needs aid again`; break;
      case 'depot': d.open = !d.open; reason = `${d.name} ${d.open ? 'back online' : 'offline'}`; break;
      case 'breakdown': d.fleet.truck = Math.max(0, d.fleet.truck - 1); reason = `Truck breakdown at ${d.name}`; break;
      case 'closure': st.closures.push({ lat: p.lat, lon: p.lon }); reason = `Road closed near ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`; break;
      case 'clearClosures': st.closures = []; st.blocked.clear(); reason = 'All road closures cleared'; break;
      case 'aftershock': {
        st.shocks.push({ lat: p.lat ?? st.sit.lat, lon: p.lon ?? st.sit.lon, radiusKm: 0.5 * st.sit.radiusKm, eta: 0.35, epoch: st.epoch });
        st.zones.forEach((zz) => { if (M.haversine(zz, { lat: p.lat ?? st.sit.lat, lon: p.lon ?? st.sit.lon }) < 0.5 * st.sit.radiusKm) zz.surge = (zz.surge || 1) * 1.15; });
        reason = 'Aftershock / new damage: roads degraded, demand +15 % nearby'; break;
      }
      case 'supply': {
        const nd = mkDepot({ lat: p.lat, lon: p.lon, name: `Supply arrival ${st.depots.length + 1}` }, st.sit, st.supplyScale, 'airlift');
        nd.id = 'D' + (st.depots.length + 1); st.depots.push(nd); await ENG.refreshTable();
        reason = `New supplies arrived at ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`; break;
      }
      case 'congestion': st.congestion = st.congestion > 1 ? 1 : 1.4; reason = st.congestion > 1 ? 'Congestion: travel times +40 %' : 'Congestion cleared'; break;
      case 'spread': {
        const P = AA.prediction;
        let pl = p._place;
        if (pl === undefined) { let places = []; try { places = await AA.data.places(p, 6); } catch (e) {} pl = places.sort((a, b) => M.haversine(p, a) - M.haversine(p, b))[0] || null; st.events[st.events.length - 1].p._place = pl; }
        const pop = pl ? pl.population || 1500 : 400 * Math.PI * 25;
        const nz = { id: 'Z' + (st.zones.length + 1), name: pl ? `${pl.name} (spread)` : 'New affected area', lat: p.lat, lon: p.lon, pop, type: pl?.type || 'sector', popProv: pl?.population ? 'osm' : 'modelled', rural: 0.8, recv: {}, surge: 1, spread: true };
        nz.distKm = 0.3 * st.sit.radiusKm; nz.I = P.intensity(st.sit, nz.distKm);
        P.forecast(st.sit, [nz]); st.zones.push(nz); await ENG.refreshTable();
        reason = `Disaster spread to ${nz.name}`; break;
      }
      case 'report': {
        const prior = { mu: z.sevPost ?? z.sevMean, sd: z.sevSd ?? 0.15 };
        const post = AA.prediction.bayes(prior.mu, prior.sd, p.value, p.sd || 0.1);
        z.sevPost = M.clamp(post.mu, 0, 1); z.sevSd = post.sd;
        z.bayes = { prior, obs: { y: p.value, sd: p.sd || 0.1 }, post };
        reason = `Field report for ${z.name}: severity ${prior.mu.toFixed(2)} → ${post.mu.toFixed(2)}`; break;
      }
      case 'supplyScale': {
        st.supplyScale = p.value; st.depots.forEach((dp) => { const t = ENG.STOCK[dp.type]; if (!t) return; Object.keys(dp.stock).forEach((k) => { const used = dp.init[k] - dp.stock[k]; dp.init[k] = t.stock[k] * p.value; dp.stock[k] = Math.max(0, dp.init[k] - used); }); });
        reason = `Supply level set to ${p.value}×`; break;
      }
      case 'importDepots': {
        const scaleOf = { water_l: ['water', 1 / 1000], food_kg: ['food', 1 / 1000], tents: ['shelter', 1], medkits: ['medical', 1], staff: ['staff', 1] };
        const nd = p.rows.map((r, k) => {
          const stock = { water: 0, food: 0, shelter: 0, medical: 0, staff: 0 };
          Object.entries(scaleOf).forEach(([col, [key, f]]) => (stock[key] = (+r[col] || 0) * f));
          const I = AA.prediction.intensity(st.sit, M.haversine(st.sit, r));
          const sev = AA.prediction.impact(st.sit.hazard, I, st.sit.countryVul).sev;
          return { id: 'D' + (k + 1), name: r.name || `Store ${k + 1}`, type: r.type || 'warehouse', typeLabel: `${TYPE_LABEL[r.type] || 'Store'} (your inventory)`, lat: +r.lat, lon: +r.lon, sev, open: sev < 0.6, damaged: sev >= 0.6, stock, init: { ...stock }, fleet: { truck: +r.trucks || 0, bus: +r.buses || 0, amb: +r.ambulances || 0 }, repl: 0, prov: 'imported inventory', beds: +r.beds || 0, address: r.address || '' };
        }).filter((d) => isFinite(d.lat) && isFinite(d.lon));
        if (!nd.length) return;
        st.depots = nd; st.blocked.clear(); await ENG.refreshTable();
        reason = `Imported ${nd.length} supply stores from your inventory`; break;
      }
      case 'objective': st.objective = { ...AA.config.objective, ...p }; reason = 'Policy weights changed'; break;
      case 'advance': {
        // record what was actually dispatched, so a restored plan reproduces the same deliveries and stock
        const run = st.lastRun; if (!run) return;
        const executed = p.executed || { ship: run.alloc.ship.map((x) => ({ i: x.i, j: x.j, k: x.k, qty: x.qty })), cas: run.casualty.flows.map((x) => ({ i: x.i, h: x.h, n: x.n })) };
        if (!meta.replay) st.events.push({ type: 'advance', p: { executed }, at: new Date().toISOString() });
        return ENG.advance(meta, executed);
      }
      default: return;
    }
    st.routeCache.clear();
    if (!meta.replay) ENG.decide(type, p, reason, meta.note);
    const done = ENG.solve(reason);
    if (['supply', 'importDepots', 'spread'].includes(type)) done.then(() => ENG.enrichAddresses());
    return done;
  };

  /** Rolling-horizon step: execute first-epoch decisions only, then re-optimise. */
  ENG.advance = async (meta = {}, executed = null) => {
    const st = ENG.state, run = st.lastRun; if (!run) return;
    const ex = executed || { ship: run.alloc.ship, cas: run.casualty.flows };
    ex.ship.forEach((s) => {
      const z = st.zones[s.i], dp = st.depots[s.j];
      z.recv[s.k] = (z.recv[s.k] || 0) + s.qty;
      dp.stock[s.k] = Math.max(0, dp.stock[s.k] - s.qty);
    });
    ex.cas.forEach((f) => { const id = st.zones[f.i].id; st.transported[id] = (st.transported[id] || 0) + f.n; st.hospitals[f.h].beds = Math.max(0, st.hospitals[f.h].beds - f.n); });
    st.depots.forEach((dp) => { if (dp.open && dp.repl) Object.keys(dp.stock).forEach((k) => (dp.stock[k] += dp.init[k] * dp.repl)); });
    st.epoch += 1;
    st.routeCache.clear();
    if (!meta.replay) ENG.decide('advance', {}, `Advanced to T+${st.epoch * AA.config.epochHours} h`, meta.note);
    return ENG.solve(`Advanced to T+${st.epoch * AA.config.epochHours} h: deliveries recorded, stock replenished, roads partly cleared`);
  };

  AA.engine = ENG;
})(typeof window !== 'undefined' ? window : globalThis);
