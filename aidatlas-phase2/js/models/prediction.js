/* Prediction model. Skill: skills/prediction/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const P = {};

  const ALERT_S0 = [0.35, 0.35, 0.65, 0.9]; // index by alertScore 0..3

  /** Hazard intensity at distance r (km). Units: EQ → MMI, TC → km/h, others → score 0..1 */
  P.intensity = (sit, r, mag) => {
    const h = sit.hazard;
    const m = mag == null ? sit.magnitude : mag;
    if (h === 'EQ') {
      const depth = sit.depth || 10;
      const a = sit.mmiA != null ? sit.mmiA : 2.5;
      // finite-fault proxy: rupture length L (Wells & Coppersmith 1994, all slip types) shortens the effective distance
      const L = Math.pow(10, -2.44 + 0.59 * m);
      const rEff = Math.max(0, r - 0.25 * L);
      return Math.max(1, a + 1.5 * m - 4.0 * Math.log10(Math.sqrt(rEff * rEff + depth * depth)));
    }
    if (h === 'TC') {
      const Rmax = 30;
      return r <= Rmax ? m : m * Math.pow(Rmax / r, 0.7);
    }
    const s0 = M.clamp(m, 0, 1);
    if (h === 'FL') { const L = 0.5 * (sit.radiusKm || 40); return s0 * Math.exp(-r / L); }
    if (h === 'WF') { const Rb = Math.sqrt((sit.areaKm2 || 50) / Math.PI); return r <= Rb ? s0 : s0 * Math.exp(-(r - Rb) / 5); }
    if (h === 'VO') return r <= 10 ? s0 : s0 * Math.exp(-(r - 10) / 10);
    if (h === 'DR') { const R = Math.min(200, Math.sqrt((sit.areaKm2 || 5000) / Math.PI)); return r <= R ? s0 : s0 * Math.exp(-(r - R) / 20); }
    return 0;
  };

  /** Damage fractions from intensity. shift = fragility perturbation (MC). V = country vulnerability 0..1 */
  P.impact = (hazard, I, V = 0.5, shift = 0, sub) => {
    if (hazard === 'EQ') {
      const fAff = M.Phi((I - 6.5 - shift) / 0.8);
      const fDis = 0.4 * M.Phi((I - 8.2 + 1.2 * (V - 0.5) - shift) / 0.8); // weaker housing → displaced at lower shaking
      const sev = M.Phi((I - 8.5 - shift) / 0.8);
      const theta = 13.5 + 2.5 * (1 - V) + shift;
      const fFat = M.Phi(Math.log(I / theta) / 0.17);
      return { fAff, fDis, sev, fFat, injPerFat: 3.5 };
    }
    if (hazard === 'TC') {
      const k = Math.exp(shift * 0.1);
      const fAff = M.Phi(Math.log(I / (120 * k)) / 0.25);
      const fDis = M.Phi(Math.log(I / (160 * k)) / 0.25);
      const sev = M.Phi(Math.log(I / (210 * k)) / 0.25);
      return { fAff, fDis, sev, fFat: 0.002 * sev, injPerFat: 10 };
    }
    const s = I, sh = shift * 0.05;
    const fAff = M.Phi((s - 0.35 - sh) / 0.15);
    if (hazard === 'FL') { // calibrated per flood type, see P.FLOOD
      const c = P.FLOOD[sub === 'flash' ? 'flash' : 'riverine'], k = Math.exp(shift * 0.5);
      return { fAff, fDis: c.dis * fAff, sev: M.clamp(s, 0, 1), fFat: c.fat * k * fAff, injPerFat: c.inj };
    }
    const kDis = { WF: 0.5, VO: 1.0, DR: 0 }[hazard] ?? 0.3;
    return { fAff, fDis: kDis * fAff, sev: M.clamp(s, 0, 1), fFat: hazard === 'DR' ? 0 : 1e-4 * fAff, injPerFat: 5 };
  };

  /** Flood calibration (ratios to people affected), from documented events:
   *  flash / glacial-lake / cloudburst: Nepal Trishuli flood Aug 2026, 955 deaths / ~93,000 impacted (IFRC) = 1.0 %;
   *    3,458 evacuated (3.7 %); 279–1,473 injured per 955 deaths (0.3–1.5).
   *  riverine: Pakistan 2022, 1,739 deaths / 33 M affected = 0.005 %; world 1980–2009, 539,811 / 2.8 bn = 0.019 %
   *    (Doocy et al., PLOS Currents 2013) → 0.01 % (geometric middle); homeless 2.1 M–displaced 8 M of 33 M → 20 %;
   *    injuries per death 0.67 (world) to 7.4 (Pakistan) → 2. */
  P.FLOOD = {
    flash: { fat: 0.01, dis: 0.04, inj: 1, implied: true, label: 'flash flood (steep terrain, glacial-lake outburst, cloudburst or dam failure)' },
    riverine: { fat: 1e-4, dis: 0.2, inj: 2, label: 'river / plain flood' },
  };
  const FLASH_WORDS = /flash|glof|glacier|glacial|cloud ?burst|dam (break|burst|failure|collapse)|debris|landslide|mudslide/i;
  /** Classify a flood: name keywords first, else terrain relief (max − min elevation within ~20 km). */
  P.floodKind = (name, reliefM) => (FLASH_WORDS.test(name || '') ? 'flash' : reliefM != null && reliefM >= 800 ? 'flash' : 'riverine');

  /** USGS PAGER fatality bands (alert colour → estimated deaths range). */
  P.PAGER_BANDS = { green: [0, 1], yellow: [1, 99], orange: [100, 999], red: [1000, Infinity] };

  /** Rescale one forecast metric (summary + zones) so its P50 equals `target`, keeping the spread. */
  const rescale = (fc, zones, key, target, floor) => {
    const d = fc.summary[key], r = d.p50 > 0 ? target / d.p50 : 0;
    if (d.p50 > 0) { d.p10 *= r; d.p50 = target; d.p90 *= r; zones.forEach((z) => ['p10', 'p50', 'p90'].forEach((q) => (z.fc[key][q] *= r))); }
    else { // model had nothing here: spread the target by affected share
      const totA = M.sum(zones.map((z) => z.fc.aff.p50)) || 1;
      zones.forEach((z) => { const w = z.fc.aff.p50 / totA; z.fc[key] = { p10: (floor || 0) * w, p50: target * w, p90: target * 1.5 * w }; });
      Object.assign(d, { p10: floor || 0, p50: target, p90: target * 1.5 });
    }
    if (floor != null) d.p10 = Math.max(d.p10, floor);
    d.p90 = Math.max(d.p90, d.p50);
  };

  /** Keep the EQ fatality forecast inside the USGS PAGER band (PAGER is the agency's own loss model). */
  P.applyPager = (fc, zones, pager) => {
    const b = P.PAGER_BANDS[pager]; if (!b) return null;
    const p50 = fc.summary.fat.p50; let target = null;
    if (p50 < b[0]) target = b[0] === 1 ? 3 : b[0] * 1.5; // inside the band, near its lower part
    else if (p50 > b[1]) target = b[1] === 1 ? 0 : b[1] * 0.7;
    if (target == null) return { pager, kept: true };
    const ratio = p50 > 0 ? target / p50 : 1;
    rescale(fc, zones, 'fat', target);
    if (p50 > 0) rescale(fc, zones, 'inj', fc.summary.inj.p50 * ratio);
    return { pager, kept: false, from: p50, to: target };
  };

  /** Agency-reported counts are confirmed minimums: the forecast can never be below them.
   *  rep = { deaths, missing, injured, displaced, affected }. Missing people raise the deaths P90. */
  P.applyReported = (fc, zones, rep, calib) => {
    if (!rep) return [];
    const changes = [];
    const fix = (key, val, extra = 0) => {
      if (!(val > 0)) return;
      const d = fc.summary[key], before = d.p50;
      if (d.p50 < val) rescale(fc, zones, key, val + 0.5 * extra, val);
      else d.p10 = Math.max(d.p10, val);
      d.p90 = Math.max(d.p90, val + extra, d.p50);
      changes.push({ key, reported: val, before, after: d.p50 });
    };
    const fat0 = fc.summary.fat.p50, inj0 = fc.summary.inj.p50;
    fix('fat', rep.deaths, rep.missing || 0);
    // no injury count reported: keep the model's injuries-per-death ratio when deaths were raised
    if (!(rep.injured > 0) && fat0 > 0 && fc.summary.fat.p50 > fat0 && inj0 > 0) rescale(fc, zones, 'inj', inj0 * (fc.summary.fat.p50 / fat0), inj0);
    fix('inj', rep.injured);
    fix('dis', rep.displaced);
    fix('aff', Math.max(rep.affected || 0, rep.displaced || 0, (rep.deaths || 0) + (rep.injured || 0) + (rep.missing || 0)));
    // implied exposure: reported deaths ÷ calibrated death rate (flash floods only; river-flood death rates vary 4× so the inference is too loose) — e.g. Nepal 2026: 955 / 1 % ≈ 95,500 vs IFRC 93,000 impacted
    if (calib && calib.implied && rep.deaths > 0) {
      const impliedAff = rep.deaths / calib.fat, a = fc.summary.aff;
      if (impliedAff > a.p50) { const before = a.p50; rescale(fc, zones, 'aff', impliedAff, a.p10); changes.push({ key: 'aff', implied: impliedAff, before, after: impliedAff }); }
      const impliedDis = impliedAff * calib.dis;
      if (impliedDis > fc.summary.dis.p50) rescale(fc, zones, 'dis', impliedDis, fc.summary.dis.p10);
    }
    // displaced and casualties cannot exceed affected
    const A = fc.summary.aff; ['dis'].forEach((k) => { const d = fc.summary[k]; if (d.p50 > A.p50) { A.p50 = d.p50; A.p90 = Math.max(A.p90, d.p90); } });
    return changes;
  };

  /** Radius (km) inside which at least 10 % of people are affected. */
  P.impactRadius = (sit) => {
    for (let r = 1; r <= 300; r += 1) {
      const I = P.intensity(sit, r);
      if (P.impact(sit.hazard, I, sit.countryVul, 0, sit.floodKind).fAff < 0.1) return Math.max(10, r);
    }
    return 300;
  };

  P.rampAt = (sit, hoursFromNow) => {
    if (!['TC', 'FL'].includes(sit.hazard)) return 1;
    const Tp = sit.peakInHours || 0;
    return 1 / (1 + Math.exp(-(hoursFromNow - Tp) / 6));
  };

  const PLACE_DEFAULT_POP = { city: 250000, town: 20000, suburb: 30000, quarter: 15000, neighbourhood: 8000, village: 1500, hamlet: 150 };
  const RURAL = { city: 0.3, town: 0.6, suburb: 0.4, quarter: 0.4, neighbourhood: 0.4, village: 1, hamlet: 1, sector: 0.7 };
  const LOCAL = new Set(['suburb', 'quarter', 'neighbourhood']);
  const DIRS = ['north', 'east', 'south', 'west'];

  /** Build demand zones from OSM places (or modelled sectors when none). */
  P.buildZones = (sit, places, maxZones = 12) => {
    const R = sit.radiusKm;
    const src = { lat: sit.lat, lon: sit.lon };
    const c = sit.focus || src; // planning focus (land point) may differ from an offshore source
    let zones = [];
    const all = (places || []).filter((pl) => M.haversine(c, pl) <= R);
    all.forEach((pl) => {
      const tagged = pl.population > 0;
      const pop = tagged ? pl.population : PLACE_DEFAULT_POP[pl.type] || 1000;
      if (pl.type === 'city' || (pl.type === 'town' && pop >= 300000)) {
        const rc = Math.max(3, Math.sqrt(pop / 4000 / Math.PI)); // urban radius at ~4,000 people/km²
        const locals = all.filter((o) => LOCAL.has(o.type) && M.haversine(pl, o) <= rc * 1.2);
        if (locals.length >= 3) { // the city is represented by its own sectors/suburbs (added below)
          locals.forEach((o) => { o.parent = o.parent || pl.name; o.cityPop = pop / locals.length; });
          return;
        }
        if (pop >= 300000) { // no localities mapped: four quarters, named from the map later
          DIRS.forEach((q, k) => {
            const p = M.destination(pl, k * 90, 0.45 * rc);
            zones.push({ name: `${pl.name} (${q})`, lat: p.lat, lon: p.lon, pop: pop / 4, type: pl.type, popProv: tagged ? 'osm' : 'modelled', needsName: true, parent: pl.name });
          });
          return;
        }
      }
      if (LOCAL.has(pl.type)) {
        const p2 = pl.population > 0 ? pl.population : pl.cityPop ? Math.min(pl.cityPop, 60000) : PLACE_DEFAULT_POP[pl.type];
        zones.push({ name: pl.name, lat: pl.lat, lon: pl.lon, pop: p2, type: pl.type, popProv: pl.population > 0 ? 'osm' : 'modelled', parent: pl.parent || '' });
        return;
      }
      zones.push({ name: pl.name, lat: pl.lat, lon: pl.lon, pop, type: pl.type, popProv: tagged ? 'osm' : 'modelled', parent: pl.parent || '' });
    });
    // merge near-duplicates (< 1.5 km)
    zones = zones.filter((z, i) => { const o = zones.find((x, j) => j < i && M.haversine(z, x) < 1.5); if (o) (o.covers = o.covers || []).push(z.name); return !o; });
    if (zones.length < 4) { // modelled sectors (center + 6 ring)
      const dens = sit.popDensity || 400; // persons/km² assumption, labelled
      const ringR = 0.45 * R, areaCore = Math.PI * (0.3 * R) ** 2, areaSector = (Math.PI * R * R - areaCore) / 6;
      // modelled areas: named from the map (reverse geocoding) by the engine; these labels are only a fallback
      zones.push({ name: 'Area at the centre', lat: c.lat, lon: c.lon, pop: dens * areaCore * 1.5, type: 'sector', popProv: 'modelled', needsName: true });
      for (let k = 0; k < 6; k++) {
        const p = M.destination(c, k * 60 + 30, ringR);
        zones.push({ name: `Area ${Math.round(ringR)} km ${['north-east', 'east', 'south-east', 'south-west', 'west', 'north-west'][k]}`, lat: p.lat, lon: p.lon, pop: dens * areaSector, type: 'sector', popProv: 'modelled', needsName: true });
      }
    }
    zones.forEach((z) => {
      z.distKm = M.haversine(src, z);
      z.I = P.intensity(sit, z.distKm);
      const im = P.impact(sit.hazard, z.I, sit.countryVul, 0, sit.floodKind);
      z.affEst = z.pop * im.fAff;
      z.rural = RURAL[z.type] ?? 0.7;
    });
    zones.sort((a, b) => b.affEst - a.affEst);
    // pick the worst-hit areas but keep them ≥ 2 km apart, so a dense city is covered across its extent;
    // each skipped locality is listed under the nearest chosen area ("also covers …")
    const cand = zones.filter((z) => z.affEst > 1), chosen = [];
    cand.forEach((z) => { if (chosen.length < maxZones && !chosen.some((o) => M.haversine(o, z) < 2)) chosen.push(z); });
    cand.forEach((z) => { if (chosen.includes(z)) return; const near = chosen.reduce((b, o) => (M.haversine(o, z) < M.haversine(b, z) ? o : b), chosen[0]); if (near && M.haversine(near, z) < 6) (near.covers = near.covers || []).push(z.name); });
    zones = chosen;
    zones.forEach((z, i) => { z.id = 'Z' + (i + 1); z.recv = {}; z.surge = 1; });
    return zones;
  };

  /** Monte-Carlo forecast per zone → P10/P50/P90 and three weighted scenarios. */
  P.forecast = (sit, zones, draws = AA.config.mcDraws, seed = AA.config.seed) => {
    const rng = M.mulberry32(seed);
    const V = sit.countryVul ?? 0.5;
    const samples = zones.map(() => ({ aff: [], dis: [], inj: [], fat: [], sev: [] }));
    const totals = { aff: [], dis: [], inj: [], fat: [] };
    for (let n = 0; n < draws; n++) {
      let mag = sit.magnitude;
      if (sit.hazard === 'EQ') mag += 0.2 * M.gauss(rng);
      else if (sit.hazard === 'TC') mag *= Math.exp(0.12 * M.gauss(rng));
      else mag = M.clamp(mag * Math.exp(0.15 * M.gauss(rng)), 0, 1);
      const shift = 0.3 * M.gauss(rng);
      const tot = { aff: 0, dis: 0, inj: 0, fat: 0 };
      zones.forEach((z, i) => {
        const pop = z.pop * Math.exp(0.2 * M.gauss(rng));
        const I = z.sObs != null ? M.clamp(z.sObs * (mag / (sit.magnitude || 1)), 0, 1) : P.intensity(sit, z.distKm, mag); // observed river flow overrides distance decay
        const im = P.impact(sit.hazard, I, V, shift, sit.floodKind);
        const aff = pop * im.fAff, dis = pop * im.fDis, fat = pop * im.fFat, inj = fat * im.injPerFat;
        const s = samples[i];
        s.aff.push(aff); s.dis.push(dis); s.inj.push(inj); s.fat.push(fat); s.sev.push(im.sev);
        tot.aff += aff; tot.dis += dis; tot.inj += inj; tot.fat += fat;
      });
      Object.keys(tot).forEach((k) => totals[k].push(tot[k]));
    }
    const q = (a) => ({ p10: M.quantile(a, 0.1), p50: M.quantile(a, 0.5), p90: M.quantile(a, 0.9) });
    zones.forEach((z, i) => {
      const s = samples[i];
      z.fc = { aff: q(s.aff), dis: q(s.dis), inj: q(s.inj), fat: q(s.fat), sev: q(s.sev) };
      if (z.sevPost == null) z.sevMean = z.fc.sev.p50; // Bayesian posterior overrides when present
    });
    const summary = {}; Object.keys(totals).forEach((k) => (summary[k] = q(totals[k])));
    return { draws, seed, summary };
  };

  /** Scenario value: s ∈ {low, base, high} → P10/P50/P90 */
  P.scenarioValue = (dist, s) => (s === 'low' ? dist.p10 : s === 'high' ? dist.p90 : dist.p50);

  /** Gaussian conjugate update. */
  P.bayes = (mu0, s0, y, sy) => {
    const w0 = 1 / (s0 * s0), wy = 1 / (sy * sy);
    return { mu: (mu0 * w0 + y * wy) / (w0 + wy), sd: Math.sqrt(1 / (w0 + wy)) };
  };

  /** River-flow ratio (peak ÷ yearly median) → flood intensity 0..1: 2× ≈ bank-full (0.35, damage threshold),
   *  5× = 0.65, 12.5× ≈ 0.95. Below 1.2× the river is in its normal range (0). */
  P.flowToS = (ratio) => (ratio == null ? null : ratio < 1.2 ? 0 : M.clamp(0.35 + (0.3 * Math.log(ratio / 2)) / Math.log(2.5), 0, 1));

  /** Catchment radius (km) for each zone: half the distance to its nearest neighbour, 1.5–15 km
   *  (quadrants of large cities use their quadrant size). Used to count people with WorldPop. */
  P.catchments = (zones) => zones.map((z) => {
    const others = zones.filter((o) => o !== z).map((o) => M.haversine(z, o));
    const nn = others.length ? Math.min(...others) : 20;
    return M.clamp(0.5 * nn, 1.5, 15);
  });

  /** Quantile of a PAGER fatality distribution (probability bins on a log scale). */
  P.pagerQuantile = (bins, q) => {
    const tot = M.sum(bins.map((b) => b.p)) || 1; let acc = 0;
    for (const b of bins) {
      const p = b.p / tot;
      if (acc + p >= q && p > 0) {
        const f = (q - acc) / p;
        if (b.min <= 0) return f * b.max; // 0–1 bin: linear
        return Math.pow(10, Math.log10(b.min) + f * (Math.log10(b.max) - Math.log10(b.min)));
      }
      acc += p;
    }
    return bins[bins.length - 1].max;
  };

  /** Replace the fatality forecast with the USGS PAGER distribution (country-calibrated, ShakeMap-based) and
   *  recompute affected/displaced by applying our fragility curves to PAGER's population exposure by MMI. */
  P.applyPagerLosses = (fc, zones, pg, V = 0.5) => {
    if (!pg?.bins) return null;
    const q = { p10: P.pagerQuantile(pg.bins, 0.1), p50: P.pagerQuantile(pg.bins, 0.5), p90: P.pagerQuantile(pg.bins, 0.9) };
    const before = { ...fc.summary.fat }, inj0 = fc.summary.inj.p50, fat0 = fc.summary.fat.p50;
    rescale(fc, zones, 'fat', q.p50);
    Object.assign(fc.summary.fat, q);
    if (fat0 > 0 && inj0 > 0) rescale(fc, zones, 'inj', inj0 * (q.p50 / fat0)); else rescale(fc, zones, 'inj', q.p50 * 3.5);
    const out = { quantiles: q, before, level: pg.level };
    if (pg.exposure?.length) {
      let aff = 0, dis = 0;
      pg.exposure.forEach((e) => { const im = P.impact('EQ', e.mmi, V); aff += e.pop * im.fAff; dis += e.pop * im.fDis; });
      // exposure covers the whole shaken area; our zones cover the planning radius, so only raise, never lower
      if (aff > fc.summary.aff.p50) { rescale(fc, zones, 'aff', aff, fc.summary.aff.p10); out.aff = aff; }
      if (dis > fc.summary.dis.p50) { rescale(fc, zones, 'dis', dis, fc.summary.dis.p10); out.dis = dis; }
    }
    return out;
  };

  P.ALERT_S0 = ALERT_S0;
  AA.prediction = P;
})(typeof window !== 'undefined' ? window : globalThis);
