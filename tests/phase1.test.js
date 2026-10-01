/* Phase 1 acceptance tests: workspace (roles, saved plans, decision log, watch areas, inventory),
   accuracy layer (WorldPop catchments, flood outline + river flow, USGS PAGER losses), engine save/restore.
   Run: npm i javascript-lp-solver && node tests/phase1.test.js */
const path = require('path');
globalThis.solver = require('javascript-lp-solver');
const R = (f) => require(path.join(__dirname, '..', f));
['js/core.js', 'js/data.js', 'js/workspace.js', 'js/cloud.js', 'js/models/prediction.js', 'js/models/fairness.js', 'js/models/efficiency.js', 'js/models/routing.js', 'js/models/facility.js', 'js/models/risk.js', 'js/engine.js'].forEach(R);
const AA = globalThis.AA, M = AA.math, P = AA.prediction, W = AA.workspace, D = AA.data, ENG = AA.engine;

let pass = 0, fail = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);
const run = async () => {
  for (const [name, fn] of queue) {
    try { const ok = await fn(); if (ok === false) throw new Error('assertion false'); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '—', e.message); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
const reset = () => { ['me', 'team', 'plans', 'watch', 'seenAlerts', 'invSource', 'cloud'].forEach((k) => W._ls.removeItem('aa.' + k)); W.cloud.ready = false; W.cloud.user = null; };

// ---------------- inventory parsing ----------------
t('CSV parser keeps quoted commas and escaped quotes', () => { const r = W.parseCSV('name,lat,lon\n"Depot, North",28.5,77.1\n"The ""Big"" Store",28.4,77\n'); return r.length === 2 && r[0].name === 'Depot, North' && r[1].name === 'The "Big" Store'; });
t('inventory columns: common spellings recognised (latitude, lng, water, ambulance) and bad rows dropped', () => {
  const rows = W.normaliseRows([{ Store: 'A', Latitude: '28.5', Lng: '77.1', Water: '12,000', Trucks: '4', Ambulance: '2' }, { name: 'no location' }, { name: 'bad', lat: '95', lon: '10' }]);
  return rows.length === 1 && rows[0].name === 'A' && rows[0].water_l === 12000 && rows[0].trucks === 4 && rows[0].ambulances === 2;
});
t('Google Sheets links become CSV export links (normal, gid, published)', () =>
  D.sheetCsvUrl('https://docs.google.com/spreadsheets/d/ABC123/edit#gid=0') === 'https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=0'
  && D.sheetCsvUrl('https://docs.google.com/spreadsheets/d/ABC123/edit') === 'https://docs.google.com/spreadsheets/d/ABC123/export?format=csv'
  && D.sheetCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pubhtml') === 'https://docs.google.com/spreadsheets/d/e/2PACX-xyz/pub?output=csv'
  && D.sheetCsvUrl('https://example.org/stock.csv') === 'https://example.org/stock.csv');

// ---------------- roles ----------------
t('roles: viewer cannot edit or save; planner can; only admin manages team', async () => {
  reset();
  W.setMe({ name: 'V', role: 'viewer' });
  let refused = false; try { await W.plans.save({ v: 1, name: 'x' }); } catch (e) { refused = true; }
  let teamRefused = false; try { W.setTeam([{ name: 'A' }]); } catch (e) { teamRefused = true; }
  const v = !W.can('edit') && refused && teamRefused;
  W.setMe({ role: 'planner' }); const p = W.can('edit') && W.can('save') && !W.can('team');
  W.setMe({ role: 'admin' }); W.setTeam([{ name: 'Asha', email: 'a@x.org', role: 'planner' }]);
  return v && p && W.team().length === 1;
});
t('unknown role falls back to planner, never to admin', () => { reset(); W.setMe({ role: 'superuser' }); return W.me().role === 'planner'; });

// ---------------- saved plans (local) ----------------
t('saved plans: save, list, load, overwrite keeps previous version, delete', async () => {
  reset(); W.setMe({ name: 'P', role: 'planner' });
  const id = await W.plans.save({ v: 1, name: 'Flood plan', savedAt: '2026-10-01T00:00:00Z', summary: { hazard: 'FL', affected: 10 } });
  await W.plans.save({ v: 1, name: 'Flood plan', savedAt: '2026-10-01T06:00:00Z', summary: { hazard: 'FL', affected: 20 } }, id);
  const list = await W.plans.list(), full = await W.plans.load(id);
  const ok = list.length === 1 && full.summary.affected === 20 && full.versions.length === 1 && full.versions[0].summary.affected === 10;
  await W.plans.remove(id);
  return ok && (await W.plans.list()).length === 0;
});
t('decision log CSV: header + one quoted row per decision', () => {
  const csv = W.decisionsCSV([{ at: '2026-10-01T10:00:00Z', epoch: 1, by: 'Asha', role: 'planner', type: 'closure', reason: 'Road closed near "Km 12"', note: 'bridge, collapsed' }]);
  const lines = csv.split('\n'); return lines.length === 2 && lines[1].includes('"T+6h"') && lines[1].includes('""Km 12""') && lines[1].includes('"bridge, collapsed"');
});

// ---------------- watch areas ----------------
const evs = [
  { id: 'FL-1', hazard: 'FL', lat: 27.3, lon: 85.36, alertlevel: 'Red', name: 'Flood in Nepal' },
  { id: 'TC-2', hazard: 'TC', lat: 20, lon: 88, alertlevel: 'Red', episodealertlevel: 'Green', name: 'Decayed cyclone' },
  { id: 'us1', hazard: 'EQ', lat: 28.5, lon: 77.1, pager: 'yellow', magnitude: 5.9, name: 'M 5.9 India' },
  { id: 'EQ-9', hazard: 'EQ', lat: 28.6, lon: 77.2, alertlevel: 'Green', name: 'Small quake' },
];
const areas = [
  { id: 'a', name: 'Bagmati', lat: 27.7, lon: 85.3, radiusKm: 100, hazards: ['FL', 'EQ'], minLevel: 'Orange' },
  { id: 'b', name: 'Gurugram', lat: 28.46, lon: 77.03, radiusKm: 50, hazards: ['EQ'], minLevel: 'Orange' },
  { id: 'c', name: 'Bay of Bengal', lat: 20, lon: 88, radiusKm: 300, hazards: ['TC'], minLevel: 'Orange' },
];
t('watch areas: match by distance, hazard and level (decayed storm and Green quake ignored)', () => {
  const m = W.matchWatch(areas, evs);
  return m.length === 2 && m[0].area.id === 'a' && m[0].level === 'Red' && m[1].area.id === 'b' && m[1].level === 'Orange';
});
t('watch alerts fire once per (area, event, level)', () => { reset(); const m = W.matchWatch(areas, evs); return W.newMatches(m).length === 2 && W.newMatches(m).length === 0; });
t('watch area input is validated and clamped', async () => {
  reset(); W.setMe({ role: 'planner' });
  await W.watch.add({ name: 'X', lat: 10, lon: 10, radiusKm: 99999, minLevel: 'Purple' });
  const a = (await W.watch.list())[0];
  let bad = false; try { await W.watch.add({ name: 'Y', lat: 'abc', lon: 1 }); } catch (e) { bad = true; }
  return a.radiusKm === 1000 && a.minLevel === 'Orange' && a.hazards.length === 6 && bad;
});

// ---------------- geometry ----------------
const square = [[[[85, 27], [86, 27], [86, 28], [85, 28], [85, 27]]]];
t('flood outline: point-in-polygon, distance to edge, bounding box', () => M.inPolys({ lat: 27.5, lon: 85.5 }, square) && !M.inPolys({ lat: 26.5, lon: 85.5 }, square)
  && Math.abs(M.distToPolys({ lat: 26.9, lon: 85.5 }, square) - 11.06) < 0.3 && M.polysBBox(square).c.lat === 27.5);
t('catchment circle ring is closed and has the requested radius', () => { const r = M.circleRing({ lat: 28, lon: 77 }, 5); return r.length === 17 && r[0][0] === r[16][0] && Math.abs(M.haversine({ lat: 28, lon: 77 }, { lat: r[3][1], lon: r[3][0] }) - 5) < 0.05; });
t('catchments: half the nearest-neighbour distance, clamped 1.5–15 km', () => { const z = [{ lat: 28, lon: 77 }, { lat: 28.09, lon: 77 }, { lat: 30, lon: 77 }]; const c = P.catchments(z); return Math.abs(c[0] - 5) < 0.1 && c[2] === 15 && P.catchments([{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 }])[0] === 1.5; });

// ---------------- river flow ----------------
t('river-flow ratio: recent peak ÷ yearly median; dry channels ignored', () => {
  const time = [], q = [];
  for (let d = 0; d < 380; d++) { const dt = new Date(Date.UTC(2025, 8, 15) + d * 864e5).toISOString().slice(0, 10); time.push(dt); q.push(d > 365 ? 500 : 100); }
  const r = D.flowRatio(time, q, '2026-09-15');
  const dry = D.flowRatio(time, q.map(() => 0.1), '2026-09-15');
  return Math.abs(r.ratio - 5) < 1e-9 && dry === null;
});
t('flow ratio → flood intensity: 1× none, 2× threshold 0.35, 5× 0.65, monotonic', () => P.flowToS(1) === 0 && Math.abs(P.flowToS(2) - 0.35) < 1e-9 && Math.abs(P.flowToS(5) - 0.65) < 1e-9 && P.flowToS(10) > P.flowToS(5) && P.flowToS(100) === 1);

// ---------------- USGS PAGER ----------------
// Real PAGER fatality bins for us6000jllz (Türkiye–Syria M7.8, 6 Feb 2023), json/alerts.json
const TR_BINS = [[0, 1, 2.1962182255497374e-05], [1, 10, 0.0008140104776836292], [10, 100, 0.01305677004143143], [100, 1000, 0.09038478660189644], [1000, 10000, 0.2721810217963696], [10000, 100000, 0.35852573587737907], [100000, 10000000, 0.26501571302273785]].map(([min, max, p]) => ({ min, max, p }));
t('PAGER Türkiye 2023: observed ≈59,000 deaths lies inside the PAGER P10–P90; median 10k–50k', () => { const q10 = P.pagerQuantile(TR_BINS, 0.1), q50 = P.pagerQuantile(TR_BINS, 0.5), q90 = P.pagerQuantile(TR_BINS, 0.9); return q10 <= 59000 && 59000 <= q90 && q50 > 10000 && q50 < 50000 && q10 < q50 && q50 < q90; });
// Real PAGER population exposure by MMI for the same event, json/exposures.json
const TR_EXPO = [0, 0, 10851891, 239201537, 22835195, 13482204, 6353548, 1927782, 746078, 0].map((pop, i) => ({ mmi: i + 1, pop }));
t('PAGER Türkiye 2023: affected from shaking exposure is 8–20 million (UN: about 14 million affected in Türkiye)', () => {
  const zones = [{ fc: { aff: { p10: 1, p50: 2, p90: 3 }, dis: { p10: 1, p50: 1, p90: 1 }, inj: { p10: 1, p50: 1, p90: 1 }, fat: { p10: 1, p50: 1, p90: 1 } } }];
  const fc = { summary: JSON.parse(JSON.stringify(zones[0].fc)) };
  const r = P.applyPagerLosses(fc, zones, { level: 'red', bins: TR_BINS, exposure: TR_EXPO }, 0.45);
  return r.aff > 8e6 && r.aff < 20e6 && Math.abs(fc.summary.fat.p50 - P.pagerQuantile(TR_BINS, 0.5)) < 1 && Math.abs(zones[0].fc.fat.p50 - fc.summary.fat.p50) < 1;
});
t('USGS event id read from GDACS+USGS merged events and USGS events', () => D.usgsIdOf({ src: 'USGS', id: 'us7000abcd' }) === 'us7000abcd' && D.usgsIdOf({ src: 'GDACS + USGS', usgsUrl: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000jllz' }) === 'us6000jllz' && D.usgsIdOf({ src: 'GDACS' }) === null);

// ---------------- cloud adapter (Supabase) against a fake client ----------------
const fakeClient = () => {
  const db = { members: [{ team_id: 't1', user_id: 'u1', email: 'a@x.org', role: 'planner', name: 'Asha', teams: { name: 'DDMA' } }], plans: [], watch_areas: [] };
  const q = (table) => {
    const st = { table, filters: [], op: 'select', row: null };
    const exec = () => {
      let rows = db[table].filter((r) => st.filters.every(([k, v]) => r[k] === v));
      if (st.op === 'insert') { const r = { id: 'id' + (db[table].length + 1), ...st.row }; db[table].push(r); rows = [r]; }
      if (st.op === 'update') rows.forEach((r) => Object.assign(r, st.row));
      if (st.op === 'delete') db[table] = db[table].filter((r) => !rows.includes(r));
      return { data: st.single ? rows[0] : rows, error: null };
    };
    const api = {
      select() { return api; }, insert(r) { st.op = 'insert'; st.row = r; return api; }, update(r) { st.op = 'update'; st.row = r; return api; }, delete() { st.op = 'delete'; return api; },
      eq(k, v) { st.filters.push([k, v]); return api; }, order() { return api; }, limit() { return api; }, single() { st.single = true; return api; },
      then(res, rej) { try { res(exec()); } catch (e) { rej(e); } },
    };
    return api;
  };
  return { db, from: q, rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'a@x.org' } } }, error: null }), signOut: async () => ({}) } };
};
t('shared back end: sign-in picks the team and role; plans and watch areas go to the team tables', async () => {
  reset();
  const fc = fakeClient();
  const ok = await W.cloud.init({ url: 'https://demo.supabase.co', key: 'k' }, fc);
  const me = W.me();
  const id = await W.plans.save({ v: 1, name: 'Shared', summary: { hazard: 'EQ' }, savedBy: me.name });
  const list = await W.plans.list();
  await W.watch.add({ name: 'W', lat: 1, lon: 2 });
  const wl = await W.watch.list();
  const res = ok && W.mode() === 'cloud' && me.role === 'planner' && me.org === 'DDMA' && list.length === 1 && list[0].id === id && fc.db.plans[0].team_id === 't1' && wl.length === 1 && wl[0].radiusKm === 100;
  await W.cloud.signOut(); W.cloud.ready = false;
  return res && W.mode() === 'local';
});

// ---------------- engine: save → restore offline replays the same plan ----------------
const stubData = () => {
  const places = [
    { name: 'Alpha', lat: 28.47, lon: 77.04, type: 'city', population: 250000 }, { name: 'Bravo', lat: 28.40, lon: 77.10, type: 'town', population: 45000 },
    { name: 'Charlie', lat: 28.52, lon: 76.95, type: 'town', population: 20000 }, { name: 'Delta', lat: 28.35, lon: 76.98, type: 'town', population: 35000 },
    { name: 'Echo', lat: 28.60, lon: 77.15, type: 'village' },
  ];
  const facs = [
    { name: 'Depot N', type: 'warehouse', lat: 28.62, lon: 77.05 }, { name: 'Depot S', type: 'warehouse', lat: 28.25, lon: 77.05 },
    { name: 'Hospital E', type: 'hospital', lat: 28.45, lon: 77.30, beds: 200 }, { name: 'Fire W', type: 'fire_station', lat: 28.45, lon: 76.80 },
  ];
  let calls = 0;
  const S = {
    reverse: async () => ({ iso2: 'IN', country: 'India', short: 'Gurugram' }), countryIndex: async () => ({ vul: 0.6, lcc: 0.6, prov: 'test' }),
    osrmNearest: async (p) => ({ lat: p.lat, lon: p.lon, offKm: 0.1 }), places: async () => places, facilitiesAny: async () => facs,
    worldpop: async (ring) => { calls++; return 50000; }, osrmTable: async () => { throw new Error('offline'); }, osrmRoute: async () => { throw new Error('offline'); },
  };
  Object.assign(D, S);
  return { count: () => calls };
};
t('engine: WorldPop replaces OSM populations; decisions are logged with who and why', async () => {
  reset(); W.setMe({ name: 'Asha', role: 'planner' });
  stubData();
  const sit = ENG.situationFromPlan({ hazard: 'EQ', lat: 28.46, lon: 77.03, magnitude: 6.8, depth: 12, name: 'Test quake', country: 'India', iso2: 'IN' });
  await ENG.build(sit, { warehouses: false });
  const st = ENG.state;
  await ENG.event('surge', { zoneId: st.zones[0].id }, { note: 'Hospital reports queue' });
  await ENG.event('advance', {}, {});
  const d = st.decisions;
  return st.zones.every((z) => z.popProv === 'WorldPop 2020' && z.pop === 50000) && d.length === 3 && d[1].by === 'Asha' && d[1].note === 'Hospital reports queue' && d[2].type === 'advance' && st.epoch === 1;
});
t('engine: viewer cannot change the plan (event refused, nothing logged)', async () => {
  const st = ENG.state, n = st.decisions.length, e = st.epoch;
  W.setMe({ role: 'viewer' });
  await ENG.event('advance');
  W.setMe({ role: 'planner' });
  return st.decisions.length === n && st.epoch === e;
});
t('engine: a saved plan restores with no network, same epoch, same forecast, same decisions', async () => {
  const st = ENG.state;
  const snap = JSON.parse(JSON.stringify(ENG.snapshot('Quake plan')));
  const before = { stock: JSON.stringify(st.depots.map((d) => d.stock)), epoch: st.epoch, aff: st.fcast.summary.aff.p50, zones: st.zones.map((z) => z.pop + ':' + z.surge), cost: st.lastRun.alloc.cost.total };
  const wp = stubData(); ['reverse', 'countryIndex', 'osrmNearest', 'places', 'facilitiesAny', 'worldpop'].forEach((k) => (D[k] = async () => { throw new Error('network used during restore: ' + k); }));
  await ENG.restore(snap);
  const s2 = ENG.state;
  // deliveries already made are replayed exactly; the current epoch is re-optimised (MILP stops within its 2 % optimality gap)
  return s2.epoch === before.epoch && Math.abs(s2.fcast.summary.aff.p50 - before.aff) < 1e-6 && JSON.stringify(s2.zones.map((z) => z.pop + ':' + z.surge)) === JSON.stringify(before.zones)
    && JSON.stringify(s2.depots.map((d) => d.stock)) === before.stock && Math.abs(s2.lastRun.alloc.cost.total - before.cost) / before.cost < 0.05 && s2.decisions.length === snap.decisions.length && wp.count() === 0 && !s2.notes.some((n) => /WorldPop unavailable/.test(n));
});
t('engine: imported live inventory replaces assumed stock and fleet', async () => {
  const rows = W.normaliseRows(W.parseCSV('name,lat,lon,water_l,food_kg,tents,medkits,staff,trucks,buses,ambulances\nCentral store,28.55,77.0,200000,30000,1500,120,40,12,3,4\n'));
  await ENG.event('importDepots', { rows });
  const d = ENG.state.depots;
  return d.length === 1 && d[0].stock.water === 200 && d[0].stock.food === 30 && d[0].fleet.truck === 12 && d[0].fleet.amb === 4 && ENG.state.decisions.at(-1).type === 'importDepots';
});

run();
