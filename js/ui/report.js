/* Plain-English action reports for authorities (Met department, disaster management, district
   administration). Built only from the model outputs on screen; no text is invented by an AI.
   Skill: modes (reports) */
(function (root) {
  const AA = root.AA, M = AA.math, f = AA.fmt;
  const R = {};
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- plain-language helpers ----------
  const about = (n) => {
    if (!isFinite(n) || n <= 0) return 'none';
    if (n < 0.5) return 'less than 1';
    if (n < 10) return String(Math.round(n));   // people and items are whole numbers: never 1.7 people
    const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
    return (Math.round(n / p) * p).toLocaleString('en-US');
  };
  const whole = (n) => (n > 0 ? Math.max(1, Math.ceil(n - 1e-9)) : 0).toLocaleString('en-US');   // things we deliver come in whole units, rounded up
  const people = (n) => (n < 0.5 ? 'almost nobody' : `about ${about(n)} ${about(n) === '1' ? 'person' : 'people'}`);
  const dec = (n) => (!isFinite(n) || n <= 0 ? 'none' : n < 10 ? String(Math.round(n * 10) / 10) : about(n));   // measures (kilolitres, tonnes) may keep one decimal
  const aboutN = (n) => (n < 0.5 ? 'less than 1' : `about ${about(n)}`);
  const mins = (h) => { if (h < 1) return `${Math.max(5, Math.round(h * 60 / 5) * 5)} minutes`; const v = Math.round(h * 2) / 2; return `${v} hour${v === 1 ? '' : 's'}`; };
  const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;
  const an = (w) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
  const list = (arr) => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);
  const qty = (k, q) => {
    const c = AA.config.commodities.find((x) => x.key === k);
    const words = { water: `${dec(q)} kilolitres of drinking water (${about(q * 1000)} litres)`, food: q < 1 ? `${about(q * 1000)} kg of food` : `${dec(q)} tonnes of food`, shelter: `${whole(q)} family ${q <= 1 ? 'tent' : 'tents'}`, medical: `${whole(q)} medical ${q <= 1 ? 'kit' : 'kits'}`, staff: `${whole(q)} relief ${q <= 1 ? 'worker' : 'workers'}` };
    return words[k] || `${dec(q)} ${c ? c.unit : ''}`;
  };
  R.about = about;

  // ---------- hazard guidance (standard public-safety advice: WHO, IFRC, India NDMA, US FEMA) ----------
  R.ADVICE = {
    EQ: {
      word: 'earthquake',
      warn: 'Warn people to expect aftershocks. Tell them to stay out of cracked buildings, and to drop, cover and hold on if the ground shakes again.',
      first: ['Send search-and-rescue teams to the worst-hit areas first. Most people trapped under rubble are saved in the first 72 hours.', 'Check hospitals, schools, bridges and dams for damage before people go back in.', 'Shut off gas lines in damaged areas to stop fires.'],
      later: ['Set up safe open-ground camps away from tall buildings.', 'Get engineers to tag buildings as safe, unsafe or needs repair.'],
      watch: 'Strong aftershocks, landslides on hill roads, and dam or embankment damage.',
    },
    TC: {
      word: 'cyclone',
      warn: 'Tell people in low-lying coastal areas and in weak (kutcha) houses to move to cyclone shelters now, before the wind and sea surge arrive. Fishing boats must return to harbour.',
      first: ['Move people out of the storm-surge zone first; most cyclone deaths are from sea water, not wind.', 'Fill shelters with water, food and medicine before landfall.', 'Keep cranes, chainsaws and road-clearing teams ready to open roads straight after the storm.'],
      later: ['Do not let people touch fallen power lines.', 'Restore drinking water quickly to stop diarrhoea outbreaks.'],
      watch: 'Changes in the storm track, heavy rain and river flooding after landfall.',
    },
    FL: {
      word: 'flood',
      warn: 'Tell people to move to higher ground with documents, medicine and drinking water. Never walk or drive through moving water; 30 cm of water can sweep away a car.',
      first: ['Send boats and rescue teams to people stranded on roofs and in low areas.', 'Warn villages downstream before any dam or barrage gates are opened.', 'Hand out water purification tablets or chlorine; flood water spreads cholera and typhoid.'],
      later: ['Spray for mosquitoes to prevent dengue and malaria.', 'Check embankments and pump out water from hospitals and power stations first.'],
      watch: 'Rising river levels upstream, more rain in the catchment, and dam releases.',
    },
    WF: {
      word: 'wildfire',
      warn: 'Tell people near the fire to leave early on the named evacuation roads. Close windows and wear N95 masks if there is smoke.',
      first: ['Keep evacuation roads clear for fire engines.', 'Move people with breathing problems, the elderly and children away from the smoke first.'],
      later: ['Watch for flash floods and landslides on burnt hills when it rains.'],
      watch: 'Wind speed and direction, temperature, and new fire spots.',
    },
    VO: {
      word: 'volcanic eruption',
      warn: 'Keep everyone out of the danger zone around the volcano. Tell people to wear masks or wet cloth against ash and to stay indoors when ash is falling.',
      first: ['Evacuate the exclusion zone completely.', 'Cover drinking-water tanks and wells to keep ash out.'],
      later: ['Clear heavy ash from roofs before they collapse, especially after rain.'],
      watch: 'Volcano observatory alerts, ash plume direction and mudflows in river valleys.',
    },
    DR: {
      word: 'drought',
      warn: 'Ask people to save water. Tell them where water tankers will come and when.',
      first: ['Run water tankers on a fixed timetable to the worst-hit villages.', 'Start food and fodder distribution for families and livestock.', 'Screen children under five for malnutrition.'],
      later: ['Repair hand pumps and check-dams; plan crop insurance and work-for-food schemes.'],
      watch: 'Rainfall, groundwater levels, and food prices in local markets.',
    },
  };
  const adv = (h) => R.ADVICE[h] || R.ADVICE.EQ;

  // ---------- bottleneck: stock or vehicles? (shared with the panel) ----------
  R.gap = (st) => {
    const run = st.lastRun, a = run.alloc, K = AA.config.commodities, dt = AA.config.epochHours;
    const open = st.depots.map((d, j) => ({ d, j })).filter((x) => x.d.open);
    const short = [], deliverableKg = { truck: 0, bus: 0 };
    K.forEach((k) => {
      const unmet = M.sum(a.unmet.map((u) => u[k.key] || 0));
      const left = M.sum(open.map(({ d, j }) => Math.max(0, (d.stock[k.key] || 0) - (a.util[j]?.used[k.key] || 0))));
      if (unmet - left > 1e-6 * Math.max(1, unmet)) short.push({ k, n: unmet - left });
      deliverableKg[k.cls] += Math.min(unmet, left) * k.kg;
    });
    const used = M.sum(open.map(({ j }) => a.util[j]?.hours.truck || 0)), budget = M.sum(open.map(({ d }) => (d.fleet.truck || 0) * dt));
    const cyc = a.trips.filter((t) => t.cls === 'truck').map((t) => 2 * run.pb.tau[t.j][t.i] + AA.config.serviceHours);
    const perTruck = Math.max(1, Math.floor(dt / (cyc.length ? M.mean(cyc) : dt)));
    return { short, util: budget ? used / budget : 0, trucks: Math.ceil(deliverableKg.truck / AA.config.vehicles.truck.cap / perTruck), buses: Math.ceil(deliverableKg.bus / AA.config.vehicles.bus.cap / perTruck) };
  };

  /** Supply dispatches grouped by store → zone, largest first. */
  R.dispatches = (st) => {
    const run = st.lastRun; if (!run) return [];
    const g = new Map();
    run.cons.tours.forEach((t) => t.cargo.forEach((c) => {
      const key = `${t.j}>${c.i}`;
      const e = g.get(key) || { j: t.j, i: c.i, trucks: 0, buses: 0, cargo: {}, kg: 0, milk: false };
      if (t.stops[0] === c.i) e[t.cls === 'bus' ? 'buses' : 'trucks']++;
      if (t.kind === 'milk-run') e.milk = true;
      Object.entries(c.cargo).forEach(([k, q]) => { e.cargo[k] = (e.cargo[k] || 0) + q; e.kg += q * AA.config.commodities.find((x) => x.key === k).kg; });
      g.set(key, e);
    }));
    const air = new Set(run.legs.filter((l) => l.airdrop && l.from.kind === 'd').map((l) => `${l.from.idx}>${l.to.idx}`));
    return [...g.values()].map((e) => ({ ...e, depot: st.depots[e.j], zone: st.zones[e.i], hours: run.pb.tau[e.j][e.i], air: air.has(`${e.j}>${e.i}`) })).sort((a, b) => b.kg - a.kg);
  };

  /** Short, ordered key actions for the map overlay and the report summary. */
  R.keyActions = (st) => {
    const run = st.lastRun, sit = st.sit, A = adv(sit.hazard), out = [];
    if (!run) return out;
    const zones = st.zones.slice().sort((a, b) => b.need - a.need);
    const top = zones.slice(0, 3);
    out.push({ icon: '!', text: `Warn and protect people in ${list(top.map((z) => z.name))}.`, detail: A.warn, at: top[0] });
    const rp = st.fcast.reported;
    if (rp && rp.missing > 0) out.push({ icon: '?', text: `Search for ${Math.round(rp.missing).toLocaleString('en')} people reported missing.`, detail: `Agencies have confirmed ${Math.round(rp.deaths || 0).toLocaleString('en')} deaths so far (${rp.asOf || 'latest report'}). ${sit.hazard === 'FL' ? 'Send search-and-rescue teams with boats and ropes downstream and to cut-off villages' : 'Send search-and-rescue teams to the worst-hit and cut-off areas'}; most survivors are found in the first 72 hours.`, at: top[0] });
    const dis = st.fcast.summary.dis.p50;
    if (dis >= 1) out.push({ icon: '⌂', text: `Open shelter for ${people(dis)} (up to ${about(st.fcast.summary.dis.p90)} in the worst case).`, detail: `About ${whole(dis / 5)} family tents or equivalent space in schools and halls.`, at: top[0] });
    const flows = run.casualty.flows.slice().sort((a, b) => b.n - a.n);
    if (flows.length) { const fl = flows[0]; out.push({ icon: '+', text: `Send ambulances: ${about(M.sum(flows.map((x) => x.n)))} seriously injured patients to ${list([...new Set(flows.map((x) => st.hospitals[x.h].name))].slice(0, 3))}.`, detail: `First run: ${about(fl.n)} patients from ${st.zones[fl.i].name} to ${st.hospitals[fl.h].name} (${mins(fl.tau)})${st.hospitals[fl.h].address ? `, ${st.hospitals[fl.h].address}` : ''}.`, at: st.hospitals[fl.h] }); }
    const d = R.dispatches(st).filter((x) => !x.air)[0];
    if (d) out.push({ icon: '→', text: `Dispatch supplies: ${d.trucks + d.buses || 1} vehicle${(d.trucks + d.buses) > 1 ? 's' : ''} from ${d.depot.name} to ${d.zone.name} first.`, detail: `${Object.entries(d.cargo).filter(([, q]) => q > 1e-3).map(([k, q]) => qty(k, q)).join('; ')}.${d.depot.address ? ` Pick up at ${d.depot.address}.` : ''}`, at: d.zone });
    const air = run.legs.filter((l) => l.airdrop);
    if (air.length) out.push({ icon: '✈', text: `Arrange helicopter or air drops for ${list([...new Set(air.map((l) => l.b.name))])}: no road gets through.`, detail: 'All road routes cross a closure or a badly damaged stretch.', at: air[0].b });
    const g = R.gap(st);
    if (g.short.length || g.trucks) out.push({ icon: '⇪', text: `Ask for outside help: ${[g.trucks ? plural(g.trucks, 'more truck') : '', ...g.short.slice(0, 3).map((x) => qty(x.k.key, x.n))].filter(Boolean).join(', ')}.`, detail: 'Local stock and vehicles cannot cover this 6-hour period.', at: null });
    if (st.warehouses?.sizes?.length) { const s = st.warehouses.sizes[0], c = st.warehouses.cand[s.j]; out.push({ icon: '◆', text: `Pre-position stock at ${st.warehouses.sizes.length} storage site${st.warehouses.sizes.length > 1 ? 's' : ''} (purple diamonds).`, detail: `Site S1${c.address ? ` (${c.address})` : ''} should hold ${qty('water', s.stock.water)} and ${qty('food', s.stock.food)} for 3 days.`, at: c }); }
    return out;
  };

  // ---------- report builders ----------
  const head = (title, sub) => ({ title, sub, created: new Date() });
  const section = (h, html) => ({ h, html });
  /** "Name (address)" for a place; coordinates when no street address is known. */
  const at = (p) => (p.address ? ` (${esc(p.address)})` : ` (${(+p.lat).toFixed(4)}, ${(+p.lon).toFixed(4)})`);
  const mapLink = (p) => `<a href="${AA.data.mapsUrl(p)}" target="_blank" rel="noopener">map</a>`;
  /** Every place the plan names, with its address, coordinates and a directions link. */
  const placesTable = (rows) => `<table class="rt"><thead><tr><th>Place</th><th>What</th><th>Address</th><th>Coordinates</th><th>Map</th></tr></thead><tbody>${rows.map(([n, what, p]) => `<tr><td>${esc(n)}</td><td>${esc(what)}</td><td>${p.address ? esc(p.address) : '<i>no street address in map data</i>'}</td><td>${(+p.lat).toFixed(5)}, ${(+p.lon).toFixed(5)}</td><td>${mapLink(p)}</td></tr>`).join('')}</tbody></table>`;
  R.placesTable = placesTable;
  const steps = (arr) => `<ol class="steps">${arr.filter(Boolean).map((s) => `<li>${s}</li>`).join('')}</ol>`;
  const bullets = (arr) => `<ul>${arr.filter(Boolean).map((s) => `<li>${s}</li>`).join('')}</ul>`;
  const severityWord = (st) => {
    const max = Math.max(...st.zones.map((z) => z.sevPost ?? z.sevMean)), fat = st.fcast.summary.fat.p50;
    if (max > 0.6 || fat > 1000) return 'very severe';
    if (max > 0.3 || fat > 100) return 'severe';
    if (max > 0.1 || fat > 10) return 'moderate';
    return 'limited';
  };

  R.plan = (st) => {
    const sit = st.sit, run = st.lastRun, A = adv(sit.hazard), sm = st.fcast.summary, K = AA.config.commodities;
    const hzLabel = AA.HAZARDS[sit.hazard].label;
    const strength = sit.hazard === 'EQ' ? `magnitude ${sit.magnitude.toFixed(1)}${sit.event && sit.event.magSource ? ` (${sit.event.magSource}${sit.event.mags && sit.event.mags.length > 1 ? `; other agencies: ${sit.event.mags.filter((m) => m.src !== sit.event.magSource).map((m) => `${m.src} ${(+m.mag).toFixed(1)}`).join(', ')}` : ''})` : ''}` : sit.hazard === 'TC' ? `winds of about ${Math.round(sit.magnitude)} km/h` : `intensity ${Math.round(sit.magnitude * 10)}/10`;
    const zones = st.zones.slice().sort((a, b) => b.need - a.need);
    const disp = R.dispatches(st);
    const g = R.gap(st);
    const flows = run.casualty.flows.slice().sort((a, b) => b.n - a.n);
    const air = run.legs.filter((l) => l.airdrop);
    const scenario = sit.event ? (sit.prov === 'historical' ? 'replay of a past event' : 'live event') : 'planning scenario (no disaster is happening; this is a drill)';
    const r = head(`${hzLabel} action report: ${sit.name || sit.placeName || ''}`, `${sit.country || ''} · ${scenario} · plan time T+${st.epoch * AA.config.epochHours} h`);
    r.sections = [
      section('In one paragraph', `<p>${an(hzLabel.toLowerCase()).replace(/^a/, 'A')} with ${strength} is ${sit.event ? 'affecting' : 'assumed to hit'} ${sit.placeName ? `${esc(sit.placeName)}${sit.country && !String(sit.placeName).endsWith(sit.country) ? `, ${esc(sit.country)}` : ''}` : esc(sit.event ? (sit.country || sit.name || 'the area') : (sit.name || 'the area'))}. We expect the damage to be <b>${severityWord(st)}</b> within about ${Math.round(sit.radiusKm)} km. Our best estimate is that <b>${people(sm.aff.p50)}</b> will be affected, <b>${people(sm.dis.p50)}</b> will need shelter, <b>${people(sm.inj.p50)}</b> will be injured and <b>${aboutN(sm.fat.p50)}</b> could die. These are estimates: the real numbers could be anywhere from ${about(sm.aff.p10)} to ${about(sm.aff.p90)} affected, so plan for the higher number.</p>${(() => { const r = st.fcast.reported; if (!r) return ''; const bits = ['deaths', 'missing', 'injured', 'displaced', 'affected'].filter((k) => r[k] > 0).map((k) => `${Math.round(r[k]).toLocaleString('en')} ${k}`); return `<p><b>Already confirmed by agencies</b> (${esc(r.source)}, ${esc(r.asOf || 'latest')}): ${bits.join(', ')}. These are minimums: the numbers above never go below them${r.missing ? `. With ${Math.round(r.missing).toLocaleString('en')} people still missing, we plan for ${aboutN(st.fcast.summary.fat.p50)} deaths and up to ${about(st.fcast.summary.fat.p90)}` : ''}.</p>`; })()}`),
      section('Areas that need help first', `<p>Ranked by need (how bad the damage is, how many people, how poor and how hard to reach), not just by size.</p><table class="rt"><thead><tr><th>#</th><th>Area</th><th>People affected</th><th>Need shelter</th><th>Injured</th><th>Reach from nearest store</th></tr></thead><tbody>${zones.slice(0, 6).map((z, k) => `<tr><td>${k + 1}</td><td>${esc(z.name)}</td><td>${about(z.fc.aff.p50)}</td><td>${about(z.fc.dis.p50)}</td><td>${about(z.fc.inj.p50)}</td><td>${air.some((l) => l.b === z) ? 'no road: air drop' : mins(z.accHours || 0)}</td></tr>`).join('')}</tbody></table>`),
      section('Do now: next 6 hours', steps([
        `<b>Warn the public.</b> ${A.warn} Send the warning to ${list(zones.slice(0, 4).map((z) => esc(z.name)))} first.`,
        `<b>Activate the control room</b> and bring in district officials, police, fire service, health and the ${A.word === 'cyclone' || A.word === 'flood' ? 'Met department and irrigation department' : 'Met department'}. Re-check this plan every 6 hours.`,
        ...A.first.map((x) => `<b>${x.split('.')[0]}.</b>${x.split('.').slice(1).join('.')}`),
        sm.dis.p50 >= 1 ? `<b>Open shelters</b> for ${people(sm.dis.p50)} (keep space for ${about(sm.dis.p90)}). That is about ${whole(sm.dis.p50 / 5)} family tents, or schools and community halls.` : '',
        flows.length ? `<b>Move the seriously injured.</b> ${flows.slice(0, 4).map((x) => `${about(x.n)} from ${esc(st.zones[x.i].name)} to <b>${esc(st.hospitals[x.h].name)}</b>${at(st.hospitals[x.h])}, ${mins(x.tau)} away`).join('; ')}. Ask these hospitals to clear beds now.` : '',
        disp.length ? `<b>Send these supplies first</b> (largest loads first):${bullets(disp.filter((x) => !x.air).slice(0, 8).map((x) => `From <b>${esc(x.depot.name)}</b>${at(x.depot)} to <b>${esc(x.zone.name)}</b>${at(x.zone)}: ${x.trucks ? plural(x.trucks, 'truck') : ''}${x.trucks && x.buses ? ' and ' : ''}${x.buses ? plural(x.buses, 'bus', 'buses') : ''}${x.milk ? ' (shared truck, also stopping at another area)' : ''}, carrying ${Object.entries(x.cargo).filter(([, q]) => q > 1e-3).map(([k, q]) => qty(k, q)).join(', ')}. Drive time about ${mins(x.hours)}.`))}` : '',
        air.length ? `<b>Arrange air drops</b> for ${list([...new Set(air.map((l) => esc(l.b.name)))])}. No road route is safe or open.` : '',
        st.closures.length ? `<b>Keep traffic away from the ${st.closures.length} closed road${st.closures.length > 1 ? 's' : ''}</b> marked ✕ on the map; trucks have been sent round them.` : '',
        (g.trucks || g.short.length) ? `<b>Ask the state or national authority for more help:</b> ${[g.trucks ? `${plural(g.trucks, 'more truck')}${g.buses ? ` and ${plural(g.buses, 'bus', 'buses')}` : ''} (our vehicles are ${Math.round(g.util * 100)}% busy)` : '', ...g.short.map((x) => qty(x.k.key, x.n))].filter(Boolean).join('; ')}.` : '',
      ])),
      section('Next 1 to 3 days', steps([
        ...A.later,
        st.warehouses?.sizes?.length ? `<b>Stock the recommended storage sites</b> (purple diamonds on the map) so each can supply its areas within ${AA.config.coverageMinutes} minutes for 3 days:${bullets(st.warehouses.sizes.map((s, k) => `<b>S${k + 1}</b> at ${(() => { const c = st.warehouses.cand[s.j]; return c.address ? esc(c.address) : `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`; })()} (serves ${s.zones.map((id) => esc(st.zones.find((z) => z.id === id)?.name || id)).join(', ')}): ${qty('water', s.stock.water)}, ${qty('food', s.stock.food)}, ${qty('shelter', s.stock.shelter)}, ${qty('medical', s.stock.medical)}.`))}` : '',
        'Re-run AidAtlas every 6 hours with field reports. Mark areas that have enough so supplies move to the next area in need.',
        'Keep one lane open on main roads for relief trucks and ambulances; send other traffic away.',
      ])),
      section('Supplies needed in the next 6 hours', `<table class="rt"><thead><tr><th>Item</th><th>Needed</th><th>We can deliver</th><th>Still short</th></tr></thead><tbody>${K.map((k) => { const d = M.sum(st.zones.map((z) => z.d[k.key] || 0)), u = M.sum(run.alloc.unmet.map((x) => x[k.key] || 0)); return `<tr><td>${k.label}</td><td>${qty(k.key, d)}</td><td>${qty(k.key, d - u)}</td><td>${u > 1e-6 ? qty(k.key, u) : 'none'}</td></tr>`; }).join('')}</tbody></table><p class="small">Daily amounts follow the Sphere humanitarian standards: 15 litres of water and 2,100 kcal of food per displaced person per day, and one family tent per 5 people.</p>`),
      section('Where everything is', `<p>Addresses come from OpenStreetMap. Where the map has no street address, use the coordinates or the map link (opens Google Maps for directions).</p>${placesTable([
        ...zones.map((z) => [`${z.id} ${z.name}`, `Affected area${z.covers?.length ? ` (also ${z.covers.slice(0, 4).join(', ')})` : ''}`, z]),
        ...[...new Set(disp.map((x) => x.depot))].map((d) => [`${d.id} ${d.name}`, d.typeLabel, d]),
        ...[...new Set(flows.map((x) => st.hospitals[x.h]))].map((h) => [`${h.id} ${h.name}`, 'Receiving hospital', h]),
        ...(st.warehouses?.sizes || []).map((s, k) => [`S${k + 1}`, 'Recommended storage site', st.warehouses.cand[s.j]]),
      ])}`),
      ...(AA.savings ? (() => { const c = AA.savings.compare(st); return c ? [section('What this plan saves', `<p>Compared with sending supplies from the nearest store (the usual manual rule), with the same stock, vehicles and roads, for this ${c.epochHours}-hour period:</p>${bullets(AA.savings.headlines(c).map(esc))}<p class="small">Nearest store: transport ${f.usd(c.baseline.cost)}, ${f.n(c.baseline.vehHours, 0)} vehicle-hours, ${Math.round(c.baseline.critCoverage * 100)} % of critical need delivered. This plan: ${f.usd(c.optimised.cost)}, ${f.n(c.optimised.vehHours, 0)} vehicle-hours, ${Math.round(c.optimised.critCoverage * 100)} %.</p>`)] : []; })() : []),
      section('What could change this plan', bullets([`<b>Watch:</b> ${A.watch}`, 'If an area gets worse, use “Demand surge”. If it has enough, use “Mark served”. If a road or store is lost, mark it on the map: AidAtlas re-plans immediately.', `The forecast range is wide (${about(sm.aff.p10)}–${about(sm.aff.p90)} people affected). Keep about a third of the stock in reserve until field teams confirm.`])),
      section('How these numbers were made', `<p class="small">Hazard data: ${esc(sit.src || 'scenario')}. Towns, hospitals and stores: OpenStreetMap. Roads and drive times: OSRM. Country vulnerability: ${esc(sit.countryIdx?.prov || 'assumed')}. Forecast: 400 computer simulations with damage curves of the kind used by the USGS PAGER system. Allocation: an optimisation model that gives each area a share by need at the lowest transport cost. Stock levels at real facilities are planning assumptions unless your own inventory was loaded. Full calculations are in the app under <i>Models</i>.</p>`),
    ];
    return r;
  };

  R.live = (events) => {
    const top = events.slice(0, 5);
    const r = head('Global situation report: top 5 disasters now', `Live data from GDACS, USGS and NASA EONET`);
    r.sections = [
      section('Summary', `<p>${top.length} disasters are ranked below by their overall severity (agency alert level, size of the event and how deadly this kind of disaster usually is). Open any of them in AidAtlas to get a full local plan with routes and supply lists.</p>`),
      ...top.map((e, k) => {
        const A = adv(e.hazard);
        const sz = e.hazard === 'EQ' ? `magnitude ${(+(e.magnitude ?? e.severity)).toFixed(1)}` : e.hazard === 'TC' ? `winds up to ${Math.round(e.severity || 0)} km/h` : e.severity ? `${dec(e.severity)} ${esc(e.severityUnit || '')}` : '';
        const level = e.alertlevel ? `${e.alertlevel} alert` : e.pager ? `USGS ${e.pager} alert` : 'no agency alert yet';
        return section(`${k + 1}. ${esc(e.name)}`, `<p><b>Where:</b> ${esc(e.country || 'see map')} (${e.lat.toFixed(2)}, ${e.lon.toFixed(2)}). <b>What:</b> ${AA.HAZARDS[e.hazard].label}${sz ? `, ${sz}` : ''}. <b>Level:</b> ${esc(level)}. <b>Source:</b> ${esc(e.src)}${e.url ? ` (<a href="${esc(e.url)}">report</a>)` : ''}.</p>${steps([A.warn, A.first[0], `Watch: ${A.watch}`])}`);
      }),
      section('About this ranking', `<p class="small">Severity score = half agency alert + about one third event size + a small weight for how deadly this type of disaster usually is. Green alerts with large sizes can rank above small orange alerts. Always confirm with the national Met department and disaster authority.</p>`),
    ];
    return r;
  };

  R.history = (place, events) => {
    const top = events.slice(0, 5);
    const counts = {}; events.forEach((e) => (counts[e.hazard] = (counts[e.hazard] || 0) + 1));
    const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const r = head(`Disaster history report: ${place.short || place.name}`, `Major events within 300 km`);
    r.sections = [
      section('Summary', `<p>We found <b>${events.length}</b> major recorded events within 300 km of ${esc(place.short || place.name)}. ${main ? `The most frequent type is <b>${AA.HAZARDS[main[0]].label.toLowerCase()}</b> (${main[1]} events).` : ''} The five most recent are listed below. Open each one in AidAtlas to see the aid routes and storage sites that would have worked best.</p>`),
      section('Most recent events', `<table class="rt"><thead><tr><th>Date</th><th>Event</th><th>Size</th><th>Distance</th></tr></thead><tbody>${top.map((e) => `<tr><td>${(e.from || '').slice(0, 10)}</td><td>${esc(e.name)}</td><td>${e.hazard === 'EQ' ? `M ${(+(e.magnitude ?? e.severity)).toFixed(1)}` : esc(e.alertlevel || '')}</td><td>${Math.round(M.haversine(place, e))} km</td></tr>`).join('')}</tbody></table>`),
      section('What this means for planning', steps([
        main ? `Prepare first for <b>${AA.HAZARDS[main[0]].label.toLowerCase()}s</b>: ${adv(main[0]).first[0]}` : '',
        'Use Plan mode at the same place with the size of the largest past event to work out how much stock to keep and where.',
        'Keep at least 3 days of water, food, tents and medicine in storage sites outside the most damaged zone of past events.',
        'Check that hospitals and main roads used in past events have been strengthened.',
      ])),
    ];
    return r;
  };

  R.risk = (rr) => {
    const r = head(`Disaster risk and preparedness report: ${rr.place}`, `Risk grid of about 120 × 120 km`);
    const yrs = rr.gr.lambda6 > 0 ? Math.round(1 / rr.gr.lambda6) : null;
    r.sections = [
      section('Summary', `<p>We combined the earthquake record, 20 years of river flow, past storms, fires and volcanoes, where people live, how far they are from a hospital and national coping capacity. The five areas below have the highest risk. ${yrs ? `In the wider region (400 km), an earthquake of magnitude 6 or more happens about <b>once every ${about(yrs)} years</b> on average.` : ''}</p>`),
      section('Highest-risk areas', `<table class="rt"><thead><tr><th>#</th><th>Area</th><th>Main danger</th><th>Risk (0–1)</th><th>Why</th></tr></thead><tbody>${rr.top.map((c, k) => { const why = [c.H > 0.6 ? 'frequent hazards' : '', c.E > 0.6 ? 'many people' : '', c.V > 0.6 ? 'vulnerable homes and incomes' : '', c.LCC > 0.6 ? 'far from hospitals / low capacity' : ''].filter(Boolean); return `<tr><td>${k + 1}</td><td>${esc(c.name)}</td><td>${AA.HAZARDS[c.dominant].label}</td><td>${c.R.toFixed(2)}</td><td>${why.length ? why.join(', ') : 'combination of factors'}</td></tr>`; }).join('')}</tbody></table>`),
      section('Prepare now', steps([
        ...[...new Set(rr.top.map((c) => c.dominant))].map((h) => `<b>${AA.HAZARDS[h].label}:</b> ${adv(h).first[0]} ${adv(h).warn}`),
        rr.sites?.length ? `<b>Build or rent storage</b> at the ${rr.sites.length} purple sites on the map. Each reaches its high-risk areas within ${AA.config.coverageMinutes} minutes by road: ${rr.sites.map((s, k) => `<b>S${k + 1}</b>${at(s)} serves ${s.serves.map(esc).join(', ')}`).join('; ')}.` : 'Press “Plan storage for all five” to get recommended storage sites.',
        'Run a drill: open each high-risk area in Plan mode and check that its supplies and routes work.',
        'Make sure every high-risk area has a warning system (sirens, SMS, radio) and a known evacuation route.',
      ])),
      section('How the risk score works', `<p class="small">Risk follows the INFORM index used by the UN and EU: hazard × exposure, vulnerability and lack of coping capacity, each weighted equally. A high score in one part cannot be cancelled out by a low score in another.</p>`),
    ];
    return r;
  };

  R.readiness = (rd) => {
    const r = head(`Pre-season readiness report: ${rd.place}`, `Score ${Math.round(rd.score)}/100 · ${rd.grade}`);
    const items = (a) => a.items.map((it) => `${esc(it.label)} ${Math.round(it.r * 100)} %`).join(', ');
    r.sections = [
      section('Summary', `<p>${esc(rd.place)} scores <b>${Math.round(rd.score)} out of 100 (${esc(rd.grade.toLowerCase())})</b>. The score asks: if the worst likely disaster (the P90 case) hit one of the five highest-risk areas, could the stock and vehicles within ${AA.readiness.REACH_HOURS} hours by road cover the first ${AA.readiness.DAYS * 24} hours? 100 means every item and enough vehicles for every area. ${rd.weakest ? `The weakest area is <b>${esc(rd.weakest.area.name)}</b> (${Math.round(rd.weakest.score)}/100).` : ''}</p>`),
      section('Add before the season', rd.gaps.length || rd.vehicles.trucks || rd.vehicles.buses ? steps([...rd.gaps.map((g) => `Add <b>${qty(g.key, g.add)}</b> to stores that can reach the high-risk areas within ${AA.readiness.REACH_HOURS} hours.`), rd.vehicles.trucks ? `Arrange <b>${plural(rd.vehicles.trucks, 'more truck')}</b> (own, contracted or on standby).` : '', rd.vehicles.buses ? `Arrange <b>${plural(rd.vehicles.buses, 'more responder bus', 'more responder buses')}</b>.` : '']) : '<p>No gaps: current stock and vehicles cover the worst likely case in each area.</p>'),
      section('Area by area', `<table class="rt"><thead><tr><th>Area</th><th>Main danger</th><th>People affected (P90)</th><th>Score</th><th>Items covered</th><th>Vehicles</th></tr></thead><tbody>${rd.areas.map((a) => `<tr><td>${esc(a.area.name)}</td><td>${AA.HAZARDS[a.area.hazard]?.label || ''}</td><td>${about(a.area.affP90)}</td><td>${Math.round(a.score)}</td><td>${items(a)}</td><td>${Math.round(a.transport.r * 100)} %</td></tr>`).join('')}</tbody></table>`),
      section('How the score is made', `<p class="small">For each area AidAtlas runs a design disaster (its main hazard; earthquakes at the size expected once in 475 years) and forecasts people affected, displaced and injured with 400 simulations. The worst likely case (90th percentile) is turned into ${AA.readiness.DAYS} days of water, food, tents, medical kits and staff using Sphere standards. Stock counts only if its store is within ${AA.readiness.REACH_HOURS} hours by road and is not itself badly damaged. Item scores are capped at 100 % and weighted by how critical the item is (water and medical highest); vehicles count with weight ${AA.readiness.TRANSPORT_WEIGHT}. The district score weights each area by the people at risk. Stock source: ${esc(rd.source)}. Roads: ${esc(rd.roads)}.</p>`),
    ];
    return r;
  };

  // ---------- render / export ----------
  const toText = (r) => {
    const tmp = document.createElement('div');
    const parts = [r.title, r.sub, `Prepared ${r.created.toLocaleString()} by AidAtlas`, ''];
    r.sections.forEach((s) => { tmp.innerHTML = s.html.replace(/<a href="([^"]+)"[^>]*>[^<]*<\/a>/g, '$1').replace(/<ul>/g, '\n<ul>').replace(/<li>/g, '<li>• ').replace(/<\/(p|li|tr|h\d)>/g, '\n').replace(/<\/t[dh]>/g, ' | '); parts.push(s.h.toUpperCase(), tmp.textContent.replace(/\n\s*\n+/g, '\n').trim(), ''); });
    return parts.join('\n');
  };
  const docHtml = (r) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>${R.CSS}</style></head><body><article class="rep">${R.inner(r)}</article></body></html>`;
  R.inner = (r) => `<header><div class="brand">AidAtlas</div><h1>${esc(r.title)}</h1><p class="sub">${esc(r.sub)} · prepared ${esc(r.created.toLocaleString())}</p></header>${r.sections.map((s) => `<section><h2>${s.h}</h2>${s.html}</section>`).join('')}<footer>Generated from AidAtlas model outputs. Forecasts are estimates, not guarantees. Confirm with the national meteorological department and disaster management authority before acting.</footer>`;
  R.CSS = `body{margin:0;background:#fff;color:#1d2024;font:15px/1.6 'IBM Plex Sans',system-ui,sans-serif}.rep{max-width:780px;margin:0 auto;padding:28px 24px}.rep header{border-bottom:2px solid #1d2024;padding-bottom:10px;margin-bottom:6px}.brand{font:700 22px 'Caveat',cursive;color:#1f5fbf}.rep h1{font-size:24px;line-height:1.2;margin:4px 0}.sub{color:#5b6068;margin:0;font-size:13px}.rep h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;margin:22px 0 6px;color:#1f5fbf}.steps{padding-left:22px}.steps>li{margin:6px 0}.rt{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0}.rt th,.rt td{border-bottom:1px solid #dde0e4;padding:5px 6px;text-align:left;vertical-align:top}.rt th{background:#f4f6f8}.small{font-size:12.5px;color:#4b5058}.rep footer{margin-top:26px;border-top:1px solid #dde0e4;padding-top:8px;font-size:12px;color:#5b6068}@media print{.rep{padding:0}a{color:inherit}}`;

  R.open = (r) => {
    let m = document.getElementById('reportModal');
    if (!m) { m = document.createElement('div'); m.id = 'reportModal'; m.className = 'modal report-modal'; document.body.appendChild(m); }
    m.hidden = false;
    m.innerHTML = `<div class="box report-box" role="dialog" aria-label="Action report"><div class="report-bar"><b>Action report</b><span class="btns"><button class="btn primary" id="repPrint" type="button">Print / save as PDF</button><button class="btn" id="repCopy" type="button">Copy text</button><button class="btn" id="repDl" type="button">Download</button><button class="btn" id="repClose" type="button">Close</button></span></div><style>${R.CSS.replace(/body\{[^}]*\}/, '')}</style><article class="rep">${R.inner(r)}</article></div>`;
    const close = () => (m.hidden = true);
    m.querySelector('#repClose').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    m.querySelector('#repPrint').onclick = () => { const w = window.open('', '_blank'); if (w) { w.document.write(docHtml(r)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); } else window.print(); };
    m.querySelector('#repCopy').onclick = async () => { try { await navigator.clipboard.writeText(toText(r)); AA.app?.toast('Report copied as plain text.'); } catch (e) { AA.app?.toast('Copy was blocked by the browser; use Download instead.', { err: true }); } };
    m.querySelector('#repDl').onclick = () => { const b = new Blob([docHtml(r)], { type: 'text/html' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = r.title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) + '.html'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  };
  R.toText = toText;

  AA.report = R;
})(typeof window !== 'undefined' ? window : globalThis);
