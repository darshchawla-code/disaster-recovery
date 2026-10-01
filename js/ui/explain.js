/* Model explainer drawer: formulas + the applied numbers of the current run. Skill: ui-sketch */
(function (root) {
  const AA = root.AA, M = AA.math, f = AA.fmt;
  const X = {};
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tex = (t) => `<div class="tex" data-tex="${esc(t)}"></div>`;
  const table = (head, rows) => `<div class="tablewrap"><table class="t"><thead><tr>${head.map((h) => `<th class="${h.n ? 'num' : ''}">${h.t ?? h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td class="${head[k].n ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const H = (t, n) => ({ t, n });
  const applied = (title, html) => `<div class="applied"><h5>Applied to this run · ${title}</h5>${html}</div>`;
  const none = '<p class="muted small">Open a disaster or planning scenario to see this calculation applied with real numbers.</p>';

  X.SECTIONS = [
    ['m-loop', 'Adaptive loop'], ['m-usi', 'Live ranking'], ['m-pred', 'Forecast'], ['m-bayes', 'Bayesian update'], ['m-need', 'Need score'],
    ['m-demand', 'Demand'], ['m-milp', 'Allocation MILP'], ['m-bpr', 'Congestion'], ['m-vrp', 'Consolidation'], ['m-route', 'Routing'],
    ['m-cas', 'Casualties'], ['m-mclp', 'Storage sites'], ['m-risk', 'Risk'],
  ];

  X.render = () => {
    const st = AA.engine.state, run = st?.lastRun, sit = st?.sit;
    const K = AA.config.commodities;
    const s = [];
    s.push(`<nav>${X.SECTIONS.map(([id, t]) => `<a href="#${id}" data-go="${id}">${t}</a>`).join('')}</nav>`);

    // loop
    s.push(`<section id="m-loop"><h3>Adaptive loop</h3><p>Every epoch (Δt = ${AA.config.epochHours} h) the system observes the state, updates the forecast, scores need, solves the allocation, routes it, and executes only the first epoch's decisions (rolling horizon). Any event — a closed road, a depot going offline, new supplies, a surge, spread — triggers the same loop immediately.</p>
      ${tex('\\text{Predict}\\rightarrow\\text{Need}\\rightarrow\\text{Allocate (MILP)}\\rightarrow\\text{Route}\\rightarrow\\text{Dispatch}_{t}\\rightarrow\\text{Observe}_{t+1}\\rightarrow\\cdots')}
      ${tex('recv_{ik}^{t+1}=recv_{ik}^{t}+\\textstyle\\sum_j x_{jik}^{t},\\qquad I_{jk}^{t+1}=I_{jk}^{t}-\\textstyle\\sum_i x_{jik}^{t}+b_{jk}')}
      ${st ? applied(`epoch ${st.epoch} (T+${st.epoch * AA.config.epochHours} h)`, `<div class="log">${st.log.slice(0, 8).map((e) => `<div class="e"><b>T+${e.epoch * AA.config.epochHours} h</b> · ${esc(e.reason)} <span class="d">cost ${f.usd(e.cost)} · ${esc(e.method)}</span></div>`).join('')}</div>`) : none}</section>`);

    // USI
    const ev = sit?.event;
    s.push(`<section id="m-usi"><h3>Unified Severity Index</h3><p>Live events from GDACS, USGS and NASA EONET are put on one scale so earthquakes, cyclones, floods, fires, droughts and eruptions can be ranked together. A is the agency alert (GDACS Green/Orange/Red, or USGS PAGER), m the magnitude normalised per hazard, h a lethality prior from disaster-loss records.</p>
      ${tex('USI = 0.50\\,A + 0.35\\,m + 0.15\\,h,\\quad A=0.3\\,\\tfrac{alert_{event}-1}{2}+0.7\\,\\tfrac{alert_{episode}-1}{2},\\; m_{EQ}=\\tfrac{M-4}{5},\\; m_{TC}=\\tfrac{V}{300},\\; m_{WF}=\\tfrac{\\log_{10}ha}{6},\\; m_{DR}=\\tfrac{\\log_{10}km^2}{6.5}')}
      ${ev && ev.usi != null ? applied(esc(ev.name), tex(`USI = 0.50\\times${ev.A.toFixed(2)} + 0.35\\times${ev.m.toFixed(2)} + 0.15\\times${ev.h.toFixed(2)} = ${ev.usi.toFixed(3)}`) + `<p class="src">Source: ${esc(ev.src)}${ev.url ? ` · <a href="${esc(ev.url)}" target="_blank" rel="noopener">report</a>` : ''}</p>`) : none}</section>`);

    // prediction
    let predApplied = none;
    if (st) {
      const mag = sit.hazard === 'EQ' ? `M_w ${sit.magnitude.toFixed(1)}, depth ${sit.depth} km, a = ${(sit.mmiA ?? 2.5).toFixed(2)}${sit.mmiA != null ? ' (calibrated to USGS observed MMI)' : ''}` : sit.hazard === 'TC' ? `V_max ${Math.round(sit.magnitude)} km/h, R_max 30 km` : `hazard score s₀ = ${sit.magnitude.toFixed(2)}`;
      const sm = st.fcast.summary;
      predApplied = applied(`${AA.HAZARDS[sit.hazard].label}`, `<p class="small">${mag} · impact radius ${Math.round(sit.radiusKm)} km · country vulnerability V = ${sit.countryVul.toFixed(2)} (${esc(sit.countryIdx?.prov)}) · ${st.fcast.draws} Monte-Carlo draws, seed ${st.fcast.seed}</p>
        ${table([H('Total'), H('P10', 1), H('P50', 1), H('P90', 1)], ['aff', 'dis', 'inj', 'fat'].map((k) => [({ aff: 'Affected', dis: 'Displaced', inj: 'Injured', fat: 'Fatalities' })[k], f.n(sm[k].p10), f.n(sm[k].p50), f.n(sm[k].p90)]))}
        <p></p>${table([H('Zone'), H('r km', 1), H(sit.hazard === 'EQ' ? 'MMI' : sit.hazard === 'TC' ? 'km/h' : 's', 1), H('Pop', 1), H('Aff P50', 1), H('Disp P50', 1), H('Inj P50', 1), H('sev', 1)],
          st.zones.map((z) => [`${z.id} ${esc(z.name)} <span class="prov">${z.popProv}</span>`, f.n(z.distKm, 1), f.n(z.I, sit.hazard === 'TC' ? 0 : 2), f.k(z.pop), f.k(z.fc.aff.p50), f.k(z.fc.dis.p50), f.n(z.fc.inj.p50), (z.sevPost ?? z.sevMean).toFixed(2)]))}`);
    }
    s.push(`<section id="m-pred"><h3>Forecast: intensity, damage, people</h3><p>Hazard intensity falls with distance from the source; fragility curves turn intensity into the share of people affected, displaced, injured or killed. Every parameter is perturbed in a seeded Monte-Carlo run, giving P10/P50/P90 per zone. Scenarios low/base/high take Swanson–Megill weights 0.3/0.4/0.3. These are estimates: stock is planned on the expected value and pre-positioned for P90.</p>
      ${tex('I_{EQ}(r)=a+1.5M-4.0\\log_{10}\\sqrt{r_{eff}^2+h^2},\\; r_{eff}=\\max(0,r-L/4),\\; \\log_{10}L=-2.44+0.59M,\\qquad V_{TC}(r)=V_{max}\\,(R_{max}/r)^{0.7}')}
      ${tex('f_{aff}=\\Phi\\!\\left(\\tfrac{I-6.5}{0.8}\\right),\\; f_{dis}=0.4\\,\\Phi\\!\\left(\\tfrac{I-8.2+1.2(V-0.5)}{0.8}\\right),\\; sev=\\Phi\\!\\left(\\tfrac{I-8.5}{0.8}\\right),\\; \\nu=\\Phi\\!\\left(\\tfrac{\\ln(I/\\theta)}{0.17}\\right),\\; \\theta=13.5+2.5(1-V)')}
      ${tex('M\\sim\\mathcal N(M_0,0.2^2),\\; pop\\sim pop_0\\,\\mathrm{LN}(0,0.2^2),\\; \\Delta\\theta\\sim\\mathcal N(0,0.3^2);\\quad d_{ik}=\\textstyle\\sum_s p_s D_{iks},\\; p=(0.3,0.4,0.3)')}
      <h4>Floods: flash vs river</h4><p>Flash floods (steep terrain with relief ≥ 800 m within 20 km, or named glacial-lake outburst, cloudburst or dam failure) kill about 1 in 100 people in the flood zone; river floods about 1 in 10,000. Calibrated on Nepal Aug 2026 (955 deaths / ~93,000 impacted) and Pakistan 2022 (1,739 / 33 M), with the world 1980–2009 average (0.019 %) as a check.</p>
      ${tex('f_{fat}^{flash}=0.01\,f_{aff},\; f_{dis}^{flash}=0.04\,f_{aff};\qquad f_{fat}^{river}=10^{-4}\,f_{aff},\; f_{dis}^{river}=0.2\,f_{aff}')}
      <h4>Agency evidence overrides the model</h4><p>Counts reported by agencies (GDACS Sendai impact reports) are confirmed minimums, so every forecast quantile is raised to at least the reported count; missing people are added to the fatality P90. For floods, reported deaths ÷ the calibrated death rate gives the implied number affected. For USGS earthquakes the fatality P50 is kept inside the PAGER alert band (green &lt; 1, yellow 1–99, orange 100–999, red ≥ 1,000).</p>
      ${tex('\hat X_{q}=\max\big(X_{q}\cdot \tfrac{\max(R,X_{50})}{X_{50}},\,R\big),\quad \hat F_{90}\ge R_{dead}+R_{missing},\quad \hat A\ge R_{dead}/f_{fat}')}
      ${predApplied}<p class="src">Fragility forms follow USGS PAGER (lognormal fatality model) and HAZUS-style damage curves; parameters are representative global values, not country-calibrated.</p></section>`);

    // bayes
    const bz = st ? st.zones.filter((z) => z.bayes) : [];
    s.push(`<section id="m-bayes"><h3>Bayesian update</h3><p>When a field report or a revised feed value arrives, zone severity is updated as a Gaussian conjugate pair, so trusted assessors move the estimate more than crowd reports.</p>
      ${tex('\\mu_1=\\frac{\\mu_0/\\sigma_0^2+y/\\sigma_y^2}{1/\\sigma_0^2+1/\\sigma_y^2},\\qquad \\sigma_1^2=\\frac{1}{1/\\sigma_0^2+1/\\sigma_y^2}')}
      ${bz.length ? applied('field reports', table([H('Zone'), H('μ₀', 1), H('σ₀', 1), H('y', 1), H('σy', 1), H('μ₁', 1), H('σ₁', 1)], bz.map((z) => [z.id, z.bayes.prior.mu.toFixed(3), z.bayes.prior.sd.toFixed(3), z.bayes.obs.y.toFixed(2), z.bayes.obs.sd.toFixed(2), z.bayes.post.mu.toFixed(3), z.bayes.post.sd.toFixed(3)]))) : `<p class="muted small">No field reports yet. Open a zone on the map and choose “Field report”.</p>`}</section>`);

    // need
    const w = AA.config.needWeights;
    s.push(`<section id="m-need"><h3>Need score (fairness)</h3><p>Need compares severity, people at risk, vulnerability, how hard the zone is to reach and what it has already received. Population carries less weight than severity because absolute demand already scales with people.</p>
      ${tex(`N_i = ${w.sev}\\,\\widetilde{sev}_i + ${w.pop}\\,\\widetilde{pop}_i + ${w.vul}\\,vul_i + ${w.acc}\\,acc_i - ${w.recv}\\,\\widetilde{recv}_i,\\qquad \\tilde x=\\frac{x-\\min x}{\\max x-\\min x+\\epsilon}`)}
      ${st ? applied('per zone', table([H('Zone'), H('sev', 1), H('s̃ev', 1), H('pop at risk', 1), H('p̃op', 1), H('vul', 1), H('acc', 1), H('r̃ecv', 1), H('N', 1)], st.zones.map((z) => { const p = z.needParts; return [`${z.id} ${esc(z.name)}`, p.sev.toFixed(2), p.sevN.toFixed(2), f.k(p.pop), p.popN.toFixed(2), p.vul.toFixed(2), p.acc.toFixed(2), p.recvN.toFixed(2), `<b>${z.need.toFixed(3)}</b>`]; }))) : none}</section>`);

    // demand
    s.push(`<section id="m-demand"><h3>Demand (Sphere standards)</h3><p>Per-person minimums from the Sphere Handbook drive water, food and shelter; medical modules and personnel use labelled planning ratios. Flow items accumulate per day; stock items are one-off targets. Demand is netted against deliveries already received so no zone is supplied twice.</p>
      ${tex('D^{water}=\\tfrac{15\\,dis+3\\,(aff-dis)}{1000}\\,\\tfrac{kL}{day},\\; D^{food}=\\tfrac{0.6\\,dis+0.3\\,(aff-dis)}{1000}\\,\\tfrac{t}{day},\\; D^{shelter}=\\tfrac{dis}{5},\\; D^{med}=\\tfrac{inj}{50}+\\tfrac{aff}{1000},\\; D^{staff}=\\tfrac{inj}{20}+\\tfrac{dis}{500}')}
      ${tex('d_{ik}=\\max\\!\\left(0,\\; \\textstyle\\sum_s p_s D_{iks}\\cdot ramp(t)\\cdot surge_i - recv_{ik}\\right)')}
      ${st ? applied(`net demand this epoch`, table([H('Zone'), ...K.map((k) => H(`${k.label} (${k.unit})`, 1))], st.zones.map((z) => [z.id, ...K.map((k) => f.n(z.d[k.key], z.d[k.key] < 10 ? 1 : 0))]))) : none}</section>`);

    // MILP
    let milp = none;
    if (run) {
      const a = run.alloc;
      const ships = a.ship.slice().sort((p, q) => q.qty * K.find((k) => k.key === q.k).kg - p.qty * K.find((k) => k.key === p.k).kg).slice(0, 30);
      milp = applied(`${esc(a.method)} · ${a.nVars} variables, ${a.nCons} constraints, ${a.nInts} integer · ${a.ms} ms`, `<p class="small">C₀ (naive nearest-depot cost) = ${f.usd(a.C0)} · transport ${f.usd(a.cost.transport)} + handling ${f.usd(a.cost.handling)} + congestion ${f.usd(a.cost.congestion)} = <b>${f.usd(a.cost.total)}</b> · objective ${a.objective?.toFixed(4)}</p>
        ${table([H('Commodity'), H('Demand', 1), H('Shipped', 1), H('Unmet', 1), H('M_k', 1), H('Gini', 1)], K.map((k) => { const d = M.sum(st.zones.map((z) => z.d[k.key] || 0)), u = M.sum(a.unmet.map((x) => x[k.key] || 0)); return [`${k.label} (${k.unit})`, f.n(d, 1), f.n(d - u, 1), f.n(u, 1), (a.Mk[k.key] || 0).toFixed(3), a.giniByK[k.key] != null ? a.giniByK[k.key].toFixed(3) : '–']; }))}
        <p></p>${table([H('Depot → Zone'), H('Commodity'), H('x', 1), H('Trips', 1), H('τ h', 1)], ships.map((sp) => { const k = K.find((c) => c.key === sp.k); const tr = a.trips.find((t) => t.j === sp.j && t.i === sp.i && t.cls === k.cls); return [`${st.depots[sp.j].id} → ${st.zones[sp.i].id}`, k.label, `${f.n(sp.qty, sp.qty < 10 ? 2 : 0)} ${k.unit}`, tr ? tr.n : '–', run.pb.tau[sp.j][sp.i].toFixed(2)]; }))}<p class="src">Showing the ${ships.length} largest of ${a.ship.length} shipments.</p>`);
    }
    const ob = { ...AA.config.objective, ...(st?.objective || {}) };
    s.push(`<section id="m-milp"><h3>Allocation MILP</h3><p>A multi-commodity, capacity- and fleet-constrained program decides how much of each resource moves from each supply store to each zone, and how many vehicle trips that takes. Cost (fuel, crew time, dispatch, handling, congestion) is traded against need-weighted shortages, a per-commodity minimax that equalises shortage ratios, a linearised Gini, and a service floor for water and medical supplies.</p>
      ${tex(`\\min\\; ${ob.alpha === 1 ? '' : ob.alpha + '\\,'}\\frac{\\sum\\kappa_{jic}n_{jic}+\\sum c^L w_k x_{jik}+\\sum\\psi_{is}f_{is}}{C_0}+\\sum_{ik}\\pi_k(0.5+N_i)\\frac{u_{ik}}{D_k}+\\frac{${ob.delta}}{3}\\sum_k\\pi_k M_k+${ob.beta}\\frac{\\sum g_{ii'k}}{|I|^2}+${ob.mu}\\sum\\frac{\\sigma_{ik}}{D_k}`)}
      ${tex('\\begin{aligned}&\\textstyle\\sum_j x_{jik}+u_{ik}=d_{ik} && \\text{demand balance}\\\\ &\\textstyle\\sum_i x_{jik}\\le S_{jk} && \\text{supply}\\\\ &\\textstyle\\sum_{k\\in K_c} w_k x_{jik}\\le Q_c\\,n_{jic} && \\text{capacity + compatibility}\\\\ &\\textstyle\\sum_i (2\\tau_{ji}+t_s)\\,n_{jic}\\le F_{jc}\\,\\Delta t && \\text{fleet hours}\\\\ &(0.5+N_i)\\,u_{ik}/d_{ik}\\le M_k && \\text{need-weighted minimax}\\\\ &g_{ii\'k}\\ge \\pm(q_{ik}-q_{i\'k}) && \\text{linear Gini}\\\\ &\\textstyle\\sum_j x_{jik}\\ge \\phi\\, d_{ik}-\\sigma_{ik},\\;k\\in K^c && \\text{service floor }\\phi=' + ob.phi + '\\\\ & n_{jic}\\in\\mathbb Z_{\\ge 0} \\end{aligned}')}
      ${tex('\\kappa_{jic}=2\\,\\delta_{ji}\\,c^D_c+2\\,\\tau_{ji}\\,c^T_c+c^F_c')}
      ${milp}<p class="src">Solver: javascript-lp-solver (simplex + branch & bound) in your browser. Unit costs: truck $${AA.config.vehicles.truck.cD}/km, $${AA.config.vehicles.truck.cT}/h, $${AA.config.vehicles.truck.cF}/trip, 8 t; bus $${AA.config.vehicles.bus.cD}/km, 30 seats. Handling $${AA.config.loadCostPerKg}/kg.</p></section>`);

    // BPR
    s.push(`<section id="m-bpr"><h3>Congestion (BPR)</h3><p>Sending many vehicles into one zone slows them all. The Bureau of Public Roads function is linearised into three convex segments so the solver spreads convoys across access routes and time.</p>
      ${tex('\\tau(v)=\\tau_0\\left(1+0.15\\left(\\tfrac{v}{\\kappa}\\right)^4\\right),\\qquad \\tfrac{d}{dv}\\big[v\\,\\tau(v)\\big]=\\tau_0\\left(1+0.75\\left(\\tfrac{v}{\\kappa}\\right)^4\\right)\\Rightarrow \\text{slopes } 1.003,\\,1.24,\\,4.80')}
      ${run ? applied('zone access', table([H('Zone'), H('κ veh/epoch', 1), H('Trips in', 1), H('τ̄ h', 1), H('BPR factor', 1)], st.zones.map((z, i) => { const v = M.sum(run.alloc.trips.filter((t) => t.i === i).map((t) => t.n)); return [z.id, run.alloc.kap[i].toFixed(1), v, run.alloc.tbar[i].toFixed(2), (1 + 0.15 * (v / run.alloc.kap[i]) ** 4).toFixed(2)]; }))) : none}</section>`);

    // VRP
    s.push(`<section id="m-vrp"><h3>Load consolidation (Clarke–Wright)</h3><p>Full truckloads go direct. Part-loads from the same depot are merged into multi-stop milk runs when the combined load fits the vehicle and the tour fits in the epoch, removing vehicles from the road.</p>
      ${tex('s_{ab}=\\tau_{ja}+\\tau_{jb}-\\tau_{ab},\\quad \\text{merge in decreasing } s_{ab}\\text{ while } \\textstyle\\sum load\\le Q,\\; T_{tour}\\le\\Delta t')}
      ${run ? applied('this epoch', `<p class="small">Vehicle trips ${run.cons.tripsBefore} → ${run.cons.tripsAfter} (${run.cons.saved} saved) · ${run.cons.tours.filter((t) => t.kind === 'milk-run').length} milk runs</p>` + (run.cons.tours.filter((t) => t.kind === 'milk-run').length ? table([H('Depot'), H('Stops'), H('Load', 1), H('Tour h', 1)], run.cons.tours.filter((t) => t.kind === 'milk-run').map((t) => [st.depots[t.j].id, t.stops.map((i) => st.zones[i].id).join(' → '), `${f.n(t.loadKg, 0)} ${t.cls === 'bus' ? 'seats' : 'kg'}`, t.hours.toFixed(2)])) : '')) : none}</section>`);

    // routing
    s.push(`<section id="m-route"><h3>Routing on damaged roads</h3><p>Each leg asks OSRM for the shortest road paths (Contraction Hierarchies, an exact accelerated Dijkstra) and alternatives. Paths are scored by generalised cost with speed reduced by road damage; any path within ${AA.config.closureBufferKm * 1000} m of a closure or crossing damage θ ≥ ${AA.config.thetaMax} is rejected, detours are tried, and isolated zones are flagged for air drop and removed from the next solve.</p>
      ${tex('GC_r=c^D\\,dist_r+c^T\\,\\frac{t_r\\,\\gamma}{1-\\alpha\\,\\bar\\theta_r},\\quad \\alpha=' + AA.config.roadAlpha + ',\\; \\gamma=\\text{congestion factor}')}
      ${tex('\\theta_{t+1}=\\max\\{0,\\;\\theta_t(1-\\rho)+\\eta_t\\},\\quad \\rho=' + AA.config.roadRecovery + '\\;\\text{per epoch},\\quad \\theta^{EQ}_0=\\Phi\\!\\left(\\tfrac{I-9.0}{1.0}\\right)')}
      ${run && run.legs.length ? applied(`${run.legs.length} legs · ${run.routing === 'done' ? 'complete' : 'routing…'}`, table([H('Leg'), H('km', 1), H('free h', 1), H('adj h', 1), H('θ̄', 1), H('θmax', 1), H('paths', 1), H('status')], run.legs.map((l) => { const b = l.best; return [`${l.a.id} → ${l.b.id} (${l.cls})`, b ? f.n(b.km, 1) : '–', b ? b.h.toFixed(2) : '–', b ? b.ev.adjH.toFixed(2) : '–', b ? b.ev.mean.toFixed(2) : '–', b ? b.ev.max.toFixed(2) : '–', l.candidates.length, l.airdrop ? '<b>air drop</b>' : l.detour ? 'detour' : l.source]; }))) : none}<p class="src">Road network and travel times: ${esc(st?.tableProv || 'OSRM')} (OpenStreetMap data).</p></section>`);

    // casualties
    s.push(`<section id="m-cas"><h3>Casualty transport</h3><p>Hospital-level casualties (25 % of injured) are sent to hospitals outside the heavy-damage zone. The LP maximises expected survivors, with survival decaying with transport time, within free beds and the ambulance time budget.</p>
      ${tex('\\max\\sum_{ih}e^{-\\tau_{ih}/\\tau_p}\\,p_{ih}-2\\sum_i u^c_i\\;\\; \\text{s.t.}\\; \\sum_h p_{ih}+u^c_i=cas_i,\\; \\sum_i p_{ih}\\le beds_h,\\; \\sum_{ih}\\tfrac{2\\tau_{ih}}{Q^c}p_{ih}\\le A\\,\\Delta t')}
      ${run ? applied(`${run.ambulances} ambulances, τ_p = 1 h`, run.casualty.flows.length ? table([H('Zone → Hospital'), H('Patients', 1), H('τ h', 1), H('e^{−τ}', 1)], run.casualty.flows.map((x) => [`${st.zones[x.i].id} → ${st.hospitals[x.h].id} ${esc(st.hospitals[x.h].name)}`, f.n(x.n, 0), x.tau.toFixed(2), Math.exp(-x.tau).toFixed(2)])) + `<p class="small">Expected survivors weight ${f.n(run.casualty.survivors, 0)} · unserved ${f.n(M.sum(run.casualty.unserved), 0)}</p>` : '<p class="small">No hospitals reachable or no casualties this epoch.</p>') : none}</section>`);

    // MCLP
    const wh = st?.warehouses;
    s.push(`<section id="m-mclp"><h3>Where to pre-position storage</h3><p>Candidate sites on a grid around the area (snapped to roads) plus existing facilities; any site where predicted heavy damage exceeds 0.3 is excluded. The Maximal Covering Location Problem picks P sites that cover the most need within ${AA.config.coverageMinutes} minutes, with a p-median tie-break on travel time. Each site is sized for 72 hours of P90 demand.</p>
      ${tex('\\max\\sum_i N_i A_i z_i-\\varepsilon\\sum_{ij}\\tau_{ij}a_{ij}\\;\\;\\text{s.t.}\\; z_i\\le\\sum_{j:\\tau_{ij}\\le T_c}y_j,\\; \\sum_j y_j=P,\\; y_j=0\\text{ if }sev_j>0.3')}
      ${wh ? applied(esc(wh.sol.method), `<p class="small">Covered need ${f.n((100 * wh.sol.covered) / Math.max(1e-9, wh.sol.total), 1)} % with P = ${wh.sol.sites.length} · ${wh.cand.filter((c) => !c.safe).length} of ${wh.cand.length} candidates excluded as hazard-unsafe</p>` + table([H('Site'), H('Zones'), ...K.map((k) => H(k.unit, 1))], wh.sizes.map((x, k) => [`S${k + 1}`, x.zones.join(', '), ...K.map((c) => f.n(x.stock[c.key], x.stock[c.key] < 10 ? 1 : 0))]))) : '<p class="muted small">Storage sites are computed in Plan, History and Risk modes.</p>'}</section>`);

    // risk
    const rk = AA.app?.riskResult;
    s.push(`<section id="m-risk"><h3>Risk index (INFORM)</h3><p>Hazard probabilities come from catalogues and river discharge; exposure from population; vulnerability and lack of coping capacity from rurality, hospital access and national indicators. Dimensions combine geometrically so a zero in one cannot be hidden by another.</p>
      ${tex('b=\\frac{\\log_{10}e}{\\bar M-(M_c-\\Delta M/2)},\\quad a=\\log_{10}\\tfrac{N}{T}+bM_c,\\quad \\lambda(M\\ge6)=10^{a-6b},\\quad P_{10y}=1-e^{-10\\lambda}')}
      ${tex('Q_T=\\mu-\\beta\\ln\\!\\left(-\\ln\\left(1-\\tfrac1T\\right)\\right),\\; \\beta=\\tfrac{s\\sqrt6}{\\pi},\\; \\mu=\\bar x-0.5772\\beta;\\qquad H=1-\\prod_h(1-P_h)')}
      ${tex('R=\\sqrt{H\\cdot E}^{\\,1/3}\\;V^{1/3}\\;LCC^{1/3}')}
      ${rk ? applied(esc(rk.place), `<p class="small">Gutenberg–Richter: n = ${rk.gr.n}, b = ${rk.gr.b.toFixed(2)}${rk.gr.a != null ? `, a = ${rk.gr.a.toFixed(2)}` : ''}, λ(M≥6) = ${rk.gr.lambda6.toExponential(2)}/yr · events used: ${rk.counts}</p>` + table([H('Area'), H('Dominant'), H('H', 1), H('E', 1), H('V', 1), H('LCC', 1), H('R', 1)], rk.top.map((c) => [esc(c.name), AA.HAZARDS[c.dominant]?.label, c.H.toFixed(2), c.E.toFixed(2), c.V.toFixed(2), c.LCC.toFixed(2), `<b>${c.R.toFixed(3)}</b>`]))) : '<p class="muted small">Run Risk mode for a place to see this applied.</p>'}</section>`);

    if (st?.notes?.length) s.push(`<section><h3>Data notes</h3>${st.notes.map((n) => `<p class="note warn">${esc(n)}</p>`).join('')}</section>`);
    return s.join('');
  };

  X.open = (id) => {
    const d = document.getElementById('drawer'), body = document.getElementById('drawerBody');
    body.innerHTML = X.render();
    if (root.katex) body.querySelectorAll('[data-tex]').forEach((el) => { try { root.katex.render(el.dataset.tex, el, { displayMode: true, throwOnError: false }); } catch (e) { el.textContent = el.dataset.tex; } });
    else body.querySelectorAll('[data-tex]').forEach((el) => (el.textContent = el.dataset.tex));
    body.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); X.scrollTo(a.dataset.go); }));
    d.classList.add('open');
    if (id) setTimeout(() => X.scrollTo(id), 30);
  };
  X.scrollTo = (id) => {
    const el = document.getElementById(id); if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
  };
  X.close = () => document.getElementById('drawer').classList.remove('open');
  X.refreshIfOpen = () => { if (document.getElementById('drawer').classList.contains('open')) { const b = document.getElementById('drawerBody'); const top = b.scrollTop; X.open(); b.scrollTop = top; } };

  AA.explain = X;
})(window);
