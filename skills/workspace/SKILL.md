# Skill: workspace

People, roles, saved plans, the decision log, watch areas and live inventory. Phase 1 of the roadmap.

## Code
- `js/workspace.js` — roles, local profile/team, plan store, decision-log CSV, watch-area matching, inventory parsing (browser + node).
- `js/cloud.js` — optional Supabase back end (e-mailed 6-digit code sign-in, teams, shared plans and watch areas).
- `supabase/schema.sql` — tables + row-level security; the database, not the browser, enforces roles.
- `js/ui/workspace-ui.js` — Workspace modal, plan "Save, share and decision log" section, saved-plans list, watch-area panel.
- `js/engine.js` — `ENG.snapshot`, `ENG.restore`, `ENG.decide`, role check in `ENG.event`.
- `tools/watch-alerts.js` + `.github/workflows/watch-alerts.yml` — alerts while the app is closed.

## Roles
| Role | view/report | edit plan | save | watch areas | inventory | team, settings |
|---|---|---|---|---|---|---|
| viewer | ✓ | | | | | |
| planner | ✓ | ✓ | ✓ | ✓ | ✓ | |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
Local mode stores the role in the browser (convenience, not security). Cloud mode reads it from `members.role`; RLS policies use `role_in(team_id)`.

## Saved plans (exact replay)
`ENG.build` routes every external read through `io(key, fn)`; results (or errors) are kept in `state.inputs`:
`reverse, country, nearest, footprint, places, facs, relief, worldpop, flow, pager, reported, table0`.
A snapshot = `{ v:1, name, sit0 (situation before build), opts, inputs, events, decisions, summary }`.
`ENG.restore` rebuilds with `opts.snapshot = inputs` (no network for recorded keys) and replays `events` with `meta.replay`.
`advance` events carry the executed shipments and casualty moves, so stock, deliveries and hospital beds are reproduced
exactly; the open epoch is re-optimised (MILP stops within its 2 % gap, so its cost may differ slightly).

## Decision log
`ENG.decide(type, p, reason, note)` appends `{at, epoch, by, role, type, reason, note}`. Every non-replayed `ENG.event`
logs one entry; the UI passes the "Note for the log" text as `meta.note`. Export: `W.decisionsCSV`.

## Watch areas
`{name, lat, lon, radiusKm 5–1000, hazards[], minLevel Green|Orange|Red}`. Event level = GDACS current episode level,
else USGS PAGER (yellow→Orange, orange/red→Red), else Green (EQ ≥ M6.5 → Orange).
`W.matchWatch(areas, events)` is pure and shared with `tools/watch-alerts.js`; `W.newMatches` de-duplicates by
`area|event|level` so each alert fires once.

## Inventory
Sources: Google Sheets link (converted to CSV export), any CSV or JSON URL. `W.normaliseRows` accepts common column
spellings and drops rows without a valid location. Applied through the `importDepots` event (logged, replayable).
Auto-sync interval 0/5/15/30/60 min while a plan is open; re-applied only when the rows change.

## Acceptance tests
- `tests/phase1.test.js` — roles, plans, versions, CSV, watch matching/dedupe, inventory parsing, cloud adapter (fake
  client), engine snapshot → restore offline with identical stock and decisions, viewer refused.
- `tests/schema.test.mjs` — schema.sql in real Postgres (PGlite): viewer read-only, outsider sees nothing, planner cannot
  self-promote, versions kept, bad watch values rejected.
- `tests/watch-alerts.test.js` — scheduled checker sends once, never twice.
