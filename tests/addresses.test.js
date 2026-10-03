/* Real names and addresses (user report: "Sector SE/SW" names, storage sites and action plans without addresses).
   Run: node tests/addresses.test.js */
const path = require('path');
globalThis.solver = require('javascript-lp-solver');
['js/core.js', 'js/data.js', 'js/workspace.js', 'js/models/prediction.js', 'js/models/fairness.js', 'js/models/efficiency.js', 'js/models/routing.js', 'js/models/facility.js', 'js/models/risk.js', 'js/engine.js'].forEach((f) => require(path.join(__dirname, '..', f)));
const AA = globalThis.AA, P = AA.prediction, D = AA.data, ENG = AA.engine, M = AA.math;
let pass = 0, fail = 0; const q = [];
const t = (n, fn) => q.push([n, fn]);

// Gurugram as OpenStreetMap maps it: one city node plus its sectors and colonies (real names and approximate positions)
const GGN = [
  { name: 'Gurugram', type: 'city', lat: 28.4595, lon: 77.0266, population: 1153000 },
  { name: 'Sector 29', type: 'suburb', lat: 28.4672, lon: 77.0636 }, { name: 'DLF Phase 1', type: 'suburb', lat: 28.4722, lon: 77.0938 },
  { name: 'Sushant Lok 1', type: 'suburb', lat: 28.4627, lon: 77.0745 }, { name: 'Sector 14', type: 'suburb', lat: 28.4708, lon: 77.0435 },
  { name: 'Palam Vihar', type: 'suburb', lat: 28.5040, lon: 77.0300 }, { name: 'Sohna Road', type: 'neighbourhood', lat: 28.4120, lon: 77.0420 },
  { name: 'Sector 56', type: 'suburb', lat: 28.4220, lon: 77.1000 }, { name: 'Manesar', type: 'town', lat: 28.3570, lon: 76.9370, population: 30000 },
];
t('a city with mapped sectors is planned by those sectors, not compass quarters or "Sector NE"', () => {
  const sit = { hazard: 'EQ', lat: 28.45, lon: 77.03, magnitude: 7.0, depth: 12, countryVul: 0.6 }; sit.radiusKm = P.impactRadius(sit);
  const z = P.buildZones(sit, GGN);
  const names = z.map((x) => x.name);
  return names.includes('Sector 29') && names.includes('DLF Phase 1') && !names.some((n) => /^(Sector (N|S|E|W|NE|NW|SE|SW))$|\((north|south|east|west)\)/.test(n)) && !names.includes('Gurugram');
});
t('chosen areas are at least 2 km apart and nearby localities are listed as "also covers"', () => {
  const sit = { hazard: 'EQ', lat: 28.45, lon: 77.03, magnitude: 7.0, depth: 12, countryVul: 0.6 }; sit.radiusKm = P.impactRadius(sit);
  const extra = [...GGN, { name: 'Sector 28', type: 'suburb', lat: 28.4680, lon: 77.0700 }];
  const z = P.buildZones(sit, extra);
  const ok = z.every((a) => z.every((b) => a === b || M.haversine(a, b) >= 2));
  return ok && z.some((a) => (a.covers || []).includes('Sector 28') || a.name === 'Sector 28');
});
t('without mapped places the fallback areas are marked for naming, never "Sector NE"', () => {
  const sit = { hazard: 'FL', lat: 26, lon: 85, magnitude: 0.8, radiusKm: 30, countryVul: 0.6 };
  const z = P.buildZones(sit, []);
  return z.length >= 4 && z.every((x) => x.needsName) && !z.some((x) => /^Sector /.test(x.name));
});
t('reverse geocode → readable address with locality, road and city', () => {
  const a = D.parseReverse({ address: { house_number: '12', road: 'Golf Course Road', neighbourhood: 'DLF Phase 5', suburb: 'Sector 43', city: 'Gurugram', postcode: '122002', state: 'Haryana' } });
  return a.locality === 'DLF Phase 5' && a.address === '12 Golf Course Road, DLF Phase 5, Sector 43, Gurugram, 122002';
});
t('facility address from OSM tags; English names preferred over non-Latin', () =>
  D.addressOf({ 'addr:housenumber': '5', 'addr:street': 'MG Road', 'addr:city': 'Gurugram', 'addr:postcode': '122001' }) === '5 MG Road, Gurugram, 122001'
  && D.placeName({ name: 'हेटौँडा', 'name:en': 'Hetauda' }) === 'Hetauda (हेटौँडा)' && D.placeName({ name: 'Sector 29' }) === 'Sector 29');
t('Google Maps directions link', () => D.mapsUrl({ lat: 28.4595, lon: 77.0266 }) === 'https://www.google.com/maps/search/?api=1&query=28.459500,77.026600');

t('engine: modelled areas get real locality names; stores, hospitals and storage sites get street addresses', async () => {
  let calls = 0;
  Object.assign(D, {
    reverse: async () => ({ iso2: 'IN', country: 'India', short: 'Gurugram' }), countryIndex: async () => ({ vul: 0.6, lcc: 0.6, prov: 'test' }),
    osrmNearest: async (p) => ({ lat: p.lat, lon: p.lon, offKm: 0.1 }), places: async () => [], worldpop: async () => 40000,
    facilitiesAny: async () => [{ name: '', type: 'warehouse', lat: 28.62, lon: 77.05 }, { name: 'Civil Hospital', type: 'hospital', lat: 28.45, lon: 77.30, beds: 200, address: 'Sector 10, Gurugram' }],
    osrmTable: async () => { throw new Error('offline'); }, osrmRoute: async () => { throw new Error('offline'); },
    reverseDetail: async (lat, lon) => { calls++; const k = Math.round((lat * 100 + lon * 7) % 37); return { locality: `Colony ${k}`, road: `Road ${k}`, city: 'Gurugram', address: `Road ${k}, Colony ${k}, Gurugram` }; },
  });
  AA.workspace.setMe({ name: 'T', role: 'planner' });
  const sit = ENG.situationFromPlan({ hazard: 'EQ', lat: 28.46, lon: 77.03, magnitude: 6.8, depth: 12, name: 'Test', country: 'India', iso2: 'IN' });
  await ENG.build(sit, { warehouses: true });
  await ENG.enrichAddresses();
  const st = ENG.state;
  const sites = st.warehouses.sizes.map((s) => st.warehouses.cand[s.j]);
  const unnamed = st.depots.find((d) => d.type === 'warehouse');
  return st.zones.every((z) => /^Colony \d+/.test(z.name) && z.address) && sites.length && sites.every((c) => /Road \d+/.test(c.address))
    && /^Warehouse on Road \d+/.test(unnamed.name) && st.depots.find((d) => d.type === 'hospital').address === 'Sector 10, Gurugram' && calls > 0;
});
t('saved plans keep addresses: reopening does no lookups', async () => {
  const snap = JSON.parse(JSON.stringify(ENG.snapshot('x')));
  let calls = 0; D.reverseDetail = async () => { calls++; return { address: 'should not be used' }; };
  ['reverse', 'countryIndex', 'osrmNearest', 'places', 'facilitiesAny', 'worldpop'].forEach((k) => (D[k] = async () => { throw new Error('network'); }));
  await ENG.restore(snap); await ENG.enrichAddresses();
  return calls === 0 && ENG.state.zones.every((z) => /^Colony/.test(z.name));
});

(async () => { for (const [n, fn] of q) { try { if ((await fn()) === false) throw new Error('assertion false'); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '—', e.message); } } console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); })();
