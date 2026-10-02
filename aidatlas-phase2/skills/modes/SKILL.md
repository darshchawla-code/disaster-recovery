---
name: modes
description: Specifies the four AidAtlas user workflows — Live, Plan (data on demand), History and Risk — including ranking rules, inputs and what each mode draws. Use when changing a mode's behaviour.
---

# Modes skill

All modes end in the same **planning view**: satellite map, green affected area, red supply
stores, purple recommended warehouses, routed aid paths with tooltips, a legend whose model
names link to the applied calculation, and the dynamic-response control panel.

## Mode 1 — Live
1. Pull GDACS EVENTS4APP + USGS M4.5+ week + EONET open events; de-duplicate earthquakes
   (same event if ≤ 100 km and ≤ 2 h apart).
2. Rank by the **Unified Severity Index**:
   `USI = 0.50·A + 0.35·m + 0.15·h`, where `A` is the agency alert on 0–1: GDACS `0.3·event + 0.7·current episode`
   (Green/Orange/Red → 0/0.5/1, so a decayed storm does not keep its old Red), USGS PAGER (none → 0), EONET 0.1; `m` = magnitude normalised per hazard
   (EQ `(M − 4)/5`; TC `V/300 km/h`; WF `log10(ha)/6`; DR `log10(km²)/6.5`; FL/VO alert-based),
   `h` = hazard lethality prior (EQ 1.0, TC 0.9, FL 0.8, VO 0.7, DR 0.6, WF 0.5).
   Current events only (GDACS `iscurrent` within 14 days, or updated within 7 days); prescribed burns excluded;
   EONET acres converted to hectares; ties broken by recency. Cyclone planning wind is capped to the current
   episode's alert band (Green 118, Orange 177 km/h) because GDACS reports the lifetime maximum.
3. Show the Top 5 (country, hazard, magnitude, alert, time). Click → planning view.
4. Auto-refresh every 10 min; magnitude changes feed the Bayesian update.

## Mode 2 — Plan (data on demand)
Search any address (Nominatim) or click the map. The point turns green. Choose hazard type,
magnitude/intensity and lead time. The full pipeline runs as if the disaster happens there.
Adds **recommended storage sites** (facility-location skill).

## Mode 3 — History
Search a place. Pull GDACS SEARCH (country, Orange/Red, since 2000), USGS FDSN M ≥ 5.5
within 300 km, and EONET closed events in the box. Keep events within 300 km, list the
Top 5 in reverse chronological order. Clicking one replays it through the pipeline using
its recorded magnitude, showing the optimal paths aid could have taken and the warehouse
sites that would have covered it.

## Mode 4 — Risk
Search a place. Build the risk grid (risk-assessment skill), list the Top 5 high-risk areas
with dominant hazard and R. Clicking one opens its planning view; "Plan storage for all"
runs facility location across all five.

## Names and addresses (user feedback, Oct 2026)
- Zones come from OSM localities: cities/towns across the radius + suburbs, quarters, neighbourhoods and villages within 35 km (`D.places`). A city with ≥ 3 mapped localities is represented by them (no N/E/S/W quarters). Zones are picked worst-first but ≥ 2 km apart; skipped neighbours are listed in `zone.covers`.
- Modelled areas and unmapped city quarters (`needsName`) are named from Nominatim reverse geocoding (zoom 16) during the build.
- `ENG.enrichAddresses()` fills `address` for storage sites → stores → hospitals → zones in the background (OSM `addr:*` tags first, else Nominatim zoom 17–18 at ≤ 1 req/s) and emits `addresses`; results live in `state.inputs.addr`, so saved plans reopen without lookups. Unnamed facilities become "Warehouse on <road>, <locality>".
- UI: address line in every tooltip; popups have coordinates + Google Maps link; name labels at zoom ≥ 12; report dispatch/hospital/storage lines carry addresses and a "Where everything is" table.
- Tests: tests/addresses.test.js.
