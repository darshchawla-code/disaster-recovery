/* Efficiency: allocation MILP, BPR congestion, Clarke–Wright consolidation, casualty LP.
   Skill: skills/efficiency/SKILL.md. Solver: javascript-lp-solver (global `solver`). */
(function (root) {
  const AA = root.AA, M = AA.math;
  const E = {};
  const getSolver = () => root.solver || (typeof require !== 'undefined' ? require('javascript-lp-solver') : null);

  E.BPR_SLOPES = [1 + 0.75 * 0.25 ** 4, 1 + 0.75 * 0.75 ** 4, 1 + 0.75 * 1.5 ** 4];
  E.bprTime = (t0, v, cap) => t0 * (1 + 0.15 * Math.pow(v / Math.max(cap, 1e-9), 4));

  E.tripCost = (cls, km, hours) => {
    const v = AA.config.vehicles[cls];
    return 2 * km * v.cD + 2 * hours * v.cT + v.cF;
  };

  /**
   * problem: { zones:[{id,need,d:{k},theta}], depots:[{id,open,stock:{k},fleet:{truck,bus}}],
   *            tau:[j][i] hours (Infinity = unreachable), dist:[j][i] km }
   */
  E.buildModel = (pb, opts = {}) => {
    const cfg = AA.config, ob = { ...cfg.objective, ...(opts.objective || {}) };
    const K = cfg.commodities, I = pb.zones, J = pb.depots, nI = I.length || 1;
    const dt = cfg.epochHours;
    const model = { optimize: 'obj', opType: 'min', constraints: {}, variables: {}, ints: {} };
    const C = model.constraints, Vv = model.variables;
    const addVar = (name, coefs) => { Vv[name] = Object.assign(Vv[name] || {}, coefs); };
    const crit = K.filter((k) => k.critical).map((k) => k.key);

    // ---- normaliser C0: direct trips from each zone's nearest open depot ----
    let C0 = 0;
    I.forEach((z, i) => {
      let best = -1, bt = Infinity;
      J.forEach((dp, j) => { if (dp.open && pb.tau[j][i] < bt) { bt = pb.tau[j][i]; best = j; } });
      if (best < 0 || !isFinite(bt)) return;
      ['truck', 'bus'].forEach((cls) => {
        const load = K.filter((k) => k.cls === cls).reduce((s, k) => s + (z.d[k.key] || 0) * k.kg, 0);
        if (load <= 0) return;
        C0 += Math.ceil(load / cfg.vehicles[cls].cap) * E.tripCost(cls, pb.dist[best][i], bt) + (cls === 'truck' ? load * cfg.loadCostPerKg : 0);
      });
    });
    C0 = Math.max(C0, 1);
    const a = ob.alpha / C0;

    // ---- per zone congestion capacity and mean access time ----
    const kap = I.map((z) => Math.max(2, cfg.bprCapacityPerEpoch * (1 - (z.theta || 0))));
    const tbar = I.map((z, i) => { const ts = J.map((_, j) => pb.tau[j][i]).filter(isFinite); return ts.length ? M.mean(ts) : 1; });

    const vars = { x: [], n: [] };
    // total demand per commodity: common per-unit normaliser so zone size does not distort priorities
    const Dk = {}; K.forEach((k) => (Dk[k.key] = Math.max(M.EPS, M.sum(I.map((z) => z.d[k.key] || 0)))));
    I.forEach((z, i) => {
      K.forEach((k) => {
        const d = z.d[k.key] || 0;
        if (d <= 1e-9) return;
        const dem = `dem_${i}_${k.key}`;
        C[dem] = { equal: d };
        const pi = cfg.criticality[k.key] || 1, wN = 0.5 + (z.need || 0);
        addVar(`u_${i}_${k.key}`, { obj: (pi * wN) / Dk[k.key], [dem]: 1 });
        // need-weighted minimax per commodity: (0.5 + N_i)·q_ik ≤ M_k
        C[`mm_${i}_${k.key}`] = { max: 0 };
        addVar(`u_${i}_${k.key}`, { [`mm_${i}_${k.key}`]: wN / d });
        addVar(`M_${k.key}`, { [`mm_${i}_${k.key}`]: -1 });
        if (k.critical) { // service floor
          C[`fl_${i}_${k.key}`] = { min: ob.phi * d };
          addVar(`s_${i}_${k.key}`, { obj: ob.mu / Dk[k.key], [`fl_${i}_${k.key}`]: 1 });
        }
        J.forEach((dp, j) => {
          if (!dp.open || !isFinite(pb.tau[j][i]) || !((dp.stock[k.key] || 0) > 1e-9)) return;
          const xn = `x_${j}_${i}_${k.key}`;
          const coef = { obj: a * cfg.loadCostPerKg * (k.cls === 'truck' ? k.kg : 0), [dem]: 1, [`sup_${j}_${k.key}`]: 1, [`cap_${j}_${i}_${k.cls}`]: k.kg };
          if (k.critical) coef[`fl_${i}_${k.key}`] = 1;
          addVar(xn, coef);
          C[`sup_${j}_${k.key}`] = { max: dp.stock[k.key] };
          vars.x.push({ name: xn, j, i, k: k.key });
          const nn = `n_${j}_${i}_${k.cls}`;
          if (!Vv[nn] || Vv[nn].obj == null) {
            const veh = cfg.vehicles[k.cls];
            C[`cap_${j}_${i}_${k.cls}`] = { max: 0 };
            C[`fleet_${j}_${k.cls}`] = { max: (dp.fleet[k.cls] || 0) * dt };
            addVar(nn, { obj: a * E.tripCost(k.cls, pb.dist[j][i], pb.tau[j][i]), [`cap_${j}_${i}_${k.cls}`]: -veh.cap, [`fleet_${j}_${k.cls}`]: 2 * pb.tau[j][i] + cfg.serviceHours, [`cong_${i}`]: 1 });
            model.ints[nn] = 1;
            vars.n.push({ name: nn, j, i, cls: k.cls });
          }
        });
      });
      // BPR piecewise congestion on zone access
      if (vars.n.some((v) => v.i === i)) {
        C[`cong_${i}`] = { equal: 0 };
        E.BPR_SLOPES.forEach((sl, s) => {
          const fn = `f_${i}_${s}`;
          const co = { obj: a * cfg.vehicles.truck.cT * tbar[i] * (sl - 1), [`cong_${i}`]: -1 };
          if (s < 2) { C[`fb_${i}_${s}`] = { max: kap[i] / 2 }; co[`fb_${i}_${s}`] = 1; }
          addVar(fn, co);
        });
      }
    });
    K.forEach((k) => addVar(`M_${k.key}`, { obj: (ob.delta * (cfg.criticality[k.key] || 1)) / 3 }));
    // linearised Gini on shortage ratios, critical commodities
    crit.forEach((k) => {
      const idx = I.map((z, i) => i).filter((i) => (I[i].d[k] || 0) > 1e-9);
      for (let p = 0; p < idx.length; p++) for (let q = p + 1; q < idx.length; q++) {
        const i1 = idx[p], i2 = idx[q], d1 = I[i1].d[k], d2 = I[i2].d[k];
        const g = `g_${i1}_${i2}_${k}`, ca = `ga_${i1}_${i2}_${k}`, cb = `gb_${i1}_${i2}_${k}`;
        C[ca] = { min: 0 }; C[cb] = { min: 0 };
        addVar(g, { obj: (2 * ob.beta) / (nI * nI), [ca]: 1, [cb]: 1 });
        addVar(`u_${i1}_${k}`, { [ca]: -1 / d1, [cb]: 1 / d1 });
        addVar(`u_${i2}_${k}`, { [ca]: 1 / d2, [cb]: -1 / d2 });
      }
    });
    return { model, vars, C0, kap, tbar, Dk };
  };

  const solveOnce = (model) => getSolver().Solve(model);

  /** Solve allocation; MILP with fallback to relax-and-round. Returns a rich, explainable result. */
  E.allocate = (pb, opts = {}) => {
    const cfg = AA.config, K = cfg.commodities;
    const built = E.buildModel(pb, opts);
    const { model, vars } = built;
    const t0 = Date.now();
    let res, method;
    const relaxed = { ...model, ints: {} };
    const lp = solveOnce(relaxed);
    const nInts = Object.keys(model.ints).length;
    if (nInts && nInts <= 40 && opts.integer !== false) {
      model.options = { timeout: 2000, tolerance: 0.02 };
      try { res = solveOnce(model); method = 'MILP branch & bound'; } catch (e) { res = null; }
      if (!res || !res.feasible || Date.now() - t0 > 4000) res = null;
    }
    if (!res) { // relax-and-round: round trips up within fleet-hour budgets, then fix and re-solve
      method = nInts ? 'LP relaxation + round-up repair' : 'LP';
      const fixed = { ...model, ints: {}, constraints: { ...model.constraints } };
      const byFleet = {};
      vars.n.forEach((v) => {
        const val = lp[v.name] || 0; const r = val > 1e-6 ? Math.ceil(val - 1e-6) : 0;
        (byFleet[`${v.j}_${v.cls}`] = byFleet[`${v.j}_${v.cls}`] || []).push({ v, r, frac: r - val });
      });
      Object.entries(byFleet).forEach(([key, list]) => {
        const [j, cls] = key.split('_'); const dp = pb.depots[+j];
        const budget = (dp.fleet[cls] || 0) * cfg.epochHours;
        const hrs = (e) => 2 * pb.tau[+j][e.v.i] + cfg.serviceHours;
        let used = M.sum(list.map((e) => e.r * hrs(e)));
        // trim the largest round-ups first so small zones keep their (single) truck
        while (used > budget + 1e-6) {
          const e = list.filter((x) => x.r > 0).sort((p, q) => q.r - p.r || q.frac - p.frac)[0];
          if (!e) break; e.r--; used -= hrs(e);
        }
        list.forEach((e) => { fixed.constraints[`fix_${e.v.name}`] = { equal: e.r }; fixed.variables[e.v.name] = { ...fixed.variables[e.v.name], [`fix_${e.v.name}`]: 1 }; });
      });
      res = solveOnce(fixed);
    }
    const ms = Date.now() - t0;

    // ---- decode ----
    const ship = vars.x.map((v) => ({ ...v, qty: res[v.name] || 0 })).filter((s) => s.qty > 1e-6);
    const trips = vars.n.map((v) => ({ ...v, n: Math.round(res[v.name] || 0) })).filter((t) => t.n > 0);
    const unmet = pb.zones.map((z, i) => {
      const o = {}; K.forEach((k) => (o[k.key] = res[`u_${i}_${k.key}`] || 0)); return o;
    });
    const ratios = pb.zones.map((z, i) => {
      const o = {}; K.forEach((k) => (o[k.key] = (z.d[k.key] || 0) > 1e-9 ? unmet[i][k.key] / z.d[k.key] : 0)); return o;
    });
    let transport = 0, handling = 0, congestion = 0;
    trips.forEach((t) => (transport += t.n * E.tripCost(t.cls, pb.dist[t.j][t.i], pb.tau[t.j][t.i])));
    ship.forEach((s) => { const k = K.find((c) => c.key === s.k); if (k.cls === 'truck') handling += s.qty * k.kg * cfg.loadCostPerKg; });
    pb.zones.forEach((z, i) => E.BPR_SLOPES.forEach((sl, s) => (congestion += (res[`f_${i}_${s}`] || 0) * cfg.vehicles.truck.cT * built.tbar[i] * (sl - 1))));
    const crit = K.filter((k) => k.critical).map((k) => k.key);
    const giniByK = {}; crit.forEach((k) => (giniByK[k] = AA.fairness ? AA.fairness.gini(ratios.filter((_, i) => (pb.zones[i].d[k] || 0) > 0).map((r) => r[k])) : 0));
    const util = pb.depots.map((dp, j) => {
      const used = {}; K.forEach((k) => (used[k.key] = M.sum(ship.filter((s) => s.j === j && s.k === k.key).map((s) => s.qty))));
      const hours = {}; ['truck', 'bus'].forEach((c) => (hours[c] = M.sum(trips.filter((t) => t.j === j && t.cls === c).map((t) => t.n * (2 * pb.tau[j][t.i] + cfg.serviceHours)))));
      return { used, hours };
    });
    return {
      feasible: !!res.feasible, method, ms, objective: res.result, C0: built.C0,
      ship, trips, unmet, ratios, Mk: Object.fromEntries(K.map((k) => [k.key, res[`M_${k.key}`] || 0])), giniByK, Dk: built.Dk,
      cost: { transport, handling, congestion, total: transport + handling + congestion },
      util, nVars: Object.keys(model.variables).length, nCons: Object.keys(model.constraints).length, nInts: Object.keys(model.ints).length,
      kap: built.kap, tbar: built.tbar,
    };
  };

  /** Clarke–Wright savings consolidation of partial loads, per depot and class. tauZZ[i][i'] hours. */
  E.consolidate = (pb, alloc, tauZZ) => {
    const cfg = AA.config, K = cfg.commodities, out = [];
    let before = 0, after = 0;
    pb.depots.forEach((dp, j) => ['truck', 'bus'].forEach((cls) => {
      const Q = cfg.vehicles[cls].cap;
      const loads = {}; // zone → {k: qty}
      alloc.ship.filter((s) => s.j === j && K.find((c) => c.key === s.k).cls === cls).forEach((s) => { (loads[s.i] = loads[s.i] || {})[s.k] = s.qty; });
      const zonesHere = Object.keys(loads).map(Number); if (!zonesHere.length) return;
      before += M.sum(alloc.trips.filter((t) => t.j === j && t.cls === cls).map((t) => t.n));
      const w = (i) => M.sum(Object.entries(loads[i]).map(([k, q]) => q * K.find((c) => c.key === k).kg));
      const routes = [];
      zonesHere.forEach((i) => {
        const W = w(i); let full = Math.floor(W / Q + 1e-9); let resid = W - full * Q;
        if (resid < 1e-3 * Q) resid = 0;
        for (let f = 0; f < full; f++) out.push({ j, cls, stops: [i], loadKg: Q, frac: Q / W, kind: 'direct' });
        if (resid > 1e-6) routes.push({ stops: [i], load: resid, fracs: { [i]: resid / W } });
      });
      const dur = (r) => { let t = pb.tau[j][r.stops[0]]; for (let s = 1; s < r.stops.length; s++) t += tauZZ[r.stops[s - 1]][r.stops[s]]; return t + pb.tau[j][r.stops[r.stops.length - 1]] + cfg.serviceHours * r.stops.length; };
      const sav = [];
      for (let p = 0; p < routes.length; p++) for (let q = p + 1; q < routes.length; q++) {
        const a = routes[p].stops[0], b = routes[q].stops[0];
        sav.push({ a, b, s: pb.tau[j][a] + pb.tau[j][b] - tauZZ[a][b] });
      }
      sav.sort((x, y) => y.s - x.s);
      for (const { a, b, s } of sav) {
        if (s <= 0) break;
        const ra = routes.find((r) => r.stops.includes(a)), rb = routes.find((r) => r.stops.includes(b));
        if (!ra || !rb || ra === rb || ra.load + rb.load > Q + 1e-6) continue;
        let merged = null;
        if (ra.stops[ra.stops.length - 1] === a && rb.stops[0] === b) merged = [...ra.stops, ...rb.stops];
        else if (rb.stops[rb.stops.length - 1] === b && ra.stops[0] === a) merged = [...rb.stops, ...ra.stops];
        else if (ra.stops[0] === a && rb.stops[0] === b) merged = [...ra.stops.reverse(), ...rb.stops];
        else if (ra.stops[ra.stops.length - 1] === a && rb.stops[rb.stops.length - 1] === b) merged = [...ra.stops, ...rb.stops.reverse()];
        if (!merged) continue;
        const cand = { stops: merged, load: ra.load + rb.load, fracs: { ...ra.fracs, ...rb.fracs } };
        if (dur(cand) > cfg.epochHours * 1.0 + 1e-6) continue;
        routes.splice(routes.indexOf(ra), 1); routes.splice(routes.indexOf(rb), 1); routes.push(cand);
      }
      routes.forEach((r) => out.push({ j, cls, stops: r.stops, loadKg: r.load, fracs: r.fracs, kind: r.stops.length > 1 ? 'milk-run' : 'direct', hours: dur(r) }));
      after += out.filter((o) => o.j === j && o.cls === cls).length;
      out.filter((o) => o.j === j && o.cls === cls).forEach((o) => {
        o.cargo = o.stops.map((i) => { const f = o.kind === 'direct' && o.frac ? o.frac : (o.fracs ? o.fracs[i] : 1); const c = {}; Object.entries(loads[i]).forEach(([k, q]) => (c[k] = q * f)); return { i, cargo: c }; });
        if (o.hours == null) o.hours = 2 * pb.tau[j][o.stops[0]] + cfg.serviceHours;
      });
    }));
    return { tours: out, tripsBefore: before, tripsAfter: after, saved: Math.max(0, before - after) };
  };

  /** Casualty transport LP. hospitals: [{beds}], tauZH[i][h] hours, cas[i] patients, ambulances A. */
  E.casualties = (cas, hospitals, tauZH, A, tauP = 1) => {
    if (!hospitals.length || !cas.some((c) => c > 0)) return { flows: [], unserved: cas.slice(), survivors: 0 };
    const model = { optimize: 'obj', opType: 'min', constraints: { amb: { max: A * AA.config.epochHours } }, variables: {} };
    cas.forEach((c, i) => {
      if (c <= 0) return;
      model.constraints[`c_${i}`] = { equal: c };
      model.variables[`uc_${i}`] = { obj: 2, [`c_${i}`]: 1 };
      hospitals.forEach((h, k) => {
        if (!isFinite(tauZH[i][k])) return;
        model.constraints[`b_${k}`] = { max: h.beds };
        model.variables[`p_${i}_${k}`] = { obj: -Math.exp(-tauZH[i][k] / tauP), [`c_${i}`]: 1, [`b_${k}`]: 1, amb: (2 * tauZH[i][k]) / 2 };
      });
    });
    const r = getSolver().Solve(model);
    const flows = []; let survivors = 0;
    cas.forEach((c, i) => hospitals.forEach((h, k) => { const v = r[`p_${i}_${k}`] || 0; if (v > 1e-6) { flows.push({ i, h: k, n: v, tau: tauZH[i][k] }); survivors += v * Math.exp(-tauZH[i][k] / tauP); } }));
    return { flows, unserved: cas.map((c, i) => r[`uc_${i}`] || 0), survivors, feasible: r.feasible };
  };

  AA.efficiency = E;
})(typeof window !== 'undefined' ? window : globalThis);
