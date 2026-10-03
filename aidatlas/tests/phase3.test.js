/* Phase 3 acceptance tests: back-test and model cards, shared tasks and comments, offline save and sync, exports.
   External data services are stubbed (deterministic, offline). Run: npm i javascript-lp-solver && node tests/phase3.test.js */
const path = require('path');
globalThis.solver = require('javascript-lp-solver');
const R = (f) => require(path.join(__dirname, '..', f));
['js/core.js', 'js/data.js', 'js/workspace.js', 'js/cloud.js', 'js/models/prediction.js', 'js/models/fairness.js', 'js/models/efficiency.js', 'js/models/routing.js', 'js/models/facility.js', 'js/models/risk.js', 'js/models/savings.js', 'js/models/readiness.js', 'js/engine.js', 'js/pipelines.js', 'js/field.js', 'js/collab.js', 'js/exports.js', 'js/models/backtest.js', 'js/models/cards.js', 'js/ui/report.js'].forEach(R);
const AA = globalThis.AA, M = AA.math, D = AA.data, BT = AA.backtest, COL = AA.collab, X = AA.exports, W = AA.workspace, ENG = AA.engine;

const C0 = { lat: 28.46, lon: 77.03 };
const ring = (c, n, km0, step, f) => Array.from({ length: n }, (_, k) => ({ ...M.destination(c, k * (360 / n), km0 + step * k), ...f(k) }));
let placeCalls = 0;
Object.assign(D, {
  reverse: async () => ({ name: 'Testville, India', short: 'Testville', country: 'India', iso2: 'IN' }),
  reverseDetail: async () => ({ locality: 'Sector 9', address: 'Road 1, Sector 9' }),
  countryIndex: async (iso2) => ({ vul: iso2 === 'JP' ? 0.2 : 0.6, lcc: 0.5, prov: 'test' }),
  osrmNearest: async (p) => ({ lat: p.lat, lon: p.lon, offKm: 0 }),
  places: async (c) => { placeCalls++; return ring(c, 8, 4, 3, (k) => ({ name: `Town ${k + 1}`, type: k ? 'town' : 'city', population: k ? 40000 - 3000 * k : 900000 })); },
  facilitiesAny: async (c) => ring(c, 9, 15, 2, (k) => ({ name: `Facility ${k + 1}`, type: ['warehouse', 'hospital', 'fire_station'][k % 3], beds: 200 })),
  worldpop: async () => 60000,
  osrmTable: async (pts) => { const dist = pts.map((a) => pts.map((b) => M.haversine(a, b) * 1350)); return { dur: dist.map((r) => r.map((d) => d / 11)), dist, snapped: pts.map((p) => ({ ...p, offKm: 0 })) }; },
  osrmRoute: async () => { throw new Error('offline'); },
});

let pass = 0, fail = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);
const sections = [];

// ---------------- back-test ----------------
t('catalogue: 44 earthquakes from NOAA NCEI, unique ids, known tolls (Nepal 2015 8,957; Türkiye 2023 56,697)', () => {
  const ids = new Set(BT.CATALOG.map((e) => e.id));
  const nep = BT.CATALOG.find((e) => e.id === 'EQ-2015-04-25'), tur = BT.CATALOG.find((e) => e.id === 'EQ-2023-02-06');
  return BT.CATALOG.length === 44 && ids.size === 44 && nep.deaths === 8957 && tur.deaths === 56697 && BT.CATALOG.every((e) => e.deaths >= 250 && Math.abs(e.lat) <= 90 && e.iso2.length === 2);
});
t('catalogue: tsunami-dominated events (2004 Sumatra, 2011 Tōhoku, 2018 Palu, 2010 Chile) and disputed Haiti 2010 are not scored', () => ['EQ-2004-12-26', 'EQ-2011-03-11', 'EQ-2018-09-28', 'EQ-2010-02-27', 'EQ-2010-01-12'].every((id) => BT.CATALOG.find((e) => e.id === id).mode !== 'shaking'));
t('scoring: inside / above / below the P10–P90 range and the error factor', () => {
  const ev = { deaths: 1000 };
  const a = BT.scoreOne(ev, { p10: 500, p50: 900, p90: 2000 }), b = BT.scoreOne(ev, { p10: 10, p50: 100, p90: 400 }), c = BT.scoreOne(ev, { p10: 2000, p50: 5000, p90: 9000 });
  return a.inside && !a.above && Math.abs(a.factor - 1000 / 900) < 1e-9 && b.above && Math.abs(b.factor - 10) < 1e-9 && c.below && Math.abs(c.factor - 5) < 1e-9 && b.within10 && !b.within3;
});
t('summary counts only scored events; coverage, typical factor and bias are consistent', () => {
  const mk = (p50, deaths, scored = true) => ({ scored, fat: { p10: p50 / 3, p50, p90: p50 * 3 }, score: BT.scoreOne({ deaths }, { p10: p50 / 3, p50, p90: p50 * 3 }) });
  const s = BT.summarise([mk(100, 100), mk(100, 1000), mk(1000, 100), mk(5, 5000, false)]);
  return s.n === 3 && s.inside === 1 && Math.abs(s.typicalFactor - 10) < 1e-9 && Math.abs(s.bias - 1) < 1e-9 && s.above === 1 && s.below === 1;
});
let btRun;
t('a back-test run replays every event through the forecast pipeline and caches clean results', async () => {
  const store = new Map(), cache = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  const ev = BT.CATALOG.filter((e) => ['EQ-2015-04-25', 'EQ-2016-04-15', 'EQ-2011-03-11'].includes(e.id));
  placeCalls = 0;
  btRun = await BT.run({ events: ev, cache });
  const calls1 = placeCalls; await BT.run({ events: ev, cache }); const calls2 = placeCalls - calls1;
  return btRun.results.length === 3 && btRun.results.every((r) => r.fat && r.fat.p10 <= r.fat.p50 && r.fat.p50 <= r.fat.p90) && btRun.summary.n === 2 && calls1 === 3 && calls2 === 0 && btRun.model === AA.MODEL_VERSION;
});
t('the back-test uses the country (stronger buildings → fewer deaths for the same shaking)', async () => {
  const base = BT.CATALOG.find((e) => e.id === 'EQ-2016-04-15');
  const jp = await BT.run({ events: [base] }), in_ = await BT.run({ events: [{ ...base, id: 'x', iso2: 'IN' }] });
  return jp.results[0].fat.p50 < in_.results[0].fat.p50;
});
t('back-test CSV has a header and one row per event', () => { const lines = BT.csv(btRun).split('\n'); return lines.length === 4 && lines[0].startsWith('id,date,event') && lines.some((l) => l.includes('EQ-2015-04-25')); });
t('model cards cover every hazard plus the plan, with status, evidence and limits', () => {
  const ids = AA.cards.CARDS.map((c) => c.id);
  return ['EQ', 'TC', 'FL', 'VO', 'PLAN'].every((i) => ids.includes(i)) && AA.cards.CARDS.every((c) => AA.cards.STATUS[c.status] && c.evidence && c.limits.length && c.method.length) && /NCEI/.test(AA.cards.CARDS.find((c) => c.id === 'EQ').evidence) && /surge/.test(AA.cards.CARDS.find((c) => c.id === 'TC').limits.join(' '));
});

// ---------------- a real plan state for collab and exports ----------------
let st;
t('build a plan (stubbed data) for the collaboration and export tests', async () => {
  W.setMe({ name: 'Priya', role: 'planner' });
  st = await ENG.build(ENG.situationFromPlan({ lat: C0.lat, lon: C0.lon, name: 'Test quake', iso2: 'IN', country: 'India', hazard: 'EQ', magnitude: 7.0, depth: 10 }), { warehouses: true, addresses: false });
  return st.zones.length > 0 && st.lastRun.legs.length > 0;
});

// ---------------- tasks and comments ----------------
t('a planner adds tasks; they sort open/doing first, by due date; adding is logged', async () => {
  const before = st.decisions.length;
  await COL.addTask(st, { title: 'Open shelter at the school', assignee: 'asha@ngo.org', due: '2026-10-05', zoneId: st.zones[0].id });
  await COL.addTask(st, { title: 'Clear the bridge', due: '2026-10-03' });
  const done = await COL.addTask(st, { title: 'Count tents' }); await COL.updateTask(st, done.id, { status: 'done' });
  const list = COL.tasks(st);
  return list.length === 3 && list[0].title === 'Clear the bridge' && list[2].status === 'done' && st.decisions.length === before + 4 && /Task added/.test(st.decisions[before].reason);
});
t('empty titles are refused; a viewer cannot create tasks but can comment', async () => {
  let a = false, b = false; try { await COL.addTask(st, { title: '  ' }); } catch (e) { a = true; }
  W.setMe({ name: 'Ravi', role: 'viewer' });
  try { await COL.addTask(st, { title: 'x' }); } catch (e) { b = /not create/.test(e.message); }
  const c = await COL.addComment(st, 'Road to Sector 9 is open again', st.zones[0].id);
  W.setMe({ name: 'Priya', role: 'planner' });
  return a && b && c.by === 'Ravi' && c.role === 'viewer';
});
t('the assignee can update their own task even without the planner role; others cannot', async () => {
  const task = COL.tasks(st).find((x) => x.assignee === 'asha@ngo.org');
  W.setMe({ name: 'Asha', email: 'asha@ngo.org', role: 'field' });
  await COL.updateTask(st, task.id, { status: 'doing' });
  const other = COL.tasks(st).find((x) => x.title === 'Clear the bridge');
  let blocked = false; try { await COL.updateTask(st, other.id, { status: 'done' }); } catch (e) { blocked = true; }
  W.setMe({ name: 'Priya', email: '', role: 'planner' });
  return task.status === 'doing' && blocked;
});
t('overdue: past due date and not done', () => { const now = new Date('2026-10-04T10:00:00Z'); return COL.isOverdue({ status: 'open', due: '2026-10-03' }, now) && !COL.isOverdue({ status: 'done', due: '2026-10-03' }, now) && !COL.isOverdue({ status: 'open', due: '2026-10-05' }, now); });
t('tasks and comments travel with saved plans and plan files', async () => {
  const snap = ENG.snapshot('With tasks');
  await ENG.restore(JSON.parse(JSON.stringify(snap)));
  const s2 = ENG.state;
  const ok = COL.tasks(s2).length === 3 && COL.comments(s2).length === 1 && COL.tasks(s2).some((x) => x.status === 'doing');
  st = s2; return ok;
});
t('merging shared rows: newer edits win, deleted tasks disappear, new comments are added', () => {
  const local = { collab: { tasks: [{ id: 'a', title: 'A', status: 'open', updatedAt: '2026-10-01T10:00:00Z' }, { id: 'b', title: 'B', status: 'open', updatedAt: '2026-10-01T10:00:00Z' }], comments: [{ id: 'c1', text: 'x', at: '2026-10-01' }] } };
  const changed = COL.merge(local, { tasks: [{ id: 'a', title: 'A', status: 'done', updatedAt: '2026-10-01T11:00:00Z' }], comments: [{ id: 'c1', text: 'x', at: '2026-10-01' }, { id: 'c2', text: 'y', at: '2026-10-02' }] });
  return changed && local.collab.tasks.length === 1 && local.collab.tasks[0].status === 'done' && local.collab.comments.length === 2;
});
t('with the shared back end, tasks go to plan_tasks and comments to plan_comments for that plan', async () => {
  const calls = [], C = W.cloud, saved = { ready: C.ready, team: C.team, client: C.client, user: C.user };
  const fake = { from: (tb) => ({ upsert: async (row) => { calls.push([tb, 'upsert', row]); return {}; }, insert: async (row) => { calls.push([tb, 'insert', row]); return {}; }, delete: () => ({ eq: async () => ({}) }) }) };
  Object.assign(C, { ready: true, team: { id: 'team-1' }, user: { name: 'Priya', role: 'planner' }, client: fake });
  W._ls.setItem('aa.cloud', JSON.stringify({ url: 'https://x.supabase.co', key: 'k' }));
  const s = { ...st, savedId: 'plan-9', collab: { tasks: [], comments: [] }, zones: st.zones, decisions: [] };
  const keep = ENG.state; ENG.state = s;
  try {
    const mode = COL.mode(s);
    await COL.addTask(s, { title: 'Shared task', assignee: 'a@b.org' }); await COL.addComment(s, 'Shared comment');
    return mode === 'cloud' && calls[0][0] === 'plan_tasks' && calls[0][2].plan_id === 'plan-9' && calls[0][2].team_id === 'team-1' && calls[1][0] === 'plan_comments' && calls[1][2].body === 'Shared comment';
  } finally { Object.assign(C, saved); W._ls.removeItem('aa.cloud'); ENG.state = keep; }
});

// ---------------- offline save and sync ----------------
t('offline in the shared workspace: a save is kept on this device and uploaded when back online', async () => {
  const C = W.cloud, saved = { ready: C.ready, team: C.team, savePlan: C.savePlan, user: C.user };
  const sent = []; let online = false;
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online; } }, configurable: true, writable: true });
  Object.assign(C, { ready: true, team: { id: 't' }, user: { name: 'Priya', role: 'planner' }, savePlan: async (snap, id) => { if (!online) throw new Error('Failed to fetch'); sent.push([snap.name, id]); return 'cloud-1'; } });
  try {
    const id = await W.plans.save({ name: 'Offline plan', summary: {} }, null);
    const pendingBefore = W.plans.pending();
    online = true; const n = await W.plans.syncPending();
    return !!id && pendingBefore === 1 && n === 1 && sent[0][0] === 'Offline plan' && W.plans.pending() === 0;
  } finally { Object.assign(C, saved); if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); else delete globalThis.navigator; }
});
t('online errors in the shared workspace are not hidden (only offline saves are queued)', async () => {
  const C = W.cloud, saved = { ready: C.ready, team: C.team, savePlan: C.savePlan, user: C.user };
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  Object.assign(C, { ready: true, team: { id: 't' }, user: { name: 'P', role: 'planner' }, savePlan: async () => { throw new Error('permission denied'); } });
  try { await W.plans.save({ name: 'x' }); return false; } catch (e) { return /permission/.test(e.message) && W.plans.pending() === 0; }
  finally { Object.assign(C, saved); if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); else delete globalThis.navigator; }
});
t('low-bandwidth mode skips the WorldPop download and street-address lookups', async () => {
  let wp = 0; const keep = D.worldpop; D.worldpop = async () => { wp++; return 50000; };
  AA.config.lowBandwidth = true;
  try { await ENG.build(ENG.situationFromPlan({ lat: C0.lat, lon: C0.lon, name: 'Low', iso2: 'IN', country: 'India', hazard: 'EQ', magnitude: 6.8, depth: 10 }), {}); return wp === 0 && ENG.state.notes.every((n) => !/WorldPop 2020/.test(n)); }
  finally { AA.config.lowBandwidth = false; D.worldpop = keep; }
});

// ---------------- exports ----------------
t('GeoJSON: valid FeatureCollection with areas, stores, hospitals, routes and the impact area; [lon, lat] order', () => {
  const g = X.geojson(st), layers = new Set(g.features.map((f) => f.properties.layer));
  const z = g.features.find((f) => f.properties.layer === 'affected_area');
  const okCoords = g.features.every((f) => f.geometry.type !== 'Point' || (Math.abs(f.geometry.coordinates[0]) <= 180 && Math.abs(f.geometry.coordinates[1]) <= 90));
  return g.type === 'FeatureCollection' && ['impact_area', 'affected_area', 'supply_store', 'hospital', 'route', 'storage_site', 'task'].every((l) => layers.has(l)) && Math.abs(z.geometry.coordinates[0] - st.zones[0].lon) < 1e-5 && okCoords && z.properties.affected_p10 <= z.properties.affected_p90 && JSON.parse(JSON.stringify(g)).features.length === g.features.length;
});
t('HXL CSV: header row, then a row of HXL tags, then one row per area', () => {
  const lines = X.hxl(st).split('\r\n');
  return lines[1].startsWith('#date,#country,#loc +name,#geo +lat,#geo +lon,#affected') && lines[1].includes('#affected +killed') && lines.length === st.zones.length + 2;
});
t('needs and dispatch CSVs: one row per area per item; dispatches match the plan', () => {
  const needs = X.needsCSV(st).split('\r\n'), disp = X.dispatchCSV(st).split('\r\n');
  return needs.length === 1 + st.zones.length * AA.config.commodities.length && disp.length === 1 + AA.report.dispatches(st).length && disp[0].startsWith('from_id,from,from_address,to_id');
});
t('CSV cells with commas, quotes and line breaks are quoted correctly', () => { const s = X.tasksCSV({ collab: { tasks: [{ id: 'a', title: 'Say "hi", then\nleave', zoneId: '', assignee: '', due: '', status: 'open', by: 'x', at: 'y' }] } }); return s.includes('"Say ""hi"", then\nleave"'); });
t('KoboToolbox import: semicolon export with group prefixes and geopoint columns', () => {
  const csv = 'start;end;report/location;_location_latitude;_location_longitude;_location_precision;report/damage;report/needs;report/trapped;report/road;report/note;report/reporter;report/trained;_uuid\n'
    + '2026-10-02T09:00:00;2026-10-02T09:05:00;28.47 77.04 210 6;28.47;77.04;6;severe;water medical;3;blocked;"Bridge down; detour 20 km";Asha;yes;ab12-cd34\n'
    + '2026-10-02T09:10:00;2026-10-02T09:12:00;;;;;minor;food;0;open;;Ravi;no;ef56\n';
  const { reports, errors } = X.importKobo(csv);
  const a = reports[0];
  return reports.length === 1 && errors.length === 1 && a.lat === 28.47 && a.damage === 0.75 && a.needs.join() === 'water,medical' && a.road === 'blocked' && a.trained && a.note === 'Bridge down; detour 20 km' && a.id === 'kab12cd34';
});
t('KoboToolbox import: comma export using the combined geopoint column', () => { const { reports } = X.importKobo('location,damage,road,reporter\n"28.5 77.1 200 5",destroyed,partly,Team B\n'); return reports.length === 1 && reports[0].lon === 77.1 && reports[0].damage === 1 && reports[0].road === 'partly'; });
t('the XLSForm definition matches the field app: same damage levels, needs and road states', () => {
  const ch = X.XLSFORM.choices.slice(1);
  const names = (l) => ch.filter((c) => c[0] === l).map((c) => c[1]);
  return names('damage').join() === AA.field.DAMAGE.map((d) => d.key).join() && names('needs').join() === AA.field.NEEDS.map((n) => n[0]).join() && names('road').join() === Object.keys(AA.field.ROAD).join() && X.XLSFORM.survey[0].includes('parameters');
});

(async () => {
  for (const [name, fn] of queue) {
    try { const ok = await fn(); if (ok === false) throw new Error('assertion false'); pass++; console.log('  ✓', name); }
    catch (e) { fail++; console.log('  ✗', name, '—', e.message); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
