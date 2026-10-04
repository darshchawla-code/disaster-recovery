# Skill: backtest (accuracy and model cards)

Show, with evidence, how good each forecast is.

## Code
- `js/models/backtest.js` (`AA.backtest`): `SOURCE`, `CATALOG` (44 events), `situation`, `scoreOne`, `summarise`, `run`, `csv`.
- `js/models/cards.js` (`AA.cards`): one model card per hazard + the planning optimiser; `STATUS` labels.
- `src/validation.html` → `validation.html`, `js/ui/validation.js` (`AA.validation`): summary tiles, log-scale dot-range chart with hover, event table, CSV/JSON download, model cards.
- `tools/backtest.js` (`npm run backtest`) → `backtest-results.json`; API `GET /v1/backtest` (cached 7 days), `GET /v1/model-cards` (public).

## Catalogue
NOAA NCEI Global Significant Earthquake Database, deaths ≥ 250, 2001–2025, snapshot 2026-10-02. Each event: date, name, ISO2, lat, lon, magnitude, depth, reported deaths, mode.
- `shaking`: scored.
- `tsunami` (Sumatra 2004, Chile 2010, Tōhoku 2011, Palu 2018): shown, not scored; the model forecasts shaking deaths only.
- `disputed` (Haiti 2010: official 316,000, independent estimates ~46k–160k): shown, not scored.

## Method
Each event runs through `PL.forecast` (the same chain as a live event: country index → impact radius → OSM places → zones → optional WorldPop → 400-draw Monte Carlo). Score per event: inside = P10 ≤ reported ≤ P90; error factor = 10^|log10(P50 / reported)|. Summary: coverage (share inside), typical (median) factor, bias = geometric mean of P50 / reported, share within ×3 and ×10. Cache key `${MODEL_VERSION}|wp|osm|id`; only runs with no data fallbacks are cached.

## Rules
- Never quote back-test numbers produced with fixture or fallback data.
- A hazard is "Back-tested" only with a scored back-test; otherwise Calibrated, Checked by automated tests, or Indicative.
- Bump `AA.MODEL_VERSION` whenever a forecast model changes, so old results are not reused.

- **Regression guard.** Best live result so far is stored in `tests/baseline/backtest-3.1.0.json`. `node tools/backtest-compare.js <run.json>` exits 1 if a new run has fewer than baseline−2 events inside the range, a typical error more than 10 % above ×12.7, or within-×10 more than 6 points lower (tolerance covers map-server failures). A golden-value unit test pins P10/P50/P90 for three fixed earthquakes.

## Acceptance
tests/phase3.test.js (catalogue integrity, scoring, summary, CSV, cards) · tests/api.test.js (model-cards, backtest) · E2E: run on the accuracy page, chart, CSV, cards.
