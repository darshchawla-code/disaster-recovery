---
name: ui-sketch
description: AidAtlas visual language — clean white ground, graphite pencil-sketch backgrounds of nature and disasters, map styling, marker semantics, legend and explainer behaviour. Use for any UI change.
---

# UI-sketch skill

## Identity
- Name **AidAtlas**, tagline "Forecast the need. Fair-share the aid. Route it fast."
- White ground, graphite ink (`#26292e`), one accent: signal blue `#1f5fbf`. Hazard semantics
  are separate from the accent: affected = green `#16a34a`, supply = red `#dc2626`,
  recommended storage = purple `#7c3aed`, closure = black ✕.
- Type: Caveat (hand-written display, used only for the wordmark and section titles),
  IBM Plex Sans (UI), IBM Plex Mono (numbers, tabular).

## Pencil-sketch background
`assets/sketch.svg` — mountains with an erupting volcano, a cyclone spiral, rain cloud with
lightning, a tsunami wave, pines, houses with a crack, a river. Strokes are graphite at low
opacity and roughened with an SVG `feTurbulence` + `feDisplacementMap` filter so lines look
hand-drawn. The landing page shows it at full strength; child pages (map app panels,
explainer) reuse it at reduced opacity behind the side panel for continuity.

## Map
Leaflet + Esri World Imagery, Esri boundaries/places and transportation overlays. Optional
TomTom live traffic flow when the user adds a free key in Settings; otherwise a modelled
congestion layer and animated fleet are shown and labelled "simulated".

### 3D map (js/ui/map3d.js)
MapLibre GL 5.24 (loaded on demand from jsdelivr, only when 3D is chosen) as an overlay above the
Leaflet map. 2D is the default; the **2D | 3D** switch (`#viewToggle`, top right of the map) turns
it on and the choice is stored (`aa.view3d`, opens in 3D next time only if the user chose it);
`?view=3d|2d` overrides. Style: Esri World Imagery + reference overlays, Mapzen
terrarium DEM on AWS (terrain ×1.4 and hillshade), OpenFreeMap vector buildings extruded from
zoom 13.5, globe projection below zoom 4 blending to mercator by zoom 5 (fill-extrusions are not
hit-testable on the globe in MapLibre 5, so regional views must be mercator). Tilt follows zoom:
0° world, 35° country, 55° region.
- It never computes anything itself: `AA.map3d.hook()` wraps `drawEvents`, `drawPlan`,
  `drawLeg`, `drawSites`, `drawRisk` and `clear` on the 2D map and rebuilds GeoJSON sources
  (`aa-zones` columns height ∝ affected P50, colour ∝ need; `aa-sites`; `aa-risk` squares
  height ∝ R; `aa-legs`; `aa-cas`; `aa-points`; `aa-labels`).
- Clicks reuse the 2D handlers (zone and depot popups, `whereHtml`, `onEvent`, `onRisk`,
  `AA.app.mapClick` for empty ground and pick mode). Cameras are kept in sync both ways
  (3D zoom = Leaflet zoom − 1).
- Overlays are added on `style.load`, not `load`, so a slow or blocked optional source
  (buildings, terrain) never blocks the plan layers. The hidden container keeps its size
  (`visibility:hidden`) because collapsing it to 0×0 breaks MapLibre's render loop.
- Headless testing needs software WebGL: launch Chromium with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

## Legend and explainer
Every legend row links (`#m-…`) into the explainer drawer, which renders the model with
KaTeX and prints the **applied numbers from the current run** (tables of N_i, d_ik, x_jik,
trips, costs, solver status).

## Accessibility
Keyboard focus visible, colour never the only signal (shape + label), reduced motion stops
vehicle animation.
