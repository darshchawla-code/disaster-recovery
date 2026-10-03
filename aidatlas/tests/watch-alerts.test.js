/* tools/watch-alerts.js end to end with offline feeds: alerts once, never twice. Run: node tests/watch-alerts.test.js */
const { execFileSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-watch-'));
const env = { ...process.env, WATCH_STATE: path.join(dir, 'state.json'), HOOK_LOG: path.join(dir, 'hook.log'), ALERT_WEBHOOK_URL: 'https://hooks.example/abc', APP_URL: 'https://example.org/aidatlas',
  WATCH_AREAS: JSON.stringify([{ name: 'Bagmati', lat: 27.7, lon: 85.3, radiusKm: 100, hazards: ['FL'], minLevel: 'Orange' }, { name: 'Tokyo', lat: 35.7, lon: 139.7, radiusKm: 200, hazards: ['EQ'], minLevel: 'Orange' }]) };
const run = () => execFileSync(process.execPath, ['-r', path.join(__dirname, 'fixtures', 'mock-fetch.js'), path.join(__dirname, '..', 'tools', 'watch-alerts.js')], { env, encoding: 'utf8' });
let pass = 0, fail = 0;
const t = (n, ok) => { if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };
const out1 = run();
const posts1 = fs.readFileSync(env.HOOK_LOG, 'utf8').trim().split('\n');
t('first run: one alert (Red flood inside Bagmati); Green quake near Tokyo ignored', posts1.length === 1 && /RED Flood near "Bagmati"/.test(JSON.parse(posts1[0]).text) && /1 new/.test(out1));
t('alert links back to the event in the app', /app\.html\?mode=live&event=FL-1104124/.test(JSON.parse(posts1[0]).text));
t('message works for Slack/Teams/Google Chat (text) and Discord (content)', (() => { const b = JSON.parse(posts1[0]); return b.text && b.content === b.text; })());
const out2 = run();
t('second run: nothing sent again', fs.readFileSync(env.HOOK_LOG, 'utf8').trim().split('\n').length === 1 && /0 new/.test(out2));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
