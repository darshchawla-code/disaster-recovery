# AidAtlas — skills-driven build guide

AidAtlas forecasts where a disaster will hurt, how badly, and what it will need, then
allocates and routes relief at the lowest feasible cost **by need, not by population or
proximity**, and re-optimises every epoch as supply and demand change.

The codebase is organised as **skills**. Each skill in `skills/<name>/SKILL.md` is the
single source of truth for one component: its purpose, its mathematics, its inputs and
outputs, the file that implements it, and the acceptance tests it must pass. Change the
SKILL.md first, then the code, then the test.

## Skill map

| Skill | Owns | Code |
|---|---|---|
| `orchestrator` | The adaptive loop Predict → Need → Allocate → Route → Dispatch → Monitor → Re-optimise | `js/engine.js` |
| `data-ingestion` | Every external API, fallbacks, caching, provenance labels | `js/data.js` |
| `prediction` | Hazard intensity, damage, affected population, casualties, Monte-Carlo scenarios, Bayesian update | `js/models/prediction.js` |
| `fairness` | Need score, demand (Sphere standards), Gini / minimax / service-floor terms | `js/models/fairness.js` |
| `efficiency` | Cost model, stochastic MILP allocation, BPR congestion, Clarke–Wright consolidation, casualty LP | `js/models/efficiency.js` |
| `routing` | Road paths (OSRM), alternative selection, closures, road-damage dynamics | `js/models/routing.js` |
| `facility-location` | Pre-positioning warehouses (MCLP + p-median, hazard-safe) | `js/models/facility.js` |
| `risk-assessment` | Multi-hazard risk grid (INFORM), Gutenberg–Richter, Gumbel floods | `js/models/risk.js` |
| `dynamic-response` | Events that change supply/demand/network and trigger re-solve | `js/engine.js` |
| `modes` | Live, Plan, History, Risk workflows | `js/ui/app.js` |
| `workspace` | Roles, saved plans + exact replay, decision log, watch areas + alerts, live inventory, optional Supabase back end | `js/workspace.js`, `js/cloud.js`, `js/ui/workspace-ui.js`, `supabase/schema.sql`, `tools/watch-alerts.js` |
| `ui-sketch` | Pencil-sketch visual language, map layers, legend, explainer | `css/`, `assets/`, `js/ui/` |
| `savings` | Optimised plan vs the nearest-store rule (cost, vehicle-hours, critical coverage, equity) | `js/models/savings.js` |
| `readiness` | Pre-season readiness score: stock + vehicles in reach vs P90 72-h need per high-risk area | `js/models/readiness.js`, `js/pipelines.js` |
| `field-app` | Field reports: phone app (offline outbox, GPS, photo), WhatsApp code, shared sync, Bayesian apply | `src/field.html`, `js/field.js`, `js/field-page.js`, `js/ui/field-ui.js`, `sw.js` |
| `api` | Public JSON API, keys, quotas, rate limits, signed webhooks, OpenAPI | `server/api.js`, `server/openapi.json`, `Dockerfile` |
| `backtest` | Back-test of the earthquake forecast against 44 NOAA NCEI events, scoring, accuracy page, model cards | `js/models/backtest.js`, `js/models/cards.js`, `js/ui/validation.js`, `src/validation.html`, `tools/backtest.js` |
| `collab` | Shared live plan: tasks (assign, due, status) and comments; Supabase tables + Realtime | `js/collab.js`, `js/ui/collab-ui.js`, `supabase/schema.sql` |
| `offline` | Service worker caches, low-bandwidth mode, offline save queue | `sw.js`, `js/ui/app.js`, `js/workspace.js`, `js/ui/map.js` |
| `exports` | GeoJSON, HXL CSV, needs/dispatch/task CSV, KoboToolbox CSV import, XLSForm | `js/exports.js`, `tools/make-xlsform.py`, `examples/aidatlas-field-xlsform.xlsx` |

## Rules for contributors (human or AI)

1. Predictions are estimates. Every number derived from a model carries its scenario
   band (P10 / P50 / P90) and its provenance (`live`, `historical`, `modelled`, `assumed`).
2. Never present an assumed value (stock levels, unit costs) as observed data. Label it.
3. All allocation decisions come from the solver; the UI never hand-assigns resources.
4. Only first-epoch decisions are executed (rolling horizon). The rest are plans.
5. Every drawn path has a tooltip naming the model chain, and every legend entry links
   to the explainer section that shows the applied calculation with real numbers.
6. Run `npm test` before shipping any change (models, Phases 1–3, API, addresses, alerts, schema).
7. Every external read in `ENG.build` goes through `io()` so saved plans can be replayed offline.
8. Never claim accuracy a model card does not support: a hazard is "back-tested" only with a scored back-test.
9. The earthquake model must not get worse than the best live back-test (`tests/baseline/backtest-3.1.0.json`: 23 of 38 inside, typical error ×12.7). Before releasing any change to `js/models/prediction.js`, `fatality-params.js` or the zone/population logic: re-run the back-test on the live site, then `node tools/backtest-compare.js <new-run.json>`; if it exits 1, do not release. The golden-value test in `tests/phase3.test.js` flags any unintended drift.

## Running

Users open the root `index.html` / `app.html`, which are generated single files.
Edit `src/*.html`, `js/`, `css/`, `assets/`, then run `node tools/build-standalone.js`.
Never ship pages that load local files by relative path: downloads get flattened.
