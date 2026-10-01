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

## Legend and explainer
Every legend row links (`#m-…`) into the explainer drawer, which renders the model with
KaTeX and prints the **applied numbers from the current run** (tables of N_i, d_ik, x_jik,
trips, costs, solver status).

## Accessibility
Keyboard focus visible, colour never the only signal (shape + label), reduced motion stops
vehicle animation.
