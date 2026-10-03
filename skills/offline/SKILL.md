# Skill: offline (offline field mode and low bandwidth)

Keep working when the network is slow or gone.

## Code
- `sw.js` (cache version v3): pages network-first (cached copy offline); libraries stale-while-revalidate; map tiles cache-first, newest 4,000, only tiles already viewed; live feeds network-first with the last copy offline, marked by header `X-AidAtlas-Offline-Copy`. Only `res.ok` responses are cached. Answers `aa-offline-status` with cache counts.
- `js/ui/map.js`: tile layers with `crossOrigin: true` (non-opaque, so the quota is not inflated); base layer street map in low-bandwidth mode.
- `js/data.js`: `D.offlineCopy` when a feed came from the cache.
- `js/workspace.js`: saves made offline in cloud mode go to `pendingCloud`; `plans.syncPending()` on reconnect.
- `js/ui/app.js`: Settings `#sLow`, `#sOffline`; offline/online banner; service worker registered on http(s).

## Low-bandwidth mode (`AA.config.lowBandwidth`)
Street map instead of satellite; no WorldPop; no address lookups; no 3D.

## Rules
- Never bulk-download or prefetch tiles: OpenStreetMap and Esri tile policies forbid it.
- Always tell the user when data is an offline copy.

## Acceptance
tests/phase3.test.js (low-bandwidth engine path, pending saves) · E2E with a local server and `setOffline`: app.html and field.html open offline, banner, low-bandwidth toggle.
