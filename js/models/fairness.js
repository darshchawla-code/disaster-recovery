/* Fairness: need score, Sphere demand, equity metrics. Skill: skills/fairness/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const F = {};

  // Sphere Handbook 2018 minimums + labelled planning ratios
  F.RATES = {
    water: { flow: true, f: (a, d) => (15 * d + 3 * (a - d)) / 1000 },   // kL / day
    food: { flow: true, f: (a, d) => (0.6 * d + 0.3 * (a - d)) / 1000 }, // t / day
    shelter: { flow: false, f: (a, d) => d / 5 },                        // tents (target)
    medical: { flow: false, f: (a, d, inj) => inj / 50 + a / 1000 },      // modules (target)
    staff: { flow: false, f: (a, d, inj) => inj / 20 + d / 500 },         // staff (target)
  };

  /** Cumulative demand target for zone z, commodity k, scenario s, at end of epoch t. */
  F.targetDemand = (z, k, s, epoch, sit) => {
    const P = AA.prediction, cfg = AA.config;
    const a = P.scenarioValue(z.fc.aff, s), d = Math.min(a, P.scenarioValue(z.fc.dis, s)), inj = P.scenarioValue(z.fc.inj, s);
    const sevScale = z.sevPost != null ? M.clamp(z.sevPost / Math.max(z.fc.sev.p50, 0.02), 0.2, 3) : 1;
    const hoursEnd = (epoch + 1) * cfg.epochHours;
    const ramp = P.rampAt(sit, hoursEnd);
    const r = F.RATES[k];
    const base = r.f(a, d, inj) * sevScale * (z.surge || 1) * ramp;
    return r.flow ? base * hoursEnd / 24 : base;
  };

  /** Expected net demand d_ik (Σ_s p_s D_iks − recv), plus P90 for pre-positioning. */
  F.netDemand = (zones, sit, epoch) => {
    const w = AA.config.scenarioWeights;
    zones.forEach((z) => {
      z.D = {}; z.d = {}; z.D90 = {};
      AA.config.commodities.forEach(({ key }) => {
        const exp = w.low * F.targetDemand(z, key, 'low', epoch, sit) + w.base * F.targetDemand(z, key, 'base', epoch, sit) + w.high * F.targetDemand(z, key, 'high', epoch, sit);
        z.D[key] = exp;
        z.D90[key] = F.targetDemand(z, key, 'high', epoch, sit);
        z.d[key] = z.served ? 0 : Math.max(0, exp - (z.recv[key] || 0));
      });
    });
  };

  /** Need score N_i with full breakdown for the explainer. */
  F.needScores = (zones, sit) => {
    const w = AA.config.needWeights;
    const sev = zones.map((z) => (z.sevPost != null ? z.sevPost : z.sevMean));
    const pop = zones.map((z) => z.fc.aff.p50);
    const recvFrac = zones.map((z) => {
      let got = 0, need = 0;
      AA.config.commodities.forEach((c) => { got += (z.recv[c.key] || 0) * c.kg; need += (z.D?.[c.key] || 0) * c.kg; });
      return need > 0 ? M.clamp(got / need, 0, 1) : 0;
    });
    const sevN = M.minmax(sev), popN = M.minmax(pop);
    const recvN = recvFrac.every((v) => v === 0) ? recvFrac : M.minmax(recvFrac);
    zones.forEach((z, i) => {
      z.vul = M.clamp(0.5 * z.rural + 0.5 * (sit.countryVul ?? 0.5), 0, 1);
      const acc = M.clamp(z.acc ?? 0.5, 0, 1);
      const N = w.sev * sevN[i] + w.pop * popN[i] + w.vul * z.vul + w.acc * acc - w.recv * recvN[i];
      z.need = M.clamp(N, 0, 1);
      z.needParts = { sev: sev[i], sevN: sevN[i], pop: pop[i], popN: popN[i], vul: z.vul, acc, recvFrac: recvFrac[i], recvN: recvN[i] };
    });
  };

  /** Gini of shortage ratios (classical, for reporting). */
  F.gini = (q) => {
    const n = q.length, mean = M.mean(q); if (!n || mean < 1e-9) return 0;
    let s = 0; for (const a of q) for (const b of q) s += Math.abs(a - b);
    return s / (2 * n * n * mean);
  };

  AA.fairness = F;
})(typeof window !== 'undefined' ? window : globalThis);
