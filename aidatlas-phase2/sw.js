/* AidAtlas service worker: lets the field app (field.html) open with no signal.
   Network first (always the newest version when online), the cached copy when offline. */
const CACHE = 'aidatlas-field-v1';
const PRECACHE = ['field.html', 'field.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mine = url.origin === location.origin && /\/(field\.html|field\.webmanifest)$/.test(url.pathname);
  const lib = /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js|fonts\.(googleapis|gstatic)\.com/.test(req.url);
  if (!mine && !lib) return; // everything else (data APIs, uploads) goes straight to the network
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || new Response('Offline and not cached yet. Open the field app once with a signal.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))));
});
