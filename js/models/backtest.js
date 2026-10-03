/* Back-test: replay past disasters through the forecast model and compare with what was reported.
   Catalogue: NOAA NCEI Global Significant Earthquake Database (deaths ≥ 250, 2001–2025), snapshot taken 2026-10-02 from
   https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/earthquakes?minYear=2001&maxYear=2025&minDeaths=250
   Skill: skills/backtest/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const BT = {};
  BT.SOURCE = { name: 'NOAA NCEI Global Significant Earthquake Database', url: 'https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/search', snapshot: '2026-10-02', query: 'deaths ≥ 250, 2001–2025' };

  // mode: 'shaking' = deaths mainly from shaking (scored) · 'tsunami' = mainly tsunami / liquefaction (shown, not scored:
  // the model has no tsunami component) · 'disputed' = official toll strongly contested (shown, not scored)
  const E = (date, name, iso2, lat, lon, mag, depth, deaths, mode = 'shaking', note = '') => ({ id: `EQ-${date}`, hazard: 'EQ', date, name, iso2, lat, lon, mag, depth, deaths, mode, note });
  BT.CATALOG = [
    E('2001-01-13', 'El Salvador', 'SV', 13.049, -88.66, 7.7, 60, 844, 'shaking', 'Most deaths from the Las Colinas landslide'),
    E('2001-01-26', 'Gujarat (Bhuj), India', 'IN', 23.388, 70.326, 7.6, 17, 20005),
    E('2001-02-13', 'San Vicente, El Salvador', 'SV', 13.671, -88.938, 6.6, 10, 315),
    E('2002-03-25', 'Nahrin, Afghanistan', 'AF', 36.062, 69.315, 6.1, 8, 1000),
    E('2002-06-22', 'Avaj, Iran', 'IR', 35.626, 49.047, 6.5, 10, 261),
    E('2003-02-24', 'Bachu, Xinjiang, China', 'CN', 39.61, 77.23, 6.3, 11, 261),
    E('2003-05-21', 'Boumerdès, Algeria', 'DZ', 36.964, 3.634, 6.8, 12, 2287),
    E('2003-12-26', 'Bam, Iran', 'IR', 28.995, 58.311, 6.6, 10, 31000),
    E('2004-02-24', 'Al Hoceima, Morocco', 'MA', 35.142, -3.997, 6.4, 1, 628),
    E('2004-12-26', 'Sumatra–Andaman (Indian Ocean tsunami)', 'ID', 3.295, 95.982, 9.1, 30, 227899, 'tsunami'),
    E('2005-02-22', 'Zarand, Iran', 'IR', 30.754, 56.816, 6.4, 14, 612),
    E('2005-03-28', 'Nias, Sumatra, Indonesia', 'ID', 2.085, 97.108, 8.6, 30, 1319),
    E('2005-10-08', 'Kashmir (Muzaffarabad), Pakistan', 'PK', 34.451, 73.649, 7.6, 15, 76213),
    E('2006-05-26', 'Yogyakarta, Java, Indonesia', 'ID', -7.961, 110.446, 6.3, 13, 6234),
    E('2007-08-15', 'Pisco, Peru', 'PE', -13.386, -76.603, 8.0, 39, 596),
    E('2008-05-12', 'Sichuan (Wenchuan), China', 'CN', 30.98, 103.396, 7.9, 10, 87652),
    E('2009-04-06', "L'Aquila, Italy", 'IT', 42.334, 13.334, 6.3, 9, 309),
    E('2009-09-30', 'Padang, Sumatra, Indonesia', 'ID', -0.72, 99.867, 7.5, 81, 1117),
    E('2010-01-12', 'Port-au-Prince, Haiti', 'HT', 18.457, -72.533, 7.0, 13, 316000, 'disputed', 'Government figure; independent estimates range from about 46,000 to 160,000'),
    E('2010-02-27', 'Maule, Chile', 'CL', -36.122, -72.898, 8.8, 22, 558, 'tsunami', 'A large share of deaths from the tsunami'),
    E('2010-04-13', 'Yushu, Qinghai, China', 'CN', 33.165, 96.548, 6.9, 17, 2968),
    E('2011-03-11', 'Tōhoku, Japan', 'JP', 38.297, 142.373, 9.1, 29, 18423, 'tsunami'),
    E('2011-10-23', 'Van (Erciş), Türkiye', 'TR', 38.722, 43.513, 7.1, 16, 604),
    E('2012-08-11', 'Ahar–Varzaqan, Iran', 'IR', 38.329, 46.826, 6.5, 11, 306),
    E('2013-09-24', 'Awaran, Pakistan', 'PK', 26.951, 65.501, 7.7, 15, 825),
    E('2014-08-03', 'Ludian, Yunnan, China', 'CN', 27.189, 103.409, 6.2, 12, 615),
    E('2015-04-25', 'Gorkha, Nepal', 'NP', 28.231, 84.731, 7.8, 8, 8957),
    E('2015-10-26', 'Hindu Kush, Afghanistan', 'AF', 36.524, 70.368, 7.5, 231, 399, 'deep', 'Deep (231 km) earthquake; outside this model\'s range'),
    E('2016-04-15', 'Kumamoto, Japan', 'JP', 32.791, 130.754, 7.0, 10, 273),
    E('2016-04-16', 'Manabí, Ecuador', 'EC', 0.382, -79.922, 7.8, 21, 663),
    E('2016-08-24', 'Amatrice, Italy', 'IT', 42.723, 13.188, 6.2, 4, 299),
    E('2017-09-19', 'Puebla–Mexico City, Mexico', 'MX', 18.55, -98.489, 7.1, 48, 369),
    E('2017-11-12', 'Kermanshah, Iran–Iraq', 'IR', 34.911, 45.959, 7.3, 19, 630),
    E('2018-08-05', 'Lombok, Indonesia', 'ID', -8.258, 116.438, 6.9, 34, 560),
    E('2018-09-28', 'Palu, Sulawesi, Indonesia', 'ID', -0.256, 119.846, 7.5, 20, 4340, 'tsunami', 'Tsunami and liquefaction'),
    E('2021-08-14', 'Nippes, Haiti', 'HT', 18.408, -73.475, 7.2, 10, 2248),
    E('2022-06-21', 'Paktika, Afghanistan', 'AF', 33.092, 69.514, 6.0, 4, 1039),
    E('2022-11-21', 'Cianjur, West Java, Indonesia', 'ID', -6.836, 106.997, 5.6, 10, 635),
    E('2023-02-06', 'Kahramanmaraş, Türkiye–Syria', 'TR', 37.166, 37.042, 7.8, 17, 56697),
    E('2023-09-08', 'Al Haouz (Marrakech), Morocco', 'MA', 31.073, -8.407, 6.8, 18, 2946),
    E('2023-10-07', 'Herat, Afghanistan', 'AF', 34.61, 61.924, 6.3, 14, 1482),
    E('2024-01-01', 'Noto, Ishikawa, Japan', 'JP', 37.487, 137.271, 7.5, 10, 549, 'shaking', 'Includes disaster-related deaths'),
    E('2025-03-28', 'Mandalay–Sagaing, Myanmar', 'MM', 22.011, 95.936, 7.7, 10, 3815),
    E('2025-08-31', 'Kunar, Afghanistan', 'AF', 34.706, 70.793, 6.0, 8, 2205),
  ];

  /** Situation for a catalogue event, as Plan mode would build it. */
  BT.situation = (ev) => AA.engine.situationFromPlan({ lat: ev.lat, lon: ev.lon, name: `${ev.name} (${ev.date.slice(0, 4)})`, iso2: ev.iso2, hazard: ev.hazard, magnitude: ev.mag, depth: Math.max(2, ev.depth || 10) });

  /** Score one event: where the reported toll falls in the forecast range. */
  BT.scoreOne = (ev, fat) => {
    const p50 = Math.max(1, fat.p50), obs = Math.max(1, ev.deaths);
    const logErr = Math.log10(p50 / obs);
    return { inside: ev.deaths >= fat.p10 && ev.deaths <= fat.p90, below: ev.deaths < fat.p10, above: ev.deaths > fat.p90, logErr, factor: Math.pow(10, Math.abs(logErr)), within3: Math.abs(logErr) <= Math.log10(3), within10: Math.abs(logErr) <= 1 };
  };
  /** Summary over scored events. */
  BT.summarise = (results) => {
    const s = results.filter((r) => r.scored && r.fat);
    if (!s.length) return { n: 0 };
    const le = s.map((r) => r.score.logErr);
    const absMed = M.quantile(le.map(Math.abs), 0.5);
    return {
      n: s.length, inside: s.filter((r) => r.score.inside).length, coverage: s.filter((r) => r.score.inside).length / s.length,
      below: s.filter((r) => r.score.below).length, above: s.filter((r) => r.score.above).length,
      typicalFactor: Math.pow(10, absMed), bias: Math.pow(10, M.quantile(le, 0.5)),
      within3: s.filter((r) => r.score.within3).length / s.length, within10: s.filter((r) => r.score.within10).length / s.length,
      byQuality: ['worldpop', 'osm', 'modelled'].reduce((o, qn) => { const g = s.filter((r) => r.quality === qn); if (g.length) o[qn] = { n: g.length, inside: g.filter((r) => r.score.inside).length, typicalFactor: Math.pow(10, M.quantile(g.map((r) => Math.abs(r.score.logErr)), 0.5)) }; return o; }, {}),
    };
  };

  /** Run the catalogue. opts: { worldpop, step(msg, k, n), cache: {get,set}, events } — results keep the forecast range. */
  BT.run = async (opts = {}) => {
    const events = opts.events || BT.CATALOG, out = [], step = opts.step || (() => {});
    for (let k = 0; k < events.length; k++) {
      const ev = events[k];
      const key = `${AA.MODEL_VERSION}|${opts.worldpop ? 'wp' : 'osm'}|${ev.id}`;
      let hit = opts.cache?.get(key);
      if (!hit) {
        step(`Replaying ${ev.name} (${ev.date.slice(0, 4)})…`, k, events.length);
        try {
          // a lookup that failed is retried (up to 3 runs) so data gaps do not masquerade as model error
          let r;
          for (let tryN = 0; tryN < 3; tryN++) {
            r = await AA.pipelines.forecast(BT.situation(ev), { worldpop: !!opts.worldpop, reverse: false });
            if (!r.notes.some((n) => /unavailable/i.test(n))) break;
            await new Promise((res) => setTimeout(res, opts.pauseMs ?? 3000));
          }
          const f = r.fc.summary.fat;
          hit = { quality: r.quality, curve: r.fc.fatCurve ? `${r.fc.fatCurve.status} θ${r.fc.fatCurve.theta} β${r.fc.fatCurve.beta}` : '', fat: { p10: f.p10, p50: f.p50, p90: f.p90 }, aff: { p50: r.fc.summary.aff.p50 }, zones: r.zones.length, places: r.places, radiusKm: r.sit.radiusKm, vul: r.sit.countryVul, notes: r.notes };
          if (!r.notes.length) opts.cache?.set(key, hit); // cache only clean runs
        } catch (e) { hit = { error: e.message }; }
      }
      const scored = ev.mode === 'shaking' && !hit.error;
      if (opts.pauseMs !== 0 && !opts.cache?.get(key)) await new Promise((res) => setTimeout(res, opts.pauseMs ?? 1200)); // be polite to public servers
      out.push({ ...ev, ...hit, scored, score: hit.fat ? BT.scoreOne(ev, hit.fat) : null });
    }
    step('Done', events.length, events.length);
    return { model: AA.MODEL_VERSION, worldpop: !!opts.worldpop, at: new Date().toISOString(), source: BT.SOURCE, results: out, summary: BT.summarise(out) };
  };

  /** CSV of a run (one row per event). */
  BT.csv = (run) => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = run.results.map((r) => [r.id, r.date, r.name, r.iso2, r.mag, r.depth, r.deaths, r.mode, r.fat ? Math.round(r.fat.p10) : '', r.fat ? Math.round(r.fat.p50) : '', r.fat ? Math.round(r.fat.p90) : '', r.score ? (r.score.inside ? 'yes' : 'no') : '', r.score ? r.score.factor.toFixed(2) : '', r.error || ''].map(q).join(','));
    return ['id,date,event,country,magnitude,depth_km,reported_deaths,scoring,p10_deaths,p50_deaths,p90_deaths,inside_p10_p90,error_factor,error', ...rows].join('\n');
  };

  AA.backtest = BT;
})(typeof window !== 'undefined' ? window : globalThis);
