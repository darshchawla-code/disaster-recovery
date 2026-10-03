/* AidAtlas service worker: the app keeps working when the network fails.
   - App pages (map, field app, guide, validation): network first, the cached copy when offline.
   - Libraries (Leaflet, KaTeX, LP solver, MapLibre, Supabase, fonts): cached copy first, refreshed in the background.
   - Map tiles you have already looked at: cached (newest 4,000), so those areas still show offline.
     Tiles are never bulk-downloaded: OpenStreetMap and Esri tile policies forbid it.
   - Live disaster feeds (GDACS, USGS, NASA EONET): network first; offline, the last copy is used and the app says so.
   Everything else (routing, uploads, the shared back end) goes straight to the network. */
const V = 'v3';
const SHELL = `aidatlas-shell-${V}`, LIBS = `aidatlas-libs-${V}`, TILES = 'aidatlas-tiles', FEEDS = 'aidatlas-feeds';
const PAGES = ['index.html', 'app.html', 'field.html', 'guide.html', 'validation.html', 'field.webmanifest'];
const MAX_TILES = 4000;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => Promise.all(PAGES.map((p) => c.add(p).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => /^aidatlas-(shell|libs|field)-/.test(k) && ![SHELL, LIBS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

const kind = (url) => {
  if (url.origin === self.location.origin) return /\.(html|webmanifest)$|\/$/.test(url.pathname) ? 'page' : null;
  if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.host)) return 'lib';
  if (/server\.arcgisonline\.com|tile\.openstreetmap\.org/.test(url.host)) return 'tile';
  if (/gdacs\.org\/gdacsapi\/api\/events\/geteventlist\/EVENTS4APP|earthquake\.usgs\.gov\/earthquakes\/feed|eonet\.gsfc\.nasa\.gov/.test(url.href)) return 'feed';
  return null;
};
const put = (name, req, res) => { if (res && res.ok) { const copy = res.clone(); caches.open(name).then((c) => c.put(req, copy)); } return res; };
let trimming = false;
const trimTiles = async () => {
  if (trimming) return; trimming = true;
  try { const c = await caches.open(TILES); const ks = await c.keys(); for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]); } finally { trimming = false; }
};
const offline = (msg) => new Response(msg, { status: 503, headers: { 'Content-Type': 'text/plain' } });

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url), k = kind(url);
  if (!k) return;
  if (k === 'page') {
    e.respondWith(fetch(req).then((r) => put(SHELL, req, r)).catch(async () => (await caches.match(req, { ignoreSearch: true })) || offline('Offline and this page is not saved yet. Open AidAtlas once with a signal.')));
  } else if (k === 'lib') {
    e.respondWith(caches.match(req).then((hit) => { const net = fetch(req).then((r) => put(LIBS, req, r)).catch(() => hit || offline('Library not cached yet.')); return hit || net; }));
  } else if (k === 'tile') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { put(TILES, req, r); trimTiles(); return r; }).catch(() => offline('Tile not cached.'))));
  } else if (k === 'feed') {
    e.respondWith(fetch(req).then((r) => put(FEEDS, req, r)).catch(async () => {
      const r = await caches.match(req); if (!r) return offline('Live feed unreachable and no saved copy.');
      const h = new Headers(r.headers); h.set('X-AidAtlas-Offline-Copy', '1');
      return new Response(await r.blob(), { status: 200, headers: h });
    }));
  }
});

// The page asks how much is saved for offline use
self.addEventListener('message', async (e) => {
  if (e.data !== 'aa-offline-status') return;
  const n = async (name) => (await (await caches.open(name)).keys()).length;
  e.source?.postMessage({ type: 'aa-offline-status', pages: await n(SHELL), libs: await n(LIBS), tiles: await n(TILES), feeds: await n(FEEDS) });
});
