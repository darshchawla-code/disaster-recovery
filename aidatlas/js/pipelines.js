/* Multi-step analyses shared by the app and the public API (server/api.js): risk grid for a place,
   design scenarios for its high-risk areas, pre-season readiness. Network reads happen here; the maths is in
   js/models/*. Skill: skills/risk-assessment/SKILL.md, skills/readiness/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const PL = {};
  const noop = () => {};

  /** Forecast only (no stores, no routing): country vulnerability → impact radius → places (OSM) → zones →
   *  optional WorldPop counts → 400-draw Monte Carlo. Shared by the API (/v1/forecast) and the back-test. */
  PL.forecast = async (sit, opts = {}) => {
    const D = AA.data, P = AA.prediction, notes = [], step = opts.step || noop;
    if (!sit.iso2 && opts.reverse !== false) { try { const r = await D.reverse(sit.lat, sit.lon); sit.iso2 = r.iso2; sit.country = sit.country || r.country; } catch (e) { notes.push('Country lookup unavailable.'); } }
    try { sit.countryIdx = await D.countryIndex(sit.iso2); } catch (e) { sit.countryIdx = { vul: 0.5, lcc: 0.5, prov: 'assumed' }; notes.push('Country indicators unavailable; vulnerability assumed 0.5.'); }
    sit.countryVul = sit.countryIdx.vul;
    sit.radiusKm = sit.hazard === 'FL' ? (sit.radiusKm || 40) : P.impactRadius(sit);
    step('Finding towns (OpenStreetMap)…');
    let places = []; try { places = await D.places(sit, Math.min(sit.radiusKm, 120)); } catch (e) { notes.push('OpenStreetMap places unavailable; modelled population sectors used.'); }
    const zones = P.buildZones(sit, places, 12);
    if (opts.worldpop && zones.length) {
      step('Counting people (WorldPop)…');
      try { const pops = await AA.engine.worldpopZones(zones); zones.forEach((z, i) => { const v = pops.counts[i]; if (v > 0) { z.pop = v; z.popProv = 'WorldPop 2020'; } }); } catch (e) { notes.push('WorldPop unavailable; OpenStreetMap populations used.'); }
    }
    const fc = P.forecast(sit, zones);
    return { sit, zones, fc, places: places.length, notes };
  };

  /** Default design intensity per hazard (same as the Plan-mode defaults). */
  PL.DESIGN = { TC: 200, FL: 0.8, WF: 0.8, VO: 0.9, DR: 0.7 };

  /** 6 × 6 risk grid (~120 × 120 km) around a place, top 5 cells named after their locality. */
  PL.risk = async (place, step = noop, opts = {}) => {
    const D = AA.data, RK = AA.risk, half = opts.halfKm || 60, n = opts.n || 6;
    const cells = RK.grid(place, half, n);
    step('Reading earthquake catalogue (USGS, since 1973)…');
    const eq = await D.usgsHistory(place.lat, place.lon, 400, 4.5, '1973-01-01').catch(() => []);
    step('Reading storm, flood, fire and volcano records (GDACS, EONET)…');
    const deg = 2.5;
    const [g, e] = await Promise.allSettled([place.country ? D.gdacsHistory(place.country) : Promise.resolve([]), D.eonetHistory([place.lon - deg, place.lat - deg, place.lon + deg, place.lat + deg])]);
    const events = [...(g.status === 'fulfilled' ? g.value : []), ...(e.status === 'fulfilled' ? e.value : [])].filter((x) => x.hazard !== 'EQ' && M.haversine(place, x) < 300);
    step('Reading 20 years of river discharge (GloFAS) and elevation…');
    let q100 = null, elev = null;
    try {
      const lats = cells.map((c) => c.lat.toFixed(3)), lons = cells.map((c) => c.lon.toFixed(3));
      const y1 = new Date().getUTCFullYear() - 1;
      const [fl, el] = await Promise.all([D.floodSeries(lats, lons, `${y1 - 19}-01-01`, `${y1}-12-31`), D.elevation(lats, lons)]);
      elev = el.elevation;
      const arr = Array.isArray(fl) ? fl : [fl];
      q100 = arr.map((loc) => {
        const t = loc.daily.time, q = loc.daily.river_discharge; const byY = {};
        t.forEach((d, k) => { const y = d.slice(0, 4); if (q[k] != null) byY[y] = Math.max(byY[y] ?? 0, q[k]); });
        const gm = RK.gumbel(Object.values(byY)); return gm ? Math.max(0, gm.q(100)) : NaN;
      });
    } catch (err) { /* discharge unavailable: flood hazard falls back to event frequency */ }
    step('Reading population and hospitals (OpenStreetMap)…');
    const [pl, fac, ci] = await Promise.all([D.places(place, half + 10).catch(() => []), D.facilities(place, half + 10).catch(() => []), D.countryIndex(place.iso2)]);
    const res = RK.assess(cells, { eq, eqYears: new Date().getUTCFullYear() - 1973, events, eventYears: new Date().getUTCFullYear() - 2000, q100, elev, places: pl, hospitals: fac.filter((x) => x.type === 'hospital'), country: ci });
    res.cells.forEach((c) => { const near = pl.slice().sort((a, b) => M.haversine(c, a) - M.haversine(c, b))[0]; c.name = near && M.haversine(c, near) < 15 ? `Around ${near.name}` : `Cell ${c.id.slice(1)} (${c.lat.toFixed(2)}, ${c.lon.toFixed(2)})`; });
    const top = res.cells.slice().sort((a, b) => b.R - a.R).slice(0, 5);
    const compass = (c) => { const b = (Math.atan2(c.lon - place.lon, c.lat - place.lat) * 180 / Math.PI + 360) % 360; return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8]; };
    step('Naming the high-risk areas…');
    for (const c of top) {
      try { const a = await D.reverseDetail(c.lat, c.lon, 14); if (a.locality) { c.name = `${a.locality}${a.city && a.city !== a.locality ? `, ${a.city}` : ''}`; c.address = a.address; } } catch (err) { /* keep the fallback name */ }
    }
    top.forEach((c) => { if (top.filter((o) => o.name === c.name).length > 1) c.name = `${c.name} (${compass(c)}, ${Math.round(M.haversine(place, c))} km)`; });
    return { place: place.short || place.name, placeObj: place, gr: res.gr, top, cells: res.cells, counts: `${eq.length} earthquakes, ${events.length} other events, ${q100 ? 'GloFAS discharge' : 'no discharge data'}`, places: pl, facs: fac, country: ci };
  };

  /** Design scenario for one high-risk cell: its dominant hazard at a 1-in-475-year size (earthquakes) or the default intensity. */
  PL.scenario = (c, rr) => {
    const hzd = c.dominant, place = rr.placeObj || {};
    const mag = hzd === 'EQ' ? Math.min(8, Math.max(6.5, rr.gr.a != null ? (rr.gr.a - Math.log10(1 / 475)) / rr.gr.b : 6.5)) : PL.DESIGN[hzd];
    return AA.engine.situationFromPlan({ lat: c.lat, lon: c.lon, name: `${AA.HAZARDS[hzd].label} risk scenario · ${c.name}`, country: rr.country ? place.country : '', iso2: place.iso2, hazard: hzd, magnitude: mag, depth: 10, peakInHours: 24, areaKm2: 200 });
  };

  /** Readiness of the district for each of its top-5 high-risk areas. opts.rows = inventory rows (else OSM + assumed stock). */
  PL.readiness = async (rr, opts = {}) => {
    const P = AA.prediction, RD = AA.readiness, step = opts.step || noop;
    step('Forecasting the worst likely case (P90) in each high-risk area…');
    const areas = rr.top.map((c) => {
      const sit = PL.scenario(c, rr);
      sit.countryVul = rr.country?.vul ?? 0.5;
      sit.radiusKm = sit.hazard === 'FL' ? (sit.radiusKm || 40) : P.impactRadius(sit);
      const zones = P.buildZones(sit, rr.places || [], 12);
      P.forecast(sit, zones);
      const { need, affP90 } = RD.need72(zones);
      return { name: c.name, lat: c.lat, lon: c.lon, R: c.R, hazard: c.dominant, sit, need, affP90, zones: zones.length };
    });
    const stores = opts.rows?.length ? RD.storesFromRows(opts.rows) : RD.storesFromFacilities(rr.facs);
    let tau = null;
    if (opts.roads !== false && stores.length && stores.length <= 90) {
      step('Reading road travel times from stores to each area (OSRM)…');
      try { const t = await AA.data.osrmTable([...stores, ...areas]); const n = stores.length; tau = stores.map((_, j) => areas.map((_, a) => (t.dur[j][n + a] != null ? t.dur[j][n + a] / 3600 : NaN))); } catch (e) { tau = null; }
    }
    const out = RD.score(areas, stores, tau);
    out.place = rr.place; out.source = opts.rows?.length ? (opts.sourceLabel || 'your inventory') : 'OpenStreetMap facilities with assumed stock';
    out.roads = tau ? 'OSRM road network' : `estimated (straight line × ${AA.config.circuity} at ${AA.config.fallbackSpeedKmh} km/h)`;
    out.at = new Date().toISOString();
    return out;
  };

  AA.pipelines = PL;
})(typeof window !== 'undefined' ? window : globalThis);
