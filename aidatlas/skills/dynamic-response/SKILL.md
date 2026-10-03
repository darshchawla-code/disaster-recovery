---
name: dynamic-response
description: Defines the events that change supply, demand or the network during a response and how each one updates state and triggers re-optimisation. Use when adding a new kind of change or when allocation must react.
---

# Dynamic-response skill

The plan is never fixed at t = 0. Each event mutates the state and immediately re-runs
need → MILP → routing. The change log records what moved and why.

| Event | State change | Effect after re-solve |
|---|---|---|
| Demand surge in zone i | `D_ik ← D_ik × (1 + g)` | more vehicles redirected to i |
| Zone sufficiently served | `recv_ik ← D_ik` | zone drops out; its supply is reassigned |
| Depot / warehouse offline | depot `open = false` | its stock and fleet are removed; others cover |
| Vehicle breakdown | `F_jc ← F_jc − 1` | fleet-hour budget shrinks |
| Road closed (map click) | add closure point | routes recomputed; air-drop flag if isolated |
| Aftershock / new damage | `θ ← θ + η` near point, intensity +0.5 | slower roads, more demand |
| New supplies arrive | `S_jk ← S_jk + Δ` | solver places them where most urgent |
| Congestion | travel times × factor | BPR capacities fall, convoys spread |
| Disaster spreads | add new zone at map click | resources reallocated to the new zone |
| Field report | Bayesian update of `sev_i` | need score and demand re-estimated |
| Advance epoch (+6 h) | `recv += x`, `I −= x`, `I += b`, `θ` recovers, ramp advances | rolling-horizon step |
| Live refresh (Live mode, 10 min) | re-pull GDACS/USGS; magnitude change → Bayesian update | predictions refresh |

## Change log entry
`{ epoch, event, Δunmet (by commodity), Δcost, trips redirected [from → to] }`

## Acceptance tests
- Every event produces a log entry and a fresh `lastRun`.
- After "Depot offline" no shipment originates at that depot.
- After "Zone sufficiently served" that zone receives nothing in the next solve.
