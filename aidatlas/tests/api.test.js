/* Public API tests: auth, quotas, rate limits, every endpoint, webhook signing, SSRF guard.
   External data services are stubbed (deterministic, offline). Run: npm i javascript-lp-solver && node tests/api.test.js */
const path = require('path'), http = require('http'), crypto = require('crypto');
const { createApi, isPrivateIp } = require(path.join(__dirname, '..', 'server', 'api.js'));
const AA = globalThis.AA, M = AA.math, D = AA.data;

// ---------- deterministic stand-ins for the public data services ----------
const C0 = { lat: 28.46, lon: 77.03 };
const ring = (c, n, km0, step, f) => Array.from({ length: n }, (_, k) => ({ ...M.destination(c, k * (360 / n), km0 + step * k), ...f(k) }));
Object.assign(D, {
  geocode: async (q) => (/nowhere/i.test(q) ? [] : [{ name: 'Testville, Haryana, India', short: 'Testville', ...C0, country: 'India', iso2: 'IN' }]),
  reverse: async (lat, lon) => ({ name: 'Testville, India', short: 'Testville', country: 'India', iso2: 'IN' }),
  reverseDetail: async () => ({ locality: 'Sector 9', city: 'Testville', address: 'Road 1, Sector 9, Testville' }),
  countryIndex: async () => ({ vul: 0.6, lcc: 0.5, prov: 'test' }),
  osrmNearest: async (p) => ({ lat: p.lat, lon: p.lon, offKm: 0 }),
  places: async (c) => ring(c, 8, 4, 3, (k) => ({ name: `Town ${k + 1}`, type: k ? 'town' : 'city', population: k ? 40000 - 3000 * k : 900000 })),
  facilitiesAny: async (c) => ring(c, 9, 15, 2, (k) => ({ name: `Facility ${k + 1}`, type: ['warehouse', 'hospital', 'fire_station'][k % 3], beds: 200 })),
  facilities: async (c) => ring(c, 9, 15, 2, (k) => ({ name: `Facility ${k + 1}`, type: ['warehouse', 'hospital', 'fire_station'][k % 3], beds: 200 })),
  worldpop: async () => 60000,
  osrmTable: async (pts) => { const dist = pts.map((a) => pts.map((b) => M.haversine(a, b) * 1350)); return { dur: dist.map((r) => r.map((d) => d / 11)), dist, snapped: pts.map((p) => ({ ...p, offKm: 0 })) }; },
  osrmRoute: async () => { throw new Error('offline'); },
  liveEvents: async () => ({ errors: [], counts: {}, events: [
    { id: 'EQ-1', name: 'Earthquake near Testville', hazard: 'EQ', lat: 28.5, lon: 77.1, country: 'India', alertlevel: 'Red', usi: 0.9, src: 'GDACS', magnitude: 6.9, from: '2026-10-01', to: '2026-10-01' },
    { id: 'TC-2', name: 'Cyclone far away', hazard: 'TC', lat: 15, lon: 120, alertlevel: 'Orange', usi: 0.7, src: 'GDACS' },
    { id: 'FL-3', name: 'Small flood nearby', hazard: 'FL', lat: 28.4, lon: 77.0, alertlevel: 'Green', usi: 0.3, src: 'GDACS' }] }),
  usgsHistory: async () => Array.from({ length: 40 }, (_, k) => ({ lat: 28 + (k % 7) * 0.2, lon: 76.5 + (k % 5) * 0.2, magnitude: 4.5 + (k % 20) / 10 })),
  gdacsHistory: async () => [{ hazard: 'FL', lat: 28.3, lon: 77.1 }, { hazard: 'FL', lat: 28.6, lon: 77.2 }],
  eonetHistory: async () => [],
  floodSeries: async () => { throw new Error('offline'); },
  elevation: async () => { throw new Error('offline'); },
});

let pass = 0, fail = 0;
const t = async (name, fn) => { try { const ok = await fn(); if (ok === false) throw new Error('assertion false'); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '—', e.message); } };
const req = (port, method, p, { key, body, headers = {} } = {}) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (resp) => {
    let s = ''; resp.on('data', (c) => (s += c)); resp.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) { j = s; } res({ status: resp.statusCode, body: j, headers: resp.headers }); });
  });
  r.on('error', rej); if (data) r.write(data); r.end();
});

(async () => {
  const api = createApi({ dataDir: null, allowPrivateWebhooks: true, log: () => {}, retryDelayMs: 5, webhookAttempts: 2 });
  await new Promise((r) => api.server.listen(0, '127.0.0.1', r));
  const port = api.server.address().port;
  const key = api.newKey('Test NGO', 'team'), devKey = api.newKey('Trial', 'dev');
  const call = (m, p, o = {}) => req(port, m, p, { key, ...o });

  console.log('API: access');
  await t('health and OpenAPI are public', async () => { const h = await req(port, 'GET', '/v1/health'), o = await req(port, 'GET', '/v1/openapi.json'); return h.status === 200 && h.body.ok && o.status === 200 && o.body.openapi === '3.1.0' && o.body.paths['/v1/plan']; });
  await t('no key → 401 with instructions; unknown key → 401', async () => { const a = await req(port, 'GET', '/v1/events'), b = await req(port, 'GET', '/v1/events', { key: 'aa_nope' }); return a.status === 401 && /Bearer/.test(a.body.error.message) && b.status === 401; });
  await t('X-API-Key header works too; keys are stored hashed, never raw', async () => { const r = await req(port, 'GET', '/v1/usage', { headers: { 'X-API-Key': key } }); return r.status === 200 && r.body.tier === 'team' && r.body.quota === 50000 && !JSON.stringify(api.keys()).includes(key); });
  await t('CORS preflight is answered', async () => { const r = await req(port, 'OPTIONS', '/v1/plan'); return r.status === 204 && r.headers['access-control-allow-origin'] === '*' && /Authorization/.test(r.headers['access-control-allow-headers']); });
  await t('unknown path → 404, wrong method → 405', async () => { const a = await call('GET', '/v1/nope'), b = await call('GET', '/v1/plan'); return a.status === 404 && b.status === 405; });

  console.log('API: data endpoints');
  await t('/v1/events ranks live events and filters by hazard', async () => { const r = await call('GET', '/v1/events?limit=2'), f = await call('GET', '/v1/events?hazard=FL'); return r.status === 200 && r.body.events.length === 2 && r.body.events[0].rank === 1 && r.body.events[0].alertLevel === 'Red' && f.body.events.every((e) => e.hazard === 'FL'); });
  await t('/v1/forecast validates input (hazard, magnitude range, missing place)', async () => {
    const a = await call('POST', '/v1/forecast', { body: { q: 'Testville', hazard: 'XX', magnitude: 7 } }), b = await call('POST', '/v1/forecast', { body: { q: 'Testville', hazard: 'EQ', magnitude: 12 } }), c = await call('POST', '/v1/forecast', { body: { hazard: 'EQ', magnitude: 7 } }), d = await call('POST', '/v1/forecast', { body: { q: 'Nowhere', hazard: 'EQ', magnitude: 7 } });
    return a.status === 400 && /hazard/.test(a.body.error.message) && b.status === 400 && c.status === 400 && d.status === 404;
  });
  await t('/v1/forecast returns P10 ≤ P50 ≤ P90 per area and 72-hour needs', async () => {
    const r = await call('POST', '/v1/forecast', { body: { q: 'Testville', hazard: 'EQ', magnitude: 7.2 } });
    const f = r.body.forecast;
    return r.status === 200 && f.affected.p10 <= f.affected.p50 && f.affected.p50 <= f.affected.p90 && r.body.zones.length > 0 && r.body.need72hP90.water > 0 && r.body.units.water === 'kL';
  });
  await t('bad JSON body → 400', async () => { const r = await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/forecast', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, (resp) => { let s = ''; resp.on('data', (c) => (s += c)); resp.on('end', () => res({ status: resp.statusCode, body: JSON.parse(s) })); }); q.write('{nope'); q.end(); }); return r.status === 400; });
  let plan;
  await t('/v1/plan builds the full plan: allocation, dispatches, key actions, savings, storage sites', async () => {
    const r = await call('POST', '/v1/plan', { body: { lat: C0.lat, lon: C0.lon, hazard: 'EQ', magnitude: 7.0, worldpop: false } });
    plan = r.body;
    return r.status === 200 && plan.zones.length > 0 && plan.allocation.dispatches.length > 0 && plan.keyActions.length >= 3 && plan.savings.headlines.length >= 1 && plan.storageSites.length > 0 && plan.allocation.coverage.water.share >= 0 && plan.routes === undefined;
  });
  await t('/v1/plan with your inventory uses your stores, and ?geometry=1 adds route lines', async () => {
    const inv = [{ name: 'Central store', lat: 28.95, lon: 77.45, water_l: 900000, food_kg: 90000, tents: 5000, medkits: 500, staff: 200, trucks: 30, buses: 6, ambulances: 6 }];
    const r = await call('POST', '/v1/plan?geometry=1', { body: { q: 'Testville', hazard: 'EQ', magnitude: 7.0, worldpop: false, storageSites: false, inventory: inv } });
    return r.status === 200 && r.body.stores.length === 1 && r.body.stores[0].name === 'Central store' && /imported/.test(r.body.stores[0].provenance) && Array.isArray(r.body.routes) && r.body.routes.length > 0 && r.body.routes[0].coordinates.length >= 2;
  });
  await t('the engine is released after each plan (no state leaks between callers)', async () => AA.engine.state === null);
  await t('/v1/risk returns 36 cells and the 5 highest-risk areas, ranked', async () => { const r = await call('GET', '/v1/risk?q=Testville'); return r.status === 200 && r.body.cells.length === 36 && r.body.top.length === 5 && r.body.top[0].risk >= r.body.top[4].risk; });
  await t('/v1/readiness scores 0–100 with gaps; sending stock raises the score', async () => {
    const a = await call('POST', '/v1/readiness', { body: { q: 'Testville' } });
    const big = [{ name: 'Mega depot', lat: 28.5, lon: 77.05, water_l: 5e7, food_kg: 5e6, tents: 5e5, medkits: 5e4, staff: 5e4, trucks: 2000, buses: 500 }];
    const b = await call('POST', '/v1/readiness', { body: { q: 'Testville', inventory: big } });
    return a.status === 200 && a.body.score >= 0 && a.body.score <= 100 && a.body.areas.length === 5 && b.body.score > a.body.score && b.body.stockSource === 'inventory sent with the request';
  });

  console.log('API: Phase 3');
  await t('/v1/model-cards is public and lists every model with status and limits', async () => { const r = await req(port, 'GET', '/v1/model-cards'); return r.status === 200 && r.body.cards.length >= 5 && r.body.cards.every((c) => c.status && c.limits.length) && r.body.modelVersion === AA.MODEL_VERSION; });
  await t('/v1/plan?format=geojson returns the plan as a GeoJSON FeatureCollection', async () => { const r = await call('POST', '/v1/plan?format=geojson', { body: { q: 'Testville', hazard: 'EQ', magnitude: 7.0, worldpop: false } }); return r.status === 200 && r.body.type === 'FeatureCollection' && r.body.features.some((f) => f.properties.layer === 'affected_area') && r.body.features.some((f) => f.properties.layer === 'route'); });
  await t('/v1/backtest scores the catalogue against reported deaths (and caches it)', async () => { const a = await call('GET', '/v1/backtest'); const b = await call('GET', '/v1/backtest'); return a.status === 200 && a.body.results.length === AA.backtest.CATALOG.length && a.body.summary.n > 30 && a.body.results.some((x) => x.scoring === 'tsunami' && !x.scored) && a.body.at === b.body.at; });

  console.log('API: webhooks');
  const got = []; let failNext = 0;
  const recv = http.createServer((rq, rs) => { let s = ''; rq.on('data', (c) => (s += c)); rq.on('end', () => { if (failNext > 0) { failNext--; rs.writeHead(500); rs.end(); return; } got.push({ headers: rq.headers, raw: s, body: JSON.parse(s) }); rs.writeHead(200); rs.end('ok'); }); });
  await new Promise((r) => recv.listen(0, '127.0.0.1', r));
  const hookUrl = `http://127.0.0.1:${recv.address().port}/hook`;
  let hook;
  await t('create a webhook: the signing secret is returned once, never listed again', async () => {
    const r = await call('POST', '/v1/webhooks', { body: { url: hookUrl, area: { name: 'Testville district', lat: 28.46, lon: 77.03, radiusKm: 150, minLevel: 'Orange' } } });
    hook = r.body; const l = await call('GET', '/v1/webhooks');
    return r.status === 201 && /^whsec_/.test(hook.secret) && l.body.webhooks.length === 1 && !('secret' in l.body.webhooks[0]);
  });
  await t('test delivery is signed: v1 = HMAC-SHA256(secret, timestamp.body)', async () => {
    const r = await call('POST', `/v1/webhooks/${hook.id}/test`);
    const d = got.pop(); const expect = crypto.createHmac('sha256', hook.secret).update(`${d.headers['x-aidatlas-timestamp']}.${d.raw}`).digest('hex');
    return r.body.ok && d.body.type === 'test' && d.headers['x-aidatlas-signature'] === `v1=${expect}`;
  });
  await t('alerts: only events inside the area at or above its level are sent, each once', async () => {
    got.length = 0;
    const a = await api.checkAlerts(), b = await api.checkAlerts();
    return a.sent === 1 && b.sent === 0 && got.length === 1 && got[0].body.event.id === 'EQ-1' && got[0].body.level === 'Red' && got[0].headers['x-aidatlas-event'] === 'alert';
  });
  await t('a failed delivery is retried', async () => { failNext = 1; const r = await call('POST', `/v1/webhooks/${hook.id}/test`); return r.body.ok === true && failNext === 0; });
  await t('another key cannot see, test or delete your webhook', async () => {
    const l = await req(port, 'GET', '/v1/webhooks', { key: devKey }), d = await req(port, 'DELETE', `/v1/webhooks/${hook.id}`, { key: devKey });
    return l.body.webhooks.length === 0 && d.status === 404;
  });
  await t('https is required and private addresses are refused in production mode', async () => {
    const strict = createApi({ dataDir: null, allowPrivateWebhooks: false, log: () => {} });
    await new Promise((r) => strict.server.listen(0, '127.0.0.1', r));
    const k = strict.newKey('S', 'team'), p = strict.server.address().port;
    const a = await req(p, 'POST', '/v1/webhooks', { key: k, body: { url: 'http://example.org/x', area: { lat: 1, lon: 1 } } });
    const b = await req(p, 'POST', '/v1/webhooks', { key: k, body: { url: 'https://127.0.0.1/x', area: { lat: 1, lon: 1 } } });
    const c = await req(p, 'POST', '/v1/webhooks', { key: k, body: { url: 'https://localhost/x', area: { lat: 1, lon: 1 } } });
    strict.server.close();
    return a.status === 400 && /https/.test(a.body.error.message) && b.status === 400 && /private/.test(b.body.error.message) && c.status === 400;
  });
  await t('private-address check covers loopback, RFC 1918, link-local and IPv6 local', () => ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1'].every(isPrivateIp) && !isPrivateIp('8.8.8.8') && !isPrivateIp('2606:4700::1111'));
  await t('delete removes the webhook', async () => { const d = await call('DELETE', `/v1/webhooks/${hook.id}`), l = await call('GET', '/v1/webhooks'); return d.status === 200 && l.body.webhooks.length === 0; });

  console.log('API: limits');
  await t('rate limit: more than the per-minute allowance → 429 with Retry-After', async () => {
    let last; for (let i = 0; i < 32; i++) last = await req(port, 'GET', '/v1/usage', { key: devKey });
    return last.status === 429 && last.body.error.code === 'rate_limited' && +last.headers['retry-after'] > 0;
  });
  await t('monthly quota: a key over its quota gets 429 quota_exceeded', async () => {
    const small = createApi({ dataDir: null, log: () => {}, tiers: { tiny: { label: 'Tiny', monthly: 3, perMin: 100, webhooks: 1 } } });
    await new Promise((r) => small.server.listen(0, '127.0.0.1', r));
    const k = small.newKey('Quota test', 'tiny'), p = small.server.address().port;
    const codes = []; for (let i = 0; i < 4; i++) codes.push((await req(p, 'GET', '/v1/usage', { key: k })).status);
    const last = await req(p, 'GET', '/v1/usage', { key: k });
    small.server.close();
    return codes.join() === '200,200,200,429' && last.body.error.code === 'quota_exceeded';
  });
  recv.close(); api.server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
