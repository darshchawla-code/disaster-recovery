# Skill: api (public API and webhooks)

Lets insurers, NGOs and other apps build on AidAtlas; enables data revenue (roadmap Phase 2).

## Code
- `server/api.js` — Node ≥ 18, no framework; loads the same `js/` modules as the browser (one model, two front ends).
  `createApi(opts)` returns `{ server, newKey, keys, checkAlerts, startAlerts, sign }` for tests and embedding.
- `server/openapi.json` — OpenAPI 3.1, served at `/v1/openapi.json`.
- `Dockerfile` — `node:20-alpine`, data volume `/app/server/data`.

## Endpoints
`GET /v1/health` · `GET /v1/openapi.json` (public) · `GET /v1/usage` · `GET /v1/events` · `POST /v1/forecast` ·
`POST /v1/plan` (serialised: the engine holds one plan; queue ≤ 4, 180 s timeout; `worldpop:false` is faster; `inventory` rows or `inventoryUrl`; `?geometry=1`) ·
`GET /v1/risk` (cached 24 h per 0.01°) · `POST /v1/readiness` · `GET|POST /v1/webhooks` · `DELETE /v1/webhooks/{id}` · `POST /v1/webhooks/{id}/test`.
Errors: `{ error: { code, message } }` with 400/401/403/404/405/413/429/503/504.

## Keys, tiers, limits
Keys `aa_…` (random 24 bytes), stored as SHA-256 only (`keys.json`), or `AIDATLAS_KEYS` env JSON. Tiers follow the freemium
plan: dev 1,000/month · 30/min · 2 webhooks; team 50,000 · 60 · 25; agency 500,000 · 300 · 200; enterprise unlimited · 1,200 · 2,000.
Monthly usage persisted (`usage.json`, flushed every 5 s); per-minute sliding window → 429 + Retry-After.

## Webhooks
Watch area per webhook (same matching as the app's watch areas, `W.matchWatch`); checked every `AIDATLAS_ALERT_MINUTES` (10).
Each (area, event, level) delivered once (`sent.json`). Headers: `X-AidAtlas-Event`, `X-AidAtlas-Delivery`,
`X-AidAtlas-Timestamp`, `X-AidAtlas-Signature: v1=hex(HMAC_SHA256(secret, timestamp + "." + body))`. 3 attempts (1 s, 4 s).
SSRF guard: https only; localhost, private, link-local and CGNAT addresses refused (after DNS resolution) unless
`AIDATLAS_ALLOW_PRIVATE_WEBHOOKS=1`.

## Data-source etiquette
All outbound requests carry `User-Agent: AidAtlas-API/<version> (+repo)` (Nominatim policy). Before selling API access,
run your own OSRM/Nominatim/Overpass (see the roadmap's cost section): the public demo servers forbid commercial load.

## Acceptance (tests/api.test.js, data services stubbed)
auth (Bearer and X-API-Key, hashed storage), CORS, 404/405, every endpoint's shape and validation, plan with inventory and
geometry, engine released after each plan, risk 36 cells/top 5, readiness rises with stock, webhook secret shown once,
signature verifies, alerts sent once and only inside area/level, retry, key isolation, https + private-address refusal,
rate limit 429 + Retry-After, monthly quota 429.
