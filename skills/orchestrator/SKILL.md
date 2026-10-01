---
name: orchestrator
description: Runs the AidAtlas adaptive loop (predict, assess need, allocate, route, dispatch, monitor, re-optimise) on a rolling horizon. Use when wiring models together or changing epoch logic.
---

# Orchestrator skill

## Purpose
Turn one disaster *situation* into an executable, continuously refreshed relief plan.
Prediction prepares resources in advance, fairness decides how much each area should get,
efficiency decides how to deliver it at least cost, and the loop repeats as conditions change.

## The loop (one epoch, default Δt = 6 h, look-ahead H = 4 epochs = 24 h)

```
Observe state  →  Predict (P10/P50/P90)  →  Need score N_i  →  Demand d_ik (net of received)
      ↑                                                                   ↓
Update state  ←  Dispatch first-epoch decisions only  ←  Route  ←  MILP allocation
```

1. **Observe** `S_t = (inventory I_jk, received recv_ik, road state θ_ℓ, closures, depot status, vehicles)`.
2. **Predict** with `prediction` skill → scenarios `s ∈ {low, base, high}` with Swanson–Megill
   weights `p = (0.3, 0.4, 0.3)`.
3. **Need** with `fairness` skill → `N_i ∈ [0,1]`.
4. **Demand** `d_ik = max(0, Σ_s p_s D_iks · ramp(t) − recv_ik)` (duplication guard).
5. **Allocate** with `efficiency` skill (MILP) → shipments `x_jik`, vehicle trips `n_ji`.
6. **Route** with `routing` skill → road geometry, times, closures respected.
7. **Dispatch** only epoch-t decisions (non-anticipativity by construction).
8. **Update** `recv ← recv + x`, `I ← I − x + b` (replenishment), `θ ← max(0, θ(1−ρ)+η)`.

## State object (`AA.engine.state`)
`{ situation, zones[], depots[], vehicles, closures[], epoch, log[], lastRun }`
`lastRun` holds every intermediate number so the explainer can show applied calculations.

## Acceptance tests
- Advancing an epoch with no events reduces total unmet demand or keeps it equal.
- Taking a depot offline never leaves its stock allocated.
- Re-running with identical state returns identical allocation (deterministic seed).
