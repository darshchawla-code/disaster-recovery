/* Phase 2 acceptance tests: cost-saving report, pre-season readiness, field reports, public API.
   Run: npm i javascript-lp-solver && node tests/phase2.test.js */
const path = require('path');
globalThis.solver = require('javascript-lp-solver');
const R = (f) => require(path.join(__dirname, '..', f));
['js/core.js', 'js/data.js', 'js/workspace.js', 'js/cloud.js', 'js/models/fatality-params.js', 'js/models/prediction.js', 'js/models/fairness.js', 'js/models/efficiency.js', 'js/models/routing.js', 'js/models/facility.js', 'js/models/risk.js', 'js/models/savings.js', 'js/models/readiness.js', 'js/engine.js', 'js/pipelines.js', 'js/field.js'].forEach(R);
const AA = globalThis.AA, M = AA.math, P = AA.prediction, F = AA.fairness, E = AA.efficiency, S = AA.savings, RD = AA.readiness, FR = AA.field;

let pass = 0, fail = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);
const run = async () => {
  for (const [name, fn] of queue) {
    try { const ok = await fn(); if (ok === false) throw new Error('assertion false'); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '—', e.message); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (require.main === module) process.exit(fail ? 1 : 0);
};
module.exports = { t, run };

// ---------- fixture (same as tests/models.test.js) ----------
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
const stateOf = (pb) => { const alloc = E.allocate(pb); const zz = pb.zones.map((a) => pb.zones.map((b) => (M.haversine(a, b) * 1.35) / 40)); const cons = E.consolidate(pb, alloc, zz); return { lastRun: { pb, alloc, cons } }; };

// ---------------- cost-saving report ----------------
console.log('cost-saving report');
t('nearest-store baseline never ships more than a store holds or more than an area needs', () => {
  const pb = mkProblem(0.3, 3), b = S.nearestStore(pb), K = AA.config.commodities;
  const okStock = pb.depots.every((d, j) => K.every((k) => M.sum(b.ship.filter((s) => s.j === j && s.k === k.key).map((s) => s.qty)) <= d.stock[k.key] + 1e-6));
  const okDem = pb.zones.every((z, i) => K.every((k) => M.sum(b.ship.filter((s) => s.i === i && s.k === k.key).map((s) => s.qty)) <= (z.d[k.key] || 0) + 1e-6));
  return okStock && okDem;
});
t('nearest-store baseline respects each store\'s vehicle-hour budget', () => {
  const pb = mkProblem(1, 2), b = S.nearestStore(pb), cfg = AA.config;
  return pb.depots.every((d, j) => ['truck', 'bus'].every((c) => M.sum(b.trips.filter((x) => x.j === j && x.cls === c).map((x) => x.n * (2 * pb.tau[j][x.i] + cfg.serviceHours))) <= (d.fleet[c] || 0) * cfg.epochHours + 1e-6));
});
t('nearest-store baseline serves the first area from its nearest store, then the next-nearest', () => {
  const pb = mkProblem(10, 20), b = S.nearestStore(pb);
  const order = pb.depots.map((d, j) => j).sort((a, c) => pb.tau[a][0] - pb.tau[c][0]);
  const used = b.ship.filter((s) => s.i === 0 && s.k === 'water').map((s) => s.j);
  return used.length > 0 && used.every((j, k) => j === order[k]);
});
t('when stock is scarce, the optimised plan shares water more evenly than nearest-store (lower Gini)', () => {
  // (with the wider 3.1 earthquake ranges the demand is spread more evenly, so "top-need areas get more" is no longer a fixed property of this fixture)
  const pb = mkProblem(0.15, 4), c = S.compare(stateOf(pb));
  return c.optimised.gini.water <= c.baseline.gini.water + 1e-6;
});
t('when stock is plentiful, the optimised plan costs no more per tonne than nearest-store', () => {
  const pb = mkProblem(20, 30), c = S.compare(stateOf(pb));
  return c.optimised.costPerTonne <= c.baseline.costPerTonne * 1.05;
});
t('comparison is consistent: savings = baseline − optimised', () => { const c = S.compare(stateOf(mkProblem(0.5, 6))); return Math.abs(c.saved.money - (c.baseline.cost - c.optimised.cost)) < 1e-6 && Math.abs(c.saved.critPts - (c.optimised.critCoverage - c.baseline.critCoverage)) < 1e-9; });
t('headlines are plain sentences, never empty', () => { const h = S.headlines(S.compare(stateOf(mkProblem(0.5, 6)))); return h.length >= 1 && h.every((x) => /\.$/.test(x)); });

// ---------------- readiness ----------------
console.log('pre-season readiness');
const area = (name, lat, lon, aff, mult = 1) => {
  const s = { hazard: 'EQ', lat, lon, magnitude: 6.8 * mult, depth: 10, countryVul: 0.6 }; s.radiusKm = P.impactRadius(s);
  const zones = P.buildZones(s, places); P.forecast(s, zones); const n = RD.need72(zones);
  return { name, lat, lon, R: 0.8, hazard: 'EQ', sit: s, need: n.need, affP90: n.affP90 || aff };
};
const a1 = area('Gurugram centre', 28.46, 77.03), a2 = area('Sohna', 28.25, 77.07);
const store = (name, lat, lon, k = 1, trucks = 10) => ({ name, lat, lon, stock: { water: 2000 * k, food: 600 * k, shelter: 20000 * k, medical: 2000 * k, staff: 2000 * k }, fleet: { truck: trucks, bus: Math.max(10, trucks / 3) }, prov: 'test' });
t('72-hour P90 need grows with the disaster size', () => { const big = area('x', 28.46, 77.03, 0, 1.12); return big.need.water > a1.need.water && big.affP90 > a1.affP90; });
t('huge stock and fleet nearby → score 100, no gaps', () => { const r = RD.score([a1, a2], [store('Big depot', 28.6, 77.2, 50, 400)]); return Math.round(r.score) === 100 && !r.gaps.length && r.gradeKey === 'ready'; });
t('no stores → score 0 and gaps equal the largest single-area need', () => { const r = RD.score([a1, a2], []); const w = r.gaps.find((g) => g.key === 'water'); return r.score === 0 && Math.abs(w.add - Math.max(a1.need.water, a2.need.water)) < 1e-6 && r.gradeKey === 'not'; });
t('a store more than 3 h away does not count', () => { const r = RD.score([a1], [store('Far', 31.5, 77.0, 50, 400)]); return r.score === 0; });
t('a store inside the heavy-damage zone of the scenario does not count', () => { const r = RD.score([area('Epicentre', 28.46, 77.03, 0, 1.1)], [store('Ruined', 28.461, 77.031, 50, 400)]); return r.score === 0 && r.areas[0].excluded.includes('Ruined'); });
t('score rises with stock (monotone) and stays within 0–100', () => { const s = [0.01, 0.1, 0.5, 2].map((k) => RD.score([a1, a2], [store('D', 28.6, 77.2, k, 30)]).score); return s.every((v, i) => v >= 0 && v <= 100 && (i === 0 || v >= s[i - 1] - 1e-9)); });
t('vehicles matter: same stock, no trucks → lower score and a truck gap', () => { const a = RD.score([a1], [store('D', 28.6, 77.2, 50, 400)]), b = RD.score([a1], [store('D', 28.6, 77.2, 50, 0)]); return b.score < a.score && b.vehicles.trucks > 0; });
t('district score is the people-weighted mean of the area scores', () => { const r = RD.score([a1, a2], [store('D', 28.3, 77.1, 0.3, 20)]); const w = r.areas.map((x) => Math.max(1, x.area.affP90)); const m = M.sum(r.areas.map((x, i) => x.score * w[i])) / M.sum(w); return Math.abs(m - r.score) < 1e-9; });
t('inventory rows convert litres and kilograms to model units', () => { const s = RD.storesFromRows([{ name: 'A', lat: 28.5, lon: 77.1, water_l: 120000, food_kg: 5000, tents: 300, medkits: 40, staff: 25, trucks: 6, buses: 2 }])[0]; return s.stock.water === 120 && s.stock.food === 5 && s.stock.shelter === 300 && s.fleet.truck === 6; });
t('OSM facilities get the assumed stock of their type, labelled as assumed', () => { const s = RD.storesFromFacilities([{ name: 'H', lat: 28.5, lon: 77.1, type: 'hospital' }])[0]; return s.stock.medical === AA.engine.STOCK.hospital.stock.medical && /assumed/.test(s.prov); });
t('design scenario: earthquake at the 1-in-475-year magnitude, others at default intensity', () => {
  const rr = { gr: { a: 4.2, b: 1.0 }, country: { vul: 0.5 }, placeObj: { country: 'India', iso2: 'in' } };
  const eq = AA.pipelines.scenario({ dominant: 'EQ', lat: 28.4, lon: 77, name: 'x' }, rr), fl = AA.pipelines.scenario({ dominant: 'FL', lat: 28.4, lon: 77, name: 'y' }, rr);
  return Math.abs(eq.magnitude - Math.min(8, Math.max(6.5, (4.2 - Math.log10(1 / 475)) / 1.0))) < 1e-9 && fl.magnitude === 0.8;
});
t('readiness pipeline runs end to end with stubbed roads', async () => {
  const rr = { place: 'Testville', gr: { a: 4.0, b: 1.0 }, country: { vul: 0.5 }, placeObj: { country: 'India', iso2: 'in' }, places, facs: [{ name: 'W', type: 'warehouse', lat: 28.6, lon: 77.2 }, { name: 'H', type: 'hospital', lat: 28.5, lon: 77.0 }],
    top: [{ name: 'A', lat: 28.46, lon: 77.03, R: 0.8, dominant: 'EQ' }, { name: 'B', lat: 28.25, lon: 77.07, R: 0.7, dominant: 'FL' }] };
  const out = await AA.pipelines.readiness(rr, { roads: false });
  return out.areas.length === 2 && out.score >= 0 && out.score <= 100 && /assumed/.test(out.source) && out.place === 'Testville';
});

// ---------------- field reports ----------------
console.log('field reports');
const rep = { lat: 28.4601, lon: 77.0299, acc: 12, damage: 0.75, needs: ['water', 'medical', 'bogus'], people: { affected: 400, injured: 12, trapped: 3 }, road: 'blocked', note: 'Bridge down — 40 families in the school, “urgent”', by: 'Asha', team: 'NDRF 8', trained: true, place: 'Sector 29', plan: 'Gurugram drill' };
t('a report survives the WhatsApp code round trip (text, unicode, numbers)', () => {
  const code = FR.encode(rep), back = FR.decodeAll(`[10:02] Asha: ${code}`).reports[0];
  return /^AA1\.[A-Za-z0-9_-]+\.[0-9a-z]{4}$/.test(code) && back.lat === 28.4601 && back.damage === 0.75 && back.note === rep.note && back.people.trapped === 3 && back.trained && back.road === 'blocked' && back.needs.join() === 'water,medical';
});
t('several codes in one pasted message are all read; a damaged code is reported, not trusted', () => {
  const a = FR.encode(rep), b = FR.encode({ ...rep, lat: 28.3, damage: 0.25 });
  const broken = a.slice(0, 20) + (a[20] === 'A' ? 'B' : 'A') + a.slice(21);
  const r = FR.decodeAll(`first ${a}\nsecond ${b}\nthird ${broken}`);
  return r.reports.length === 2 && r.errors.length === 1 && /checksum/.test(r.errors[0]);
});
t('codes stay short enough for one SMS-sized message part (no photo inside)', () => FR.encode({ ...rep, note: '' }).length < 300);
t('reports without a location or damage level are rejected', () => { let a = false, b = false; try { FR.normalise({ damage: 0.5 }); } catch (e) { a = true; } try { FR.normalise({ lat: 28, lon: 77, damage: 'x' }); } catch (e) { b = true; } return a && b; });
t('damage is clamped to 0–1 and unknown road states become "open"', () => { const n = FR.normalise({ lat: 1, lon: 1, damage: 3, road: 'teleport' }); return n.damage === 1 && n.road === 'open'; });
t('a report is matched to the nearest area within its catchment, not to a far one', () => {
  const zones = [{ id: 'Z1', name: 'A', lat: 28.46, lon: 77.03, catchKm: 4 }, { id: 'Z2', name: 'B', lat: 28.25, lon: 77.07, catchKm: 4 }];
  const near = FR.match({ lat: 28.47, lon: 77.03 }, zones), far = FR.match({ lat: 28.8, lon: 77.5 }, zones);
  return near.zone.id === 'Z1' && !near.outside && far.outside === true;
});
t('a blocked-road report becomes a severity update for its area plus a road closure; trained → σ 0.1', () => {
  const st = { zones: [{ id: 'Z1', name: 'A', lat: 28.46, lon: 77.03, catchKm: 4 }] };
  const { events } = FR.toEvents(FR.normalise(rep), st);
  return events.length === 2 && events[0].type === 'report' && events[0].p.zoneId === 'Z1' && events[0].p.sd === 0.1 && events[0].p.value === 0.75 && events[1].type === 'closure';
});
t('a crowd report counts with σ 0.2 and an open road adds no closure', () => { const { events } = FR.toEvents(FR.normalise({ ...rep, trained: false, road: 'open' }), { zones: [{ id: 'Z1', lat: 28.46, lon: 77.03 }] }); return events.length === 1 && events[0].p.sd === 0.2; });
t('applying a field report through the engine moves the area severity toward the observation', async () => {
  const zones = P.buildZones(sit, places); P.forecast(sit, zones);
  const z = zones[0]; const before = z.sevMean;
  AA.engine.state = { sit, zones, depots: [], hospitals: [], events: [], decisions: [], log: [], closures: [], shocks: [], blocked: new Set(), routeCache: new Map(), epoch: 0, congestion: 1 };
  const saveSolve = AA.engine.solve; AA.engine.solve = async () => {};
  try { await AA.engine.event('report', { zoneId: z.id, value: 0.95, sd: 0.1, fieldId: 'fX' }, { replay: true }); } finally { AA.engine.solve = saveSolve; }
  return z.sevPost > before && z.sevPost < 0.95 && AA.engine.state.events[0].p.fieldId === 'fX';
});
t('only reports within the plan radius + 30 km are shown for a plan', () => { const st = { sit: { lat: 28.45, lon: 77.02, radiusKm: 40 } }; const r = FR.inPlanArea([{ lat: 28.5, lon: 77.0 }, { lat: 30, lon: 79 }], st); return r.length === 1; });
t('cloud send uploads the photo into the team folder and upserts the row', async () => {
  const calls = []; const C = AA.workspace.cloud;
  const saved = { ready: C.ready, team: C.team, client: C.client, user: C.user };
  Object.assign(C, { ready: true, team: { id: 'team-1', name: 'T' }, user: { name: 'Asha' }, client: { storage: { from: (b) => ({ upload: async (p, blob, o) => { calls.push(['upload', b, p, o.contentType]); return {}; } }) }, from: (tb) => ({ upsert: async (row) => { calls.push(['upsert', tb, row]); return {}; } }) } });
  try { const id = await FR.cloudSend(rep, { size: 10 }); return calls[0][1] === 'field-photos' && calls[0][2] === `team-1/${id}.jpg` && calls[1][1] === 'field_reports' && calls[1][2].photo_path === `team-1/${id}.jpg` && calls[1][2].damage === 0.75; }
  finally { Object.assign(C, saved); }
});

if (require.main === module) setTimeout(run, 0);
