/* Preloaded by tests/watch-alerts.test.js: answers the live feeds offline and records webhook posts. */
const fs = require('fs');
const gd = (type, id, lon, lat, level, name) => ({ geometry: { coordinates: [lon, lat] }, properties: { eventtype: type, eventid: id, name, alertlevel: level, alertscore: { Green: 1, Orange: 2, Red: 3 }[level], episodealertlevel: level, iscurrent: 'true', fromdate: new Date(Date.now() - 864e5).toISOString().slice(0, 19), todate: new Date().toISOString().slice(0, 19), country: 'Nepal', severitydata: { severity: 0 }, url: { report: 'https://gdacs.org/x' } } });
const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('EVENTS4APP')) return json({ features: [gd('FL', 1104124, 85.36, 27.3, 'Red', 'Flood in Nepal'), gd('EQ', 9, 140, 36, 'Green', 'Earthquake in Japan')] });
  if (url.includes('4.5_week')) return json({ features: [] });
  if (url.includes('eonet')) return json({ events: [] });
  if (url.startsWith('https://hooks.example')) { fs.appendFileSync(process.env.HOOK_LOG, init.body + '\n'); return json({ ok: true }); }
  throw new Error('unexpected fetch ' + url);
};
