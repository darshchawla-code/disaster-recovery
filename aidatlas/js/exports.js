/* Exports to the tools agencies already use, and import from KoboToolbox / ODK.
   - GeoJSON (RFC 7946): ArcGIS Online / Pro, QGIS, Google Earth via conversion, any GIS.
   - HXL-tagged CSV (Humanitarian Exchange Language): HDX and other HXL tools read the second row of tags.
   - Plain CSV tables (needs, dispatches, tasks): spreadsheets, and Sahana Eden's CSV importer after column mapping.
   - KoboToolbox / ODK: examples/aidatlas-field-xlsform.xlsx is the same field report as the AidAtlas field app;
     its CSV export comes back in through importKobo().
   Skill: skills/exports/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const X = {};
  const r = (x, d = 0) => (x == null || !isFinite(x) ? null : M.round(x, d));
  const pt = (p, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r(+p.lon, 6), r(+p.lat, 6)] }, properties: props });

  /** The whole plan as one GeoJSON FeatureCollection; every feature has a `layer` property to style or filter by. */
  X.geojson = (st) => {
    const run = st.lastRun, K = AA.config.commodities, F = [];
    const c = st.sit.focus || st.sit;
    F.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [M.circleRing(c, st.sit.radiusKm, 64)] }, properties: { layer: 'impact_area', name: st.sit.name, hazard: st.sit.hazard, radius_km: r(st.sit.radiusKm, 1) } });
    st.zones.forEach((z, i) => F.push(pt(z, { layer: 'affected_area', id: z.id, name: z.name, address: z.address || '', need_score: r(z.need, 3), severity: r(z.sevPost ?? z.sevMean, 3), population: r(z.pop), population_source: z.popProv,
      affected_p10: r(z.fc.aff.p10), affected_p50: r(z.fc.aff.p50), affected_p90: r(z.fc.aff.p90), displaced_p50: r(z.fc.dis.p50), injured_p50: r(z.fc.inj.p50), deaths_p50: r(z.fc.fat.p50), deaths_p90: r(z.fc.fat.p90),
      ...Object.fromEntries(K.map((k) => [`need_${k.key}_${k.unit.replace(/\W+/g, '')}`, r(z.d?.[k.key] || 0, 2)])),
      ...(run ? Object.fromEntries(K.map((k) => [`unmet_${k.key}`, r(run.alloc.unmet[i]?.[k.key] || 0, 2)])) : {}), served: !!z.served })));
    st.depots.forEach((d) => F.push(pt(d, { layer: 'supply_store', id: d.id, name: d.name, type: d.type, open: d.open, address: d.address || '', provenance: d.prov, trucks: d.fleet.truck || 0, buses: d.fleet.bus || 0, ambulances: d.fleet.amb || 0, ...Object.fromEntries(K.map((k) => [`stock_${k.key}`, r(d.stock[k.key] || 0, 2)])) })));
    st.hospitals.forEach((h) => F.push(pt(h, { layer: 'hospital', id: h.id, name: h.name, free_beds: h.beds, address: h.address || '' })));
    (st.warehouses?.sizes || []).forEach((s, k) => { const cc = st.warehouses.cand[s.j]; F.push(pt(cc, { layer: 'storage_site', id: `S${k + 1}`, serves: s.zones.join(' '), address: cc.address || '', ...Object.fromEntries(Object.entries(s.stock).map(([q, v]) => [`stock72h_${q}`, r(v, 2)])) })); });
    (run?.legs || []).forEach((l) => { const coords = l.best?.coords || [[l.a.lon, l.a.lat], [l.b.lon, l.b.lat]]; F.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords.map(([x, y]) => [r(x, 6), r(y, 6)]) }, properties: { layer: 'route', from: l.from.kind === 'd' ? st.depots[l.from.idx].id : st.zones[l.from.idx].id, to: st.zones[l.to.idx].id, vehicle: l.cls, air_drop: !!l.airdrop, km: r(l.best?.km, 1), hours: r(l.best?.h, 2) } }); });
    (run?.casualty?.flows || []).forEach((fl) => { const z = st.zones[fl.i], h = st.hospitals[fl.h]; if (z && h) F.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[r(z.lon, 6), r(z.lat, 6)], [r(h.lon, 6), r(h.lat, 6)]] }, properties: { layer: 'ambulance_flow', from: z.id, to: h.id, patients: r(fl.n, 1) } }); });
    (st.closures || []).forEach((cl) => F.push(pt(cl, { layer: 'road_closure' })));
    (st.field?.reports || []).forEach((fr) => F.push(pt(fr, { layer: 'field_report', id: fr.id, at: fr.at, damage: fr.damage, road: fr.road, needs: fr.needs.join(' '), trapped: fr.people.trapped, by: fr.by, note: fr.note })));
    (st.collab?.tasks || []).forEach((t) => { const z = st.zones.find((x) => x.id === t.zoneId) || c; F.push(pt(z, { layer: 'task', id: t.id, title: t.title, assignee: t.assignee, due: t.due, status: t.status, area: t.zoneId || '' })); });
    return { type: 'FeatureCollection', name: st.savedName || st.sit.name, generator: `AidAtlas ${AA.MODEL_VERSION}`, generated: new Date().toISOString(), features: F };
  };

  // ---------------- CSV ----------------
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = (head, rows, tags) => [head.map(cell).join(','), ...(tags ? [tags.map(cell).join(',')] : []), ...rows.map((row) => row.map(cell).join(','))].join('\r\n');

  /** Areas with HXL hashtags (second row). Only tags from the HXL core dictionary are used; other columns are untagged. */
  X.hxl = (st) => {
    const date = new Date().toISOString().slice(0, 10);
    const head = ['Date', 'Country', 'Area', 'Latitude', 'Longitude', 'People affected (P50)', 'Displaced (P50)', 'Injured (P50)', 'Deaths (P50)', 'Deaths (P90)', 'Need score', 'Population', 'Source'];
    const tags = ['#date', '#country', '#loc +name', '#geo +lat', '#geo +lon', '#affected', '#affected +displaced', '#affected +injured', '#affected +killed', '', '', '', ''];
    const rows = st.zones.map((z) => [date, st.sit.country || '', z.name, r(z.lat, 5), r(z.lon, 5), r(z.fc.aff.p50), r(z.fc.dis.p50), r(z.fc.inj.p50), r(z.fc.fat.p50), r(z.fc.fat.p90), r(z.need, 3), r(z.pop), `AidAtlas ${AA.MODEL_VERSION} forecast (modelled)`]);
    return csv(head, rows, tags);
  };
  /** Needs per area per item (this 6-hour period and 72-hour P90). */
  X.needsCSV = (st) => {
    const K = AA.config.commodities, F = AA.fairness;
    const rows = [];
    st.zones.forEach((z, i) => K.forEach((k) => rows.push([z.id, z.name, r(z.lat, 5), r(z.lon, 5), k.label, k.unit, r(z.d?.[k.key] || 0, 2), r(st.lastRun?.alloc.unmet[i]?.[k.key] || 0, 2), r(z.D90?.[k.key] || 0, 2)])));
    return csv(['area_id', 'area', 'lat', 'lon', 'item', 'unit', 'needed_this_period', 'not_covered_this_period', 'needed_p90_cumulative'], rows);
  };
  /** Dispatch list: store → area, vehicles and cargo. */
  X.dispatchCSV = (st) => {
    const rows = (AA.report?.dispatches?.(st) || []).map((d) => [d.depot.id, d.depot.name, d.depot.address || '', d.zone.id, d.zone.name, d.trucks, d.buses, d.milk ? 'yes' : 'no', d.air ? 'yes' : 'no', r(d.hours, 2), ...AA.config.commodities.map((k) => r(d.cargo[k.key] || 0, 2))]);
    return csv(['from_id', 'from', 'from_address', 'to_id', 'to', 'trucks', 'buses', 'multi_stop', 'air_drop', 'drive_hours', ...AA.config.commodities.map((k) => `${k.key}_${k.unit.replace(/\W+/g, '')}`)], rows);
  };
  X.tasksCSV = (st) => csv(['id', 'title', 'area_id', 'assignee', 'due', 'status', 'added_by', 'added_at'], (st.collab?.tasks || []).map((t) => [t.id, t.title, t.zoneId, t.assignee, t.due, t.status, t.by, t.at]));

  // ---------------- KoboToolbox / ODK import ----------------
  /** CSV with comma or semicolon (Kobo's default) delimiters and quoted fields. */
  X.parseDelimited = (text) => {
    const first = String(text).split(/\r?\n/)[0] || '';
    const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], c = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
      else if (ch === '"') q = true; else if (ch === d) { row.push(c); c = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(c); rows.push(row); row = []; c = ''; }
      else c += ch;
    }
    if (c.length || row.length) { row.push(c); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim());
    return rows.filter((x) => x.some((v) => v.trim())).map((x) => Object.fromEntries(head.map((h, k) => [h, (x[k] ?? '').trim()])));
  };
  const DMG = { none: 0, minor: 0.25, moderate: 0.5, severe: 0.75, destroyed: 1 };
  /** Kobo / ODK export (XML values, from examples/aidatlas-field-xlsform.xlsx) → field reports. Group prefixes ("group/name") are ignored. */
  X.importKobo = (text) => {
    const rows = X.parseDelimited(text), out = [], errors = [];
    rows.forEach((raw, k) => {
      const o = {}; Object.entries(raw).forEach(([key, v]) => (o[key.split('/').pop().replace(/^_/, '')] = v));
      let lat = +o.location_latitude, lon = +o.location_longitude;
      if (!isFinite(lat) || !o.location_latitude) { const p = String(o.location || '').trim().split(/\s+/).map(Number); lat = p[0]; lon = p[1]; }
      const needs = String(o.needs || '').split(/\s+/).filter(Boolean);
      try {
        out.push(AA.field.normalise({ id: o.uuid ? `k${o.uuid.replace(/[^a-z0-9]/gi, '').slice(0, 30)}` : undefined, at: o.end || o.submission_time || o.start, lat, lon, acc: +o.location_precision || null,
          damage: DMG[String(o.damage || '').toLowerCase()] ?? +o.damage, needs, people: { affected: o.affected, injured: o.injured, trapped: o.trapped }, road: o.road, note: o.note, by: o.reporter, team: o.team, trained: /^(yes|true|1)$/i.test(o.trained || ''), place: o.place }));
      } catch (e) { errors.push(`Row ${k + 2}: ${e.message}`); }
    });
    return { reports: out, errors };
  };

  /** XLSForm definition (also written to examples/aidatlas-field-xlsform.xlsx by tools/make-xlsform.py). */
  X.XLSFORM = {
    survey: [['type', 'name', 'label', 'required', 'hint', 'parameters'],
      ['start', 'start', '', '', '', ''], ['end', 'end', '', '', '', ''],
      ['geopoint', 'location', 'Where are you?', 'yes', 'Wait for an accuracy under 30 m', ''],
      ['text', 'place', 'Place name (village, ward, landmark)', '', '', ''],
      ['image', 'photo', 'Photo', '', 'Optional', 'max-pixels=1280'],
      ['select_one damage', 'damage', 'How bad is the damage here?', 'yes', '', ''],
      ['select_multiple needs', 'needs', 'What do people need most?', '', '', ''],
      ['integer', 'affected', 'People affected (about)', '', '', ''], ['integer', 'injured', 'Injured', '', '', ''], ['integer', 'trapped', 'Trapped or missing', '', '', ''],
      ['select_one road', 'road', 'Can trucks reach this place?', 'yes', '', ''],
      ['text', 'note', 'Anything else', '', '', ''], ['text', 'reporter', 'Your name', '', '', ''], ['text', 'team', 'Team', '', '', ''],
      ['select_one yesno', 'trained', 'Are you a trained damage assessor?', '', '', '']],
    choices: [['list_name', 'name', 'label'],
      ['damage', 'none', 'No damage'], ['damage', 'minor', 'Minor'], ['damage', 'moderate', 'Moderate'], ['damage', 'severe', 'Severe'], ['damage', 'destroyed', 'Destroyed'],
      ['needs', 'water', 'Water'], ['needs', 'food', 'Food'], ['needs', 'shelter', 'Shelter'], ['needs', 'medical', 'Medical'], ['needs', 'rescue', 'Search & rescue'],
      ['road', 'open', 'Open'], ['road', 'partly', 'Partly blocked'], ['road', 'blocked', 'Blocked'], ['yesno', 'yes', 'Yes'], ['yesno', 'no', 'No']],
    settings: [['form_title', 'form_id', 'version'], ['AidAtlas field report', 'aidatlas_field_report', '3']],
  };

  AA.exports = X;
})(typeof window !== 'undefined' ? window : globalThis);
