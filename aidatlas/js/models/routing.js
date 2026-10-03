/* Routing: damage-aware matrices, path choice, closures. Skill: skills/routing/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const R = {};

  /** Road damage θ at point p for the current epoch (θ_t = θ0(1−ρ)^t + Σ η_e(1−ρ)^(t−t_e)). */
  R.damageAt = (sit, st, p) => {
    const cfg = AA.config, P = AA.prediction;
    const r = M.haversine(sit, p);
    const I = P.intensity(sit, r);
    let th0 = 0;
    if (sit.hazard === 'EQ') th0 = M.Phi((I - 9.0) / 1.0);
    else if (sit.hazard === 'TC') th0 = M.Phi(Math.log(Math.max(I, 1) / 200) / 0.3);
    else if (sit.hazard === 'FL') th0 = 0.6 * I;
    else if (sit.hazard === 'WF' || sit.hazard === 'VO') th0 = 0.8 * I;
    const decay = (t) => Math.pow(1 - cfg.roadRecovery, Math.max(0, t));
    let th = th0 * decay(st.epoch || 0);
    (st.shocks || []).forEach((e) => { const d = M.haversine(e, p); if (d < e.radiusKm) th += e.eta * (1 - d / e.radiusKm) * decay((st.epoch || 0) - e.epoch); });
    return M.clamp(th, 0, 1);
  };

  /** Mean θ along the straight segment a→b (8 samples) — used to slow matrix times. */
  R.lineDamage = (sit, st, a, b) => {
    let s = 0; const n = 8;
    for (let k = 0; k <= n; k++) s += R.damageAt(sit, st, { lat: a.lat + (b.lat - a.lat) * k / n, lon: a.lon + (b.lon - a.lon) * k / n });
    return s / (n + 1);
  };

  R.hitsClosure = (coords, closures, bufKm) => {
    if (!closures || !closures.length) return false;
    for (const c of closures) for (let k = 1; k < coords.length; k++) {
      const a = { lat: coords[k - 1][1], lon: coords[k - 1][0] }, b = { lat: coords[k][1], lon: coords[k][0] };
      if (Math.abs(a.lat - c.lat) > 0.2 || Math.abs(a.lon - c.lon) > 0.2) continue;
      if (M.pointSegDist(c, a, b) <= bufKm) return true;
    }
    return false;
  };

  /** Evaluate a geometry: damage stats + generalised cost. coords = [[lon,lat],...] */
  R.evaluate = (sit, st, coords, distKm, hours, cls = 'truck') => {
    const cfg = AA.config, v = cfg.vehicles[cls];
    const step = Math.max(1, Math.floor(coords.length / 40));
    const ths = []; for (let k = 0; k < coords.length; k += step) ths.push(R.damageAt(sit, st, { lat: coords[k][1], lon: coords[k][0] }));
    const mean = M.mean(ths), max = Math.max(0, ...ths);
    const adjH = (hours * (st.congestion || 1)) / (1 - cfg.roadAlpha * mean);
    const blocked = R.hitsClosure(coords, st.closures, cfg.closureBufferKm);
    const tooDamaged = max >= cfg.thetaMax;
    return { mean, max, adjH, gc: v.cD * distKm + v.cT * adjH, blocked, tooDamaged, feasible: !blocked && !tooDamaged };
  };

  /** Choose the cheapest feasible path for one leg, trying OSRM alternatives then detours. */
  R.routeLeg = async (sit, st, a, b, cls = 'truck') => {
    const tryRoutes = async (pts) => {
      const rs = await AA.data.osrmRoute(pts).catch(() => null);
      if (!rs) return [];
      return rs.map((r) => ({ coords: r.geometry.coordinates, km: r.distance / 1000, h: r.duration / 3600 }));
    };
    let cands = await tryRoutes([a, b]);
    let source = 'osrm';
    if (!cands.length) { // network fallback: great circle × circuity
      const km = M.haversine(a, b) * AA.config.circuity;
      cands = [{ coords: [[a.lon, a.lat], [b.lon, b.lat]], km, h: km / AA.config.fallbackSpeedKmh }];
      source = 'estimated';
    }
    let evald = cands.map((c, idx) => ({ ...c, alt: idx, ev: R.evaluate(sit, st, c.coords, c.km, c.h, cls) }));
    let ok = evald.filter((c) => c.ev.feasible);
    let detour = false;
    if (!ok.length && source === 'osrm') {
      const L = M.haversine(a, b), mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      const brg = Math.atan2(b.lon - a.lon, b.lat - a.lat) * 180 / Math.PI;
      for (const side of [90, -90]) {
        const via = M.destination(mid, brg + side, 0.3 * L + 2);
        const d = await tryRoutes([a, via, b]);
        const e = d.map((c) => ({ ...c, alt: 'detour', ev: R.evaluate(sit, st, c.coords, c.km, c.h, cls) })).filter((c) => c.ev.feasible);
        if (e.length) { ok = e; detour = true; evald = evald.concat(e); break; }
      }
    }
    const best = ok.sort((p, q) => p.ev.gc - q.ev.gc)[0];
    return { best: best || null, candidates: evald, source, detour, airdrop: !best };
  };

  /** Damage/congestion-adjusted matrices. base = {dur:[[s]], dist:[[m]]} from OSRM table or null. */
  R.adjustMatrix = (sit, st, from, to, base) => {
    const cfg = AA.config;
    const tau = [], dist = [], theta = [];
    from.forEach((a, j) => {
      tau[j] = []; dist[j] = []; theta[j] = [];
      to.forEach((b, i) => {
        let km, h;
        if (base && base.dist?.[j]?.[i] != null && base.dur?.[j]?.[i] != null) { km = base.dist[j][i] / 1000; h = base.dur[j][i] / 3600; }
        else { km = M.haversine(a, b) * cfg.circuity; h = km / cfg.fallbackSpeedKmh; }
        const th = R.lineDamage(sit, st, a, b);
        theta[j][i] = th;
        dist[j][i] = km;
        tau[j][i] = (h * (st.congestion || 1)) / (1 - cfg.roadAlpha * th);
      });
    });
    return { tau, dist, theta };
  };

  AA.routing = R;
})(typeof window !== 'undefined' ? window : globalThis);
