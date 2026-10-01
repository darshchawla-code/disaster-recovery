---
name: fairness
description: Computes the need score and Sphere-standard demand per zone and defines the equity terms (need-weighted shortage ratio, minimax, linearised Gini, critical-resource service floor) used by the allocator. Use when changing who gets how much.
---

# Fairness skill

Resources follow **relative need**, not raw population or proximity. A dense area with
moderate damage and a small area with extreme damage are compared on the same footing.

## 1. Normalisation (min–max across zones, ε = 1e-6)
`x̃ = (x − min x) / (max x − min x + ε)` for severity, population at risk and received.
Vulnerability `vul ∈ [0,1]` and accessibility difficulty `acc ∈ [0,1]` are already normalised.

## 2. Need score
`N_i = w1·sẽv_i + w2·põp_i + w3·vul_i + w4·acc_i − w5·rẽcv_i`, clipped to `[0, 1]`.
Defaults `w = (0.35, 0.20, 0.20, 0.15, 0.10)`. Population carries a lower weight than
severity on purpose; absolute demand already scales with people, so a large weight here
would double-count size.

- `vul_i` = 0.5·(rural share: hamlet/village 1, town 0.6, city 0.3) + 0.5·country index
  (World Bank: beds per 1000 and GDP per capita, inverted and normalised).
- `acc_i` = normalised travel time from the nearest open depot × (1 + mean road damage).

## 3. Demand per epoch (Sphere Handbook 2018 minimums; planning ratios labelled)
| k | Unit | Rule (per 24 h, scaled by Δt/24 except shelter) | Weight |
|---|---|---|---|
| water (critical) | kL | 15 L × displaced + 3 L × (affected − displaced) | 1000 kg/kL |
| food | t | 0.6 kg × displaced + 0.3 kg × (affected − displaced) | 1000 kg/t |
| shelter | tents | displaced / 5 (family tent, 3.5 m²/person), one-off | 35 kg |
| medical (critical) | modules | injured / 50 + affected / 1000 | 50 kg |
| personnel | staff | injured / 20 + displaced / 500 | 1 seat |

Demand is netted against what already arrived: `d_ik = max(0, D_ik − recv_ik)`. This stops
a second convoy going to a zone that is already covered.

## 4. Equity terms in the allocator (all linear)
- Shortage ratio `q_ik = u_ik / (d_ik + ε)` (linear because `d` is data).
- Need-weighted shortage `Σ_i Σ_k π_k (0.5 + N_i) u_ik / D_k`, with `D_k = Σ_i d_ik`. Every unit
  of a commodity is valued on the same scale in every zone, tilted only by need. (Dividing by each
  zone's own `d_ik` was tested and rejected: it makes the solver fill tiny zones first.)
- Need-weighted minimax per commodity `(0.5 + N_i)·q_ik ≤ M_k` — shortage ratios are equalised
  across zones, with higher-need zones held to a lower shortage ratio. This is what stops a large
  or cheap-to-reach zone from absorbing the supply.
- Linearised Gini (mean absolute difference) `g_ii'k ≥ ±(q_ik − q_i'k)`, critical k only.
  The classical Gini divides by the mean, which is non-linear; the unnormalised mean
  difference keeps the model a MILP.
- Service floor for critical resources `Σ_j x_ijk ≥ φ·d_ik − σ_ik`, `φ = 0.5` default, slack penalised.

Criticality `π = (water 3, medical 3, food 2, personnel 2, shelter 1.5)`.

## Acceptance tests
- Two zones with equal need score receive equal shortage ratios when supply is scarce.
- Raising a zone's population ×10 at constant severity does not raise its shortage priority above a zone with higher severity and equal vulnerability.
- A zone with `recv ≥ D` gets zero new deliveries.
