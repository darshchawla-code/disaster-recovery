/* Multi-hazard risk grid (INFORM-style). Skill: skills/risk-assessment/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const RK = {};

  /** Aki (1965) maximum-likelihood b-value and annual a-value. */
  RK.gutenbergRichter = (mags, years, Mc = 4.5, dM = 0.1) => {
    const m = mags.filter((x) => x >= Mc);
    if (m.length < 5 || years <= 0) return { n: m.length, b: 1.0, a: null, lambda6: m.filter((x) => x >= 6).length / Math.max(years, 1), note: 'too few events; empirical rate used' };
    const b = Math.LOG10E / (M.mean(m) - (Mc - dM / 2));
    const a = Math.log10(m.length / years) + b * Mc;
    const lambda6 = Math.pow(10, a - 6 * b);
    return { n: m.length, b, a, lambda6, Mc, years };
  };

  /** Gumbel EV-I fit by method of moments; returns quantile function. */
  RK.gumbel = (annualMax) => {
    const xs = annualMax.filter((x) => isFinite(x));
    if (xs.length < 3) return null;
    const beta = (M.std(xs) * Math.sqrt(6)) / Math.PI, mu = M.mean(xs) - 0.5772 * beta;
    return { mu, beta, q: (T) => mu - beta * Math.log(-Math.log(1 - 1 / T)), n: xs.length };
  };

  RK.grid = (c, halfKm = 60, n = 7) => {
    const cells = [];
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const dy = -halfKm + (2 * halfKm * (a + 0.5)) / n, dx = -halfKm + (2 * halfKm * (b + 0.5)) / n;
      cells.push({ id: `R${a}${b}`, lat: c.lat + dy / 110.57, lon: c.lon + dx / (111.32 * Math.cos(M.toRad(c.lat))), sizeKm: (2 * halfKm) / n });
    }
    return cells;
  };

  const logIdx = (p) => M.clamp((Math.log10(Math.max(p, 1e-5)) + 4) / 4, 0, 1); // 1e-4 → 0, 1 → 1

  /**
   * inputs: { eq:[{lat,lon,magnitude}], eqYears, events:[{lat,lon,hazard}], eventYears,
   *           q100:[per cell m³/s] | null, elev:[per cell m] | null, places:[{lat,lon,population,type}],
   *           hospitals:[{lat,lon}], country:{vul,lcc} }
   */
  RK.assess = (cells, inp) => {
    const gr = RK.gutenbergRichter((inp.eq || []).map((e) => e.magnitude), inp.eqYears || 50);
    const regionArea = Math.PI * 400 * 400, footprint = Math.PI * 50 * 50;
    const kEq = cells.map((c) => M.sum((inp.eq || []).map((e) => Math.exp(-(M.haversine(c, e) ** 2) / (2 * 50 * 50)))));
    const kEqMean = M.mean(kEq) || 1;
    const elevMed = inp.elev ? M.quantile(inp.elev.filter(isFinite), 0.5) : 0;
    const popK = cells.map((c) => M.sum((inp.places || []).map((p) => (p.population || ({ city: 250000, town: 20000, village: 1500 })[p.type] || 500) * Math.exp(-(M.haversine(c, p) ** 2) / (2 * 10 * 10)))));
    const popMax = Math.max(1, ...popK);
    const hazards = ['TC', 'FL', 'WF', 'VO', 'DR'];
    cells.forEach((c, i) => {
      const comp = {};
      // earthquake: regional G-R rate redistributed by epicentre kernel
      const rateEq = gr.lambda6 * (footprint / regionArea) * (kEq[i] / kEqMean) * (inp.eq?.length ? 1 : 0);
      comp.EQ = 1 - Math.exp(-10 * rateEq);
      // event-frequency hazards (σ = 75 km kernel), plus river-flood index from GloFAS
      hazards.forEach((h) => {
        const lam = M.sum((inp.events || []).filter((e) => e.hazard === h).map((e) => Math.exp(-(M.haversine(c, e) ** 2) / (2 * 75 * 75)))) / Math.max(1, inp.eventYears || 25);
        comp[h] = 1 - Math.exp(-10 * lam);
      });
      if (inp.q100 && isFinite(inp.q100[i])) {
        const low = inp.elev && inp.elev[i] < elevMed ? 1.25 : 1;
        c.q100 = inp.q100[i];
        comp.FL = Math.max(comp.FL, M.clamp((1 - Math.exp(-inp.q100[i] / 500)) * low, 0, 0.95));
      }
      const H0 = 1 - Object.values(comp).reduce((p, x) => p * (1 - x), 1);
      const H = logIdx(H0);
      const E = Math.log10(1 + popK[i]) / Math.log10(1 + popMax);
      const near = (inp.places || []).filter((p) => M.haversine(c, p) < 15);
      const ruralPop = M.sum(near.filter((p) => ['village', 'hamlet'].includes(p.type)).map((p) => p.population || 1500));
      const allPop = M.sum(near.map((p) => p.population || ({ city: 250000, town: 20000 })[p.type] || 1500));
      const rural = allPop ? ruralPop / allPop : 0.8;
      const V = M.clamp(0.5 * (inp.country?.vul ?? 0.5) + 0.5 * rural, 0.01, 1);
      const dH = (inp.hospitals || []).length ? Math.min(...inp.hospitals.map((h) => M.haversine(c, h))) : 40;
      const LCC = M.clamp(0.5 * M.clamp(dH / 30, 0, 1) + 0.5 * (inp.country?.lcc ?? 0.5), 0.01, 1);
      const HE = Math.sqrt(H * E);
      const R = Math.cbrt(HE) * Math.cbrt(V) * Math.cbrt(LCC);
      const dom = Object.entries(comp).sort((a, b) => b[1] - a[1])[0];
      Object.assign(c, { comp, H0, H, E, V, LCC, R, dominant: dom[1] > 0 ? dom[0] : 'EQ', hospKm: dH, pop: popK[i] });
    });
    return { gr, cells };
  };

  AA.risk = RK;
})(typeof window !== 'undefined' ? window : globalThis);
