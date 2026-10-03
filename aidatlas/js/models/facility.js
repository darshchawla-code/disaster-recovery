/* Facility location: hazard-safe MCLP + p-median tie-break. Skill: skills/facility-location/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const FL = {};

  /** Candidate grid (5×5) around the focus, flagged hazard-unsafe when heavy damage > 0.3. */
  FL.candidates = (sit, n = 5) => {
    const c = sit.focus || sit, half = Math.min(1.2 * sit.radiusKm, 60);
    const out = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const dy = -half + (2 * half * a) / (n - 1), dx = -half + (2 * half * b) / (n - 1);
      const p = { lat: c.lat + dy / 110.57, lon: c.lon + dx / (111.32 * Math.cos(M.toRad(c.lat))) };
      const I = AA.prediction.intensity(sit, M.haversine(sit, p));
      const sev = AA.prediction.impact(sit.hazard, I, sit.countryVul).sev;
      out.push({ ...p, sev, safe: sev <= 0.3, kind: 'grid' });
    }
    return out;
  };

  const combos = function* (n, k, start = 0, acc = []) {
    if (acc.length === k) { yield acc.slice(); return; }
    for (let i = start; i <= n - (k - acc.length); i++) { acc.push(i); yield* combos(n, k, i + 1, acc); acc.pop(); }
  };

  /**
   * zones: [{need, fc}], cand: [{safe}], tau[c][i] hours.
   * Exact MCLP by enumeration when C(n,P) ≤ 60 000, otherwise greedy + 1-swap.
   */
  FL.mclp = (zones, cand, tau, P = AA.config.warehouses, Tc = AA.config.coverageMinutes / 60) => {
    const idx = cand.map((c, j) => j).filter((j) => cand[j].safe);
    const w = zones.map((z) => (z.need ?? 0.5) * (z.fc ? z.fc.aff.p90 : z.pop || 1));
    const wMax = Math.max(1, ...w);
    const score = (S) => {
      let cov = 0, med = 0;
      zones.forEach((z, i) => {
        let best = Infinity; S.forEach((j) => { if (tau[j][i] < best) best = tau[j][i]; });
        if (best <= Tc) cov += w[i];
        med += (w[i] / wMax) * (isFinite(best) ? best : 99);
      });
      return { cov, med, val: cov - 1e-4 * wMax * med };
    };
    P = Math.min(P, idx.length);
    if (!P) return { sites: [], method: 'no hazard-safe candidates', covered: 0, total: M.sum(w) };
    let nComb = 1; for (let k = 0; k < P; k++) nComb = (nComb * (idx.length - k)) / (k + 1);
    let best = null, method;
    if (nComb <= 60000) {
      method = `exact enumeration of ${Math.round(nComb).toLocaleString()} site combinations`;
      for (const c of combos(idx.length, P)) { const S = c.map((k) => idx[k]); const s = score(S); if (!best || s.val > best.s.val) best = { S, s }; }
    } else {
      method = 'greedy + 1-swap local search';
      let S = [];
      for (let k = 0; k < P; k++) { let b = null; idx.forEach((j) => { if (S.includes(j)) return; const s = score([...S, j]); if (!b || s.val > b.s.val) b = { j, s }; }); S.push(b.j); }
      let improved = true;
      while (improved) { improved = false; const cur = score(S).val; for (let a = 0; a < S.length && !improved; a++) for (const j of idx) { if (S.includes(j)) continue; const T = S.slice(); T[a] = j; if (score(T).val > cur + 1e-9) { S = T; improved = true; break; } } }
      best = { S, s: score(S) };
    }
    const assign = zones.map((z, i) => best.S.reduce((b, j) => (tau[j][i] < tau[b][i] ? j : b), best.S[0]));
    return { sites: best.S, assign, covered: best.s.cov, total: M.sum(w), method, Tc, weights: w };
  };

  /** 72-hour P90 stock per recommended site. */
  FL.size = (zones, sol) => {
    const F = AA.fairness, P = AA.prediction;
    return sol.sites.map((j) => {
      const stock = {}; AA.config.commodities.forEach((c) => (stock[c.key] = 0));
      zones.forEach((z, i) => {
        if (sol.assign[i] !== j) return;
        const a = P.scenarioValue(z.fc.aff, 'high'), d = Math.min(a, P.scenarioValue(z.fc.dis, 'high')), inj = P.scenarioValue(z.fc.inj, 'high');
        AA.config.commodities.forEach((c) => { const r = F.RATES[c.key]; stock[c.key] += r.flow ? r.f(a, d, inj) * 3 : r.f(a, d, inj); });
      });
      return { j, stock, zones: zones.filter((_, i) => sol.assign[i] === j).map((z) => z.id) };
    });
  };

  AA.facility = FL;
})(typeof window !== 'undefined' ? window : globalThis);
