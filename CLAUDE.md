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

## Rules for contributors (human or AI)

1. Predictions are estimates. Every number derived from a model carries its scenario
   band (P10 / P50 / P90) and its provenance (`live`, `historical`, `modelled`, `assumed`).
2. Never present an assumed value (stock levels, unit costs) as observed data. Label it.
3. All allocation decisions come from the solver; the UI never hand-assigns resources.
4. Only first-epoch decisions are executed (rolling horizon). The rest are plans.
5. Every drawn path has a tooltip naming the model chain, and every legend entry links
   to the explainer section that shows the applied calculation with real numbers.
6. Run `npm test` before shipping any change (models, Phase 1 workspace, schema, alerts).
7. Every external read in `ENG.build` goes through `io()` so saved plans can be replayed offline.

## Running

Users open the root `index.html` / `app.html`, which are generated single files.
Edit `src/*.html`, `js/`, `css/`, `assets/`, then run `node tools/build-standalone.js`.
Never ship pages that load local files by relative path: downloads get flattened.
