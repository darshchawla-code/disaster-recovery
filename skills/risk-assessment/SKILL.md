---
name: risk-assessment
description: Builds a multi-hazard risk grid around a chosen place from historical catalogues, river discharge, elevation, population and coping capacity (INFORM-style geometric mean) and ranks the highest-risk areas. Use in Risk mode.
---

# Risk-assessment skill

Grid: 7 × 7 cells over ±R_box (default 60 km) around the searched location.

## Hazard components (each converted to a 10-year exceedance probability)
**Earthquake — Gutenberg–Richter.** USGS events M ≥ 4.5 within 400 km since 1973.
Aki maximum-likelihood `b = log10(e) / (M̄ − (Mc − ΔM/2))`, `ΔM = 0.1`;
`a = log10(N / T) + b·Mc` (annual). Rate `λ(M ≥ 6) = 10^(a − 6b)`;
`P10y = 1 − exp(−10 λ)`. Spread spatially with a Gaussian kernel (σ = 50 km) over epicentres.

**Flood — Gumbel EV-I on annual maximum river discharge** (GloFAS via Open-Meteo, 1995 →
last full year). `β = s√6/π`, `μ = x̄ − 0.5772 β`, `Q_T = μ − β ln(−ln(1 − 1/T))`.
Cell flood hazard = normalised `log(1 + Q100)` × low-ground factor (1.25 if cell elevation is
below the grid median, else 1). Converted to probability `1 − exp(−Q100_norm)`.

**Cyclone, wildfire, volcano, drought — event frequency.** GDACS SEARCH (country, Orange/Red,
since 2000) + NASA EONET closed events in the box. Annual rate `λ_h = count_h / years`,
weighted by a 150 km kernel; `P10y = 1 − exp(−10 λ_h)`.

Combined hazard (independent hazards): `H = 1 − Π_h (1 − P_h)`.

## Exposure, vulnerability, coping capacity
- `E` = normalised log population from OSM places (kernel 10 km).
- `V` = 0.5 × country vulnerability (World Bank GDP pc, inverted) + 0.5 × rural share.
- `LCC` (lack of coping capacity) = normalised distance to the nearest hospital, blended with
  country beds per 1 000 (inverted).

## Risk (INFORM methodology, geometric mean)
`R = (H·E)^(1/2·1/3) · V^(1/3) · LCC^(1/3)` — hazard & exposure, vulnerability and lack of
coping capacity are dimensions of equal weight, combined geometrically so one zero dimension
cannot be offset by another.

## Output
Top 5 cells by R, named after the nearest place, each with its dominant hazard. Clicking one
runs the full Plan pipeline (prediction → fairness → MILP → routing) for that hazard and
runs facility location across all top cells together.

## Acceptance tests
- `0 ≤ R ≤ 1` for every cell; raising any one dimension never lowers R.
- b-value on a synthetic G-R catalogue with b = 1 is recovered within ±0.1.
