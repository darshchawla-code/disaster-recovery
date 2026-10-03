# Skill: exports (partner tools)

Get plans into the tools partners already use, and field data back in.

## Code
- `js/exports.js` (`AA.exports`): `geojson`, `hxl`, `needsCSV`, `dispatchCSV`, `tasksCSV`, `parseDelimited`, `importKobo`, `XLSFORM`.
- `js/ui/app.js` `#exportSec` (downloads with UTF-8 BOM); `js/ui/field-ui.js` Kobo import (`#fKobo`).
- `tools/make-xlsform.py` → `examples/aidatlas-field-xlsform.xlsx` (converts cleanly with pyxform).
- API: `POST /v1/plan?format=geojson`.

## Formats
- GeoJSON (RFC 7946, lon/lat): FeatureCollection; `properties.layer` ∈ impact_area, affected_area, supply_store, hospital, storage_site, route, ambulance_flow, road_closure, field_report, task. ArcGIS Online/Pro, QGIS.
- HXL CSV: header row + tag row; tags `#date`, `#country`, `#loc +name`, `#geo +lat`, `#geo +lon`, `#affected`, `#affected +displaced`, `#affected +injured`, `#affected +killed`. HDX.
- CSV (needs, dispatches, tasks): Sahana Eden importer or any spreadsheet.
- KoboToolbox / ODK CSV (XML values and headers; `,` or `;`; group prefixes stripped; `_location_latitude` or `location` "lat lon alt acc"); damage none/minor/moderate/severe/destroyed → 0/.25/.5/.75/1; id `k<uuid>` so re-imports never duplicate.

## Rules
Exported figures are forecasts and say so. Use only verified HXL tags.

## Acceptance
tests/phase3.test.js (GeoJSON validity, HXL tags, CSV quoting, Kobo parsing incl. semicolons, XLSForm sheets) · E2E: export buttons, Kobo import into a plan.
