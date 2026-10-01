/* Acceptance tests from the SKILL.md files. Run: npm i javascript-lp-solver && node tests/models.test.js */
const path = require('path');
globalThis.solver = require('javascript-lp-solver');
const R = (f) => require(path.join(__dirname, '..', f));
['js/core.js', 'js/data.js', 'js/workspace.js', 'js/models/prediction.js', 'js/models/fairness.js', 'js/models/efficiency.js', 'js/models/routing.js', 'js/models/facility.js', 'js/models/risk.js'].forEach(R);
const AA = globalThis.AA, M = AA.math, P = AA.prediction, F = AA.fairness, E = AA.efficiency;

let pass = 0, fail = 0;
const t = (name, fn) => { try { const ok = fn(); if (ok === false) throw new Error('assertion false'); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '—', e.message); } };

// ---------- fixture ----------
const sit = { hazard: 'EQ', lat: 28.45, lon: 77.02, magnitude: 7.0, depth: 12, countryVul: 0.6 };
sit.radiusKm = P.impactRadius(sit);
const places = [
  { name: 'Gurugram', lat: 28.46, lon: 77.03, population: 1500000, type: 'city' }, { name: 'Sohna', lat: 28.25, lon: 77.07, population: 60000, type: 'town' },
  { name: 'Farukhnagar', lat: 28.45, lon: 76.82, type: 'town' }, { name: 'Manesar', lat: 28.36, lon: 76.94, population: 30000, type: 'town' },
  { name: 'Badshahpur', lat: 28.39, lon: 77.05, type: 'village' }, { name: 'Pataudi', lat: 28.32, lon: 76.78, population: 25000, type: 'town' },
];
const mkProblem = (stockScale = 1, fleet = 6) => {
  const zones = P.buildZones(sit, places); P.forecast(sit, zones);
  F.netDemand(zones, sit, 0); zones.forEach((z, i) => (z.acc = (i % 3) / 3)); F.needScores(zones, sit);
  const depots = [0, 1, 2, 3, 4, 5].map((j) => ({ id: 'D' + j, ...M.destination(sit, j * 60, 35), open: true, stock: { water: 400 * stockScale, food: 60 * stockScale, shelter: 3000 * stockScale, medical: 300 * stockScale, staff: 150 * stockScale }, fleet: { truck: fleet, bus: Math.max(2, fleet / 3) } }));
  const tau = depots.map((d) => zones.map((z) => (M.haversine(d, z) * 1.35) / 40)), dist = depots.map((d) => zones.map((z) => M.haversine(d, z) * 1.35));
  return { zones, depots, tau, dist };
};
const totalUnmet = (r) => M.sum(r.unmet.map((u) => M.sum(Object.values(u))));

console.log('prediction');
t('intensity never increases with distance (flat over the rupture, then decays)', () => [1, 5, 20, 50, 100, 200].every((r, k, a) => k === 0 || P.intensity(sit, r) <= P.intensity(sit, a[k - 1])) && P.intensity(sit, 100) < P.intensity(sit, 50));
// Calibration against real events: the observed death toll must fall inside the forecast P10–P90 band
const band = (s, pl) => { s.radiusKm = P.impactRadius(s); const z = P.buildZones(s, pl); return P.forecast(s, z).summary.fat; };
t('Nepal 2015 M7.8 (≈9,000 deaths) inside P10–P90', () => { const f = band({ hazard: 'EQ', lat: 28.23, lon: 84.73, magnitude: 7.8, depth: 15, countryVul: 0.75 }, [{ name: 'Kathmandu', lat: 27.71, lon: 85.32, population: 2800000, type: 'city' }, { name: 'Pokhara', lat: 28.21, lon: 83.99, population: 500000, type: 'city' }, { name: 'Gorkha', lat: 28.0, lon: 84.63, population: 250000, type: 'town' }]); return f.p10 <= 9000 && 9000 <= f.p90; });
t('Türkiye 2023 M7.8 (≈50,000 deaths) inside P10–P90', () => { const f = band({ hazard: 'EQ', lat: 37.17, lon: 37.03, magnitude: 7.8, depth: 10, countryVul: 0.45 }, [{ name: 'Gaziantep', lat: 37.07, lon: 37.38, population: 2100000, type: 'city' }, { name: 'Kahramanmaras', lat: 37.58, lon: 36.93, population: 1100000, type: 'city' }, { name: 'Hatay', lat: 36.2, lon: 36.16, population: 1600000, type: 'city' }, { name: 'Adiyaman', lat: 37.76, lon: 38.28, population: 600000, type: 'city' }, { name: 'Malatya', lat: 38.35, lon: 38.31, population: 800000, type: 'city' }]); return f.p10 <= 50000 && 50000 <= f.p90; });
t('M7 at 10 km gives MMI 8–9.5', () => { const I = P.intensity({ ...sit, depth: 10 }, 10); return I >= 8 && I <= 9.5; });
t('P10 ≤ P50 ≤ P90 for every zone metric', () => { const z = P.buildZones(sit, places); P.forecast(sit, z); return z.every((x) => ['aff', 'dis', 'inj', 'fat'].every((k) => x.fc[k].p10 <= x.fc[k].p50 && x.fc[k].p50 <= x.fc[k].p90)); });
t('Bayesian posterior lies between prior and observation', () => { const b = P.bayes(0.4, 0.15, 0.8, 0.1); return b.mu > 0.4 && b.mu < 0.8 && b.sd < 0.1; });
t('forecast is deterministic for a fixed seed', () => { const a = P.buildZones(sit, places), b = P.buildZones(sit, places); P.forecast(sit, a); P.forecast(sit, b); return a[0].fc.aff.p50 === b[0].fc.aff.p50; });


console.log('accuracy backtests (floods, agency evidence)');
// Real GDACS geteventdata 'sendai' entries for FL 1104124 (Nepal Trishuli flood, Aug 2026), fetched 1 Oct 2026
const SENDAI_NEPAL = [
  ['affected', 826, 'Out of contact in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'], ['rescued', 1552, 'Rescued in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'],
  ['displaced', 3458, 'Evacuated in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'], ['rescued', 10451, 'Rescued in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'],
  ['affected', 910, 'Out of contact in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'], ['transport damaged', 77, 'Bridge destroyed in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province', '[bridges]'],
  ['affected', 558, 'Out of contact in Gyirong County, Shigatse, Tibet, China', 'China', 'Gyirong County'], ['affected', 564, 'Out of contact in Gyirong County, Shigatse, Tibet, China', 'China', 'Gyirong County'],
  ['injured', 279, 'Injured in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'], ['affected', 1124, 'Out of contact in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'],
  ['death', 16, 'Fatalities in Gyirong Port , Gyirong County, Shigatse, Tibet, China', 'China', 'Gyirong County'], ['death', 939, 'Fatalities in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'],
  ['affected', 4247, 'Out of contact in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'], ['affected', 3925, 'Out of contact in Bagmati Province, Nepal', 'Nepal', 'Bagmati Province'],
].map(([n, v, d, c, r, u]) => ({ sendainame: n, sendaivalue: String(v), description: `${v.toLocaleString('en')} ${u || '[people]'} ${d}`, country: c, region: r, dateinsert: '2026-09-01T15:57:03' }));
const rep = AA.data.parseSendai(SENDAI_NEPAL);
t('GDACS reports parsed: Nepal 2026 = 955 deaths, 4,811 missing, 279 injured, 3,458 displaced', () => rep.deaths === 955 && rep.missing === 4811 && rep.injured === 279 && rep.displaced === 3458);
t('terrain classifies floods: Himalayan relief → flash; Indus plain → river', () => P.floodKind('Flood in Nepal', 2281) === 'flash' && P.floodKind('Flood in Pakistan', 40) === 'riverine' && P.floodKind('Cloudburst in Himachal', null) === 'flash');
t('flash-flood death rate matches Nepal 2026 (955 / 93,000 = 1.0 %) within ×2', () => { const im = P.impact('FL', 0.9, 0.6, 0, 'flash'); const r = im.fFat / im.fAff; return r >= 0.005 && r <= 0.02; });
t('river-flood death rate between Pakistan 2022 (0.005 %) and world 1980–2009 (0.019 %)', () => { const im = P.impact('FL', 0.9, 0.6, 0, 'riverine'); const r = im.fFat / im.fAff; return r >= 5.3e-5 && r <= 1.9e-4; });
t('flash flood deaths are ≥ 50× river flood deaths for the same exposure', () => P.impact('FL', 0.9, 0.6, 0, 'flash').fFat >= 50 * P.impact('FL', 0.9, 0.6, 0, 'riverine').fFat);
const nepalFL = () => { const s = { hazard: 'FL', lat: 27.2953, lon: 85.3649, magnitude: 0.9, radiusKm: 40, countryVul: 0.75, floodKind: 'flash' }; const pl = [{ name: 'Village A', lat: 27.33, lon: 85.43, type: 'village' }, { name: 'Village B', lat: 27.26, lon: 85.47, type: 'village' }, { name: 'Village C', lat: 27.32, lon: 85.48, type: 'village' }, { name: 'Village D', lat: 27.39, lon: 85.48, type: 'village' }]; const z = P.buildZones(s, pl); const fc = P.forecast(s, z); return { z, fc }; };
t('Nepal 2026 replay: forecast never below reported deaths; P90 covers deaths + missing', () => { const { z, fc } = nepalFL(); P.applyReported(fc, z, rep); const f = fc.summary.fat; return f.p10 >= 955 && f.p50 >= 955 && f.p90 >= 955 + 4811 && Math.abs(M.sum(z.map((x) => x.fc.fat.p50)) - f.p50) / f.p50 < 0.05; });
t('Nepal 2026 replay: displaced ≥ 3,458 and affected ≥ displaced', () => { const { z, fc } = nepalFL(); P.applyReported(fc, z, rep); return fc.summary.dis.p50 >= 3458 && fc.summary.aff.p50 >= fc.summary.dis.p50; });
t('Nepal 2026 replay: implied affected (deaths ÷ flash rate) within ±25 % of IFRC 93,000 impacted', () => { const { z, fc } = nepalFL(); P.applyReported(fc, z, rep, P.FLOOD.flash); return Math.abs(fc.summary.aff.p50 - 93000) / 93000 <= 0.25 && fc.summary.dis.p50 >= 3458; });
t('USGS PAGER red moves a low fatality forecast to ≥ 1,000; green to < 1', () => { const a = P.buildZones(sit, places), fa = P.forecast(sit, a); fa.summary.fat = { p10: 10, p50: 50, p90: 90 }; P.applyPager(fa, a, 'red'); const b = P.buildZones(sit, places), fb = P.forecast(sit, b); P.applyPager(fb, b, 'green'); return fa.summary.fat.p50 >= 1000 && fb.summary.fat.p50 < 1; });

console.log('fairness');
t('zone already supplied gets zero net demand', () => { const pb = mkProblem(); const z = pb.zones[1]; Object.keys(z.D).forEach((k) => (z.recv[k] = z.D[k] * 1.01)); F.netDemand(pb.zones, sit, 0); return Object.values(z.d).every((v) => v === 0); });
t('need score in [0,1] and population is not the dominant weight', () => { const w = AA.config.needWeights; const pb = mkProblem(); return pb.zones.every((z) => z.need >= 0 && z.need <= 1) && w.sev > w.pop; });
t('10× population at equal severity does not outrank a more severe zone', () => {
  const zs = [{ fc: { aff: { p50: 1e6 } }, sevMean: 0.3, rural: 0.5, acc: 0.5, recv: {}, D: {} }, { fc: { aff: { p50: 1e5 } }, sevMean: 0.9, rural: 0.5, acc: 0.5, recv: {}, D: {} }];
  F.needScores(zs, { countryVul: 0.5 }); return zs[1].need > zs[0].need;
});

console.log('efficiency');
const base = mkProblem();
const r1 = E.allocate(base);
t('allocation is feasible', () => r1.feasible);
t('ships only from open depots and within stock', () => base.depots.every((d, j) => AA.config.commodities.every((k) => M.sum(r1.ship.filter((s) => s.j === j && s.k === k.key).map((s) => s.qty)) <= d.stock[k.key] + 1e-6)));
t('fleet-hour budget respected', () => base.depots.every((d, j) => ['truck', 'bus'].every((c) => M.sum(r1.trips.filter((x) => x.j === j && x.cls === c).map((x) => x.n * (2 * base.tau[j][x.i] + AA.config.serviceHours))) <= d.fleet[c] * AA.config.epochHours + 1e-6)));
t('doubling supply never increases unmet demand', () => { const r2 = E.allocate(mkProblem(2, 12)); return totalUnmet(r2) <= totalUnmet(r1) + 1e-6; });
t('ample supply → no unmet demand', () => { const r3 = E.allocate(mkProblem(400, 400)); return totalUnmet(r3) < 1e-3; });
t('closing a depot removes all its shipments', () => { const pb = mkProblem(); pb.depots[0].open = false; const r = E.allocate(pb); return !r.ship.some((s) => s.j === 0); });
t('scarce water is shared: shortage ratios within 0.25 across zones', () => { const q = r1.ratios.filter((_, i) => base.zones[i].d.water > 0).map((r) => r.water); return Math.max(...q) - Math.min(...q) <= 0.25; });
t('consolidation never increases vehicle count', () => { const zz = base.zones.map((a) => base.zones.map((b) => (M.haversine(a, b) * 1.35) / 40)); const c = E.consolidate(base, r1, zz); return c.tripsAfter <= c.tripsBefore; });
t('BPR time grows with flow', () => E.bprTime(1, 10, 10) > E.bprTime(1, 5, 10) && E.bprTime(1, 0, 10) === 1);
t('casualty LP respects beds', () => { const c = E.casualties([30, 10], [{ beds: 15 }, { beds: 5 }], [[0.5, 1], [1, 0.3]], 20); return M.sum(c.flows.filter((f) => f.h === 0).map((f) => f.n)) <= 15 + 1e-6 && M.sum(c.unserved) >= 20 - 1e-6; });

console.log('routing');
t('closure on path is detected', () => AA.routing.hitsClosure([[77.0, 28.4], [77.1, 28.5]], [{ lat: 28.45, lon: 77.05 }], 0.25));
t('road damage decays each epoch without new shocks', () => { const p = { lat: 28.46, lon: 77.03 }; return AA.routing.damageAt(sit, { epoch: 3 }, p) < AA.routing.damageAt(sit, { epoch: 0 }, p); });

console.log('facility-location');
t('more sites never reduce covered need; no site in heavy damage', () => {
  const zones = P.buildZones(sit, places); P.forecast(sit, zones); F.netDemand(zones, sit, 0); F.needScores(zones, sit);
  const cand = AA.facility.candidates(sit); const tau = cand.map((c) => zones.map((z) => (M.haversine(c, z) * 1.35) / 40));
  const a = AA.facility.mclp(zones, cand, tau, 2), b = AA.facility.mclp(zones, cand, tau, 3);
  return b.covered >= a.covered && b.sites.every((j) => cand[j].sev <= 0.3);
});

console.log('risk');
t('Gutenberg–Richter recovers b≈1 on a synthetic catalogue', () => {
  const rng = M.mulberry32(7); const mags = []; for (let k = 0; k < 4000; k++) mags.push(4.45 + -Math.log10(1 - rng()) / 1.0);
  const g = AA.risk.gutenbergRichter(mags.map((m) => Math.round(m * 10) / 10), 50); return Math.abs(g.b - 1) < 0.1;
});
t('risk index in [0,1] for every cell', () => {
  const cells = AA.risk.grid(sit, 60, 5); const res = AA.risk.assess(cells, { eq: [{ lat: 28.5, lon: 77, magnitude: 5.6 }, { lat: 28.2, lon: 77.3, magnitude: 6.1 }], eqYears: 50, events: [{ lat: 28.4, lon: 77.1, hazard: 'FL' }], places, hospitals: [{ lat: 28.46, lon: 77.03 }], country: { vul: 0.6, lcc: 0.7 } });
  return res.cells.every((c) => c.R >= 0 && c.R <= 1);
});
t('Gumbel 100-yr flood exceeds 10-yr flood', () => { const g = AA.risk.gumbel([100, 140, 90, 200, 160, 120, 180, 110]); return g.q(100) > g.q(10); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
