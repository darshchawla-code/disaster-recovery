/* Map layer management (Leaflet). Skill: ui-sketch, routing */
(function (root) {
  const AA = root.AA, M = AA.math;
  const MAP = {};
  let map, layers = {}, anim = null, trafficLayer = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  MAP.esc = esc;
  const reduceMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  MAP.init = (el) => {
    map = L.map(el, { zoomControl: true, worldCopyJump: true, preferCanvas: false }).setView([20, 10], 2);
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '© OpenStreetMap contributors' });
    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true, pane: 'overlayPane', opacity: 0.9 });
    const roads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true, opacity: 0.75 });
    MAP.base = { sat, streets };
    (AA.config.lowBandwidth ? streets : sat).addTo(map); labels.addTo(map); if (!AA.config.lowBandwidth) roads.addTo(map);
    MAP.overlays = { 'Place labels': labels, 'Road network': roads };
    MAP.control = L.control.layers({ Satellite: sat, Streets: streets }, MAP.overlays, { position: 'topright', collapsed: true }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    ['base', 'impact', 'zones', 'depots', 'hosp', 'legs', 'cas', 'fleet', 'sites', 'closures', 'risk', 'events', 'field'].forEach((k) => (layers[k] = L.layerGroup().addTo(map)));
    // name labels for areas, stores and storage sites: shown when zoomed in far enough to read them
    layers.labels = L.layerGroup();
    const toggleLabels = () => { if (map.getZoom() >= 12) layers.labels.addTo(map); else map.removeLayer(layers.labels); };
    map.on('zoomend', toggleLabels); toggleLabels();
    MAP.setTraffic(AA.config.tomtomKey);
    return map;
  };
  MAP.map = () => map;
  /** Field reports: a square marker coloured by damage (grey when already applied to the plan). */
  MAP.FIELD_COLORS = ['#16a34a', '#84cc16', '#f59e0b', '#ea580c', '#b91c1c'];
  MAP.drawField = (reports, applied = new Set()) => {
    const FR = AA.field; layers.field.clearLayers();
    (reports || []).forEach((r) => {
      const col = applied.has(r.id) ? '#6b7280' : MAP.FIELD_COLORS[Math.round(r.damage * 4)];
      const icon = L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: `<div class="field-pin" style="background:${col}">${r.photoUrl ? '▣' : '◎'}</div>` });
      const needs = r.needs.map((k) => FR.NEEDS.find(([x]) => x === k)?.[1]).filter(Boolean).join(', ');
      L.marker([r.lat, r.lon], { icon, zIndexOffset: 700 })
        .bindTooltip(`<b>Field report · ${esc(FR.damageLabel(r.damage))} damage</b><br>${esc(FR.ROAD[r.road])}${r.people.trapped ? ` · ${r.people.trapped} trapped` : ''}${needs ? `<br>Needs: ${esc(needs)}` : ''}<br>${esc(r.by || 'field team')} · ${esc(new Date(r.at).toLocaleString())}${r.note ? `<br>“${esc(r.note.slice(0, 140))}”` : ''}${r.photoUrl ? `<br><img src="${esc(r.photoUrl)}" alt="" style="max-width:180px;max-height:120px;margin-top:4px;border-radius:4px">` : ''}${applied.has(r.id) ? '<br><i>Applied to the plan</i>' : ''}<span class="m">Field app · ${r.trained ? 'trained assessor' : 'crowd report'}</span>`, { className: 'aa-tip' })
        .addTo(layers.field);
    });
  };
  MAP.clear = (...keys) => (keys.length ? keys : Object.keys(layers)).forEach((k) => layers[k] && layers[k].clearLayers());
  MAP.layer = (k) => layers[k];

  MAP.setTraffic = (key) => {
    if (trafficLayer) { map.removeLayer(trafficLayer); MAP.control.removeLayer(trafficLayer); trafficLayer = null; }
    if (!key) return;
    trafficLayer = L.tileLayer(`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`, { maxZoom: 22, opacity: 0.85, attribution: 'Traffic © TomTom' });
    trafficLayer.addTo(map); MAP.control.addOverlay(trafficLayer, 'Live traffic (TomTom)');
  };

  const dotIcon = (color, size = 12, label = '', ring = '#fff') => L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid ${ring};box-shadow:0 0 0 1px rgba(0,0,0,.45);display:grid;place-items:center;color:#fff;font:700 ${Math.max(8, size * 0.5)}px/1 'IBM Plex Sans',sans-serif">${label}</div>` });
  MAP.dotIcon = dotIcon;

  /** Live / history event markers (green). */
  MAP.drawEvents = (events, onClick, opts = {}) => {
    layers.events.clearLayers();
    events.forEach((e, k) => {
      const top = k < (opts.top ?? 5);
      const m = L.marker([e.lat, e.lon], { icon: dotIcon('#16a34a', top ? 18 : 9, top ? k + 1 : ''), zIndexOffset: top ? 500 : 0, keyboard: top });
      m.bindTooltip(`<b>${esc(e.name)}</b><br>${AA.HAZARDS[e.hazard]?.label || e.hazard} · ${esc(e.country || '')}${e.usi != null ? `<br>USI ${e.usi.toFixed(2)}` : ''}${e.from ? `<br>${new Date(e.from.endsWith('Z') || e.from.length < 12 ? e.from : e.from + 'Z').toUTCString().slice(5, 22)} UTC` : ''}`, { className: 'aa-tip' });
      m.on('click', () => onClick(e));
      m.addTo(layers.events);
    });
    if (events.length && opts.fit !== false) {
      const b = L.latLngBounds(events.slice(0, opts.top ?? 5).map((e) => [e.lat, e.lon]));
      map.fitBounds(b.pad(0.3), { maxZoom: opts.maxZoom || 6 });
    }
  };

  /** Address line for tooltips/popups: street address when known, else coordinates (always shown, so a team can navigate). */
  const addrLine = (p) => `<br><span class="addr">${p.address ? esc(p.address) : `${(+p.lat).toFixed(5)}, ${(+p.lon).toFixed(5)}${p.addressPending === false ? '' : ' · address loading…'}`}</span>`;
  MAP.addrLine = addrLine;
  /** Popup footer: address, coordinates and a Google Maps link for directions. */
  MAP.whereHtml = (p) => `<div class="where small">${p.address ? `<b>Address:</b> ${esc(p.address)}<br>` : ''}<span class="mono">${(+p.lat).toFixed(5)}, ${(+p.lon).toFixed(5)}</span> · <a href="${AA.data.mapsUrl(p)}" target="_blank" rel="noopener">Open in Google Maps</a></div>`;
  const label = (p, text, cls) => L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="maplabel ${cls || ''}">${esc(text)}</div>`, iconSize: null, iconAnchor: [-12, 8] }), interactive: false, keyboard: false }).addTo(layers.labels);

  /** Draw the whole planning state (everything except routed legs). */
  MAP.drawPlan = (st, handlers) => {
    MAP.clear('impact', 'zones', 'depots', 'hosp', 'legs', 'cas', 'fleet', 'closures', 'labels');
    layers.events.clearLayers();
    const sit = st.sit, focus = sit.focus || sit;
    L.circle([focus.lat, focus.lon], { radius: sit.radiusKm * 1000, color: '#16a34a', weight: 1.5, dashArray: '6 6', fill: true, fillOpacity: 0.06, interactive: false }).addTo(layers.impact);
    const src = L.marker([sit.lat, sit.lon], { icon: L.divIcon({ className: '', html: '<div class="pulse"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 });
    src.bindTooltip(`<b>${esc(sit.name || 'Affected area')}</b><br>${AA.HAZARDS[sit.hazard].label} · impact radius ${Math.round(sit.radiusKm)} km<span class="m">Affected-area centre · prediction model</span>`, { className: 'aa-tip' });
    src.addTo(layers.impact);
    if (sit.focus) L.polyline([[sit.lat, sit.lon], [focus.lat, focus.lon]], { color: '#16a34a', weight: 1, dashArray: '2 6' }).addTo(layers.impact);
    const maxNeed = Math.max(0.01, ...st.zones.map((z) => z.need || 0));
    st.zones.forEach((z, i) => {
      const s = 10 + 14 * ((z.need || 0) / maxNeed);
      const cov = coverage(st, i);
      const m = L.marker([z.lat, z.lon], { icon: dotIcon(z.served ? '#86efac' : '#16a34a', s, z.id.slice(1)), zIndexOffset: 400 });
      m.bindTooltip(`<b>${z.id} · ${esc(z.name)}</b><br>Need ${(z.need || 0).toFixed(2)} · severity ${(z.sevPost ?? z.sevMean).toFixed(2)}<br>Affected ${AA.fmt.k(z.fc.aff.p50)} (P10–P90 ${AA.fmt.k(z.fc.aff.p10)}–${AA.fmt.k(z.fc.aff.p90)})<br>Critical coverage this epoch ${Math.round(cov * 100)} %${z.covers?.length ? `<br>Also covers: ${esc(z.covers.slice(0, 6).join(', '))}${z.covers.length > 6 ? '…' : ''}` : ''}${addrLine(z)}<span class="m">Need score · fairness model</span>`, { className: 'aa-tip' });
      m.bindPopup(() => handlers.zonePopup(z));
      m.addTo(layers.zones);
      label(z, `${z.id} ${z.name}`, 'zone');
    });
    st.depots.forEach((d) => {
      const m = L.marker([d.lat, d.lon], { icon: dotIcon(d.open ? '#dc2626' : '#6b7280', 14, d.type === 'hospital' ? 'H' : ''), zIndexOffset: 300 });
      m.bindTooltip(`<b>${d.id} · ${esc(d.name)}</b><br>${d.typeLabel}${d.open ? '' : ' · <b>offline</b>'}${d.damaged ? ' · inside heavy-damage zone' : ''}${addrLine(d)}<span class="m">Supply store · stock ${d.prov === 'imported inventory' ? 'from your inventory' : d.type === 'staging' ? 'modelled' : 'assumed by type'}</span>`, { className: 'aa-tip' });
      m.bindPopup(() => handlers.depotPopup(d));
      m.addTo(layers.depots);
      label(d, `${d.id} ${d.name}`, 'store');
    });
    st.hospitals.forEach((h) => {
      if (st.depots.some((d) => M.haversine(d, h) < 0.05)) return;
      const m = L.marker([h.lat, h.lon], { icon: dotIcon('#dc2626', 12, 'H'), zIndexOffset: 250 });
      m.bindTooltip(`<b>${h.id} · ${esc(h.name)}</b><br>Receiving hospital · ${h.beds} free beds (${h.bedsProv})${addrLine(h)}<span class="m">Casualty transport LP</span>`, { className: 'aa-tip' });
      m.bindPopup(`<h4>${h.id} · ${esc(h.name)}</h4><div class="small">Receiving hospital · ${h.beds} free beds</div>${MAP.whereHtml(h)}`);
      m.addTo(layers.hosp);
      label(h, `${h.id} ${h.name}`, 'store');
    });
    st.closures.forEach((c) => L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: '<div class="closure-x">✕</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).bindTooltip('Road closed').addTo(layers.closures));
    // casualty flows
    const run = st.lastRun;
    if (run) run.casualty.flows.forEach((f) => {
      const z = st.zones[f.i], h = st.hospitals[f.h];
      L.polyline([[z.lat, z.lon], [h.lat, h.lon]], { color: '#db2777', weight: 2, dashArray: '4 6', opacity: 0.9 })
        .bindTooltip(`<b>Ambulance flow · ${z.id} → ${h.id}</b><br>${AA.fmt.n(f.n, 0)} patients · ${AA.fmt.min(f.tau)} · survival weight e<sup>−τ/τp</sup> = ${Math.exp(-f.tau).toFixed(2)}<span class="m">Model: casualty transport LP (survival-weighted)</span>`, { className: 'aa-tip', sticky: true })
        .addTo(layers.cas);
    });
    if (st.warehouses) MAP.drawSites(st);
  };

  const coverage = (st, i) => {
    const run = st.lastRun; if (!run) return 0;
    const z = st.zones[i]; let need = 0, got = 0;
    AA.config.commodities.filter((c) => c.critical).forEach((c) => { const d = z.d[c.key] || 0; need += d; got += d - (run.alloc.unmet[i][c.key] || 0); });
    return need > 0 ? got / need : 1;
  };
  MAP.coverage = coverage;

  MAP.fitPlan = (st) => {
    const pts = [...st.zones, ...st.depots, ...st.hospitals, st.sit].map((p) => [p.lat, p.lon]);
    map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 12 });
  };

  /** One routed leg → polyline with model tooltip. */
  MAP.drawLeg = (st, leg) => {
    const veh = AA.config.vehicles[leg.cls];
    const run = st.lastRun;
    const cargo = {};
    leg.tours.forEach((ti) => { const t = run.cons.tours[ti]; const c = t.cargo.find((x) => x.i === leg.to.idx); if (c) Object.entries(c.cargo).forEach(([k, q]) => (cargo[k] = (cargo[k] || 0) + q)); });
    const cargoTxt = Object.entries(cargo).filter(([, q]) => q > 1e-3).map(([k, q]) => { const c = AA.config.commodities.find((x) => x.key === k); return `${AA.fmt.n(q, q < 10 ? 1 : 0)} ${c.unit} ${c.label.toLowerCase()}`; }).join(', ');
    const fromName = leg.from.kind === 'd' ? `${leg.a.id} ${leg.a.name}` : `${leg.a.id} ${leg.a.name}`;
    const kinds = [...new Set(leg.tours.map((ti) => run.cons.tours[ti].kind))].join(' / ');
    const nVeh = leg.tours.length;
    if (leg.airdrop) {
      const l = L.polyline([[leg.a.lat, leg.a.lon], [leg.b.lat, leg.b.lon]], { color: '#dc2626', weight: 2.5, dashArray: '1 7', lineCap: 'round' });
      l.bindTooltip(`<b>No road access · ${esc(fromName)} → ${leg.b.id}</b><br>Every road alternative and both detours cross a closure or a segment with damage θ ≥ ${AA.config.thetaMax}. Recommend air drop / helicopter. The allocation was re-solved without this arc.<span class="m">Model: OSRM alternatives + closure buffer ${AA.config.closureBufferKm * 1000} m + θ<sub>max</sub> rule</span>`, { className: 'aa-tip', sticky: true });
      l.addTo(layers.legs);
      L.marker([(leg.a.lat + leg.b.lat) / 2, (leg.a.lon + leg.b.lon) / 2], { icon: L.divIcon({ className: '', html: '<span class="airdrop-label">Air drop</span>', iconSize: [50, 14], iconAnchor: [25, 7] }) }).addTo(layers.legs);
      return;
    }
    const b = leg.best;
    const latlngs = b.coords.map((c) => [c[1], c[0]]);
    const line = L.polyline(latlngs, { color: veh.color, weight: Math.min(7, 2.5 + nVeh * 0.5), opacity: 0.92, dashArray: kinds.includes('milk-run') ? '10 6' : null });
    const alts = leg.candidates.length;
    line.bindTooltip(`<b>${veh.label}${nVeh > 1 ? ` ×${nVeh}` : ''} · ${esc(fromName)} → ${leg.b.id} ${esc(leg.b.name)}</b><br>${cargoTxt || 'empty return leg'}<br>${AA.fmt.n(b.km, 1)} km · ${AA.fmt.min(b.ev.adjH)} damage- & congestion-adjusted (free-flow ${AA.fmt.min(b.h)})<br>Road damage θ̄ ${b.ev.mean.toFixed(2)}, max ${b.ev.max.toFixed(2)} · ${kinds}${leg.detour ? ' · detour around closure' : ''} · chosen from ${alts} path${alts > 1 ? 's' : ''} by generalised cost $${AA.fmt.n(b.ev.gc, 0)}${leg.source === 'estimated' ? '<br><i>Estimated straight-line path (road router unavailable)</i>' : ''}<span class="m">Model: MILP allocation → Clarke–Wright VRP → OSRM shortest path (Contraction Hierarchies) → BPR congestion + damage-adjusted speed</span>`, { className: 'aa-tip', sticky: true });
    line.on('click', () => AA.explain.open('m-route'));
    line.addTo(layers.legs);
    leg._latlngs = latlngs; leg._n = Math.min(3, nVeh); leg._cargoTxt = cargoTxt;
  };

  /** Simulated fleet movement along routed legs. */
  let lastLegs = [];
  MAP.animate = (legs) => {
    if (legs) lastLegs = legs;
    if (anim) cancelAnimationFrame(anim); layers.fleet.clearLayers();
    if (!AA.config.showFleet) return;
    legs = lastLegs;
    const movers = [];
    legs.filter((l) => l._latlngs && l._latlngs.length > 1).forEach((l) => {
      const cum = [0]; for (let k = 1; k < l._latlngs.length; k++) cum.push(cum[k - 1] + map.distance(l._latlngs[k - 1], l._latlngs[k]));
      const total = cum[cum.length - 1]; if (!total) return;
      for (let n = 0; n < l._n; n++) {
        const v = AA.config.vehicles[l.cls];
        const mk = L.circleMarker(l._latlngs[0], { radius: 6, color: '#111', weight: 1.5, fillColor: v.color, fillOpacity: 1 }).addTo(layers.fleet);
        mk.bindTooltip(`<b>${v.label} in transit</b> (simulated position)<br>${esc(l.a.name)} → ${esc(l.b.name)}<br>${esc(l._cargoTxt || '')}<br>Trip takes about ${AA.fmt.min(l.best.ev.adjH)} on damaged roads<span class="m">Shows where a dispatched vehicle would be along its planned route. Not GPS tracking.</span>`, { className: 'aa-tip' });
        movers.push({ mk, l, cum, total, off: n / l._n, period: reduceMotion ? 1e12 : 12000 + Math.min(24000, l.best.ev.adjH * 12000) });
      }
    });
    const t0 = performance.now();
    const step = (t) => {
      movers.forEach((m) => {
        const f = (((t - t0) / m.period) + m.off) % 1, d = f * m.total;
        let k = 1; while (k < m.cum.length && m.cum[k] < d) k++;
        const a = m.l._latlngs[k - 1], b = m.l._latlngs[Math.min(k, m.l._latlngs.length - 1)];
        const seg = (m.cum[k] - m.cum[k - 1]) || 1, u = (d - m.cum[k - 1]) / seg;
        m.mk.setLatLng([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      });
      anim = requestAnimationFrame(step);
    };
    if (movers.length) anim = requestAnimationFrame(step);
  };

  MAP.drawSites = (st) => {
    layers.sites.clearLayers();
    layers.labels.eachLayer((l) => { if (l.options.icon?.options?.html?.includes('maplabel site')) layers.labels.removeLayer(l); });
    const w = st.warehouses; if (!w) return;
    w.cand.forEach((c) => { if (!c.safe && c.kind === 'grid') L.circleMarker([c.lat, c.lon], { radius: 3, color: '#7c3aed', weight: 1, opacity: 0.5, fillOpacity: 0, interactive: false }).addTo(layers.sites); });
    w.sizes.forEach((s, k) => {
      const c = w.cand[s.j];
      const stock = AA.config.commodities.map((cm) => `${AA.fmt.n(s.stock[cm.key], s.stock[cm.key] < 10 ? 1 : 0)} ${cm.unit} ${cm.label.toLowerCase()}`).join('<br>');
      const where = c.address ? c.address.split(',').slice(0, 2).join(',') : '';
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: '<div class="site-diamond"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 600 })
        .bindTooltip(`<b>Recommended storage S${k + 1}</b>${c.name ? ` (existing: ${esc(c.name)})` : ''}${addrLine(c)}<br>Serves ${esc(s.zones.map((id) => st.zones.find((z) => z.id === id)?.name || id).join(', '))} within ${AA.config.coverageMinutes} min<br>Pre-position for 72 h at P90:<br>${stock}<br><i>Click for address and directions</i><span class="m">Model: hazard-safe MCLP (${esc(w.sol.method)}) + 72 h P90 sizing</span>`, { className: 'aa-tip' })
        .bindPopup(() => `<h4>Recommended storage S${k + 1}</h4><div class="small">${c.name ? `Existing facility: ${esc(c.name)}<br>` : 'Suggested location: look for a warehouse, school, hall or open ground at or near this point that is safe from the hazard.<br>'}Serves ${esc(s.zones.map((id) => st.zones.find((z) => z.id === id)?.name || id).join(', '))} within ${AA.config.coverageMinutes} min by road<br>Stock for 72 h at P90: ${stock.replace(/<br>/g, ', ')}</div>${MAP.whereHtml(c)}<div class="small"><a href="#m-mclp" class="x-mclp">How this site was chosen</a></div>`)
        .on('popupopen', (e) => { const a = e.popup.getElement()?.querySelector('.x-mclp'); if (a) a.onclick = (ev) => { ev.preventDefault(); AA.explain.open('m-mclp'); }; })
        .addTo(layers.sites);
      label(c, `S${k + 1} storage${where ? ` · ${where}` : ''}`, 'site');
    });
  };

  /** "Key actions now" box on the map (top-left). Pass null to remove. */
  let actionsCtl = null;
  MAP.drawActions = (acts, onReport) => {
    if (actionsCtl) { map.removeControl(actionsCtl); actionsCtl = null; }
    if (!acts || !acts.length) return;
    actionsCtl = L.control({ position: 'topleft' });
    actionsCtl.onAdd = () => {
      const el = L.DomUtil.create('div', 'actions-box');
      L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
      const collapsed = (() => { try { return localStorage.getItem('aa.actionsCollapsed') === '1'; } catch (e) { return false; } })();
      el.innerHTML = `<div class="ab-head"><b>Key actions now</b><button type="button" class="ab-tog">${collapsed ? 'show' : 'hide'}</button></div><ol ${collapsed ? 'hidden' : ''}>${acts.map((a, k) => `<li data-k="${k}" title="${esc(a.detail)}"><span class="ai">${a.icon}</span>${esc(a.text)}</li>`).join('')}</ol><button type="button" class="btn primary ab-rep" ${collapsed ? 'hidden' : ''}>Full action report</button>`;
      el.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => { const a = acts[+li.dataset.k]; if (a.at) map.flyTo([a.at.lat, a.at.lon], Math.max(map.getZoom(), 11)); }));
      el.querySelector('.ab-rep').addEventListener('click', onReport);
      el.querySelector('.ab-tog').addEventListener('click', (e) => { const ol = el.querySelector('ol'), rb = el.querySelector('.ab-rep'); ol.hidden = !ol.hidden; rb.hidden = ol.hidden; e.target.textContent = ol.hidden ? 'show' : 'hide'; try { localStorage.setItem('aa.actionsCollapsed', ol.hidden ? '1' : '0'); } catch (er) {} });
      return el;
    };
    actionsCtl.addTo(map);
  };

  /** Risk grid heat map. */
  MAP.drawRisk = (cells, top, onClick) => {
    layers.risk.clearLayers();
    const maxR = Math.max(0.01, ...cells.map((c) => c.R));
    const ramp = (v) => { const t = M.clamp(v / maxR, 0, 1); const r = Math.round(255), g = Math.round(237 - 180 * t), b = Math.round(160 - 140 * t); return `rgb(${r},${g},${b})`; };
    cells.forEach((c) => {
      const dLat = c.sizeKm / 2 / 110.57, dLon = c.sizeKm / 2 / (111.32 * Math.cos(M.toRad(c.lat)));
      const isTop = top.includes(c);
      const rect = L.rectangle([[c.lat - dLat, c.lon - dLon], [c.lat + dLat, c.lon + dLon]], { color: isTop ? '#111' : '#fff', weight: isTop ? 2 : 0.5, fillColor: ramp(c.R), fillOpacity: 0.55 });
      rect.bindTooltip(`<b>${esc(c.name || c.id)}</b>${isTop ? ` · rank ${top.indexOf(c) + 1}` : ''}<br>Risk R = ${c.R.toFixed(3)} · dominant ${AA.HAZARDS[c.dominant]?.label}<br>H ${c.H.toFixed(2)} · E ${c.E.toFixed(2)} · V ${c.V.toFixed(2)} · LCC ${c.LCC.toFixed(2)}<span class="m">Model: INFORM geometric mean · Gutenberg–Richter · Gumbel</span>`, { className: 'aa-tip', sticky: true });
      rect.on('click', () => onClick(c));
      rect.addTo(layers.risk);
    });
    map.fitBounds(L.latLngBounds(cells.map((c) => [c.lat, c.lon])).pad(0.1));
  };

  AA.map = MAP;
})(window);
