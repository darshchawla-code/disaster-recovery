---
name: data-ingestion
description: Defines every external data source AidAtlas calls (live hazards, geocoding, facilities, roads, weather, floods, socio-economic), with fallbacks and provenance. Use when adding or debugging a data feed.
---

# Data-ingestion skill

All sources below are free, keyless, CORS-enabled and were verified from a browser on 2026-10-01.

| Need | Primary source | Endpoint | Fallback |
|---|---|---|---|
| Live multi-hazard events (EQ, TC, FL, VO, DR, WF) with alert level, severity, country | **GDACS** (UN OCHA + EC JRC) | `gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP` | USGS + EONET |
| Live earthquakes (magnitude, depth, PAGER alert) | **USGS** | `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson` | GDACS EQ |
| Live satellite-observed events (wildfire, volcano, storms, floods) | **NASA EONET v3** | `eonet.gsfc.nasa.gov/api/v3/events?status=open` | — |
| Historical events by country | GDACS SEARCH | `.../geteventlist/SEARCH?eventlist=…&country=…&alertlevel=Orange;Red` | EONET closed + bbox |
| Historical earthquakes by radius | USGS FDSN | `earthquake.usgs.gov/fdsnws/event/1/query?latitude&longitude&maxradiuskm` | — |
| Geocoding / reverse geocoding | OSM Nominatim | `nominatim.openstreetmap.org/search`, `/reverse` | — |
| Supply stores (hospitals, fire, police, warehouses), populated places | OSM Overpass (3 mirrors raced) | `overpass-api.de`, `overpass.kumi.systems`, `maps.mail.ru/osm/tools/overpass` | Modelled staging sites on the road network |
| Road travel time/distance matrix, routes, snapping | OSRM | `router.project-osrm.org/table`, `/route`, `/nearest` | Haversine × circuity 1.35 at 40 km/h |
| Weather forecast (rain, gusts) | Open-Meteo | `api.open-meteo.com/v1/forecast` | — |
| River discharge (GloFAS), 1984–today | Open-Meteo Flood | `flood-api.open-meteo.com/v1/flood` | — |
| Elevation | Open-Meteo | `api.open-meteo.com/v1/elevation` | — |
| Coping capacity (beds/1000, GDP pc) | World Bank | `api.worldbank.org/v2/country/{iso3}/indicator/...` | Global medians |
| Satellite imagery | Esri World Imagery tiles | `server.arcgisonline.com/.../World_Imagery` | OSM tiles |
| Live traffic | TomTom Traffic Flow tiles (user supplies free key) | `api.tomtom.com/traffic/map/4/tile/flow/relative0` | Modelled BPR congestion + animated fleet |

## Rules
- Every fetch has a timeout (default 15 s) and an in-memory cache keyed by URL.
- Nominatim: ≤ 1 request/second; identify the app in the `Referer`.
- Overpass: race mirrors with `Promise.any`, first valid JSON wins.
- Every returned record carries `src` and `prov ∈ {live, historical, modelled, assumed}`.
- Stocks at real facilities are **assumed** by facility type until the user imports a CSV
  (`name,lat,lon,type,water_l,food_kg,tents,medkits,staff,trucks,ambulances,beds`).

## Acceptance tests
- With Overpass down, the plan still renders using modelled staging sites, labelled as such.
- With OSRM down, routes fall back to great-circle lines labelled "estimated".


## Reported impact (round 4)
- `D.gdacsImpacts(type, id)` reads `properties.sendai` from GDACS geteventdata. Each entry is a running total per (kind, country, region, wording), so take the max per group and add across groups. "Out of contact"/missing → missing; evacuated/displaced → displaced; rescued and infrastructure entries are ignored.
- Verified on 1 Oct 2026: FL 1104124 (Nepal) → 955 deaths, 4,811 missing, 279 injured, 3,458 displaced. Sendai entries are mostly published for floods; EQ/TC rely on PAGER and the model.
- `D.relief(c)`: terrain relief from Open-Meteo elevation, used to classify floods.
- `usgsHistory` now keeps the PAGER `alert`.

## Phase 1 sources
| Function | Source | Notes |
|---|---|---|
| `D.gdacsGeometry(type,id,ep)` | GDACS polygons/getgeometry | Polygon/MultiPolygon features only |
| `D.flowRatios(pts)` | Open-Meteo flood API (GloFAS), one multi-point call | start = today−372 d, end = today+7 d |
| `D.worldpop(ring)` | api.worldpop.org v1 stats, dataset wpgppop 2020 | sync call, falls back to task polling; 3 at a time, 60 s budget |
| `D.pagerLosses(usgsId)` | USGS detail GeoJSON → losspager json/alerts, losses, exposures | id from USGS feed or `eventpage/<id>` URL |
| `D.fetchText`, `D.sheetCsvUrl` | Google Sheets / CSV / JSON inventory | sheet must be link-viewable or published |
Not used: ReliefWeb API (needs an approved appname), Copernicus EMS (no documented public API).
CORS for these new endpoints must be confirmed in a real browser; failures degrade to the previous behaviour with a data note.
