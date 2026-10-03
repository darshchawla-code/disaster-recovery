---
name: prediction
description: Forecasts hazard intensity, damage, affected and displaced population, casualties and their uncertainty (Monte-Carlo P10/P50/P90) per demand zone, with Bayesian updating as reports arrive. Use when touching any forecast number.
---

# Prediction skill

Predictions are **estimates, not guarantees**. Every output is a distribution summarised as
P10 / P50 / P90 and turned into three scenarios with Swanson–Megill weights
`p_low = 0.3, p_base = 0.4, p_high = 0.3`. Resources are planned on the expected value and
pre-positioned for P90, so the plan stays flexible when the real event differs.

## 1. Hazard intensity at distance r (km) from the source

| Hazard | Model | Parameters |
|---|---|---|
| Earthquake | Intensity attenuation `I(r) = a + b·M − c·log10(√(r² + h²))`, MMI scale | `b = 1.5, c = 4.0, h = depth (default 10 km)`; `a = 2.5` (calibrated to typical USGS ShakeMaps: M7.2 → MMI ≈ 8.7 near-field, 6.5 at 50 km, 5.3 at 100 km) or set so `I(0)` equals the USGS observed MMI when the feed reports it. Large ruptures are not points: distance is shortened to `r_eff = max(0, r − L/4)` with rupture length `log10 L = −2.44 + 0.59 M` (Wells & Coppersmith 1994) |
| Tropical cyclone | Holland-type radial decay `V(r) = Vmax` for `r ≤ Rmax`, `Vmax·(Rmax/r)^0.7` beyond | `Rmax = 30 km`, `Vmax` from GDACS (km/h) |
| Flood | Hazard score `s(r) = s0 · exp(−r / L)` | `s0` from GDACS alert (0.35/0.65/0.9) blended with GloFAS discharge anomaly `Q/Q50`; `L = 0.5 R` |
| Wildfire | Burn-front score `s(r) = 1` for `r ≤ R_burn`, then `exp(−(r−R_burn)/5)` | `R_burn = √(A/π)` from burned area |
| Volcano | Exclusion `s(r) = 1` for `r ≤ 10 km`, `exp(−(r−10)/10)` beyond | — |
| Drought | Uniform `s = s0` inside affected polygon radius | `s0` from alert |

## 2. Damage and population impact (fragility curves)

Earthquake (MMI, normal fragility on the intensity scale, Φ = standard normal CDF):
- affected fraction `f_aff = Φ((I − 6.5)/0.8)` (strong shaking and above)
- displaced fraction `f_dis = 0.4·Φ((I − 8.2 + 1.2(V − 0.5))/0.8)` (weaker housing, higher V, means people lose homes at lower shaking;  calibrated against Türkiye 2023 and Nepal 2015 displacement)
- heavy-damage fraction (severity used for need) `sev = Φ((I − 8.5)/0.8)`
- fatality rate (USGS PAGER, model 3.1) `ν = Φ(ln((I − shift)/θ)/β)` with a per-country θ, β from `js/models/fatality-params.js` (`AA.fatCurve(iso2)`; 252 countries, Jaiswal & Wald 2010; unknown country → median curve, status `global`). Pass the curve to `P.impact(..., fp)`; `P.forecast` does this from `sit.fatParams` or `sit.iso2`. The old single curve (θ = 13.5 + 2.5(1 − V), β = 0.17) is kept only for callers that give no curve.
- uncertainty (model 3.1, stated assumptions, NOT tuned on the back-test): shaking ±0.8 intensity units; log-normal spread on the death rate 0.7 (country curve), 1.0 (group curve), 1.2 (global); population ±20 %; magnitude ±0.2.
- a zone is an area: `P.zoneDistances(z)` evaluates five points across the zone (`z.rz` km) and averages the fractions.
- exposure: modelled sectors use the national population density (World Bank EN.POP.DNST, clamped 5–1000 /km²), not a flat 400; WorldPop is better and should be used for any judgement of accuracy.
- deep earthquakes (> 70 km) are flagged and not scored.
- Honest status (back-test 3.0, 39 events): reported toll inside P10–P90 for only 26 %, typical error ×48. 3.1 is unproven until the back-test is re-run (Validation page, tick WorldPop).
- injuries `= 3.5 × fatalities` (WHO ratio 3:1–4:1)

Cyclone (wind, lognormal fragility): `f_aff = Φ(ln(V/120)/0.25)`, `f_dis = Φ(ln(V/160)/0.25)`,
`sev = Φ(ln(V/210)/0.25)`, fatalities `= 0.002·sev·pop`, injuries `= 10 × fatalities`.

Other hazards: `f_aff = Φ((s − 0.35)/0.15)`, `f_dis = k_dis·f_aff` (flood 0.4, wildfire 0.5,
volcano 1.0, drought 0), `sev = s`, fatalities `= 1e-4 · f_aff · pop`, injuries `= 5 ×`.

## 3. Exposure
Zone population comes from OSM `place` nodes with a `population` tag inside the impact
radius. Missing tags fall back to density-by-place-type × sector area
(city 4 000/km², town 1 500, village 300, hamlet 80). Labelled `modelled`.

## 4. Uncertainty (Monte Carlo, N = 400, seeded mulberry32)
Perturb per draw: EQ magnitude `M + N(0, 0.2)`, cyclone wind `V·LN(0, 0.12)`,
flood/fire score `s·LN(0, 0.15)`, population `× LN(0, 0.2)`, fragility median `+ N(0, 0.3)`.
Report per-zone P10/P50/P90 of affected, displaced, injured, fatalities.

## 5. Bayesian update (field reports, new feed data)
Severity in a zone is Gaussian: prior `N(μ0, σ0²)` from the model, observation `y` with
variance `σy²`. Posterior:
`μ1 = (μ0/σ0² + y/σy²) / (1/σ0² + 1/σy²)`, `σ1² = 1 / (1/σ0² + 1/σy²)`.
Defaults: `σ0 = 0.15` (severity units), `σy = 0.10` (trained assessor) or `0.2` (crowd report).

## 6. Time profile (pre-positioning before the peak)
Demand ramp per epoch t (Δt = 6 h): earthquake `ramp = 1`; cyclone/flood
`ramp(t) = 1 / (1 + exp(−(t·Δt − T_peak)/6))` with `T_peak` = landfall/crest ETA (hours).
The look-ahead uses `max(ramp over horizon)` so stock is moved before the peak.

## Acceptance tests
- `I(r)` decreases monotonically with r; M7 at 10 km gives MMI ≈ 8–9.5.
- `P10 ≤ P50 ≤ P90` for every zone metric.
- Posterior mean lies between prior mean and observation.


## Accuracy layer (round 4)
- **Flood type.** `P.floodKind(name, reliefM)`: flash if the name says flash/GLOF/glacier/cloudburst/dam failure/debris, or terrain relief (max − min of a 5×5 Open-Meteo elevation grid, ±20 km) ≥ 800 m; otherwise riverine.
- **Flood calibration (`P.FLOOD`).** Flash: deaths 1 % of affected, displaced 4 %, injuries 1 per death (Nepal Aug 2026: 955 / ~93,000 impacted, 3,458 evacuated). Riverine: deaths 0.01 %, displaced 20 %, injuries 2 per death (Pakistan 2022: 1,739 / 33 M; world 1980–2009: 0.019 %).
- **Agency evidence.** `P.applyReported(fc, zones, rep, calib)`: GDACS-reported counts are confirmed minimums. Every quantile is raised to at least the count; deaths P50 = confirmed + ½ missing; P90 ≥ confirmed + all missing. Injuries keep the model's ratio when deaths are raised. For flash floods, implied affected = deaths ÷ 1 %.
- **PAGER band.** `P.applyPager(fc, zones, alert)` keeps EQ fatality P50 inside the USGS PAGER band (green < 1, yellow 1–99, orange 100–999, red ≥ 1,000).
- Acceptance: tests/models.test.js "accuracy backtests" (Nepal 2026 replay; river vs flash rates; PAGER).

## Phase 1 accuracy layer
- **Population (WorldPop 2020, 100 m).** Each zone counts people inside a catchment circle (half the nearest-neighbour
  distance, 1.5–15 km; `P.catchments`). Falls back to OSM tags / type defaults when WorldPop fails. Provenance: `popProv`.
- **Flood outline + river flow.** GDACS MultiPolygon restricts the town search; live floods read GloFAS discharge at each
  zone: ratio = max(last 7 d + next 7 d) ÷ median(previous 365 d); `P.flowToS`: 1.2× → 0, 2× → 0.35, 5× → 0.65, 12.5× → 0.95.
  Observed `z.sObs` replaces distance decay in the Monte Carlo (scaled by the drawn magnitude).
- **USGS PAGER losses.** `P.pagerQuantile` interpolates the PAGER fatality bins on a log scale; `P.applyPagerLosses`
  replaces the fatality P10/P50/P90 and computes affected/displaced from PAGER's population exposure by MMI using our
  fragility curves (raise only). Backtest: Türkiye 2023 PAGER P10–P90 contains the ≈59,000 observed deaths; exposure
  gives 8–20 M affected (UN ≈14 M).
