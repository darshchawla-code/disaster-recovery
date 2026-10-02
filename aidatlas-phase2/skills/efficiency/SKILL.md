---
name: efficiency
description: Defines the cost model and solves the multi-commodity allocation MILP (with BPR congestion, fleet-hour budgets, equity terms), consolidates loads with Clarke–Wright savings and allocates casualties to hospitals. Use when changing how resources are moved or what it costs.
---

# Efficiency skill

Goal: the **lowest total allocation cost** that still gets resources to the areas that need
them most, with no idle capacity and no duplicate convoys.

## 1. Cost model (per epoch, defaults in USD, editable)
| Symbol | Meaning | Truck | Responder bus |
|---|---|---|---|
| `c^D` | distance cost (fuel + wear) per km | 1.20 | 0.90 |
| `c^T` | crew time per hour | 40 | 35 |
| `c^F` | fixed dispatch per trip | 150 | 100 |
| `Q` | capacity | 8 000 kg | 30 staff |
| `c^L_k` | loading + unloading per kg | 0.02 | — |

Trip cost `κ_jic = 2·δ_ji·c^D_c + 2·τ_ji·c^T_c + c^F_c` (round trip). Distance cost is charged
per **vehicle trip**, not per unit shipped, because fuel scales with trips; handling cost is
charged per kg.

## 2. Allocation MILP (one epoch, solved with javascript-lp-solver branch & bound)

Variables: `x_jik ≥ 0` shipments, `n_jic ∈ ℤ≥0` trips, `u_ik ≥ 0` unmet, `M ≥ 0`,
`g_ii'k ≥ 0`, `σ_ik ≥ 0`, congestion segments `f_i1, f_i2, f_i3 ≥ 0`.

```
min  α·(Σ κ_jic n_jic + Σ c^L_k w_k x_jik + Σ_i Σ_s ψ_is f_is) / C0
   + Σ_ik π_k (0.5 + N_i) u_ik / D_k          (D_k = Σ_i d_ik, common per-unit scale)
   + (δ/3)·Σ_k π_k M_k + β·Σ g_ii'k / |I|² + μ·Σ σ_ik / D_k
s.t.
 Σ_j x_jik + u_ik = d_ik                          demand balance
 Σ_i x_jik ≤ S_jk                                  supply (open depots only)
 Σ_{k∈K_c} w_k x_jik ≤ Q_c n_jic                   vehicle capacity + compatibility
 Σ_i (2τ_ji + t_srv) n_jic ≤ F_jc · Δt             fleet-hour budget
 Σ_jc n_jic = f_i1 + f_i2 + f_i3, f_i1, f_i2 ≤ κ_i/2   BPR piecewise congestion
 (0.5 + N_i) u_ik / d_ik ≤ M_k                    need-weighted minimax per commodity
 g_ii'k ≥ ±(u_ik/d_ik − u_i'k/d_i'k)                linear Gini, k ∈ K^c
 Σ_j x_jik ≥ φ d_ik − σ_ik                         critical service floor
```
Defaults `α = 1, δ = 2, β = 1, μ = 3, φ = 0.5`. `C0` = cost of serving all demand with direct
trips from each zone's nearest depot (normaliser so cost and equity are on one scale).

**BPR congestion** (Bureau of Public Roads): `τ(v) = τ0 (1 + 0.15 (v/κ)^4)`. The marginal delay
of the v-th vehicle is `τ0 (1 + 0.75 (v/κ)^4)`, evaluated at segment mid-points
`v/κ = 0.25, 0.75, 1.5` → slopes `1.003, 1.24, 4.80`. Segment cost `ψ_is = c^T τ̄_i (slope_s − 1)`.
This is convex, so the LP fills the cheap segment first and spreads convoys instead of
jamming one access road. `κ_i` = 12 relief vehicles per 6 h × (1 − mean road damage).

Exact branch & bound runs when the model has ≤ 40 integer trip variables (2 s limit).
Larger instances use **relax-and-repair**: solve the LP relaxation, round trips up, trim the
largest round-ups until every depot's fleet-hour budget holds (small zones keep their truck),
fix trips and re-solve the LP for shipments. The explainer reports which path was used.

## 3. Load consolidation (Clarke–Wright savings VRP, per depot and vehicle class)
Full loads go direct. Residual loads `r_i < Q` start as single-stop tours. Savings
`s_ab = τ_ja + τ_jb − τ_ab`, merged in descending order while load ≤ Q and tour time ≤ Δt.
Each merge removes one vehicle from the road (reported as "trips saved").

## 4. Casualty transport LP
Maximise expected survivors `Σ_ih e^(−τ_ih/τ_p) p_ih` (τ_p = 1 h) minus unserved penalty, s.t.
`Σ_h p_ih + u^c_i = cas_i`, `Σ_i p_ih ≤ beds_h`, `Σ_ih 2τ_ih p_ih / Q^c ≤ A·Δt`
(`Q^c = 2` patients, `A` ambulances). `cas_i = 0.25 × injured_i` (hospital-level cases).

## Acceptance tests
- Doubling supply never increases total unmet demand.
- With ample supply, the solution has zero unmet demand and cost ≤ naive nearest-depot cost.
- Consolidation never increases vehicle count.
