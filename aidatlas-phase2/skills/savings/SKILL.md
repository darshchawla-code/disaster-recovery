# Skill: savings (cost-saving report)

Shows the return on AidAtlas: the optimised plan against what a control room does by hand.

## Code
- `js/models/savings.js` — `S.nearestStore(pb)`, `S.metrics(pb, plan)`, `S.compare(st)`, `S.headlines(c)`.
- UI: plan panel section `#savingsSec` (`js/ui/app.js` `savingsHtml`), action report section "What this plan saves" (`js/ui/report.js`), explainer `#m-save`, API `/v1/plan → savings`.

## Baseline: nearest-store rule
Same problem object as the MILP (`run.pb`: zones with net demand d_ik, open depots with stock and fleet, τ_ji hours, km).
1. Areas in list order (Z1 = most affected, as requests usually arrive).
2. For each vehicle class, stores sorted by τ_ji; take what the nearest store has of each item, then the next-nearest.
3. Direct trips only: n = min(⌈kg/Q⌉, ⌊fleet-hours left / (2τ + t_s)⌋); deliver the share that fits; deduct stock and hours.
Cost = Σ trips (2·km·c_D + 2·h·c_T + c_F) + truck kg · c_load (same `E.tripCost` as the MILP).

## Metrics (both plans)
cost, cost per tonne, vehicle-hours (optimised: consolidated tours), trips (optimised: after Clarke–Wright),
critical coverage = Σ_{water,medical} min(delivered, d)·kg / Σ d·kg, water share to the top third by need score,
areas with < 50 % of their water, kg-weighted mean drive time, Gini of shortage ratios.
Optimised cost uses trips before consolidation (conservative); congestion cost is excluded from both.

## Acceptance (tests/phase2.test.js)
- baseline never exceeds stock or demand, respects fleet-hour budgets, uses nearest store first;
- scarce stock: optimised gives high-need areas ≥ baseline water share, Gini not worse (+0.05 tolerance);
- plentiful stock: optimised cost per tonne ≤ 1.05 × baseline;
- savings = baseline − optimised; headlines are sentences.
Honesty rule: never claim savings that the numbers do not show; when AidAtlas costs more, say why (delivers more).
