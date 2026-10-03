# AidAtlas

Forecast the need. Fair-share the aid. Route it fast.

AidAtlas is a browser web app that forecasts where a disaster will hurt, how badly and what it
will need, then allocates and routes relief from real supply stores at the lowest feasible cost,
**by need rather than head-count or proximity**, and re-optimises every 6-hour epoch as roads
close, depots fail, supplies land and the disaster spreads.

## Run it

Double-click **`index.html`** (or `app.html` to go straight to the map). Both are single,
self-contained files: they keep working if you copy, email or flatten them into one folder.
They need an internet connection for the live data, map imagery and four CDN libraries.

Deep links you can bookmark or share:

- `app.html?mode=live&event=top` opens today's most severe event
- `app.html?mode=plan&q=Gurugram&hazard=EQ&mag=7.2` runs a planning scenario (hazard: EQ, TC, FL, WF, VO, DR)
- `app.html?mode=history&q=Kathmandu` lists past disasters near a place
- `app.html?mode=risk&q=Manila` shows the risk grid

Live demo (once GitHub Pages is on): **https://darshchawla-code.github.io/disaster-recovery/** —
enable it in the repo under Settings → Pages → Deploy from a branch → `main` / `/ (root)`. Optional: paste a free TomTom key in **Settings** for live traffic flow.

### Editing

Sources live in `src/` (page shells), `js/`, `css/` and `assets/`. After any change run
`node tools/build-standalone.js` to regenerate the root `index.html` and `app.html`.

## Phase 2: what people pay for (new)

- **Cost-saving report**: every plan is compared with the usual manual rule ("send from the nearest store") on the same demand, stock, vehicles and roads: cost, cost per tonne, vehicle-hours, critical need delivered, water to the highest-need areas, drive times. In the plan panel, the action report and Models → Savings.
- **Pre-season readiness score** (Risk mode → Readiness score): 0–100 per district and per high-risk area: stock and vehicles within 3 h by road vs the worst likely (P90) first 72 hours, with the stock to add before the season. Uses your inventory when connected; otherwise flags stock as assumed.
- **Field app** (`field.html`, works offline on phones): GPS, photo, damage level, needs, road access. Sends automatically to the team's shared workspace (new role *Field team*, table `field_reports`, private photo bucket) or as a WhatsApp/SMS code the control room pastes into the plan. Applying a report runs the Bayesian severity update and closes blocked roads.
- **Public API and webhooks** (`server/api.js`, `npm run api`): `/v1/events`, `/v1/forecast`, `/v1/plan`, `/v1/risk`, `/v1/readiness`, `/v1/webhooks` (HMAC-signed alerts). API keys with the freemium tiers (dev 1,000 · team 50,000 · agency 500,000 calls a month), rate limits, OpenAPI at `/v1/openapi.json`, `Dockerfile` for hosting. Same model code as the app.
- Shared back end: re-run `supabase/schema.sql` (safe to re-run) to add field reports and the photo bucket.

## 3D map

The map opens in 2D (fastest to load); the **2D | 3D** switch at the top right of the map turns on 3D: a spinning globe of live disasters, then
satellite imagery on real terrain with 3D buildings, affected areas as columns (height = people
affected, colour = need), storage sites as purple columns and the risk grid as rising squares.
Drag to move, right-drag or Ctrl+drag (two fingers on phones) to tilt and rotate; hover and click
work as in 2D. The 3D engine is only downloaded when 3D is chosen; the choice is remembered; `&view=2d` / `&view=3d` in a
link forces either. Built on MapLibre GL 5 (`js/ui/map3d.js`), Mapzen/AWS terrain and OpenFreeMap buildings.

## Phase 1: workspace and accuracy

- **Roles**: viewer, planner, admin (Workspace button). Local by default; real access control with the optional Supabase back end (`supabase/schema.sql`, row-level security).
- **Saved plans**: save, version, reopen exactly (offline replay of recorded inputs and decisions), or share as a `.json` plan file.
- **Decision log**: every change with time, person, role and an optional note; CSV export for audits.
- **Watch areas**: alert when a live event in your area reaches Orange/Red; browser notifications while open, and an hourly GitHub Action (`.github/workflows/watch-alerts.yml`) that posts to Slack/Teams/Google Chat/Discord when closed.
- **Live inventory**: Google Sheet, CSV or JSON link as the stock and fleet source, auto-synced while a plan is open.
- **Accuracy**: WorldPop 2020 population per area, GDACS flood outlines, GloFAS river flow at each area for live floods, USGS PAGER loss estimates for earthquakes.

Tests: `npm install && npm test` (models, Phase 1, Phase 2, API, addresses, alert checker, database schema in PGlite).

## Author

Built by [@Darshchawla](https://github.com/darshchawla-code).

## Reports and guide

- **Action reports**: every mode has a report button (situation, action, history and preparedness reports) written in plain English for the Met department and disaster authorities. You can print or save them as PDF, copy them as text, or download them.
- **Key actions now**: every plan shows the most important next steps in the side panel and in a box on the map.
- **User guide**: open `guide.html` (also the **Guide** button in the app) for every mode, button, map symbol and term.

## The four modes

| Mode | What it does |
|---|---|
| **Live** | Pulls GDACS, USGS and NASA EONET, ranks current events by the Unified Severity Index, shows the top 5. Click one for the full plan. |
| **Plan** | Search any address or click the map, choose a hazard and intensity; the full plan runs as if it happens there, plus recommended storage sites. |
| **History** | The 5 most recent major disasters within 300 km of a place (GDACS since 2000, USGS since 1900, EONET), each replayed with optimal aid paths and storage sites. |
| **Risk** | A 6 × 6 risk grid (~120 km) from Gutenberg–Richter seismicity, Gumbel flood return levels on 20 years of GloFAS discharge, storm/fire/volcano records, population, hospital access and World Bank coping capacity; top 5 high-risk areas and storage that covers them. |

Every plan shows: green affected area and demand zones, red supply stores (real OpenStreetMap
facilities), purple recommended storage, routed truck/bus paths with model tooltips, ambulance
flows to hospitals, air-drop flags where no road survives, and a legend whose model names open
the explainer with the **applied calculation for that run**.

## The models (see `skills/`)

- **Prediction** — intensity attenuation (MMI) / Holland-type wind decay, fragility curves,
  USGS PAGER country fatality curves (model 3.1; indicative until re-validated), 400-draw Monte Carlo → P10/P50/P90, Swanson–Megill scenario
  weights, Gaussian Bayesian update from field reports.
- **Fairness** — normalised need score (severity, people at risk, vulnerability, access,
  received), Sphere-standard demand netted against deliveries, need-weighted minimax per
  commodity, linearised Gini, critical service floor.
- **Efficiency** — multi-commodity MILP with trip integers, vehicle capacity and compatibility,
  fleet-hour budgets, BPR congestion (piecewise-linear), Clarke–Wright load consolidation,
  survival-weighted casualty LP.
- **Routing** — OSRM shortest paths (Contraction Hierarchies) with alternatives, damage-adjusted
  speed, closure buffers, detours, road-damage recovery dynamics, air-drop fallback.
- **Facility location** — hazard-safe Maximal Covering Location Problem with p-median tie-break,
  72-hour P90 sizing.
- **Dynamic response** — rolling horizon; surge, served, depot offline, breakdown, road closure,
  aftershock, new supplies, congestion, spread, field report, advance epoch.

## Phase 3: accuracy, teamwork, offline, partner tools

- **Accuracy page** (`validation.html`): back-test of the earthquake forecast against 44 NOAA NCEI earthquakes (2001–2025, 250+ deaths): forecast range vs reported toll per event, coverage, typical error, bias; CSV/JSON download; `npm run backtest`; API `/v1/backtest`.
- **Model cards** for every hazard model and the optimiser, with an honest status (back-tested, calibrated, tested, indicative); API `/v1/model-cards`.
- **Tasks and comments** on every plan: assign, due date, area, status; comments from every role; live for the whole team with the shared back end (Supabase Realtime).
- **Offline field mode**: app, field app, guide and accuracy page open without a signal; map areas already viewed stay available; plans saved offline sync on reconnect. **Low-bandwidth mode** in Settings.
- **Exports**: GeoJSON (ArcGIS, QGIS), HXL CSV (HDX), needs/dispatch/task CSV (Sahana Eden); KoboToolbox/ODK import with a ready XLSForm (`examples/aidatlas-field-xlsform.xlsx`).

If your shared back end was set up before Phase 3, run `supabase/schema.sql` again (it is safe to re-run) to add the task and comment tables.

## Honest limits

- Fragility and fatality parameters are representative global values, not country-calibrated.
- Stock and fleet at real facilities are **assumptions by facility type** (scaled by the
  supply-level slider) until you replace them with your own inventory.
- Public OSRM, Overpass and Nominatim servers are rate-limited demo services; for operational use
  self-host them.
- Live traffic needs a TomTom key; without it the moving vehicles are a simulation.

## Tests

```bash
npm install
npm test        # models, Phases 1–3, API, addresses, alert checker, database schema (PGlite)
```

## Data sources

GDACS (UN OCHA / EC JRC), USGS Earthquake Hazards Program, NASA EONET, OpenStreetMap via
Nominatim / Overpass / OSRM, Open-Meteo (forecast, elevation, GloFAS flood), World Bank Open Data,
Esri World Imagery, Mapzen Terrain Tiles (AWS Open Data), OpenFreeMap; 3D rendering by MapLibre GL. Respect each provider's terms and rate limits.
