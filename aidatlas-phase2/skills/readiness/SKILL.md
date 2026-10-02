# Skill: readiness (pre-season readiness score)

"Is this district stocked for the season?" — a number a government officer can put in a budget request.

## Code
- `js/models/readiness.js` — `RD.need72(zones)`, `RD.storesFromRows(rows)`, `RD.storesFromFacilities(facs)`, `RD.score(areas, stores, tau)`.
- `js/pipelines.js` — `PL.risk(place)` (risk grid, shared by app and API), `PL.scenario(cell, rr)` (design disaster), `PL.readiness(rr, {rows})`.
- UI: Risk mode → "Readiness score" (`js/ui/app.js` `runReadiness`, `readinessHtml`), report `AA.report.readiness`, explainer `#m-ready`. API: `POST /v1/readiness`.

## Method
1. Areas = the top-5 risk cells. Design scenario per area: dominant hazard; EQ magnitude M = (a − log10(1/475)) / b from
   Gutenberg–Richter, clamped 6.5–8; TC 200 km/h, FL 0.8, WF 0.8, VO 0.9, DR 0.7 (Plan-mode defaults).
2. Forecast zones (`P.buildZones` + `P.forecast`); 72-h P90 need N_k with the Sphere rates (flows × 3 days, targets once) —
   identical to storage-site sizing (`FL.size`).
3. Stores: inventory rows (water_l/1000 → kL, food_kg/1000 → t, tents, medkits, staff, trucks, buses) or OSM facilities
   with `ENG.STOCK` assumptions (labelled "assumed by facility type").
4. A store counts for an area if road time ≤ `RD.REACH_HOURS` (3 h; OSRM table, else straight line × circuity / 40 km/h)
   and its severity in that scenario < 0.6.
5. r_k = min(1, S_k / N_k); vehicles r_veh = min over truck/bus of capacity in 72 h (n·⌊72/(2τ+t_s)⌋·Q) / need kg.
   score_a = 100 (Σ π_k r_k + 2 r_veh) / (Σ π_k + 2), π = criticality. District = P90-affected-weighted mean.
6. Gaps = max shortfall per item over the five areas (enough for any one area); vehicles likewise.
Grades: ≥ 80 Ready · 50–79 Partly ready · < 50 Not ready.

## Acceptance (tests/phase2.test.js)
huge stock → 100 and no gaps; no stores → 0 and gap = largest single-area need; > 3 h away or inside the damage zone
does not count; monotone in stock; no trucks lowers the score and adds a truck gap; district = weighted mean;
unit conversion of inventory rows; design magnitude formula; pipeline end to end.
