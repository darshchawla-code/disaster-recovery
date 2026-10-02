/* Pre-season readiness score: is the stock and transport in a district enough for the worst likely (P90)
   first 72 hours of a disaster in each of its high-risk areas?  Pure model, no network.
   Skill: skills/readiness/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const RD = {};
  RD.DAYS = 3;                 // stock must cover the first 72 hours
  RD.REACH_HOURS = 3;          // a store counts for an area if its stock can be on the road there within 3 h
  RD.TRANSPORT_WEIGHT = 2;     // weight of "enough trucks" next to the item weights (criticality)
  RD.GRADES = [[80, 'Ready', 'ready'], [50, 'Partly ready', 'partly'], [0, 'Not ready', 'not']];
  RD.grade = (s) => RD.GRADES.find(([t]) => s >= t);

  /** P90 need for the first 72 hours from forecast zones (same rates and P90 rule as storage-site sizing). */
  RD.need72 = (zones) => {
    const F = AA.fairness, P = AA.prediction, out = {};
    AA.config.commodities.forEach((c) => (out[c.key] = 0));
    let aff = 0;
    zones.forEach((z) => {
      const a = P.scenarioValue(z.fc.aff, 'high'), d = Math.min(a, P.scenarioValue(z.fc.dis, 'high')), inj = P.scenarioValue(z.fc.inj, 'high');
      aff += a;
      AA.config.commodities.forEach((c) => { const r = F.RATES[c.key]; out[c.key] += r.flow ? r.f(a, d, inj) * RD.DAYS : r.f(a, d, inj); });
    });
    return { need: out, affP90: aff };
  };

  /** Inventory rows (Workspace → Inventory source, same columns as the CSV import) → stores in model units. */
  RD.storesFromRows = (rows) => {
    const scaleOf = { water_l: ['water', 1 / 1000], food_kg: ['food', 1 / 1000], tents: ['shelter', 1], medkits: ['medical', 1], staff: ['staff', 1] };
    return (rows || []).map((r, k) => {
      const stock = { water: 0, food: 0, shelter: 0, medical: 0, staff: 0 };
      Object.entries(scaleOf).forEach(([col, [key, f]]) => (stock[key] = (+r[col] || 0) * f));
      return { name: r.name || `Store ${k + 1}`, lat: +r.lat, lon: +r.lon, type: r.type || 'warehouse', address: r.address || '', stock, fleet: { truck: +r.trucks || 0, bus: +r.buses || 0, amb: +r.ambulances || 0 }, prov: 'your inventory' };
    }).filter((s) => isFinite(s.lat) && isFinite(s.lon));
  };
  /** OpenStreetMap facilities with the planning-assumption stock by type (labelled "assumed"). */
  RD.storesFromFacilities = (facs) => (facs || []).map((f) => {
    const t = AA.engine?.STOCK?.[f.type] || AA.engine?.STOCK?.warehouse;
    if (!t) return null;
    return { name: f.name || `${f.type} (unnamed)`, lat: f.lat, lon: f.lon, type: f.type, address: f.address || '', stock: { ...t.stock }, fleet: { ...t.fleet }, prov: 'assumed by facility type' };
  }).filter(Boolean);

  /**
   * areas: [{ name, lat, lon, R, sit, need:{k}, affP90 }]   stores: [{ name, lat, lon, stock:{k}, fleet:{truck,bus} }]
   * tau (optional): [store][area] road hours; default = straight line × circuity at the fallback speed.
   */
  RD.score = (areas, stores, tau = null) => {
    const cfg = AA.config, K = cfg.commodities, P = AA.prediction;
    const hrs = (j, a) => (tau && isFinite(tau[j]?.[a]) ? tau[j][a] : (M.haversine(stores[j], areas[a]) * cfg.circuity) / cfg.fallbackSpeedKmh);
    const W = Object.fromEntries(K.map((k) => [k.key, cfg.criticality[k.key] || 1]));
    const wSum = M.sum(Object.values(W)) + RD.TRANSPORT_WEIGHT;
    const res = areas.map((ar, a) => {
      // a store counts if it is within reach and not itself badly damaged in this area's scenario
      const usable = stores.map((s, j) => {
        const h = hrs(j, a);
        const sev = ar.sit ? P.impact(ar.sit.hazard, P.intensity(ar.sit, M.haversine(ar.sit, s)), ar.sit.countryVul, 0, ar.sit.floodKind).sev : 0;
        return { s, j, h, sev, ok: h <= RD.REACH_HOURS && sev < 0.6 };
      });
      const ok = usable.filter((u) => u.ok);
      const items = K.map((k) => {
        const have = M.sum(ok.map((u) => u.s.stock[k.key] || 0)), need = ar.need[k.key] || 0;
        return { key: k.key, label: k.label, unit: k.unit, have, need, r: need > 1e-9 ? Math.min(1, have / need) : 1, short: Math.max(0, need - have) };
      });
      // transport: can the trucks and buses in reach move the 72-hour need in 72 hours?
      const T = RD.DAYS * 24;
      const cap = (cls) => M.sum(ok.map((u) => (u.s.fleet[cls] || 0) * Math.floor(T / (2 * u.h + cfg.serviceHours)) * cfg.vehicles[cls].cap));
      const kgNeed = (cls) => M.sum(K.filter((k) => k.cls === cls).map((k) => (ar.need[k.key] || 0) * k.kg));
      const capT = cap('truck'), capB = cap('bus'), nT = kgNeed('truck'), nB = kgNeed('bus');
      const rT = nT > 0 ? Math.min(1, capT / nT) : 1, rB = nB > 0 ? Math.min(1, capB / nB) : 1;
      const rTrans = Math.min(rT, rB);
      const cycle = ok.length ? M.mean(ok.map((u) => 2 * u.h + cfg.serviceHours)) : 2 * RD.REACH_HOURS;
      const trucksShort = nT > capT ? Math.ceil((nT - capT) / cfg.vehicles.truck.cap / Math.max(1, Math.floor(T / cycle))) : 0;
      const busesShort = nB > capB ? Math.ceil((nB - capB) / cfg.vehicles.bus.cap / Math.max(1, Math.floor(T / cycle))) : 0;
      const score = (100 * (M.sum(items.map((it) => W[it.key] * it.r)) + RD.TRANSPORT_WEIGHT * rTrans)) / wSum;
      return { area: ar, score, items, transport: { r: rTrans, rT, rB, trucksShort, busesShort, capKg: capT, needKg: nT }, stores: ok.map((u) => ({ name: u.s.name, hours: u.h, prov: u.s.prov })), excluded: usable.filter((u) => !u.ok && u.h <= RD.REACH_HOURS).map((u) => u.s.name) };
    });
    // district: weighted by people at risk (P90 affected); the weakest area is reported separately
    const wts = res.map((r) => Math.max(1, r.area.affP90 || 1));
    const district = res.length ? M.sum(res.map((r, i) => r.score * wts[i])) / M.sum(wts) : 0;
    const weakest = res.slice().sort((a, b) => a.score - b.score)[0] || null;
    // stock to add so that ANY one of these areas could be served (worst single area per item)
    const gaps = K.map((k) => ({ key: k.key, label: k.label, unit: k.unit, add: Math.max(0, ...res.map((r) => r.items.find((x) => x.key === k.key).short)) })).filter((g) => g.add > 1e-6);
    const vehicles = { trucks: Math.max(0, ...res.map((r) => r.transport.trucksShort)), buses: Math.max(0, ...res.map((r) => r.transport.busesShort)) };
    const g = RD.grade(district);
    return { score: district, grade: g[1], gradeKey: g[2], areas: res, weakest, gaps, vehicles, stores: stores.length, provs: [...new Set(stores.map((s) => s.prov))] };
  };

  AA.readiness = RD;
})(typeof window !== 'undefined' ? window : globalThis);
