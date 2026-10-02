#!/usr/bin/env node
/* AidAtlas public API: forecasts, relief plans, risk grids, readiness scores and alert webhooks over HTTP/JSON.
   Runs the SAME model code as the web app (js/), so numbers match what users see on the map.
   Start:   npm install && npm run api          (PORT, default 8787)
   New key: node server/api.js --new-key "Organisation name" team
   Docs:    GET /v1/openapi.json · guide.html#api · skills/api/SKILL.md
   Env:     PORT · AIDATLAS_DATA_DIR (keys, usage, webhooks; default server/data) · AIDATLAS_KEYS (JSON {"key":{"name","tier"}})
            AIDATLAS_ALERT_MINUTES (webhook check interval, default 10) · AIDATLAS_ALLOW_PRIVATE_WEBHOOKS=1 (tests / intranets)
            AIDATLAS_USER_AGENT (sent to public data services) · AIDATLAS_CORS_ORIGIN (default *) */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), dns = require('dns').promises, net = require('net');
const ROOT = path.join(__dirname, '..');
const VERSION = (() => { try { return require(path.join(ROOT, 'package.json')).version || '2.0.0'; } catch (e) { return '2.0.0'; } })();

// Public data services ask callers to identify themselves (Nominatim usage policy)
const UA = process.env.AIDATLAS_USER_AGENT || `AidAtlas-API/${VERSION} (+https://github.com/darshchawla-code/disaster-recovery)`;
const rawFetch = globalThis.fetch;
globalThis.fetch = (u, init = {}) => rawFetch(u, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
globalThis.solver = require('javascript-lp-solver');
['js/core.js', 'js/data.js', 'js/workspace.js', 'js/models/prediction.js', 'js/models/fairness.js', 'js/models/efficiency.js', 'js/models/routing.js', 'js/models/facility.js', 'js/models/risk.js', 'js/models/savings.js', 'js/models/readiness.js', 'js/engine.js', 'js/pipelines.js', 'js/ui/report.js'].forEach((f) => require(path.join(ROOT, f)));
const AA = globalThis.AA, M = AA.math, P = AA.prediction, D = AA.data, ENG = AA.engine, RD = AA.readiness, PL = AA.pipelines, W = AA.workspace;

// ---------------- tiers (Freemium plan: Team 50,000 calls/month, Agency 500,000) ----------------
const TIERS = {
  dev: { label: 'Developer trial', monthly: 1000, perMin: 30, webhooks: 2 },
  team: { label: 'Team / NGO', monthly: 50000, perMin: 60, webhooks: 25 },
  agency: { label: 'Agency', monthly: 500000, perMin: 300, webhooks: 200 },
  enterprise: { label: 'Enterprise & Government', monthly: Infinity, perMin: 1200, webhooks: 2000 },
};
const HAZ = Object.keys(AA.HAZARDS);
const hash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');

// ---------------- tiny JSON store (atomic writes); memory-only when dir is null ----------------
const store = (dir) => {
  const mem = {};
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const file = (n) => path.join(dir, `${n}.json`);
  return {
    get: (n, d) => { if (n in mem) return mem[n]; if (dir) { try { mem[n] = JSON.parse(fs.readFileSync(file(n), 'utf8')); return mem[n]; } catch (e) { /* missing */ } } mem[n] = d; return d; },
    set: (n, v) => { mem[n] = v; if (dir) { const tmp = file(n) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 1)); fs.renameSync(tmp, file(n)); } },
  };
};

class ApiError extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }
const bad = (msg, extra) => new ApiError(400, 'bad_request', msg, extra);
const num = (v, name, lo, hi, def) => {
  if (v === undefined || v === null || v === '') { if (def !== undefined) return def; throw bad(`"${name}" is required`); }
  const x = +v; if (!isFinite(x) || x < lo || x > hi) throw bad(`"${name}" must be a number between ${lo} and ${hi}`); return x;
};
const round = (x, d = 0) => (x == null || !isFinite(x) ? x : M.round(x, d));
const q3 = (o) => (o ? { p10: round(o.p10), p50: round(o.p50), p90: round(o.p90) } : null);

/** Is this URL safe to call back (no localhost / private networks unless allowed)? */
const isPrivateIp = (ip) => {
  if (net.isIPv6(ip)) { const l = ip.toLowerCase(); return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l === '::' || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.'); }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};
const checkHookUrl = async (u, allowPrivate) => {
  let url; try { url = new URL(u); } catch (e) { throw bad('"url" is not a valid URL'); }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw bad('Webhook URLs must use https://');
  if (allowPrivate) return url.toString();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw bad('Webhook URL points to a private address');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => { throw bad(`Webhook host ${host} could not be resolved`); })).map((x) => x.address);
  if (ips.some(isPrivateIp)) throw bad('Webhook URL points to a private address');
  return url.toString();
};

// ---------------- serialisers ----------------
const placeOf = async (b) => {
  if (b.q) { const r = (await D.geocode(String(b.q).slice(0, 200)))[0]; if (!r) throw new ApiError(404, 'not_found', `No place found for "${b.q}"`); return r; }
  const lat = num(b.lat, 'lat', -90, 90), lon = num(b.lon, 'lon', -180, 180);
  let r = {}; try { r = await D.reverse(lat, lon); } catch (e) { /* offline reverse geocoder */ }
  return { lat, lon, name: r.name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, short: r.short || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, country: r.country || '', iso2: r.iso2 || '' };
};
const scenarioOf = (b, place) => {
  const hz = String(b.hazard || '').toUpperCase();
  if (!HAZ.includes(hz)) throw bad(`"hazard" must be one of ${HAZ.join(', ')}`);
  const mag = hz === 'EQ' ? num(b.magnitude, 'magnitude', 4, 9.6) : hz === 'TC' ? num(b.magnitude, 'magnitude', 60, 350) : num(b.magnitude, 'magnitude', 0.1, 1);
  const sit = ENG.situationFromPlan({ lat: place.lat, lon: place.lon, name: b.name ? String(b.name).slice(0, 120) : `${AA.HAZARDS[hz].label} scenario · ${place.short || place.name}`, country: place.country, iso2: place.iso2, hazard: hz, magnitude: mag, depth: num(b.depth, 'depth', 1, 700, 10), peakInHours: num(b.peakInHours, 'peakInHours', 0, 240, 0), radiusKm: b.radiusKm != null ? num(b.radiusKm, 'radiusKm', 5, 300) : undefined, areaKm2: b.areaKm2 != null ? num(b.areaKm2, 'areaKm2', 1, 1e6) : undefined });
  return sit;
};
const zoneOut = (z) => ({ id: z.id, name: z.name, lat: round(z.lat, 5), lon: round(z.lon, 5), population: round(z.pop), populationSource: z.popProv, severity: round(z.sevPost ?? z.sevMean, 3), need: z.need != null ? round(z.need, 3) : undefined, affected: q3(z.fc.aff), displaced: q3(z.fc.dis), injured: q3(z.fc.inj), deaths: q3(z.fc.fat), address: z.address || undefined, alsoCovers: z.covers?.length ? z.covers : undefined });
const unitsOf = Object.fromEntries(AA.config.commodities.map((k) => [k.key, k.unit]));
const planOut = (st, geometry) => {
  const run = st.lastRun, K = AA.config.commodities, R = AA.report, sv = AA.savings.compare(st), sm = st.fcast.summary;
  const cov = Object.fromEntries(K.map((k) => { const d = M.sum(st.zones.map((z) => z.d[k.key] || 0)), u = M.sum(run.alloc.unmet.map((x) => x[k.key] || 0)); return [k.key, { needed: round(d, 2), delivered: round(d - u, 2), share: d > 0 ? round((d - u) / d, 3) : 1, unit: k.unit }]; }));
  const g = R.gap(st);
  return {
    situation: { name: st.sit.name, hazard: st.sit.hazard, magnitude: st.sit.magnitude, lat: st.sit.lat, lon: st.sit.lon, country: st.sit.country || '', radiusKm: round(st.sit.radiusKm, 1), focus: st.sit.focus || null, epochHours: AA.config.epochHours },
    forecast: { affected: q3(sm.aff), displaced: q3(sm.dis), injured: q3(sm.inj), deaths: q3(sm.fat), reported: st.fcast.reported || null, pagerLosses: st.fcast.pagerLosses ? { level: st.fcast.pagerLosses.level, deaths: q3(st.fcast.pagerLosses.quantiles) } : null },
    zones: st.zones.map((z) => ({ ...zoneOut(z), demandThisPeriod: Object.fromEntries(K.map((k) => [k.key, round(z.d[k.key] || 0, 2)])) })),
    stores: st.depots.map((d) => ({ id: d.id, name: d.name, type: d.type, lat: round(d.lat, 5), lon: round(d.lon, 5), open: d.open, stock: Object.fromEntries(K.map((k) => [k.key, round(d.stock[k.key] || 0, 2)])), fleet: d.fleet, provenance: d.prov, address: d.address || undefined })),
    hospitals: st.hospitals.map((h) => ({ id: h.id, name: h.name, lat: round(h.lat, 5), lon: round(h.lon, 5), freeBeds: h.beds, address: h.address || undefined })),
    allocation: {
      method: run.alloc.method, costUSD: { transport: round(run.alloc.cost.transport), handling: round(run.alloc.cost.handling), congestion: round(run.alloc.cost.congestion), total: round(run.alloc.cost.total) },
      coverage: cov, trips: run.cons.tripsAfter, tripsSavedByConsolidation: run.cons.saved,
      dispatches: R.dispatches(st).map((d) => ({ from: d.depot.id, fromName: d.depot.name, to: d.zone.id, toName: d.zone.name, trucks: d.trucks, buses: d.buses, multiStop: d.milk, airDrop: d.air, driveHours: round(d.hours, 2), cargo: Object.fromEntries(Object.entries(d.cargo).filter(([, q]) => q > 1e-6).map(([k, q]) => [k, round(q, 2)])) })),
      casualties: run.casualty.flows.map((f) => ({ from: st.zones[f.i].id, to: st.hospitals[f.h].id, patients: round(f.n, 1), driveHours: round(f.tau, 2) })),
    },
    gap: { trucks: g.trucks, buses: g.buses, shortages: g.short.map((x) => ({ item: x.k.key, amount: round(x.n, 2), unit: x.k.unit })) },
    storageSites: (st.warehouses?.sizes || []).map((s, k) => { const c = st.warehouses.cand[s.j]; return { id: `S${k + 1}`, lat: round(c.lat, 5), lon: round(c.lon, 5), serves: s.zones, stock72hP90: Object.fromEntries(Object.entries(s.stock).map(([q, v]) => [q, round(v, 2)])) }; }),
    keyActions: R.keyActions(st).map((a) => ({ text: a.text, detail: a.detail })),
    savings: sv ? { headlines: AA.savings.headlines(sv), nearestStore: slimMetrics(sv.baseline), aidatlas: slimMetrics(sv.optimised) } : null,
    routes: geometry ? run.legs.map((l) => ({ from: l.from.kind === 'd' ? st.depots[l.from.idx].id : st.zones[l.from.idx].id, to: st.zones[l.to.idx].id, vehicle: l.cls, airDrop: !!l.airdrop, coordinates: (l.best?.coords || []).map(([x, y]) => [round(x, 5), round(y, 5)]) })) : undefined,
    units: unitsOf, notes: st.notes, generatedAt: new Date().toISOString(),
  };
};
const slimMetrics = (m) => ({ costUSD: round(m.cost), costPerTonneUSD: round(m.costPerTonne), vehicleHours: round(m.vehHours, 1), trips: m.trips, criticalNeedDelivered: round(m.critCoverage, 3), waterToHighestNeedThird: round(m.topNeedWater, 3), areasUnderHalfWater: m.leftBehind.length, averageDriveHours: round(m.avgHours, 2) });
const riskOut = (rr) => ({ place: rr.place, lat: rr.placeObj.lat, lon: rr.placeObj.lon, country: rr.placeObj.country || '', gutenbergRichter: { b: round(rr.gr.b, 3), a: rr.gr.a != null ? round(rr.gr.a, 3) : null, ratePerYearM6: rr.gr.lambda6 }, basis: rr.counts,
  top: rr.top.map((c, k) => ({ rank: k + 1, name: c.name, lat: round(c.lat, 4), lon: round(c.lon, 4), risk: round(c.R, 3), hazard: round(c.H, 3), exposure: round(c.E, 3), vulnerability: round(c.V, 3), lackOfCoping: round(c.LCC, 3), dominantHazard: c.dominant, address: c.address || undefined })),
  cells: rr.cells.map((c) => ({ id: c.id, lat: round(c.lat, 4), lon: round(c.lon, 4), sizeKm: round(c.sizeKm, 1), risk: round(c.R, 3), dominantHazard: c.dominant })) });
const readyOut = (rd) => ({ place: rd.place, score: round(rd.score, 1), grade: rd.grade, gaps: rd.gaps.map((g) => ({ item: g.key, add: round(g.add, 2), unit: g.unit })), vehiclesToAdd: rd.vehicles, stockSource: rd.source, roads: rd.roads, reachHours: RD.REACH_HOURS, days: RD.DAYS,
  areas: rd.areas.map((a) => ({ name: a.area.name, lat: round(a.area.lat, 4), lon: round(a.area.lon, 4), hazard: a.area.hazard, peopleAffectedP90: round(a.area.affP90), score: round(a.score, 1), items: a.items.map((it) => ({ item: it.key, need: round(it.need, 2), have: round(it.have, 2), covered: round(it.r, 3), unit: it.unit })), vehicles: { covered: round(a.transport.r, 3), trucksToAdd: a.transport.trucksShort, busesToAdd: a.transport.busesShort }, storesInReach: a.stores.map((s) => ({ name: s.name, hours: round(s.hours, 2) })) })), computedAt: rd.at });

// ---------------- server ----------------
function createApi(opts = {}) {
  const TIERS_ = opts.tiers || TIERS;
  const S = store(opts.dataDir === undefined ? (process.env.AIDATLAS_DATA_DIR || path.join(__dirname, 'data')) : opts.dataDir);
  const allowPrivate = opts.allowPrivateWebhooks ?? process.env.AIDATLAS_ALLOW_PRIVATE_WEBHOOKS === '1';
  const corsOrigin = process.env.AIDATLAS_CORS_ORIGIN || '*';
  const log = opts.log || ((...a) => console.log(new Date().toISOString(), ...a));

  // keys: env (raw) + keys.json (hashed)
  const keys = () => {
    const k = { ...S.get('keys', {}) };
    try { Object.entries(JSON.parse(process.env.AIDATLAS_KEYS || '{}')).forEach(([raw, v]) => (k[hash(raw)] = { name: v.name || 'env key', tier: v.tier || 'team', created: 'env' })); } catch (e) { log('AIDATLAS_KEYS is not valid JSON'); }
    return k;
  };
  const newKey = (name, tier = 'team') => {
    if (!TIERS_[tier]) throw new Error(`tier must be one of ${Object.keys(TIERS_).join(', ')}`);
    const raw = 'aa_' + crypto.randomBytes(24).toString('base64url');
    const all = S.get('keys', {}); all[hash(raw)] = { name: String(name).slice(0, 80), tier, created: new Date().toISOString() }; S.set('keys', all);
    return raw;
  };

  // usage and rate limits
  const month = () => new Date().toISOString().slice(0, 7);
  const usage = S.get('usage', {});
  let usageDirty = false;
  const flush = () => { if (usageDirty) { S.set('usage', usage); usageDirty = false; } };
  const flushTimer = setInterval(flush, 5000); flushTimer.unref?.();
  const windows = new Map();
  const meter = (h, tier) => {
    const t = TIERS_[tier], m = month(), u = (usage[h] = usage[h] || {});
    if ((u[m] || 0) >= t.monthly) throw new ApiError(429, 'quota_exceeded', `Monthly quota of ${t.monthly.toLocaleString('en')} calls used. It resets on the 1st; contact us to upgrade.`);
    const now = Date.now(), w = (windows.get(h) || []).filter((x) => now - x < 60000);
    if (w.length >= t.perMin) { windows.set(h, w); throw new ApiError(429, 'rate_limited', `More than ${t.perMin} calls in a minute. Slow down and retry.`, { retryAfterSeconds: Math.ceil((60000 - (now - w[0])) / 1000) }); }
    w.push(now); windows.set(h, w);
    u[m] = (u[m] || 0) + 1; usageDirty = true;
  };
  const auth = (req) => {
    const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'] || '';
    if (!raw) throw new ApiError(401, 'unauthorized', 'Send your API key as "Authorization: Bearer <key>" or "X-API-Key: <key>".');
    const h = hash(raw), k = keys()[h];
    if (!k || k.revoked) throw new ApiError(401, 'unauthorized', 'Unknown or revoked API key.');
    meter(h, k.tier);
    return { h, ...k };
  };

  // heavy jobs (plans) run one at a time: the engine keeps one plan in memory
  let chain = Promise.resolve(), waiting = 0;
  const serial = (fn) => {
    if (waiting >= (opts.maxQueue || 4)) throw new ApiError(503, 'busy', 'The planning queue is full. Retry in a minute.', { retryAfterSeconds: 60 });
    waiting++;
    const p = chain.then(fn, fn);
    chain = p.catch(() => {}).finally(() => { waiting--; });
    return p;
  };
  const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new ApiError(504, 'timeout', `${what} took longer than ${Math.round(ms / 1000)} s; public data services may be slow. Retry later.`)), ms).unref?.())]);

  // caches
  const cache = new Map();
  const cached = async (key, ttl, fn) => { const h = cache.get(key); if (h && Date.now() - h.t < ttl) return h.v; const v = await fn(); cache.set(key, { t: Date.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value); return v; };

  // ---------------- webhooks ----------------
  const hooks = () => S.get('webhooks', []);
  const saveHooks = (h) => S.set('webhooks', h);
  const sign = (secret, ts, body) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const deliver = async (hook, payload) => {
    const body = JSON.stringify(payload), ts = Math.floor(Date.now() / 1000);
    let last = '';
    for (let attempt = 0; attempt < (opts.webhookAttempts || 3); attempt++) {
      try {
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10000);
        const r = await rawFetch(hook.url, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-AidAtlas-Event': payload.type, 'X-AidAtlas-Delivery': crypto.randomUUID(), 'X-AidAtlas-Timestamp': String(ts), 'X-AidAtlas-Signature': `v1=${sign(hook.secret, ts, body)}` }, body }).finally(() => clearTimeout(timer));
        if (r.ok) return { ok: true, status: r.status };
        last = `HTTP ${r.status}`;
      } catch (e) { last = e.name === 'AbortError' ? 'timed out' : e.message; }
      await new Promise((res) => setTimeout(res, (opts.retryDelayMs ?? 1000) * 4 ** attempt));
    }
    return { ok: false, error: last };
  };
  /** Check live events against every webhook's area; send each (area, event, level) once. */
  const checkAlerts = async () => {
    const list = hooks(); if (!list.length) return { sent: 0 };
    const { events } = await D.liveEvents();
    const sent = S.get('sent', {}); let n = 0;
    for (const hk of list) {
      if (!hk.events.includes('alert')) continue;
      const done = new Set(sent[hk.id] || []);
      for (const m of W.matchWatch([{ ...hk.area, id: hk.id, name: hk.area.name }], events)) {
        if (done.has(m.key)) continue;
        const e = m.event;
        const r = await deliver(hk, { type: 'alert', level: m.level, distanceKm: round(m.distKm, 1), area: hk.area, event: { id: e.id, name: e.name, hazard: e.hazard, lat: e.lat, lon: e.lon, country: e.country || '', source: e.src, url: e.url || '', severityIndex: round(e.usi, 3), from: e.from, to: e.to }, sentAt: new Date().toISOString() });
        hk.lastDelivery = { at: new Date().toISOString(), ...r };
        if (r.ok) { done.add(m.key); n++; hk.failures = 0; } else hk.failures = (hk.failures || 0) + 1;
      }
      sent[hk.id] = [...done].slice(-1000);
    }
    S.set('sent', sent); saveHooks(list);
    return { sent: n };
  };

  // ---------------- routes ----------------
  const routes = [];
  const route = (method, re, open, fn) => routes.push({ method, re, open, fn });
  const body = (req) => new Promise((res, rej) => {
    let s = ''; req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > 2e6) { rej(new ApiError(413, 'too_large', 'Request body over 2 MB.')); req.destroy(); } });
    req.on('end', () => { if (!s) return res({}); try { res(JSON.parse(s)); } catch (e) { rej(bad('Body is not valid JSON')); } });
    req.on('error', rej);
  });

  route('GET', /^\/v1\/health$/, true, async () => ({ ok: true, version: VERSION, time: new Date().toISOString() }));
  route('GET', /^\/v1\/openapi\.json$/, true, async () => JSON.parse(fs.readFileSync(path.join(__dirname, 'openapi.json'), 'utf8')));
  route('GET', /^\/v1\/usage$/, false, async (ctx) => { const t = TIERS_[ctx.key.tier]; return { name: ctx.key.name, tier: ctx.key.tier, tierLabel: t.label, month: month(), used: usage[ctx.key.h]?.[month()] || 0, quota: isFinite(t.monthly) ? t.monthly : null, perMinute: t.perMin }; });

  route('GET', /^\/v1\/events$/, false, async (ctx) => {
    const limit = num(ctx.query.get('limit'), 'limit', 1, 200, 20), hz = ctx.query.get('hazard');
    const { events, errors } = await cached('events', 5 * 60e3, () => D.liveEvents());
    return { count: events.length, sources: { errors }, events: events.filter((e) => !hz || e.hazard === hz.toUpperCase()).slice(0, limit).map((e, k) => ({ rank: k + 1, id: e.id, name: e.name, hazard: e.hazard, lat: e.lat, lon: e.lon, country: e.country || '', alertLevel: W.eventLevel(e), severityIndex: round(e.usi, 3), magnitude: e.magnitude ?? null, severity: e.severity ?? null, severityUnit: e.severityUnit || null, source: e.src, url: e.url || null, from: e.from || null, to: e.to || null })) };
  });

  route('POST', /^\/v1\/forecast$/, false, async (ctx) => {
    const b = ctx.body, place = await placeOf(b), sit = scenarioOf(b, place), notes = [];
    try { sit.countryIdx = await D.countryIndex(sit.iso2); } catch (e) { sit.countryIdx = { vul: 0.5, lcc: 0.5, prov: 'assumed' }; notes.push('Country indicators unavailable; vulnerability assumed 0.5.'); }
    sit.countryVul = sit.countryIdx.vul;
    sit.radiusKm = sit.hazard === 'FL' ? (sit.radiusKm || 40) : P.impactRadius(sit);
    let places = []; try { places = await D.places(sit, Math.min(sit.radiusKm, 120)); } catch (e) { notes.push('OpenStreetMap places unavailable; modelled population sectors used.'); }
    const zones = P.buildZones(sit, places, 12);
    const fc = P.forecast(sit, zones);
    const n72 = RD.need72(zones);
    return { situation: { name: sit.name, hazard: sit.hazard, magnitude: sit.magnitude, lat: sit.lat, lon: sit.lon, country: sit.country || place.country || '', radiusKm: round(sit.radiusKm, 1), vulnerability: round(sit.countryVul, 3) },
      forecast: { affected: q3(fc.summary.aff), displaced: q3(fc.summary.dis), injured: q3(fc.summary.inj), deaths: q3(fc.summary.fat), simulations: fc.draws },
      need72hP90: Object.fromEntries(Object.entries(n72.need).map(([k, v]) => [k, round(v, 2)])), units: unitsOf, zones: zones.map(zoneOut), notes, generatedAt: new Date().toISOString() };
  });

  route('POST', /^\/v1\/plan$/, false, async (ctx) => {
    const b = ctx.body, place = await placeOf(b), sit = scenarioOf(b, place);
    const supplyScale = num(b.supplyScale, 'supplyScale', 0.1, 10, 1);
    let rows = Array.isArray(b.inventory) ? W.normaliseRows(b.inventory) : null;
    if (!rows && b.inventoryUrl) rows = await W.inventory.fetchRows(String(b.inventoryUrl));
    if (rows && !rows.length) throw bad('"inventory" has no rows with lat and lon');
    const out = await serial(() => withTimeout((async () => {
      const keepWp = AA.config.worldpop;
      AA.config.worldpop = b.worldpop !== false;
      try {
        await ENG.build(sit, { warehouses: b.storageSites !== false, supplyScale, addresses: false, mode: 'api' });
        if (rows) await ENG.event('importDepots', { rows, source: 'API inventory' }, { replay: true });
        return planOut(ENG.state, ctx.query.get('geometry') === '1' || b.geometry === true);
      } finally { AA.config.worldpop = keepWp; ENG.state = null; }
    })(), opts.planTimeoutMs || 180000, 'Planning'));
    return out;
  });

  const riskFor = (place) => cached(`risk:${place.lat.toFixed(2)},${place.lon.toFixed(2)}`, 24 * 36e5, () => PL.risk(place));
  route('GET', /^\/v1\/risk$/, false, async (ctx) => {
    const q = Object.fromEntries(ctx.query); const place = await placeOf(q);
    return riskOut(await withTimeout(riskFor(place), opts.riskTimeoutMs || 180000, 'The risk assessment'));
  });
  route('POST', /^\/v1\/readiness$/, false, async (ctx) => {
    const b = ctx.body, place = await placeOf(b);
    let rows = Array.isArray(b.inventory) ? W.normaliseRows(b.inventory) : null;
    if (!rows && b.inventoryUrl) rows = await W.inventory.fetchRows(String(b.inventoryUrl));
    const rr = await withTimeout(riskFor(place), opts.riskTimeoutMs || 180000, 'The risk assessment');
    const rd = await PL.readiness(rr, { rows, sourceLabel: rows ? 'inventory sent with the request' : '' });
    return readyOut(rd);
  });

  // webhooks
  const mine = (ctx) => hooks().filter((h) => h.keyHash === ctx.key.h);
  const hookOut = (h, withSecret) => ({ id: h.id, url: h.url, events: h.events, area: h.area, created: h.created, lastDelivery: h.lastDelivery || null, ...(withSecret ? { secret: h.secret } : {}) });
  route('GET', /^\/v1\/webhooks$/, false, async (ctx) => ({ webhooks: mine(ctx).map((h) => hookOut(h)) }));
  route('POST', /^\/v1\/webhooks$/, false, async (ctx) => {
    const b = ctx.body, a = b.area || {};
    if (mine(ctx).length >= TIERS_[ctx.key.tier].webhooks) throw new ApiError(403, 'limit', `Your tier allows ${TIERS_[ctx.key.tier].webhooks} webhooks.`);
    const url = await checkHookUrl(b.url, allowPrivate);
    const events = (b.events || ['alert']).filter((e) => ['alert'].includes(e)); if (!events.length) throw bad('"events" must include "alert"');
    const hazards = (a.hazards || HAZ).map((h) => String(h).toUpperCase()).filter((h) => HAZ.includes(h));
    const area = { name: String(a.name || 'Watch area').slice(0, 80), lat: num(a.lat, 'area.lat', -90, 90), lon: num(a.lon, 'area.lon', -180, 180), radiusKm: num(a.radiusKm, 'area.radiusKm', 5, 1000, 100), hazards: hazards.length ? hazards : HAZ, minLevel: ['Green', 'Orange', 'Red'].includes(a.minLevel) ? a.minLevel : 'Orange' };
    const h = { id: 'wh_' + crypto.randomBytes(8).toString('hex'), keyHash: ctx.key.h, url, events, area, secret: 'whsec_' + crypto.randomBytes(24).toString('base64url'), created: new Date().toISOString() };
    saveHooks([...hooks(), h]);
    return { status: 201, body: { ...hookOut(h, true), note: 'Keep the secret: it is shown only now. Verify X-AidAtlas-Signature = v1=HMAC_SHA256(secret, timestamp + "." + body).' } };
  });
  route('DELETE', /^\/v1\/webhooks\/(wh_[a-f0-9]+)$/, false, async (ctx) => {
    const all = hooks(), h = all.find((x) => x.id === ctx.params[0] && x.keyHash === ctx.key.h);
    if (!h) throw new ApiError(404, 'not_found', 'No such webhook for this key.');
    saveHooks(all.filter((x) => x !== h)); return { deleted: h.id };
  });
  route('POST', /^\/v1\/webhooks\/(wh_[a-f0-9]+)\/test$/, false, async (ctx) => {
    const h = hooks().find((x) => x.id === ctx.params[0] && x.keyHash === ctx.key.h);
    if (!h) throw new ApiError(404, 'not_found', 'No such webhook for this key.');
    return deliver(h, { type: 'test', message: 'AidAtlas webhook test', area: h.area, sentAt: new Date().toISOString() });
  });

  // ---------------- dispatcher ----------------
  const handler = async (req, res) => {
    const t0 = Date.now();
    const u = new URL(req.url, 'http://x');
    const send = (status, obj, extraHeaders = {}) => {
      const s = JSON.stringify(obj);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Headers': 'Authorization, X-API-Key, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Cache-Control': 'no-store', 'X-AidAtlas-Version': VERSION, ...extraHeaders });
      res.end(s);
    };
    if (req.method === 'OPTIONS') return send(204, {});
    const m = routes.map((r) => ({ r, mm: r.re.exec(u.pathname) })).filter((x) => x.mm);
    try {
      if (!m.length) throw new ApiError(404, 'not_found', `No endpoint ${u.pathname}. See /v1/openapi.json`);
      const hit = m.find((x) => x.r.method === req.method);
      if (!hit) throw new ApiError(405, 'method_not_allowed', `Use ${m.map((x) => x.r.method).join(' or ')} for ${u.pathname}`);
      const ctx = { query: u.searchParams, params: hit.mm.slice(1), body: ['POST', 'PUT'].includes(req.method) ? await body(req) : {} };
      if (!hit.r.open) ctx.key = auth(req);
      const out = await hit.r.fn(ctx);
      if (out && out.status && out.body) send(out.status, out.body); else send(200, out);
      log(req.method, u.pathname, 'ok', `${Date.now() - t0} ms`);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500 && !(e instanceof ApiError)) log('ERROR', req.method, u.pathname, e.stack || e.message);
      send(status, { error: { code: e.code || 'internal', message: e instanceof ApiError ? e.message : `Internal error: ${e.message}`, ...(e.extra || {}) } }, e.extra?.retryAfterSeconds ? { 'Retry-After': String(e.extra.retryAfterSeconds) } : {});
      log(req.method, u.pathname, status, `${Date.now() - t0} ms`);
    }
  };

  const server = http.createServer((req, res) => { handler(req, res); });
  let alertTimer = null;
  const startAlerts = (minutes = +process.env.AIDATLAS_ALERT_MINUTES || 10) => { alertTimer = setInterval(() => checkAlerts().then((r) => r.sent && log(`webhooks: ${r.sent} alert(s) sent`)).catch((e) => log('webhooks:', e.message)), minutes * 60e3); alertTimer.unref?.(); };
  server.on('close', () => { clearInterval(alertTimer); clearInterval(flushTimer); flush(); });
  return { server, newKey, keys, checkAlerts, startAlerts, sign, TIERS: TIERS_, flush };
}

module.exports = { createApi, TIERS, isPrivateIp };

if (require.main === module) {
  const args = process.argv.slice(2);
  const api = createApi();
  if (args[0] === '--new-key') {
    const key = api.newKey(args[1] || 'New organisation', args[2] || 'team');
    console.log(`New ${args[2] || 'team'} key for "${args[1] || 'New organisation'}" (shown once, store it safely):\n${key}`);
    api.flush(); process.exit(0);
  }
  if (!Object.keys(api.keys()).length) {
    const key = api.newKey('Local developer', 'dev');
    console.log(`No API keys yet. Created a developer key (1,000 calls/month), shown once:\n  ${key}\nCreate more with: node server/api.js --new-key "Organisation" team`);
  }
  const port = +process.env.PORT || 8787;
  api.server.listen(port, () => console.log(`AidAtlas API ${VERSION} on http://localhost:${port}/v1/health · docs /v1/openapi.json`));
  api.startAlerts();
}
