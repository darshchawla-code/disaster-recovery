/* App shell: modes, panel, search, events, settings. Skill: modes */
(function (root) {
  const AA = root.AA, M = AA.math, f = AA.fmt, MAP = AA.map, ENG = AA.engine, D = AA.data;
  const esc = MAP.esc;
  const $ = (s) => document.querySelector(s);
  const app = (AA.app = { mode: 'live', view: 'list' });
  const panel = () => $('#panelInner');
  const hz = (h) => `<span class="chip ${h}">${AA.HAZARDS[h]?.label || h}</span>`;
  const alertDot = (lvl) => `<span class="alert ${lvl || 'na'}" title="${lvl ? lvl + ' alert' : 'no agency alert'}"></span>`;
  const ago = (iso) => { if (!iso) return ''; const t = new Date(/Z$|[+-]\d\d:?\d\d$/.test(iso) || iso.length < 12 ? iso : iso + 'Z').getTime(); const h = (Date.now() - t) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };
  const dateStr = (iso) => { if (!iso) return ''; const d = new Date(/Z$/.test(iso) || iso.length < 12 ? iso : iso + 'Z'); return d.toISOString().slice(0, 10); };
  const magText = (e) => e.hazard === 'EQ' ? `M ${(+(e.magnitude ?? e.severity)).toFixed(1)}` : e.hazard === 'TC' ? `${Math.round(e.severity || 0)} km/h` : e.severity ? `${f.n(e.severity)} ${esc(e.severityUnit || '')}` : (e.alertlevel || '');

  // ---------------- toast / hint ----------------
  let toastTimer;
  app.toast = (msg, { err = false, sticky = false } = {}) => {
    const t = $('#toast'); t.hidden = !msg; t.className = 'toast' + (err ? ' err' : ''); t.innerHTML = msg || '';
    clearTimeout(toastTimer); if (msg && !sticky) toastTimer = setTimeout(() => (t.hidden = true), err ? 7000 : 3500);
  };
  let pick = null;
  app.pickPoint = (text, cb) => {
    pick = cb; $('#hintText').textContent = text; $('#hint').hidden = false; MAP.map().getContainer().style.cursor = 'crosshair';
  };
  const endPick = () => { pick = null; $('#hint').hidden = true; MAP.map().getContainer().style.cursor = ''; };

  // ---------------- legend ----------------
  const legend = () => {
    const L = (sw, label, link) => `<li><span class="sw">${sw}</span><span>${label}${link ? ` · <a href="#${link[0]}" data-x="${link[0]}">${link[1]}</a>` : ''}</span></li>`;
    const dot = (c) => `<span class="dot" style="background:${c}"></span>`;
    const ln = (c, dash) => `<span class="ln${dash ? ' dash' : ''}" style="border-color:${c}"></span>`;
    $('#legend').innerHTML = `<h4>Legend <button type="button" id="legendToggle">hide</button></h4><ul>
      ${L(dot('#16a34a'), 'Affected area / demand zone', ['m-pred', 'Monte-Carlo forecast'])}
      ${L(dot('#16a34a'), 'Zone size = need', ['m-need', 'Need score'])}
      ${L(dot('#dc2626'), 'Supply store (H = hospital)', ['m-milp', 'Allocation MILP'])}
      ${L('<span class="site-diamond" style="width:11px;height:11px"></span>', 'Recommended storage', ['m-mclp', 'MCLP'])}
      ${L(ln('#f59e0b'), 'Truck route', ['m-route', 'OSRM + damage'])}
      ${L(ln('#f59e0b', 1), 'Milk run (multi-stop)', ['m-vrp', 'Clarke–Wright'])}
      ${L(ln('#0ea5e9'), 'Responder bus', ['m-bpr', 'BPR congestion'])}
      ${L(ln('#db2777', 1), 'Ambulance flow', ['m-cas', 'Survival LP'])}
      ${L(ln('#dc2626', 1), 'No road: air drop', ['m-route', 'closure rule'])}
      ${L('<span class="closure-x" style="font-size:14px">✕</span>', 'Road closure')}
      ${L(dot('#fdba74'), 'Risk cell', ['m-risk', 'INFORM risk'])}
      ${L(dot('#16a34a'), 'Live ranking', ['m-usi', 'Unified Severity Index'])}
    </ul><p class="small muted" style="margin:0 0 6px"><b>3D map:</b> drag to move, right-drag or Ctrl+drag to tilt and rotate (two fingers on phones). Green column height = people affected; purple columns = storage sites; risk squares rise with risk.</p><label class="small fleet-tog"><input type="checkbox" id="fleetTog" ${AA.config.showFleet ? 'checked' : ''}> Show vehicles in transit</label>
    <p class="small muted" style="margin:0">When on, each moving dot is one dispatched vehicle (orange = truck, blue = responder bus) shown along its planned route. Positions are simulated, not GPS. Hover a dot for its cargo. ${AA.config.tomtomKey ? 'Live traffic: TomTom.' : 'Add a free TomTom key in Settings to see real traffic.'} <a href="guide.html#map-symbols" target="_blank" rel="noopener">All symbols explained</a></p>`;
    $('#fleetTog').addEventListener('change', (e) => { AA.config.showFleet = e.target.checked; MAP.animate(); });
    $('#legend').querySelectorAll('[data-x]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); AA.explain.open(a.dataset.x); }));
    $('#legendToggle').addEventListener('click', () => { const l = $('#legend'); l.classList.toggle('collapsed'); $('#legendToggle').textContent = l.classList.contains('collapsed') ? 'show' : 'hide'; });
  };

  // ---------------- modes ----------------
  const setMode = (mode, { push = true } = {}) => {
    app.mode = mode; app.view = 'list';
    document.querySelectorAll('.tabs a').forEach((a) => a.setAttribute('aria-current', a.dataset.mode === mode ? 'page' : 'false'));
    if (push) history.replaceState(null, '', `?mode=${mode}`);
    MAP.clear(); ENG.state = null; app.riskResult = null;
    $('#q').placeholder = mode === 'live' ? 'Search to move the map' : mode === 'plan' ? 'Search a city or address to plan for' : mode === 'history' ? 'Search a place to see its past disasters' : 'Search a city, region or country to map risk';
    ({ live: renderLive, plan: renderPlanStart, history: renderHistoryStart, risk: renderRiskStart })[mode]();
  };

  // ----- Mode 1: Live -----
  const renderLive = async (opts = {}) => {
    panel().innerHTML = `<div class="ph"><span class="eyebrow">Mode 1 · Live</span><h2>Disasters happening now</h2><p>Top 5 current events worldwide, ranked by the <a href="#m-usi" data-x="m-usi">Unified Severity Index</a>. Sources: GDACS, USGS, NASA EONET. Refreshes every 10 minutes.</p></div>
      <div class="sec" id="liveList"><div class="empty"><span class="spin"></span> Reading live feeds…</div></div>${AA.wsui.watchSection()}`;
    bindX(); AA.wsui.bindWatch();
    try {
      const { events, errors, counts } = await D.liveEvents();
      app.live = events;
      const top = events.slice(0, 5);
      $('#liveList').innerHTML = `<h3>Top 5 now <span class="small muted" style="text-transform:none;letter-spacing:0">${counts.gdacs} GDACS · ${counts.usgs} USGS · ${counts.eonet} EONET</span></h3>
        ${top.map((e, k) => `<button class="evt" type="button" data-k="${k}"><span class="rk">${k + 1}</span><span><span class="t">${esc(e.name)}</span><br><span class="s">${hz(e.hazard)} ${alertDot(e.alertlevel || (e.pager ? ({ green: 'Green', yellow: 'Orange', orange: 'Orange', red: 'Red' })[e.pager] : ''))}${esc(e.country || '')} · ${magText(e)} · ${ago(e.to || e.from)}</span><br><span class="s">${esc(e.src)}</span></span><span class="score"><b>${e.usi.toFixed(2)}</b>USI</span></button>`).join('')}
        ${errors.length ? `<p class="note warn">${errors.map(esc).join('<br>')}</p>` : ''}
        <div class="btns"><button class="btn primary" id="repLive" type="button">Generate situation report</button><a class="btn" href="guide.html#mode-live" target="_blank" rel="noopener">Guide</a></div>
        <p class="small muted">${events.length - 5 > 0 ? `${events.length - 5} more current events are shown as small dots on the map.` : ''} Click an event to forecast impact, allocate supplies and route aid.</p>`;
      $('#repLive').addEventListener('click', () => AA.report.open(AA.report.live(events)));
      $('#liveList').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => openEvent(top[+b.dataset.k])));
      MAP.drawEvents(events.slice(0, 60), openEvent, { top: 5 });
      AA.wsui.fillWatch(events);
      const want = new URLSearchParams(location.search).get('event');
      if (want && !opts.noAuto) { const e = want === 'top' ? top[0] : events.find((x) => x.id === want); if (e) openEvent(e); }
    } catch (err) {
      AA.wsui.fillWatch([]);
      $('#liveList').innerHTML = `<p class="note warn">Live feeds could not be reached: ${esc(err.message)}. Check your connection and reload.</p>`;
    }
  };
  const openEvent = app.openEvent = (e) => openPlan(ENG.situationFromEvent(e), { warehouses: app.mode !== 'live', back: app.mode === 'live' ? () => renderLive({ noAuto: true }) : () => renderHistoryList() });
  setInterval(async () => { if (app.mode === 'live' && app.view === 'list') renderLive({ noAuto: true }); else {
    try { const { events } = await D.liveEvents(); app.live = events; try { AA.wsui.notify(AA.workspace.matchWatch(await AA.workspace.watch.list(), events)); } catch (e) {} if (!(app.mode === 'live' && ENG.state?.sit?.event)) return; const cur = ENG.state.sit.event; const now = events.find((x) => x.id === cur.id); if (now && (now.magnitude ?? now.severity) !== (cur.magnitude ?? cur.severity)) app.toast(`Live update: ${esc(now.name)} changed to ${magText(now)}. Re-open it to re-forecast.`, { sticky: true }); } catch (e) {} } }, 10 * 60e3);

  // ----- Mode 2: Plan -----
  const HZ_INPUT = {
    EQ: { label: 'Magnitude (Mw)', min: 4.5, max: 9.5, step: 0.1, val: 7.0, extra: 'depth' },
    TC: { label: 'Max sustained wind (km/h)', min: 90, max: 320, step: 5, val: 200, extra: 'lead' },
    FL: { label: 'Flood intensity (0.1–1)', min: 0.1, max: 1, step: 0.05, val: 0.8, extra: 'lead' },
    WF: { label: 'Fire intensity (0.1–1)', min: 0.1, max: 1, step: 0.05, val: 0.8, extra: 'area' },
    VO: { label: 'Eruption intensity (0.1–1)', min: 0.1, max: 1, step: 0.05, val: 0.9 },
    DR: { label: 'Drought intensity (0.1–1)', min: 0.1, max: 1, step: 0.05, val: 0.7, extra: 'area' },
  };
  const renderPlanStart = (place) => {
    app.view = 'list';
    const p = place || app.planPlace;
    panel().innerHTML = `<div class="ph"><span class="eyebrow">Mode 2 · Plan</span><h2>Plan for a disaster anywhere</h2><p>Search a place or click the map. AidAtlas assumes the disaster happens there and builds the full relief plan, including where to pre-position storage.</p></div>
      <div class="sec card"><h3>Location</h3><div id="planPlace" class="small">${p ? `<b>${esc(p.short || p.name)}</b><br><span class="muted">${esc(p.name)}</span><br><span class="mono">${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</span>` : '<span class="muted">No point yet. Use the search box, or click on the map.</span>'}</div></div>
      <div class="sec card"><h3>Scenario</h3>
        <label class="field">Hazard<select id="pHz">${Object.entries(AA.HAZARDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        <label class="field"><span id="pMagL"></span><input id="pMag" type="number"></label>
        <div class="grid2"><label class="field" id="pDepthF">Depth (km)<input id="pDepth" type="number" value="10" min="2" max="300"></label>
        <label class="field" id="pLeadF">Hours until peak<input id="pLead" type="number" value="24" min="0" max="120"></label>
        <label class="field" id="pAreaF">Area (km²)<input id="pArea" type="number" value="200" min="5"></label></div>
        <label class="field">Supply level <span class="mono" id="pSupV">1.0×</span><input id="pSup" type="range" min="0.25" max="4" step="0.25" value="1"></label>
        <button class="btn primary" id="pRun" type="button" ${p ? '' : 'disabled'}>Build relief plan</button>
      </div>${AA.wsui.savedPlansSection()}`;
    AA.wsui.fillSavedPlans();
    const upd = () => {
      const h = $('#pHz').value, c = HZ_INPUT[h];
      $('#pMagL').textContent = c.label; Object.assign($('#pMag'), { min: c.min, max: c.max, step: c.step, value: c.val });
      $('#pDepthF').hidden = c.extra !== 'depth'; $('#pLeadF').hidden = c.extra !== 'lead'; $('#pAreaF').hidden = c.extra !== 'area';
    };
    $('#pHz').addEventListener('change', upd); upd();
    $('#pSup').addEventListener('input', () => ($('#pSupV').textContent = (+$('#pSup').value).toFixed(2) + '×'));
    $('#pRun').addEventListener('click', () => {
      const pl = app.planPlace; if (!pl) return;
      const sit = ENG.situationFromPlan({ lat: pl.lat, lon: pl.lon, name: `${AA.HAZARDS[$('#pHz').value].label} scenario · ${pl.short || pl.name}`, country: pl.country, iso2: pl.iso2, hazard: $('#pHz').value, magnitude: +$('#pMag').value, depth: +$('#pDepth').value, peakInHours: +$('#pLead').value, areaKm2: +$('#pArea').value });
      openPlan(sit, { warehouses: true, supplyScale: +$('#pSup').value, back: () => renderPlanStart() });
    });
    if (p) { MAP.clear('events'); L.marker([p.lat, p.lon], { icon: MAP.dotIcon('#16a34a', 20) }).addTo(MAP.layer('events')); MAP.map().setView([p.lat, p.lon], 10); }
  };
  const setPlanPlace = async (p) => {
    if (!p.country) { try { const r = await D.reverse(p.lat, p.lon); Object.assign(p, { name: p.name || r.name, short: p.short || r.short, country: r.country, iso2: r.iso2 }); } catch (e) {} }
    app.planPlace = p; renderPlanStart(p);
  };

  // ----- Mode 3: History -----
  const renderHistoryStart = () => {
    app.view = 'list';
    panel().innerHTML = `<div class="ph"><span class="eyebrow">Mode 3 · History</span><h2>What happened here before</h2><p>Search a place. AidAtlas pulls past major disasters within 300 km (GDACS Orange/Red since 2000, USGS M5.5+ since 1900, NASA EONET), lists the five most recent and replays each one with the aid paths and storage sites that would have worked best.</p></div>
      <div class="sec" id="histList"><p class="empty">Search a city, region or address above, or click the map.</p></div>`;
  };
  const runHistory = async (place) => {
    app.histPlace = place;
    panel().querySelector('#histList') || renderHistoryStart();
    $('#histList').innerHTML = `<div class="empty"><span class="spin"></span> Searching catalogues near ${esc(place.short || place.name)}…</div>`;
    MAP.clear(); MAP.map().setView([place.lat, place.lon], 7);
    const deg = 3;
    const [u, g, e] = await Promise.allSettled([
      D.usgsHistory(place.lat, place.lon, 300, 5.5),
      place.country ? D.gdacsHistory(place.country) : Promise.resolve([]),
      D.eonetHistory([place.lon - deg, place.lat - deg, place.lon + deg, place.lat + deg]),
    ]);
    let all = [];
    [u, g, e].forEach((r) => r.status === 'fulfilled' && (all = all.concat(r.value)));
    all = all.filter((x) => M.haversine(place, x) <= 300);
    // de-duplicate (same hazard within 100 km and 3 days)
    all.sort((a, b) => new Date(b.from) - new Date(a.from));
    const uniq = []; all.forEach((x) => { if (!uniq.some((y) => y.hazard === x.hazard && M.haversine(x, y) < 100 && Math.abs(new Date(x.from) - new Date(y.from)) < 3 * 864e5)) uniq.push(x); });
    app.history = uniq;
    renderHistoryList();
  };
  const renderHistoryList = () => {
    const place = app.histPlace, uniq = app.history || [];
    app.view = 'list';
    if (!$('#histList')) renderHistoryStart();
    const top = uniq.slice(0, 5);
    $('#histList').innerHTML = top.length ? `<h3>${esc(place.short || place.name)} · 5 most recent within 300 km</h3>${top.map((x, k) => `<button class="evt" type="button" data-k="${k}"><span class="rk">${k + 1}</span><span><span class="t">${esc(x.name)}</span><br><span class="s">${hz(x.hazard)} ${alertDot(x.alertlevel)}${dateStr(x.from)} · ${magText(x)} · ${Math.round(M.haversine(place, x))} km away</span><br><span class="s">${esc(x.src)}</span></span><span class="score">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">source</a>` : ''}</span></button>`).join('')}
      <div class="btns"><button class="btn primary" id="repHist" type="button">Generate history report</button><a class="btn" href="guide.html#mode-history" target="_blank" rel="noopener">Guide</a></div>
      <p class="small muted">${uniq.length} events found in total. Click one to replay it.</p>` : `<p class="empty">No major recorded disasters within 300 km of ${esc(place.short || place.name)} in these catalogues.</p>`;
    $('#repHist')?.addEventListener('click', () => AA.report.open(AA.report.history(place, uniq)));
    $('#histList').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => openEvent({ ...top[+b.dataset.k], iso2: place.iso2, country: place.country })));
    MAP.drawEvents(top, (x) => openEvent({ ...x, iso2: place.iso2, country: place.country }), { top: 5, maxZoom: 8 });
  };

  // ----- Mode 4: Risk -----
  const renderRiskStart = () => {
    app.view = 'list';
    panel().innerHTML = `<div class="ph"><span class="eyebrow">Mode 4 · Risk</span><h2>Where disaster is most likely to hurt</h2><p>Search a city or region. AidAtlas builds a 6 × 6 risk grid (about 120 × 120 km) from earthquake catalogues (Gutenberg–Richter), 20 years of river discharge (Gumbel), storm, fire and volcano records, population, hospital access and national coping capacity, then ranks the five highest-risk areas.</p></div>
      <div class="sec" id="riskList"><p class="empty">Search a place above, or click the map.</p></div>`;
  };
  const runRisk = async (place) => {
    app.riskPlace = place;
    if (!$('#riskList')) renderRiskStart();
    const out = $('#riskList');
    const step = (t) => (out.innerHTML = `<div class="empty"><span class="spin"></span> ${t}</div>`);
    MAP.clear(); MAP.map().setView([place.lat, place.lon], 8);
    const RK = AA.risk, half = 60, n = 6;
    const cells = RK.grid(place, half, n);
    step('Reading earthquake catalogue (USGS, since 1973)…');
    const eq = await D.usgsHistory(place.lat, place.lon, 400, 4.5, '1973-01-01').catch(() => []);
    step('Reading storm, flood, fire and volcano records (GDACS, EONET)…');
    const deg = 2.5;
    const [g, e] = await Promise.allSettled([place.country ? D.gdacsHistory(place.country) : Promise.resolve([]), D.eonetHistory([place.lon - deg, place.lat - deg, place.lon + deg, place.lat + deg])]);
    const events = [...(g.status === 'fulfilled' ? g.value : []), ...(e.status === 'fulfilled' ? e.value : [])].filter((x) => x.hazard !== 'EQ' && M.haversine(place, x) < 300);
    step('Reading 20 years of river discharge (GloFAS) and elevation…');
    let q100 = null, elev = null;
    try {
      const lats = cells.map((c) => c.lat.toFixed(3)), lons = cells.map((c) => c.lon.toFixed(3));
      const y1 = new Date().getUTCFullYear() - 1;
      const [fl, el] = await Promise.all([D.floodSeries(lats, lons, `${y1 - 19}-01-01`, `${y1}-12-31`), D.elevation(lats, lons)]);
      elev = el.elevation;
      const arr = Array.isArray(fl) ? fl : [fl];
      q100 = arr.map((loc) => {
        const t = loc.daily.time, q = loc.daily.river_discharge; const byY = {};
        t.forEach((d, k) => { const y = d.slice(0, 4); if (q[k] != null) byY[y] = Math.max(byY[y] ?? 0, q[k]); });
        const gm = RK.gumbel(Object.values(byY)); return gm ? Math.max(0, gm.q(100)) : NaN;
      });
    } catch (err) { /* discharge unavailable: flood hazard falls back to event frequency */ }
    step('Reading population and hospitals (OpenStreetMap)…');
    const [pl, fac, ci] = await Promise.all([D.places(place, half + 10).catch(() => []), D.facilities(place, half + 10).catch(() => []), D.countryIndex(place.iso2)]);
    const res = RK.assess(cells, { eq, eqYears: new Date().getUTCFullYear() - 1973, events, eventYears: new Date().getUTCFullYear() - 2000, q100, elev, places: pl, hospitals: fac.filter((x) => x.type === 'hospital'), country: ci });
    res.cells.forEach((c) => { const near = pl.slice().sort((a, b) => M.haversine(c, a) - M.haversine(c, b))[0]; c.name = near && M.haversine(c, near) < 15 ? `Around ${near.name}` : `Cell ${c.id.slice(1)} (${c.lat.toFixed(2)}, ${c.lon.toFixed(2)})`; });
    const top = res.cells.slice().sort((a, b) => b.R - a.R).slice(0, 5);
    const compass = (c) => { const b = (Math.atan2(c.lon - place.lon, c.lat - place.lat) * 180 / Math.PI + 360) % 360; return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8]; };
    // name each of the top 5 after the locality at its centre (reverse geocoding), keep "Around <town>" as context
    step('Naming the high-risk areas…');
    for (const c of top) {
      try { const a = await D.reverseDetail(c.lat, c.lon, 14); if (a.locality) { c.name = `${a.locality}${a.city && a.city !== a.locality ? `, ${a.city}` : ''}`; c.address = a.address; } } catch (e) { /* keep the fallback name */ }
    }
    top.forEach((c) => { if (top.filter((o) => o.name === c.name).length > 1) c.name = `${c.name} (${compass(c)}, ${Math.round(M.haversine(place, c))} km)`; });
    app.riskResult = { place: place.short || place.name, gr: res.gr, top, cells: res.cells, counts: `${eq.length} earthquakes, ${events.length} other events, ${q100 ? 'GloFAS discharge' : 'no discharge data'}`, places: pl, facs: fac, country: ci };
    MAP.drawRisk(res.cells, top, (c) => openRiskCell(c));
    renderRiskList();
  };
  const renderRiskList = () => {
    const r = app.riskResult; app.view = 'list';
    if (!$('#riskList')) renderRiskStart();
    $('#riskList').innerHTML = `<h3>${esc(r.place)} · top 5 high-risk areas <a href="#m-risk" data-x="m-risk">method</a></h3>
      ${r.top.map((c, k) => `<button class="evt" type="button" data-k="${k}"><span class="rk">${k + 1}</span><span><span class="t">${esc(c.name)}</span><br><span class="s">${hz(c.dominant)} · H ${c.H.toFixed(2)} · E ${c.E.toFixed(2)} · V ${c.V.toFixed(2)} · LCC ${c.LCC.toFixed(2)}</span></span><span class="score"><b>${c.R.toFixed(2)}</b>risk</span></button>`).join('')}
      <div class="btns"><button class="btn primary" id="rkAll" type="button">Plan storage for all five</button><button class="btn" id="repRisk" type="button">Generate preparedness report</button><a class="btn" href="guide.html#mode-risk" target="_blank" rel="noopener">Guide</a></div>
      <p class="small muted">Based on ${esc(r.counts)}. Gutenberg–Richter b = ${r.gr.b.toFixed(2)}, λ(M≥6) = ${r.gr.lambda6.toExponential(1)} per year in the 400 km region.</p>`;
    bindX();
    $('#riskList').querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => openRiskCell(r.top[+b.dataset.k])));
    $('#rkAll').addEventListener('click', planRiskStorage);
    $('#repRisk').addEventListener('click', () => AA.report.open(AA.report.risk(app.riskResult)));
    if (!MAP.layer('risk').getLayers().length) MAP.drawRisk(r.cells, r.top, openRiskCell);
  };
  const riskScenario = (c) => {
    const r = app.riskResult;
    const hzd = c.dominant;
    const maxM = Math.max(6.5, ...[]);
    const mag = hzd === 'EQ' ? Math.min(8, Math.max(6.5, r.gr.a != null ? (r.gr.a - Math.log10(1 / 475)) / r.gr.b : 6.5)) : HZ_INPUT[hzd].val;
    return ENG.situationFromPlan({ lat: c.lat, lon: c.lon, name: `${AA.HAZARDS[hzd].label} risk scenario · ${c.name}`, country: r.country ? app.riskPlace.country : '', iso2: app.riskPlace.iso2, hazard: hzd, magnitude: mag, depth: 10, peakInHours: 24, areaKm2: 200 });
  };
  const openRiskCell = (c) => openPlan(riskScenario(c), { warehouses: true, back: () => { renderRiskStart(); renderRiskList(); } });
  const planRiskStorage = async () => {
    const r = app.riskResult, FL = AA.facility;
    app.toast('<span class="spin"></span> Solving storage locations across the five high-risk areas…', { sticky: true });
    const zones = r.top.map((c, k) => ({ id: 'R' + (k + 1), name: c.name, lat: c.lat, lon: c.lon, need: c.R, pop: Math.max(1000, c.pop), fc: { aff: { p90: Math.max(1000, c.pop) * 0.3 } } }));
    const pseudo = { hazard: 'FL', lat: app.riskPlace.lat, lon: app.riskPlace.lon, magnitude: 0, radiusKm: 60, countryVul: 0.5 };
    const cand = FL.candidates(pseudo, 6).map((c) => ({ ...c, safe: true }));
    r.cells.forEach((c, k) => { if (c.H > 0.75) { const near = cand.reduce((b, x, j) => (M.haversine(c, x) < M.haversine(c, cand[b]) ? j : b), 0); if (M.haversine(c, cand[near]) < 8) cand[near].safe = false; } });
    let tau;
    try { const t = await D.osrmTable([...cand, ...zones]); tau = cand.map((_, a) => zones.map((_, b) => t.dur[a][cand.length + b] / 3600)); }
    catch (e) { tau = cand.map((c) => zones.map((z) => (M.haversine(c, z) * AA.config.circuity) / AA.config.fallbackSpeedKmh)); }
    const sol = FL.mclp(zones, cand, tau, AA.config.warehouses);
    r.sites = sol.sites.map((j) => ({ lat: cand[j].lat, lon: cand[j].lon, serves: zones.filter((_, i) => sol.assign[i] === j).map((z) => z.name) }));
    app.toast('<span class="spin"></span> Looking up the address of each storage site…', { sticky: true });
    for (const site of r.sites) { try { const a = await D.reverseDetail(site.lat, site.lon, 18); site.address = a.address; site.locality = a.locality; } catch (e) { site.addressPending = false; } }
    MAP.clear('sites');
    sol.sites.forEach((j, k) => {
      const c = cand[j], served = zones.filter((_, i) => sol.assign[i] === j).map((z) => z.id + ' ' + z.name);
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: '<div class="site-diamond"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 600 })
        .bindTooltip(`<b>Recommended storage S${k + 1}</b>${MAP.addrLine(r.sites[k])}<br>Covers: ${served.map(esc).join('<br>')}<br>within ${AA.config.coverageMinutes} min by road<br><i>Click for address and directions</i><span class="m">Model: MCLP over risk-weighted areas (${esc(sol.method)})</span>`, { className: 'aa-tip' })
        .bindPopup(`<h4>Recommended storage S${k + 1}</h4><div class="small">Covers ${served.map(esc).join(', ')} within ${AA.config.coverageMinutes} min by road. Look for a warehouse, school, hall or open ground at or near this point.</div>${MAP.whereHtml(r.sites[k])}`).addTo(MAP.layer('sites'));
      zones.filter((_, i) => sol.assign[i] === j).forEach((z) => L.polyline([[c.lat, c.lon], [z.lat, z.lon]], { color: '#7c3aed', weight: 2, dashArray: '3 6' }).bindTooltip(`S${k + 1} → ${esc(z.name)} · ${AA.fmt.min(tau[j][zones.indexOf(z)])}<span class="m">Model: MCLP assignment</span>`, { className: 'aa-tip', sticky: true }).addTo(MAP.layer('sites')));
    });
    AA.map3d.setRiskSites(r.sites);
    app.toast(`Storage sites placed: ${sol.sites.length}, covering ${Math.round((100 * sol.covered) / Math.max(1e-9, sol.total))} % of risk-weighted population within ${AA.config.coverageMinutes} min.`);
  };

  // ---------------- planning view ----------------
  let building = false;
  const openPlan = async (sit, opts = {}) => {
    if (building) return; building = true;
    app.view = 'plan'; app.back = opts.back;
    MAP.clear('events', 'risk');
    panel().innerHTML = `<button class="back" type="button" id="back">← Back</button><div class="ph"><span class="eyebrow">${esc(sit.src || '')}</span><h2>${esc(sit.name || 'Scenario')}</h2></div><div class="empty" id="prog"><span class="spin"></span> Starting…</div>`;
    $('#back').addEventListener('click', goBack);
    MAP.map().setView([sit.lat, sit.lon], 9);
    try {
      await ENG.build(sit, { warehouses: !!opts.warehouses, supplyScale: opts.supplyScale || 1, mode: app.mode });
      MAP.fitPlan(ENG.state);
      AA.wsui.startInventoryAuto();
    } catch (e) {
      console.error(e); panel().insertAdjacentHTML('beforeend', `<p class="note warn">Could not build the plan: ${esc(e.message)}</p>`);
    } finally { building = false; app.toast(''); }
  };
  /** Re-open a saved plan (from storage or a plan file): same inputs, decisions replayed in order. */
  app.openSnapshot = async (snap) => {
    if (building) return; building = true;
    app.view = 'plan'; app.back = () => setMode(app.mode);
    MAP.clear('events', 'risk');
    panel().innerHTML = `<button class="back" type="button" id="back">← Back</button><div class="ph"><span class="eyebrow">Saved plan</span><h2>${esc(snap.name || 'Plan')}</h2><p class="small">Saved ${esc(snap.savedAt || '')} by ${esc(snap.savedBy || '')}. Rebuilding from the saved inputs and replaying ${(snap.events || []).length} decisions…</p></div><div class="empty" id="prog"><span class="spin"></span> Starting…</div>`;
    $('#back').addEventListener('click', goBack);
    try { await ENG.restore(snap); ENG.state.savedId = snap.id || null; MAP.fitPlan(ENG.state); renderPlanPanel(); app.toast(`Opened “${esc(snap.name)}” at T+${ENG.state.epoch * AA.config.epochHours} h.`); }
    catch (e) { console.error(e); panel().insertAdjacentHTML('beforeend', `<p class="note warn">Could not open the plan: ${esc(e.message)}</p>`); }
    finally { building = false; }
  };
  app.rerender = () => { if (app.view === 'plan' && ENG.state) renderPlanPanel(); else if (app.view === 'list') setMode(app.mode, { push: false }); };
  const goBack = () => { AA.wsui.stopInventoryAuto(); MAP.drawActions(null); ENG.state = null; MAP.clear('impact', 'zones', 'depots', 'hosp', 'legs', 'cas', 'fleet', 'closures', 'sites'); MAP.animate([]); app.view = 'list'; (app.back || (() => setMode(app.mode)))(); };

  /** Evidence box: agency-reported counts and agency alert bands beside the modelled numbers. */
  const evidenceHtml = (st) => {
    const fc = st.fcast, rep = fc.reported, mo = fc.modelled, sit = st.sit, out = [];
    if (rep) out.push(`<b>Reported so far</b> <span class="prov">${esc(rep.source)}, ${esc(rep.asOf || '')}</span><br>${['deaths', 'missing', 'injured', 'displaced', 'affected'].filter((k) => rep[k] > 0).map((k) => `${f.k(rep[k])} ${k}`).join(' · ')}<br><span class="muted">Reported counts are confirmed minimums, so the forecast never goes below them; ${rep.missing > 0 ? ` Deaths forecast = ${f.k(rep.deaths || 0)} confirmed + half of the ${f.k(rep.missing)} missing; P90 counts all missing.` : ''} Model alone: ${f.k(mo.fat.p50)} deaths, ${f.k(mo.aff.p50)} affected.</span>`);
    if (fc.pagerLosses) { const q = fc.pagerLosses.quantiles; out.push(`<b>USGS PAGER loss estimate (${esc(fc.pagerLosses.level)})</b>: deaths most likely ${f.k(q.p50)} (10–90 % range ${f.k(q.p10)}–${f.k(q.p90)}). Used instead of our own curve because PAGER is calibrated per country on past earthquakes.${fc.pagerLosses.aff ? ` Affected from PAGER shaking exposure: ${f.k(fc.pagerLosses.aff)}.` : ''} Model alone: ${f.k(mo.fat.p50)} deaths.${fc.pagerLosses.url ? ` <a href="${esc(fc.pagerLosses.url)}" target="_blank" rel="noopener">PAGER page</a>` : ''}`); }
    if (fc.pager) out.push(`<b>USGS PAGER alert: ${esc(fc.pager.pager)}</b> (${{ green: 'under 1', yellow: '1–99', orange: '100–999', red: '1,000+' }[fc.pager.pager]} deaths expected). ${fc.pager.kept ? 'Our model agrees.' : `Our model said ${f.k(fc.pager.from)}; moved into the PAGER band.`}`);
    if (sit.floodKind) out.push(`<b>Flood type: ${sit.floodKind === 'flash' ? 'flash flood' : 'river flood'}</b>${sit.reliefM != null ? ` · terrain relief ${Math.round(sit.reliefM)} m` : ''} · death rate ${sit.floodKind === 'flash' ? '1 in 100' : '1 in 10,000'} affected (calibrated on Nepal 2026 / Pakistan 2022).`);
    const wp = st.zones.filter((z) => z.popProv === 'WorldPop 2020').length, fl = st.zones.filter((z) => z.flow).length;
    if (wp || fl || sit.footprint) out.push(`<b>Where the people and water are</b>: ${wp ? `population from WorldPop 2020 (100 m grid) for ${wp} of ${st.zones.length} areas` : 'population from OpenStreetMap'}${sit.footprint ? ' · towns searched inside the GDACS flood outline' : ''}${fl ? ` · river flow read at ${fl} areas (GloFAS; highest ${Math.max(...st.zones.filter((z) => z.flow).map((z) => z.flow.ratio)).toFixed(1)}× its usual level)` : ''}.`);
    if (!rep && !fc.pager && !fc.pagerLosses && sit.event) out.push('<span class="muted">No agency impact counts published yet for this event; figures are modelled.</span>');
    return out.length ? `<div class="card small evidence" style="display:grid;gap:6px;margin:8px 0">${out.map((x) => `<div>${x}</div>`).join('')}</div>` : '';
  };
  const renderPlanPanel = () => {
    const st = ENG.state; if (!st || app.view !== 'plan') return;
    const run = st.lastRun, sit = st.sit, K = AA.config.commodities, sm = st.fcast.summary;
    const cov = K.map((k) => { const d = M.sum(st.zones.map((z) => z.d[k.key] || 0)), u = M.sum(run.alloc.unmet.map((x) => x[k.key] || 0)); return { k, d, pct: d > 0 ? (d - u) / d : 1 }; });
    const tile = (l, d, link) => `<div class="tile"><div class="l">${l}</div><div class="v">${f.k(d.p50)}</div><div class="band">P10–P90 ${f.k(d.p10)}–${f.k(d.p90)}</div></div>`;
    const evMeta = sit.event ? `${hz(sit.hazard)} ${alertDot(sit.event.alertlevel)} ${esc(sit.country || '')} · ${magText(sit.event)}${sit.windNote ? ` (planning ${Math.round(sit.magnitude)} km/h)` : ''} · ${esc(sit.event.src)}${sit.event.url ? ` · <a href="${esc(sit.event.url)}" target="_blank" rel="noopener">source report</a>` : ''}` : `${hz(sit.hazard)} ${esc(sit.country || '')} · <span class="prov">planning scenario</span>`;
    const zrows = st.zones.slice().sort((a, b) => b.need - a.need).map((z) => {
      const i = st.zones.indexOf(z), c = MAP.coverage(st, i);
      return `<tr><td><a href="#" data-z="${z.id}">${z.id}</a> ${esc(z.name)}${z.served ? ' <span class="prov">served</span>' : ''}${z.spread ? ' <span class="prov">spread</span>' : ''}${z.address ? `<br><span class="small muted">${esc(z.address)}</span>` : ''}</td><td class="num">${z.need.toFixed(2)}<div class="bar need"><i style="width:${Math.round(z.need * 100)}%"></i></div></td><td class="num">${f.k(z.fc.aff.p50)}</td><td class="num">${Math.round(c * 100)}%<div class="bar cov"><i style="width:${Math.round(c * 100)}%"></i></div></td></tr>`;
    }).join('');
    const drows = st.depots.map((d, j) => {
      const used = M.sum(K.map((k) => (run.alloc.util[j]?.used[k.key] || 0) * k.kg)), have = M.sum(K.map((k) => (d.stock[k.key] || 0) * k.kg));
      const hrs = run.alloc.util[j]?.hours.truck || 0, cap = (d.fleet.truck || 0) * AA.config.epochHours;
      return `<tr><td><a href="#" data-d="${d.id}">${d.id}</a> ${esc(d.name)}<br><span class="small muted">${d.typeLabel}${d.open ? '' : ' · <b>offline</b>'}${d.address ? ` · ${esc(d.address)}` : ''}</span></td><td class="num">${have ? Math.round((100 * used) / have) : 0}%</td><td class="num">${cap ? Math.round((100 * hrs) / cap) : 0}%</td></tr>`;
    }).join('');
    const ob = { ...AA.config.objective, ...(st.objective || {}) };
    const gap = AA.report.gap(st);
    const gapHtml = (gap.trucks || gap.buses || gap.short.length) ? `<div class="card small" style="display:grid;gap:4px"><b>What would close the gap</b>
      ${gap.trucks ? `<span>Vehicles: about <b>${gap.trucks} more trucks</b>${gap.buses ? ` and <b>${gap.buses} buses</b>` : ''} would deliver the stock that is already available but cannot be moved this epoch (truck hours used ${Math.round(gap.util * 100)} %).</span>` : ''}
      ${gap.short.length ? `<span>Stock: request ${gap.short.map((x) => `<b>${f.n(x.n, x.n < 10 ? 1 : 0)} ${x.k.unit} ${x.k.label.toLowerCase()}</b>`).join(', ')} from regional or national reserves.</span>` : ''}</div>` : '';
    panel().innerHTML = `<button class="back" type="button" id="back">← Back</button>
      <div class="ph"><span class="eyebrow">Plan · T+${st.epoch * AA.config.epochHours} h · epoch ${st.epoch}</span><h2>${esc(sit.name || 'Scenario')}</h2><p>${evMeta}</p><p class="small">Impact radius ${Math.round(sit.radiusKm)} km · ${st.zones.length} demand zones · ${st.depots.filter((d) => d.open).length}/${st.depots.length} supply stores open · ${st.hospitals.length} hospitals</p></div>
      <div class="sec"><div class="btns"><button class="btn primary" id="repBtn" type="button">Generate action report</button><a class="btn" href="guide.html#plan-view" target="_blank" rel="noopener">How to read this</a></div></div>
      <div class="sec"><h3>Key actions now <a href="guide.html#key-actions" target="_blank" rel="noopener">?</a></h3><ol class="actions">${AA.report.keyActions(st).map((a, k) => `<li><button type="button" class="act" data-act="${k}"><span class="ai">${a.icon}</span><span><b>${esc(a.text)}</b><br><span class="small muted">${esc(a.detail)}</span></span></button></li>`).join('')}</ol></div>
      <div class="sec"><h3>Forecast <a href="#m-pred" data-x="m-pred">Monte Carlo · fragility</a></h3><div class="tiles">${tile('Affected', sm.aff)}${tile('Displaced', sm.dis)}${tile('Injured', sm.inj)}${tile('Fatalities', sm.fat)}</div>${evidenceHtml(st)}<p class="small muted" style="margin:0">Estimates, not guarantees: stock is planned on the expected value and pre-positioned for P90.</p></div>
      <div class="sec"><h3>This epoch's allocation <a href="#m-milp" data-x="m-milp">MILP</a></h3>
        <div class="card" style="display:grid;gap:6px">${cov.map((c) => `<div class="covrow"><span>${c.k.label}</span><div class="bar cov"><i style="width:${Math.max(c.pct > 0 ? 2 : 0, Math.round(c.pct * 100))}%"></i></div><span class="num">${c.pct > 0 && c.pct < 0.01 ? '<1' : Math.round(c.pct * 100)}%</span></div><div class="small muted" style="margin:-4px 0 2px 82px">${f.n(c.d * c.pct, c.d * c.pct < 10 ? 1 : 0)} of ${f.n(c.d, c.d < 10 ? 1 : 0)} ${c.k.unit} needed</div>`).join('')}
        <div class="small muted">Share of this epoch's (${AA.config.epochHours} h) need delivered from stock and vehicles in the area. Low numbers mean the area needs outside supply; see below.</div></div>
        <div class="tiles"><div class="tile"><div class="l">Total cost</div><div class="v">${f.usd(run.alloc.cost.total)}</div><div class="band">vs naive ${f.usd(run.alloc.C0)}</div></div><div class="tile"><div class="l">Vehicle trips</div><div class="v">${run.cons.tripsAfter}</div><div class="band">${run.cons.saved} saved by consolidation</div></div></div>
        ${gapHtml}
        <p class="small muted" style="margin:0">${esc(run.alloc.method)} · ${run.alloc.ms} ms · routing ${run.routing === 'done' ? `${run.legs.length} legs done` : '<span class="spin"></span> in progress'}${run.legs.some((l) => l.airdrop) ? ` · <b style="color:#b91c1c">${run.legs.filter((l) => l.airdrop).length} air drop</b>` : ''}</p></div>
      ${AA.wsui.planSection(st)}
      ${AA.workspace.can('edit') ? '' : '<!--'}<div class="sec"><h3>Respond to change <a href="#m-loop" data-x="m-loop">rolling horizon</a></h3>
        <div class="btns"><button class="btn primary" data-ev="advance" type="button">Advance 6 h</button><button class="btn" data-pick="closure" type="button">Close a road</button><button class="btn" data-pick="spread" type="button">Disaster spreads</button><button class="btn" data-pick="supply" type="button">New supplies arrive</button><button class="btn" data-ev="aftershock" type="button">${sit.hazard === 'EQ' ? 'Aftershock' : 'New damage'}</button><button class="btn ${st.congestion > 1 ? 'on' : ''}" data-ev="congestion" type="button">Congestion ${st.congestion > 1 ? 'on' : 'off'}</button>${st.closures.length ? '<button class="btn" data-ev="clearClosures" type="button">Clear closures</button>' : ''}</div>
        <p class="small muted" style="margin:0">Click a zone (green) for surge / served / field report; click a supply store (red) to take it offline.</p>
        <label class="field">Supply level <span class="mono">${st.supplyScale.toFixed(2)}×</span><input id="supScale" type="range" min="0.25" max="4" step="0.25" value="${st.supplyScale}"></label>
        <label class="field">Policy: lowest cost ↔ strongest equity <span class="mono">δ = ${ob.delta}, β = ${ob.beta}</span><input id="eqW" type="range" min="0" max="6" step="0.5" value="${ob.delta}"></label></div>${AA.workspace.can('edit') ? '' : '-->'}
      <div class="sec"><h3>Demand zones by need <a href="#m-need" data-x="m-need">need score</a></h3><div class="tablewrap"><table class="t"><thead><tr><th>Zone</th><th class="num">Need</th><th class="num">Affected</th><th class="num">Critical cov.</th></tr></thead><tbody>${zrows}</tbody></table></div></div>
      <div class="sec"><h3>Supply stores <a href="#m-milp" data-x="m-milp">stock & fleet use</a></h3><div class="tablewrap"><table class="t"><thead><tr><th>Store</th><th class="num">Stock used</th><th class="num">Truck hours</th></tr></thead><tbody>${drows}</tbody></table></div><p class="small muted" style="margin:0">Facility locations are real (OpenStreetMap). Stock and fleet are planning assumptions by facility type, scaled by the supply level, until you import your own inventory.</p>
        ${AA.workspace.can('inventory') ? '<label class="field">Import your inventory (CSV: name, lat, lon, type, water_l, food_kg, tents, medkits, staff, trucks, buses, ambulances, beds)<input id="csvIn" type="file" accept=".csv,text/csv"></label>' : ''}</div>
      ${st.warehouses ? `<div class="sec"><h3>Recommended storage <a href="#m-mclp" data-x="m-mclp">MCLP</a></h3><div class="tablewrap"><table class="t"><thead><tr><th>Site</th><th class="num">Water kL</th><th class="num">Food t</th><th class="num">Tents</th><th class="num">Med</th></tr></thead><tbody>${st.warehouses.sizes.map((s, k) => { const c = st.warehouses.cand[s.j]; return `<tr><td><b>S${k + 1}</b> ${c.address ? esc(c.address) : `<span class="mono">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</span>`} · <a href="${D.mapsUrl(c)}" target="_blank" rel="noopener">map</a><br><span class="small muted">serves ${esc(s.zones.map((id) => st.zones.find((z) => z.id === id)?.name || id).join(', '))}</span></td><td class="num">${f.n(s.stock.water)}</td><td class="num">${f.n(s.stock.food, 1)}</td><td class="num">${f.n(s.stock.shelter)}</td><td class="num">${f.n(s.stock.medical)}</td></tr>`; }).join('')}</tbody></table></div><p class="small muted" style="margin:0">${Math.round((100 * st.warehouses.sol.covered) / Math.max(1e-9, st.warehouses.sol.total))} % of need covered within ${AA.config.coverageMinutes} min · 72 h of P90 demand per site.</p></div>` : ''}
      <div class="sec"><h3>Change log</h3><div class="log">${st.log.slice(0, 10).map((e) => `<div class="e"><b>T+${e.epoch * AA.config.epochHours} h</b> · ${esc(e.reason)}<div class="d">cost ${f.usd(e.cost)}${e.diff ? ` (${e.diff.cost.after >= e.diff.cost.before ? '+' : '−'}${f.usd(Math.abs(e.diff.cost.after - e.diff.cost.before))})` : ''}${e.diff && e.diff.redirected.length ? ` · trips ${e.diff.redirected.slice(0, 4).map((r) => `${r.id} ${r.before}→${r.after}`).join(', ')}` : ''}${e.diff ? ` · unmet water ${f.n(e.diff.unmet[0].before, 0)}→${f.n(e.diff.unmet[0].after, 0)} kL` : ''}</div></div>`).join('')}</div></div>
      ${st.notes.length ? `<div class="sec"><h3>Data notes</h3>${st.notes.map((n) => `<p class="note warn">${esc(n)}</p>`).join('')}</div>` : ''}
      <div class="sec"><h3>Sources</h3><p class="small muted" style="margin:0">Population & facilities: OpenStreetMap (Overpass) · roads: OSRM · vulnerability: ${esc(sit.countryIdx?.prov || 'assumed')}${sit.countryIdx?.gdppc ? ` (GDP pc $${f.n(sit.countryIdx.gdppc)}, ${sit.countryIdx.beds ?? '–'} beds/1000)` : ''} · hazard: ${esc(sit.src)}</p></div>`;
    $('#back').addEventListener('click', goBack);
    bindX();
    $('#repBtn').addEventListener('click', () => AA.report.open(AA.report.plan(st)));
    AA.wsui.bindPlan(st);
    const acts = AA.report.keyActions(st);
    panel().querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { const a = acts[+b.dataset.act]; if (a?.at) MAP.map().flyTo([a.at.lat, a.at.lon], Math.max(MAP.map().getZoom(), 11)); }));
    MAP.drawActions(acts, () => AA.report.open(AA.report.plan(st)));
    panel().querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => AA.wsui.act(b.dataset.ev)));
    panel().querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.pick;
      app.pickPoint({ closure: 'Click on a road to close it', spread: 'Click where the disaster has spread', supply: 'Click where new supplies have arrived' }[t], (ll) => AA.wsui.act(t, { lat: ll.lat, lon: ll.lng }));
    }));
    panel().querySelectorAll('[data-z]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const z = st.zones.find((x) => x.id === a.dataset.z); MAP.map().setView([z.lat, z.lon], Math.max(MAP.map().getZoom(), 11)); }));
    panel().querySelectorAll('[data-d]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const d = st.depots.find((x) => x.id === a.dataset.d); MAP.map().setView([d.lat, d.lon], Math.max(MAP.map().getZoom(), 11)); }));
    $('#csvIn')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const rows = AA.workspace.normaliseRows(AA.workspace.parseCSV(await file.text()));
      if (!rows.length) { app.toast('The CSV needs a header row with at least name, lat and lon columns.', { err: true }); return; }
      AA.wsui.act('importDepots', { rows, source: file.name });
    });
    $('#supScale')?.addEventListener('change', (e) => AA.wsui.act('supplyScale', { value: +e.target.value }));
    $('#eqW')?.addEventListener('change', (e) => { const v = +e.target.value; AA.wsui.act('objective', { delta: v, beta: v / 2, mu: Math.max(0.5, v * 1.5), alpha: 1 }); });
  };

  const zonePopup = (z) => {
    const el = document.createElement('div');
    el.innerHTML = `<h4>${z.id} · ${esc(z.name)}</h4><div class="small">Need ${z.need.toFixed(2)} · severity ${(z.sevPost ?? z.sevMean).toFixed(2)}${z.sevSd ? ` ± ${z.sevSd.toFixed(2)}` : ''}<br>Population ${f.k(z.pop)} <span class="prov">${z.popProv}</span><br>Affected ${f.k(z.fc.aff.p50)}, displaced ${f.k(z.fc.dis.p50)}, injured ${f.n(z.fc.inj.p50)}${z.covers?.length ? `<br>Also covers: ${esc(z.covers.join(', '))}` : ''}</div>${MAP.whereHtml(z)}
      <div class="btns"><button class="btn" data-a="surge">Demand surge</button><button class="btn" data-a="${z.served ? 'unserved' : 'served'}">${z.served ? 'Needs aid again' : 'Mark served'}</button></div>
      <div class="field" style="margin-top:8px">Field report: observed severity <span class="mono" id="rv">0.80</span><input type="range" min="0" max="1" step="0.05" value="0.8" id="rr"><select id="rs"><option value="0.1">Trained assessor (σ 0.10)</option><option value="0.2">Crowd report (σ 0.20)</option></select><button class="btn" data-a="report">Apply Bayesian update</button></div>`;
    el.querySelector('#rr').addEventListener('input', (e) => (el.querySelector('#rv').textContent = (+e.target.value).toFixed(2)));
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { MAP.map().closePopup(); const a = b.dataset.a; AA.wsui.act(a, a === 'report' ? { zoneId: z.id, value: +el.querySelector('#rr').value, sd: +el.querySelector('#rs').value } : { zoneId: z.id }); }));
    if (!AA.workspace.can('edit')) el.querySelectorAll('.btns, .field').forEach((x) => x.remove());
    return el;
  };
  const depotPopup = (d) => {
    const el = document.createElement('div');
    const K = AA.config.commodities;
    el.innerHTML = `<h4>${d.id} · ${esc(d.name)}</h4><div class="small">${d.typeLabel}${d.damaged ? ' · inside heavy-damage zone' : ''}<br>${K.map((k) => `${k.label}: ${f.n(d.stock[k.key], d.stock[k.key] < 10 ? 1 : 0)} ${k.unit}`).join('<br>')}<br>Fleet: ${d.fleet.truck} trucks, ${d.fleet.bus} buses, ${d.fleet.amb || 0} ambulances<br><span class="prov">${esc(d.prov)}</span>${d.osm ? ` <a href="https://www.openstreetmap.org/${d.osm}" target="_blank" rel="noopener">OSM</a>` : ''}</div>${MAP.whereHtml(d)}
      <div class="btns"><button class="btn" data-a="depot">${d.open ? 'Take offline' : 'Bring online'}</button><button class="btn" data-a="breakdown">Truck breakdown</button></div>`;
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { MAP.map().closePopup(); AA.wsui.act(b.dataset.a, { depotId: d.id }); }));
    if (!AA.workspace.can('edit')) el.querySelectorAll('.btns').forEach((x) => x.remove());
    return el;
  };
  const handlers = { zonePopup, depotPopup };

  // engine events → UI
  ENG.on((type, data) => {
    if (type === 'progress') { app.toast(`<span class="spin"></span> ${esc(data)}`, { sticky: true }); const p = $('#prog'); if (p) p.innerHTML = `<span class="spin"></span> ${esc(data)}`; }
    if (type === 'error') app.toast(esc(data), { err: true });
    if (type === 'solved') { app.toast(''); MAP.drawPlan(ENG.state, handlers); renderPlanPanel(); AA.explain.refreshIfOpen(); }
    if (type === 'leg') MAP.drawLeg(ENG.state, data);
    if (type === 'routed') { MAP.animate(data.legs); renderPlanPanel(); AA.explain.refreshIfOpen(); }
    if (type === 'warehouses') MAP.drawSites(ENG.state);
    if (type === 'addresses' && ENG.state) { const st = ENG.state; MAP.drawPlan(st, handlers); (st.lastRun?.legs || []).forEach((l) => MAP.drawLeg(st, l)); if (st.lastRun?.routing === 'done') MAP.animate(st.lastRun.legs); renderPlanPanel(); }
  });

  // ---------------- search ----------------
  const onPlace = (p) => {
    $('#qres').hidden = true;
    if (app.mode === 'live') { MAP.map().setView([p.lat, p.lon], 9); return; }
    if (app.mode === 'plan') { if (app.view === 'plan') goBack(); setPlanPlace(p); return; }
    if (app.mode === 'history') { if (app.view === 'plan') goBack(); runHistory(p); return; }
    if (app.mode === 'risk') { if (app.view === 'plan') goBack(); renderRiskStart(); runRisk(p); }
  };
  const doSearch = async () => {
    const q = $('#q').value.trim(); if (!q) return;
    const ul = $('#qres'); ul.hidden = false; ul.innerHTML = '<li class="empty" style="padding:8px"><span class="spin"></span> Searching…</li>';
    try {
      const rs = await D.geocode(q);
      app.results = rs;
      ul.innerHTML = rs.length ? rs.map((r, k) => `<li><button type="button" data-k="${k}"><b>${esc(r.short)}</b><br><span class="small muted">${esc(r.name)}</span></button></li>`).join('') : '<li class="empty" style="padding:8px">No match. Try a city and country.</li>';
      ul.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => onPlace(rs[+b.dataset.k])));
    } catch (e) { ul.innerHTML = `<li class="empty" style="padding:8px">Search failed: ${esc(e.message)}</li>`; }
  };

  // ---------------- settings ----------------
  const SKEY = 'aidatlas.settings';
  const loadSettings = () => { try { const s = JSON.parse(localStorage.getItem(SKEY) || '{}'); Object.assign(AA.config, s.config || {}); if (s.needWeights) AA.config.needWeights = s.needWeights; } catch (e) {} };
  const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify({ config: { tomtomKey: AA.config.tomtomKey, coverageMinutes: AA.config.coverageMinutes, warehouses: AA.config.warehouses }, needWeights: AA.config.needWeights })); } catch (e) {} };
  const openSettings = () => {
    const m = $('#settings'), w = AA.config.needWeights;
    m.hidden = false;
    m.innerHTML = `<div class="box" role="dialog" aria-label="Settings"><h2>Settings</h2>
      <label class="field">TomTom traffic API key (free tier) — shows live traffic flow on the map<input id="sTT" type="text" value="${esc(AA.config.tomtomKey)}" placeholder="paste key from developer.tomtom.com"></label>
      <div class="eyebrow">Need-score weights (fairness)</div>
      <div class="grid2">${Object.entries(w).map(([k, v]) => `<label class="field">${({ sev: 'Severity', pop: 'Population at risk', vul: 'Vulnerability', acc: 'Access difficulty', recv: 'Already received (−)' })[k]}<input type="number" step="0.05" min="0" max="1" data-w="${k}" value="${v}"></label>`).join('')}</div>
      <div class="grid2"><label class="field">Storage sites to recommend (P)<input id="sP" type="number" min="1" max="6" value="${AA.config.warehouses}"></label><label class="field">Coverage time (min)<input id="sTc" type="number" min="15" max="240" step="15" value="${AA.config.coverageMinutes}"></label></div>
      <p class="small muted">Weights are renormalised to sum to 1. Changes apply to the next plan you open.</p>
      <p class="small muted" style="margin:0">AidAtlas · built by <a href="https://github.com/darshchawla-code" target="_blank" rel="noopener">@Darshchawla</a></p>
      <div class="btns"><button class="btn primary" id="sSave" type="button">Save</button><button class="btn" id="sCancel" type="button">Cancel</button></div></div>`;
    $('#sCancel').addEventListener('click', () => (m.hidden = true));
    m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
    $('#sSave').addEventListener('click', () => {
      AA.config.tomtomKey = $('#sTT').value.trim();
      const nw = {}; m.querySelectorAll('[data-w]').forEach((i) => (nw[i.dataset.w] = Math.max(0, +i.value || 0)));
      const s = M.sum(Object.values(nw)) || 1; Object.keys(nw).forEach((k) => (nw[k] = +(nw[k] / s).toFixed(3)));
      AA.config.needWeights = nw; AA.config.warehouses = M.clamp(+$('#sP').value || 3, 1, 6); AA.config.coverageMinutes = M.clamp(+$('#sTc').value || 90, 15, 240);
      saveSettings(); MAP.setTraffic(AA.config.tomtomKey); legend(); m.hidden = true; app.toast('Settings saved');
    });
  };

  const bindX = () => panel().querySelectorAll('[data-x]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); AA.explain.open(a.dataset.x); }));

  // ---------------- boot ----------------
  const boot = () => {
    loadSettings();
    MAP.init('map');
    legend();
    if (root.innerWidth < 860) { $('#legend').classList.add('collapsed'); $('#legendToggle').textContent = 'show'; }
    /** One click handler for the 2D and 3D maps. latlng = { lat, lng }. */
    app.mapClick = async (latlng) => {
      if (pick) { const cb = pick; endPick(); cb(latlng); return; }
      if (app.view === 'plan') return;
      const p = { lat: latlng.lat, lon: latlng.lng };
      if (app.mode === 'plan') setPlanPlace(p);
      else if (app.mode === 'history' || app.mode === 'risk') { try { const r = await D.reverse(p.lat, p.lon); Object.assign(p, r); } catch (er) {} onPlace(p); }
    };
    app.picking = () => !!pick;
    MAP.map().on('click', (e) => app.mapClick(e.latlng));
    // Map view: 2D by default (fast to load). The 2D | 3D switch on the map loads the 3D engine only when asked;
    // the choice is remembered per browser; ?view=2d / ?view=3d in a link override it.
    AA.map3d.hook();
    $('#viewToggle').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (!b) return; if (b.dataset.view === '3d') AA.map3d.enter(); else AA.map3d.exit(); });
    AA.map3d.updateButton();
    const want3d = new URLSearchParams(location.search).get('view');
    if (want3d === '3d' || (want3d !== '2d' && AA.workspace.get('view3d', false) === true && AA.map3d.supported())) AA.map3d.enter();
    $('#hintCancel').addEventListener('click', endPick);
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); if (e.key === 'Escape') $('#qres').hidden = true; });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('#qres').hidden = true; });
    document.querySelectorAll('.tabs a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); setMode(a.dataset.mode); }));
    $('#btnExplain').addEventListener('click', () => AA.explain.open());
    $('#drawerClose').addEventListener('click', AA.explain.close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { AA.explain.close(); $('#settings').hidden = true; $('#workspace').hidden = true; endPick(); } });
    $('#btnSettings').addEventListener('click', openSettings);
    $('#btnWork').addEventListener('click', () => AA.wsui.openWorkspace());
    AA.wsui.refreshBadge();
    if (AA.workspace.cloud?.config()) AA.workspace.cloud.init().then(() => { AA.wsui.refreshBadge(); if (app.view === 'list') app.rerender(); }).catch((e) => app.toast(`Shared workspace: ${esc(e.message)}`, { err: true }));
    if (!root.solver) app.toast('Optimisation library failed to load — check your connection and reload.', { err: true, sticky: true });
    const mode = new URLSearchParams(location.search).get('mode') || 'live';
    setMode(['live', 'plan', 'history', 'risk'].includes(mode) ? mode : 'live', { push: false });
    if (location.hash === '#explain') AA.explain.open();
    deepLink(new URLSearchParams(location.search));
  };
  // Shareable deep links: ?mode=plan&q=Gurugram&hazard=EQ&mag=7.2  ·  ?mode=history&q=Kathmandu  ·  ?mode=risk&q=Manila  ·  ?mode=live&event=top
  const deepLink = async (qs) => {
    const q = qs.get('q'); if (!q || app.mode === 'live') return;
    $('#q').value = q;
    let place;
    try { place = (await D.geocode(q))[0]; } catch (e) { app.toast(`Search failed: ${esc(e.message)}`, { err: true }); return; }
    if (!place) { app.toast(`No place found for “${esc(q)}”.`, { err: true }); return; }
    if (app.mode === 'plan') {
      await setPlanPlace(place);
      const hzd = (qs.get('hazard') || '').toUpperCase();
      if (AA.HAZARDS[hzd]) { $('#pHz').value = hzd; $('#pHz').dispatchEvent(new Event('change')); }
      if (qs.get('mag')) $('#pMag').value = qs.get('mag');
      if (hzd) $('#pRun').click();
    } else onPlace(place);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
