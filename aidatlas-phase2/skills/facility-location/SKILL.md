---
name: facility-location
description: Recommends where to pre-position relief warehouses using a hazard-safe Maximal Covering Location Problem with p-median tie-break, and sizes their stock to P90 demand. Use in Plan, History and Risk modes.
---

# Facility-location skill

## Candidates
A 5 × 5 grid spanning ±1.6 R around the event plus existing depots, each snapped to the road
network with OSRM `/nearest`. A candidate is **hazard-unsafe** and removed when its predicted
heavy-damage fraction exceeds 0.3 (do not put the warehouse where the disaster will hit it).

## Model — Maximal Covering Location Problem (Church & ReVelle, 1974) + p-median tie-break
```
max  Σ_i N_i · A_i · z_i  −  ε Σ_i Σ_j τ_ij a_ij
s.t. z_i ≤ Σ_{j : τ_ij ≤ T_c} y_j        zone i covered only by a site within T_c
     Σ_j y_j = P
     a_ij ≤ y_j,  Σ_j a_ij = 1             each zone assigned to one open site
     y_j, z_i, a_ij ∈ {0,1}
```
`A_i` = P90 affected population, `N_i` = need score, `T_c = 90 min`, `P = 3`, `ε` small.

## Sizing
Stock at site j = Σ over assigned zones of P90 daily demand × 3 days (72-hour autonomy, the
IFRC pre-positioning norm). Reported per commodity.

## Acceptance tests
- Increasing P never reduces covered need.
- No recommended site lies inside the heavy-damage footprint.
