/* 3D map: MapLibre GL — a globe for the world view, then satellite imagery, real terrain, 3D buildings and the plan drawn as 3D columns.
   Mirrors whatever the 2D (Leaflet) map shows — live events, a plan, risk cells — so every mode works in 3D.
   Tilt/rotate: right-drag or Ctrl+drag (two fingers on phones). Falls back to 2D when WebGL or the library is unavailable.
   Skill: skills/ui-sketch/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const V = { active: false, data: {} };
  const VER = '5.24.0';
  const LIB = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VER}/dist/maplibre-gl.js`;
  const CSS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${VER}/dist/maplibre-gl.css`;
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let ready = false, gl = null, m3 = null, el = null, hover = null, popup = null, syncing = false, renderTimer = null, loading = null;

  let probe = null;
  const glInfo = () => {
    if (probe) return probe;
    probe = { ok: false, software: false, renderer: '' };
    try {
      const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl');
      if (g) {
        const ext = g.getExtension('WEBGL_debug_renderer_info');
        probe.renderer = String(ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER) || '');
        probe.ok = true;
        probe.software = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(probe.renderer);
        g.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch (e) { /* no WebGL */ }
    return probe;
  };
  V.supported = () => glInfo().ok;
  /** 3D by default only with a real graphics chip: software WebGL works but is too slow to be the default. */
  V.recommended = () => glInfo().ok && !glInfo().software;
  const loadLib = () => loading || (loading = new Promise((res, rej) => {
    if (root.maplibregl) return res(root.maplibregl);
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = LIB; s.async = true;
    const t = setTimeout(() => rej(new Error('3D library timed out')), 20000);
    s.onload = () => { clearTimeout(t); root.maplibregl ? res(root.maplibregl) : rej(new Error('3D library did not load')); };
    s.onerror = () => { clearTimeout(t); rej(new Error('3D library could not be downloaded')); };
    document.head.appendChild(s);
  }).catch((e) => { loading = null; throw e; }));

  const style = () => ({
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      sat: { type: 'raster', tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      roads: { type: 'raster', tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
      places: { type: 'raster', tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
      dem: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen / AWS Open Data' },
      demhs: { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 15 },
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenFreeMap, OpenMapTiles, OpenStreetMap contributors' },
    },
    layers: [
      { id: 'sat', type: 'raster', source: 'sat' },
      { id: 'hillshade', type: 'hillshade', source: 'demhs', paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#2a2a2a' } },
      { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.75 } },
      { id: 'places', type: 'raster', source: 'places', paint: { 'raster-opacity': 0.9 } },
      { id: 'buildings', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 13.5,
        paint: { 'fill-extrusion-color': '#ece8df', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 9], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.82 } },
    ],
    terrain: { source: 'dem', exaggeration: 1.4 },
    // globe for the world view; flat (mercator) from zoom 5 so 3D columns stay clickable when you look at a region
    projection: { type: ['interpolate', ['linear'], ['zoom'], 4, 'vertical-perspective', 5, 'mercator'] },
    sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] },
  });
  /** Tilt that suits the zoom: a flat-on globe for the world view, a 3D tilt once you are looking at a region. */
  const pitchFor = (z) => (z < 4 ? 0 : z < 7 ? 35 : 55);

  const FC = (features) => ({ type: 'FeatureCollection', features });
  const pt = (p, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [+p.lon, +p.lat] }, properties: props });
  const poly = (ring, props) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: props });
  const line = (coords, props) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props });
  const SRC = ['aa-impact', 'aa-zones', 'aa-sites', 'aa-risk', 'aa-legs', 'aa-cas', 'aa-points', 'aa-labels'];

  const addOverlays = () => {
    SRC.forEach((id) => m3.addSource(id, { type: 'geojson', data: FC([]) }));
    const font = ['Noto Sans Regular'];
    m3.addLayer({ id: 'aa-risk', type: 'fill-extrusion', source: 'aa-risk', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.72 } });
    m3.addLayer({ id: 'aa-impact-fill', type: 'fill', source: 'aa-impact', paint: { 'fill-color': '#16a34a', 'fill-opacity': 0.07 } });
    m3.addLayer({ id: 'aa-impact-line', type: 'line', source: 'aa-impact', paint: { 'line-color': '#16a34a', 'line-width': 1.5, 'line-dasharray': [3, 3] } });
    m3.addLayer({ id: 'aa-legs', type: 'line', source: 'aa-legs', filter: ['==', ['get', 'kind'], 'road'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': 0.95 } });
    m3.addLayer({ id: 'aa-legs-milk', type: 'line', source: 'aa-legs', filter: ['==', ['get', 'kind'], 'milk'], paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-dasharray': [2, 1.2] } });
    m3.addLayer({ id: 'aa-legs-air', type: 'line', source: 'aa-legs', filter: ['==', ['get', 'kind'], 'air'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#dc2626', 'line-width': 3, 'line-dasharray': [0.2, 2] } });
    m3.addLayer({ id: 'aa-cas', type: 'line', source: 'aa-cas', paint: { 'line-color': '#db2777', 'line-width': 2.5, 'line-dasharray': [2, 2] } });
    m3.addLayer({ id: 'aa-zones', type: 'fill-extrusion', source: 'aa-zones', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.85 } });
    m3.addLayer({ id: 'aa-sites', type: 'fill-extrusion', source: 'aa-sites', paint: { 'fill-extrusion-color': '#7c3aed', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.9 } });
    m3.addLayer({ id: 'aa-points', type: 'circle', source: 'aa-points', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'viewport' } });
    m3.addLayer({ id: 'aa-points-tag', type: 'symbol', source: 'aa-points', filter: ['!=', ['get', 'tag'], ''], layout: { 'text-field': ['get', 'tag'], 'text-font': font, 'text-size': 11, 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
    m3.addLayer({ id: 'aa-labels', type: 'symbol', source: 'aa-labels', minzoom: 9, layout: { 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12.5, 'text-offset': [0, -1.6], 'text-anchor': 'bottom', 'text-max-width': 14, 'text-optional': true }, paint: { 'text-color': '#111111', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 } });
  };

  // ---------------- data → GeoJSON ----------------
  const ramp = (t) => `rgb(255,${Math.round(237 - 180 * t)},${Math.round(160 - 140 * t)})`;
  const needColor = (t) => { const a = [187, 247, 208], b = [21, 128, 61]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };
  const build = () => {
    const d = V.data, out = Object.fromEntries(SRC.map((k) => [k, []]));
    // live events
    (d.events || []).forEach((e, k) => {
      const top = k < (d.eventsTop ?? 5);
      const lvl = e.episodealertlevel || e.alertlevel || (e.pager ? { green: 'Green', yellow: 'Orange', orange: 'Red', red: 'Red' }[e.pager] : '');
      out['aa-points'].push(pt(e, { kind: 'event', k, color: lvl === 'Red' ? '#dc2626' : lvl === 'Orange' ? '#ea580c' : '#16a34a', r: top ? 11 : 5, tag: top ? String(k + 1) : '' }));
      if (top) out['aa-labels'].push(pt(e, { label: e.name }));
    });
    // risk grid
    if (d.risk) {
      const cells = d.risk.cells, maxR = Math.max(0.01, ...cells.map((c) => c.R));
      cells.forEach((c, k) => {
        const dLat = c.sizeKm / 2 / 110.57, dLon = c.sizeKm / 2 / (111.32 * Math.cos(M.toRad(c.lat)));
        const ring = [[c.lon - dLon, c.lat - dLat], [c.lon + dLon, c.lat - dLat], [c.lon + dLon, c.lat + dLat], [c.lon - dLon, c.lat + dLat], [c.lon - dLon, c.lat - dLat]];
        out['aa-risk'].push(poly(ring, { kind: 'risk', k, color: ramp(M.clamp(c.R / maxR, 0, 1)), h: 200 + (c.R / maxR) * c.sizeKm * 600 }));
        if (d.risk.top.includes(c)) out['aa-labels'].push(pt(c, { label: `${d.risk.top.indexOf(c) + 1}. ${c.name}` }));
      });
      (d.riskSites || []).forEach((s, k) => { out['aa-sites'].push(poly(M.circleRing(s, 1.2, 4), { kind: 'rsite', k, h: 2500 })); out['aa-labels'].push(pt(s, { label: `S${k + 1} storage` })); });
    }
    // plan
    const st = d.st;
    if (st && st.zones) {
      const sit = st.sit, f = sit.focus || sit;
      out['aa-impact'].push(poly(M.circleRing(f, sit.radiusKm, 64), {}));
      const rKm = M.clamp(sit.radiusKm / 40, 0.25, 2.5), H = M.clamp(sit.radiusKm * 120, 2000, 12000);
      const maxAff = Math.max(1, ...st.zones.map((z) => z.fc?.aff?.p50 || 0)), maxNeed = Math.max(0.01, ...st.zones.map((z) => z.need || 0));
      st.zones.forEach((z, i) => {
        out['aa-zones'].push(poly(M.circleRing(z, rKm, 28), { kind: 'zone', i, h: 150 + ((z.fc?.aff?.p50 || 0) / maxAff) * H, color: z.served ? '#86efac' : needColor((z.need || 0) / maxNeed) }));
        out['aa-labels'].push(pt(z, { label: `${z.id} ${z.name}` }));
      });
      st.depots.forEach((dp, j) => { out['aa-points'].push(pt(dp, { kind: 'depot', j, color: dp.open ? '#dc2626' : '#6b7280', r: 8, tag: dp.type === 'hospital' ? 'H' : '' })); out['aa-labels'].push(pt(dp, { label: `${dp.id} ${dp.name}` })); });
      st.hospitals.forEach((h, j) => { if (st.depots.some((dp) => M.haversine(dp, h) < 0.05)) return; out['aa-points'].push(pt(h, { kind: 'hosp', j, color: '#dc2626', r: 7, tag: 'H' })); out['aa-labels'].push(pt(h, { label: `${h.id} ${h.name}` })); });
      (st.closures || []).forEach((c) => out['aa-points'].push(pt(c, { kind: 'closure', color: '#111111', r: 7, tag: '×' })));
      if (st.warehouses) st.warehouses.sizes.forEach((s, k) => { const c = st.warehouses.cand[s.j]; out['aa-sites'].push(poly(M.circleRing(c, rKm * 0.7, 4), { kind: 'site', k, h: H * 0.45 })); out['aa-labels'].push(pt(c, { label: `S${k + 1} storage${c.address ? ` · ${c.address.split(',').slice(0, 2).join(',')}` : ''}` })); });
      const run = st.lastRun;
      if (run) {
        (run.legs || []).forEach((leg, n) => {
          if (leg.airdrop) { out['aa-legs'].push(line([[leg.a.lon, leg.a.lat], [leg.b.lon, leg.b.lat]], { kind: 'air', n })); return; }
          const veh = AA.config.vehicles[leg.cls], milk = leg.tours.some((ti) => run.cons.tours[ti]?.kind === 'milk-run');
          out['aa-legs'].push(line(leg.best.coords, { kind: milk ? 'milk' : 'road', n, color: veh.color, w: Math.min(7, 2.5 + leg.tours.length * 0.6) }));
        });
        (run.casualty?.flows || []).forEach((fl) => { const z = st.zones[fl.i], h = st.hospitals[fl.h]; if (z && h) out['aa-cas'].push(line([[z.lon, z.lat], [h.lon, h.lat]], {})); });
      }
    }
    return out;
  };
  V.render = () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { if (!m3 || !ready) return; const g = build(); SRC.forEach((k) => m3.getSource(k)?.setData(FC(g[k]))); }, 120);
  };

  // ---------------- interaction ----------------
  const LAYERS = ['aa-points', 'aa-zones', 'aa-sites', 'aa-risk', 'aa-legs', 'aa-legs-milk', 'aa-legs-air', 'aa-cas'];
  const tipFor = (f) => {
    const p = f.properties, st = V.data.st;
    switch (p.kind) {
      case 'event': { const e = V.data.events[p.k]; return `<b>${esc(e.name)}</b><br>${AA.HAZARDS[e.hazard]?.label || e.hazard} · ${esc(e.country || '')}${e.usi != null ? `<br>USI ${e.usi.toFixed(2)}` : ''}<br><i>Click to open its plan</i>`; }
      case 'zone': { const z = st.zones[p.i]; return `<b>${z.id} · ${esc(z.name)}</b><br>Need ${(z.need || 0).toFixed(2)} · affected ${AA.fmt.k(z.fc.aff.p50)} (column height)${MAP().addrLine(z)}`; }
      case 'depot': { const d = st.depots[p.j]; return `<b>${d.id} · ${esc(d.name)}</b><br>${d.typeLabel}${d.open ? '' : ' · offline'}${MAP().addrLine(d)}`; }
      case 'hosp': { const h = st.hospitals[p.j]; return `<b>${h.id} · ${esc(h.name)}</b><br>Receiving hospital · ${h.beds} free beds${MAP().addrLine(h)}`; }
      case 'site': { const c = st.warehouses.cand[st.warehouses.sizes[p.k].j]; return `<b>Recommended storage S${p.k + 1}</b>${MAP().addrLine(c)}<br><i>Click for address and directions</i>`; }
      case 'rsite': { const s = V.data.riskSites[p.k]; return `<b>Recommended storage S${p.k + 1}</b>${MAP().addrLine(s)}`; }
      case 'risk': { const c = V.data.risk.cells[p.k]; return `<b>${esc(c.name || c.id)}</b><br>Risk ${c.R.toFixed(2)} (column height) · ${AA.HAZARDS[c.dominant]?.label || ''}`; }
      case 'closure': return 'Road closed';
      default: return f.layer.id.startsWith('aa-legs') ? 'Aid route · click for how routes are chosen' : f.layer.id === 'aa-cas' ? 'Ambulance flow to hospital' : '';
    }
  };
  const MAP = () => AA.map;
  const onClick = (e) => {
    const f = m3.queryRenderedFeatures(e.point, { layers: LAYERS })[0];
    const ll = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    if (!f || (AA.app && AA.app.picking && AA.app.picking())) { if (AA.app?.mapClick) AA.app.mapClick(ll); return; }
    const p = f.properties, st = V.data.st, h = V.data.handlers || {};
    const show = (content) => { popup?.remove(); popup = new gl.Popup({ maxWidth: '340px', closeButton: true, className: 'aa-pop3d' }).setLngLat(e.lngLat); typeof content === 'string' ? popup.setHTML(content) : popup.setDOMContent(content); popup.addTo(m3); };
    switch (p.kind) {
      case 'event': V.data.onEvent?.(V.data.events[p.k]); break;
      case 'zone': if (h.zonePopup) show(h.zonePopup(st.zones[p.i])); break;
      case 'depot': if (h.depotPopup) show(h.depotPopup(st.depots[p.j])); break;
      case 'hosp': { const x = st.hospitals[p.j]; show(`<h4>${x.id} · ${esc(x.name)}</h4><div class="small">Receiving hospital · ${x.beds} free beds</div>${MAP().whereHtml(x)}`); break; }
      case 'site': { const s = st.warehouses.sizes[p.k], c = st.warehouses.cand[s.j]; show(`<h4>Recommended storage S${p.k + 1}</h4><div class="small">Serves ${esc(s.zones.map((id) => st.zones.find((z) => z.id === id)?.name || id).join(', '))}</div>${MAP().whereHtml(c)}`); break; }
      case 'rsite': show(`<h4>Recommended storage S${p.k + 1}</h4>${MAP().whereHtml(V.data.riskSites[p.k])}`); break;
      case 'risk': V.data.onRisk?.(V.data.risk.cells[p.k]); break;
      default: if (f.layer.id.startsWith('aa-legs')) AA.explain.open('m-route');
    }
  };
  const onMove = (e) => {
    const f = m3.queryRenderedFeatures(e.point, { layers: LAYERS })[0];
    m3.getCanvas().style.cursor = AA.app?.picking?.() ? 'crosshair' : f ? 'pointer' : '';
    if (!f) { hover?.remove(); return; }
    const html = tipFor(f); if (!html) { hover?.remove(); return; }
    if (!hover) hover = new gl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'aa-tip3d', maxWidth: '300px' });
    hover.setLngLat(e.lngLat).setHTML(html).addTo(m3);
  };

  // ---------------- camera sync with the 2D map ----------------
  const fromLeaflet = (animate) => {
    const lm = MAP().map(); if (!lm || !m3) return;
    const c = lm.getCenter(), z = Math.max(0, lm.getZoom() - 1);
    syncing = true;
    const tilt = (z >= 4 && m3.getPitch() < 20) || z < 4 ? { pitch: pitchFor(z) } : {};
    (animate ? m3.easeTo.bind(m3) : m3.jumpTo.bind(m3))({ center: [c.lng, c.lat], zoom: z, ...tilt, ...(animate ? { duration: 900 } : {}) });
    setTimeout(() => (syncing = false), animate ? 950 : 0);
  };
  const toLeaflet = () => {
    if (syncing || !m3) return;
    const lm = MAP().map(), c = m3.getCenter();
    V.pushing = true; lm.setView([c.lat, c.lng], Math.round(m3.getZoom() + 1), { animate: false }); V.pushing = false;
  };

  // ---------------- public API ----------------
  V.enter = async () => {
    if (V.active) return true;
    if (!V.supported()) { AA.app?.toast('3D needs WebGL, which this browser does not offer. Showing 2D.', { err: true }); return false; }
    V.updateButton(true);
    try { gl = await loadLib(); } catch (e) { V.updateButton(false); AA.app?.toast(`3D map unavailable (${esc(e.message)}). Showing 2D.`, { err: true }); return false; }
    const wrap = document.querySelector('.mapwrap');
    if (!el) { el = document.createElement('div'); el.id = 'map3d'; el.setAttribute('aria-label', '3D map'); wrap.insertBefore(el, wrap.querySelector('.toast')); }
    el.hidden = false; document.getElementById('map').classList.add('is3d'); V.active = true;
    if (!m3) {
      const lm = MAP().map(), c = lm.getCenter();
      m3 = new gl.Map({ container: el, style: style(), center: [c.lng, c.lat], zoom: Math.max(0, lm.getZoom() - 1), pitch: pitchFor(lm.getZoom() - 1), bearing: lm.getZoom() - 1 < 4 ? 0 : -15, maxPitch: 80, attributionControl: { compact: true } });
      m3.addControl(new gl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');
      m3.addControl(new gl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      // 'style.load' fires once the style is parsed, even if an optional source (buildings, terrain) is slow or down
      m3.on('style.load', () => { if (ready) return; addOverlays(); ready = true; V.render(); });
      m3.on('error', (e) => { if (/terrain|dem|elevation/i.test(String(e?.error?.message || e?.sourceId || ''))) console.warn('3D terrain tile error', e?.error?.message); });
      m3.on('click', onClick); m3.on('mousemove', onMove); m3.on('mouseout', () => hover?.remove());
      m3.on('moveend', toLeaflet);
      MAP().map().on('moveend', () => { if (V.active && !V.pushing) fromLeaflet(true); });
    } else { m3.resize(); fromLeaflet(false); V.render(); }
    try { AA.workspace?.set('view3d', true); } catch (e) { /* ignore */ }
    V.updateButton();
    return true;
  };
  V.exit = () => {
    if (!V.active) return;
    V.active = false; if (el) el.hidden = true; document.getElementById('map').classList.remove('is3d');
    hover?.remove(); popup?.remove();
    MAP().map().invalidateSize();
    try { AA.workspace?.set('view3d', false); } catch (e) { /* ignore */ }
    V.updateButton();
  };
  V.toggle = () => (V.active ? V.exit() : V.enter());
  V.updateButton = (busy) => {
    const t = document.getElementById('viewToggle'); if (!t) return;
    t.classList.toggle('busy', !!busy);
    t.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.view === '3d') === V.active)));
  };
  V.map = () => m3;
  V.ready = () => ready;
  V.flyTo = (p, zoom) => { if (m3 && V.active) m3.flyTo({ center: [p.lon ?? p.lng, p.lat], zoom: zoom ?? Math.max(m3.getZoom(), 12), pitch: 60 }); };

  /** Hook the 2D drawing calls so the 3D view always shows the same thing. */
  V.hook = () => {
    const MP = MAP();
    const wrap = (name, after) => { const orig = MP[name]; MP[name] = (...a) => { const r = orig.apply(MP, a); try { after(...a); } catch (e) { console.error(e); } return r; }; };
    wrap('drawEvents', (events, onClick, opts = {}) => { V.data.events = events; V.data.onEvent = onClick; V.data.eventsTop = opts.top ?? 5; V.render(); });
    wrap('drawPlan', (st, handlers) => { V.data.st = st; V.data.handlers = handlers; V.data.events = []; V.render(); });
    wrap('drawLeg', () => V.render());
    wrap('drawSites', (st) => { V.data.st = st; V.render(); });
    wrap('drawRisk', (cells, top, onClick) => { V.data.risk = { cells, top }; V.data.onRisk = onClick; V.data.riskSites = null; V.render(); });
    wrap('clear', (...keys) => {
      const all = !keys.length, has = (k) => all || keys.includes(k);
      if (has('events')) V.data.events = [];
      if (has('zones') || has('impact')) V.data.st = null;
      if (has('risk')) { V.data.risk = null; V.data.riskSites = null; }
      if (has('sites') && !V.data.st) V.data.riskSites = null;
      V.render();
    });
  };
  V.setRiskSites = (sites) => { V.data.riskSites = sites; V.render(); };

  AA.map3d = V;
})(window);
