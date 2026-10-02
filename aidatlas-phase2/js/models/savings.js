/* Cost-saving report: the optimised plan compared with the usual manual practice, "send from the nearest store".
   Same demand, same stock, same vehicles, same road times; only the decision rule differs.
   Skill: skills/savings/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const S = {};

  /**
   * Baseline: every area is supplied from its nearest open, reachable store; when that store runs out of an item
   * (or out of vehicle hours) the next-nearest store is used. Areas are served in list order (Z1 first = most
   * affected), as requests usually arrive. Direct trips only, no multi-stop runs, no fairness rule.
   * pb = { zones:[{d:{k}}], depots:[{open,stock,fleet}], tau:[j][i] h, dist:[j][i] km }
   */
  S.nearestStore = (pb) => {
    const cfg = AA.config, K = cfg.commodities, E = AA.efficiency, dt = cfg.epochHours;
    const stock = pb.depots.map((d) => ({ ...d.stock }));
    const hours = pb.depots.map((d) => ({ truck: (d.fleet.truck || 0) * dt, bus: (d.fleet.bus || 0) * dt }));
    const ship = [], trips = [];
    pb.zones.forEach((z, i) => {
      const order = pb.depots.map((d, j) => ({ d, j })).filter(({ d, j }) => d.open && isFinite(pb.tau[j][i])).sort((a, b) => pb.tau[a.j][i] - pb.tau[b.j][i]);
      ['truck', 'bus'].forEach((cls) => {
        const ks = K.filter((k) => k.cls === cls);
        const left = {}; ks.forEach((k) => (left[k.key] = z.d?.[k.key] || 0));
        for (const { j } of order) {
          if (ks.every((k) => left[k.key] <= 1e-9)) break;
          // what this store can give
          const give = {}; let kg = 0;
          ks.forEach((k) => { give[k.key] = Math.min(left[k.key], stock[j][k.key] || 0); kg += give[k.key] * k.kg; });
          if (kg <= 1e-9) continue;
          const cyc = 2 * pb.tau[j][i] + cfg.serviceHours, cap = cfg.vehicles[cls].cap;
          const possible = Math.floor(hours[j][cls] / cyc + 1e-9);
          if (possible <= 0) continue;
          const need = Math.ceil(kg / cap - 1e-9), n = Math.min(need, possible);
          const frac = Math.min(1, (n * cap) / kg);
          hours[j][cls] -= n * cyc;
          trips.push({ j, i, cls, n });
          ks.forEach((k) => { const q = give[k.key] * frac; if (q > 1e-9) { ship.push({ j, i, k: k.key, qty: q }); stock[j][k.key] -= q; left[k.key] -= q; } });
        }
      });
    });
    let transport = 0, handling = 0;
    trips.forEach((t) => (transport += t.n * E.tripCost(t.cls, pb.dist[t.j][t.i], pb.tau[t.j][t.i])));
    ship.forEach((s) => { const k = K.find((c) => c.key === s.k); if (k.cls === 'truck') handling += s.qty * k.kg * cfg.loadCostPerKg; });
    return { ship, trips, cost: { transport, handling, total: transport + handling } };
  };

  /** Metrics of any plan {ship, trips, cost} on the same problem. */
  S.metrics = (pb, plan, tripsOverride) => {
    const cfg = AA.config, K = cfg.commodities;
    const delivered = {}, demand = {};
    K.forEach((k) => { delivered[k.key] = M.sum(plan.ship.filter((s) => s.k === k.key).map((s) => s.qty)); demand[k.key] = M.sum(pb.zones.map((z) => z.d?.[k.key] || 0)); });
    const nTrips = tripsOverride ?? M.sum(plan.trips.map((t) => t.n));
    const vehHours = M.sum(plan.trips.map((t) => t.n * (2 * pb.tau[t.j][t.i] + cfg.serviceHours)));
    let kgT = 0, kg = 0;
    plan.ship.forEach((s) => { const k = K.find((c) => c.key === s.k); kgT += s.qty * k.kg * pb.tau[s.j][s.i]; kg += s.qty * k.kg; });
    const crit = K.filter((k) => k.critical).map((k) => k.key);
    const zoneGot = pb.zones.map((z, i) => { const o = {}; K.forEach((k) => (o[k.key] = M.sum(plan.ship.filter((s) => s.i === i && s.k === k.key).map((s) => s.qty)))); return o; });
    const ratio = (i, k) => { const d = pb.zones[i].d?.[k] || 0; return d > 1e-9 ? M.clamp(1 - zoneGot[i][k] / d, 0, 1) : 0; };
    const gini = {}; crit.forEach((k) => (gini[k] = AA.fairness.gini(pb.zones.map((z, i) => i).filter((i) => (pb.zones[i].d?.[k] || 0) > 1e-9).map((i) => ratio(i, k)))));
    const critDem = M.sum(crit.map((k) => demand[k] * K.find((c) => c.key === k).kg)), critDel = M.sum(crit.map((k) => Math.min(delivered[k], demand[k]) * K.find((c) => c.key === k).kg));
    // areas left with less than half of their water (the first thing people die without)
    const leftBehind = pb.zones.filter((z, i) => (z.d?.water || 0) > 1e-9 && zoneGot[i].water < 0.5 * z.d.water).map((z) => z.name || z.id);
    // high-need areas (top third by need score) served first or not
    const byNeed = pb.zones.map((z, i) => i).sort((a, b) => (pb.zones[b].need || 0) - (pb.zones[a].need || 0));
    const topN = byNeed.slice(0, Math.max(1, Math.ceil(byNeed.length / 3)));
    const topWater = M.sum(topN.map((i) => pb.zones[i].d?.water || 0)), topGot = M.sum(topN.map((i) => Math.min(zoneGot[i].water, pb.zones[i].d?.water || 0)));
    const tonnes = kg / 1000;
    return {
      cost: plan.cost.transport + plan.cost.handling, trips: nTrips, vehHours, delivered, demand,
      coverage: Object.fromEntries(K.map((k) => [k.key, demand[k.key] > 1e-9 ? Math.min(1, delivered[k.key] / demand[k.key]) : 1])),
      critCoverage: critDem > 0 ? critDel / critDem : 1, avgHours: kg > 0 ? kgT / kg : 0, tonnes,
      costPerTonne: tonnes > 0 ? (plan.cost.transport + plan.cost.handling) / tonnes : 0, gini, leftBehind,
      topNeedWater: topWater > 0 ? topGot / topWater : 1,
    };
  };

  /** Compare the current optimised run with the nearest-store baseline. */
  S.compare = (st) => {
    const run = st?.lastRun; if (!run) return null;
    const pb = run.pb;
    const base = S.nearestStore(pb);
    const b = S.metrics(pb, base), o = S.metrics(pb, run.alloc, run.cons?.tripsAfter);
    // optimised vehicle hours after consolidation (multi-stop runs replace separate part-loaded trips)
    if (run.cons?.tours?.length) o.vehHours = M.sum(run.cons.tours.map((t) => t.hours || 0));
    const pct = (a, z) => (z > 1e-9 ? (z - a) / z : 0);
    const perT = b.costPerTonne > 0 ? pct(o.costPerTonne, b.costPerTonne) : 0;
    return {
      baseline: b, optimised: o,
      saved: {
        money: b.cost - o.cost, moneyPct: pct(o.cost, b.cost), perTonnePct: perT,
        vehHours: b.vehHours - o.vehHours, vehHoursPct: pct(o.vehHours, b.vehHours),
        trips: b.trips - o.trips, faster: b.avgHours - o.avgHours,
        critPts: o.critCoverage - b.critCoverage, topNeedPts: o.topNeedWater - b.topNeedWater,
        fewerLeftBehind: b.leftBehind.length - o.leftBehind.length,
      },
      epochHours: AA.config.epochHours,
    };
  };

  /** One-sentence verdicts in plain English, best first. */
  S.headlines = (c) => {
    if (!c) return [];
    const f = AA.fmt, s = c.saved, out = [];
    const pctS = (x) => `${Math.round(Math.abs(x) * 100)} %`;
    if (s.money > 1) out.push(`Saves ${f.usd(s.money)} (${pctS(s.moneyPct)}) in transport this ${c.epochHours}-hour period.`);
    else if (s.perTonnePct > 0.02) out.push(`Costs ${f.usd(-s.money)} more in total, because it delivers more, but ${pctS(s.perTonnePct)} less per tonne delivered.`);
    if (s.vehHours > 0.5) out.push(`Uses ${f.n(s.vehHours, 0)} fewer vehicle-hours (${pctS(s.vehHoursPct)}).`);
    if (s.critPts > 0.005) out.push(`Delivers ${Math.round(s.critPts * 100)} percentage points more of the critical need (water and medical).`);
    if (s.topNeedPts > 0.005) out.push(`The highest-need areas get ${Math.round(s.topNeedPts * 100)} points more of their water.`);
    if (s.fewerLeftBehind > 0) out.push(`${s.fewerLeftBehind} fewer area${s.fewerLeftBehind > 1 ? 's are' : ' is'} left with less than half their water.`);
    if (s.faster > 0.05) out.push(`Supplies arrive ${f.min(s.faster)} sooner on average.`);
    if (!out.length) out.push('Here the nearest-store rule happens to give about the same result: stores and areas are close together and stock is enough.');
    return out;
  };

  AA.savings = S;
})(typeof window !== 'undefined' ? window : globalThis);
