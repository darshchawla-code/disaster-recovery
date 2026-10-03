#!/usr/bin/env node
/* Watch-area alerts without a server. Runs on a schedule (GitHub Actions: .github/workflows/watch-alerts.yml)
   or by hand: node tools/watch-alerts.js [watch-areas.json]
   - Reads watch areas (same format the app exports: Live → Watch areas → Export).
   - Pulls live events from GDACS, USGS and NASA EONET with the app's own code (js/data.js).
   - Sends one message per new (area, event, level) to ALERT_WEBHOOK_URL (Slack, Microsoft Teams, Google Chat or Discord).
   - Remembers what it already sent in .watch-state.json so nobody is alerted twice.
   Env: ALERT_WEBHOOK_URL (optional; without it alerts are printed), WATCH_AREAS (JSON, overrides the file), APP_URL (link in messages). */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
['js/core.js', 'js/data.js', 'js/workspace.js'].forEach((f) => require(path.join(ROOT, f)));
const AA = globalThis.AA, W = AA.workspace;

const STATE = process.env.WATCH_STATE || path.join(ROOT, '.watch-state.json');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };

const loadAreas = () => {
  const raw = process.env.WATCH_AREAS ? JSON.parse(process.env.WATCH_AREAS) : readJSON(process.argv[2] || path.join(ROOT, 'watch-areas.json'), null);
  if (!raw) throw new Error('No watch areas: add watch-areas.json (export it from the app) or set WATCH_AREAS.');
  const list = Array.isArray(raw) ? raw : raw.areas || [];
  return list.map((a, i) => ({ id: a.id || 'w' + i, name: a.name || `Area ${i + 1}`, lat: +a.lat, lon: +a.lon, radiusKm: +a.radiusKm || +a.radius_km || 100, hazards: a.hazards || ['EQ', 'TC', 'FL', 'VO', 'DR', 'WF'], minLevel: a.minLevel || a.min_level || 'Orange' }))
    .filter((a) => isFinite(a.lat) && isFinite(a.lon));
};

const message = (m, appUrl) => {
  const e = m.event, hz = (AA.HAZARDS[e.hazard] || {}).label || e.hazard;
  const link = appUrl ? `${appUrl.replace(/\/$/, '')}/app.html?mode=live&event=${encodeURIComponent(e.id)}` : e.url || '';
  return `AidAtlas alert · ${m.level.toUpperCase()} ${hz} near "${m.area.name}" (${Math.round(m.distKm)} km away)\n${e.name}${e.country ? ' · ' + e.country : ''} · source ${e.src}\n${link}`;
};

const post = async (url, text) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }) });
  if (!r.ok) throw new Error(`webhook ${r.status}`);
};

(async () => {
  const areas = loadAreas();
  const { events, errors } = await AA.data.liveEvents();
  const matches = W.matchWatch(areas, events);
  const sent = new Set(readJSON(STATE, []));
  const fresh = matches.filter((m) => !sent.has(m.key));
  console.log(`${areas.length} watch areas · ${events.length} live events · ${matches.length} matches · ${fresh.length} new${errors.length ? ' · feed errors: ' + errors.join('; ') : ''}`);
  const hook = process.env.ALERT_WEBHOOK_URL;
  let failed = 0;
  for (const m of fresh) {
    const text = message(m, process.env.APP_URL);
    if (hook) { try { await post(hook, text); sent.add(m.key); } catch (e) { failed++; console.error('send failed:', e.message); } }
    else { console.log('\n' + text); sent.add(m.key); }
  }
  fs.writeFileSync(STATE, JSON.stringify([...sent].slice(-2000)));
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e.message); process.exit(1); });
