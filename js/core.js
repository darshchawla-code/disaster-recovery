/* AidAtlas core: namespace, maths utilities, configuration. Skill: orchestrator */
(function (root) {
  const AA = (root.AA = root.AA || {});

  // ---------- maths ----------
  const M = {};
  M.EPS = 1e-6;
  M.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7
  M.erf = (x) => {
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  };
  M.Phi = (z) => 0.5 * (1 + M.erf(z / Math.SQRT2));
  M.toRad = (d) => d * Math.PI / 180;
  M.haversine = (a, b) => { // km
    const R = 6371.0088, dLat = M.toRad(b.lat - a.lat), dLon = M.toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(M.toRad(a.lat)) * Math.cos(M.toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  };
  M.destination = (p, bearingDeg, km) => {
    const R = 6371.0088, d = km / R, br = M.toRad(bearingDeg);
    const la1 = M.toRad(p.lat), lo1 = M.toRad(p.lon);
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
    const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    return { lat: la2 * 180 / Math.PI, lon: ((lo2 * 180 / Math.PI + 540) % 360) - 180 };
  };
  // point-to-segment distance (km) using local equirectangular projection
  M.pointSegDist = (p, a, b) => {
    const k = Math.cos(M.toRad(p.lat)) * 111.32, kl = 110.57;
    const ax = (a.lon - p.lon) * k, ay = (a.lat - p.lat) * kl, bx = (b.lon - p.lon) * k, by = (b.lat - p.lat) * kl;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? -(ax * dx + ay * dy) / L : 0; t = M.clamp(t, 0, 1);
    const x = ax + t * dx, y = ay + t * dy; return Math.sqrt(x * x + y * y);
  };
  M.mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  M.gauss = (rng) => { // Box–Muller
    let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  M.quantile = (arr, q) => {
    const a = [...arr].sort((x, y) => x - y); if (!a.length) return 0;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  };
  M.minmax = (vals) => {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return vals.map((v) => (v - lo) / (hi - lo + M.EPS));
  };
  M.sum = (a) => a.reduce((s, x) => s + x, 0);
  M.mean = (a) => (a.length ? M.sum(a) / a.length : 0);
  M.std = (a) => { const m = M.mean(a); return Math.sqrt(M.mean(a.map((x) => (x - m) ** 2))); };
  M.round = (x, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; };
  // ---------- polygons (GeoJSON lon/lat rings) ----------
  /** Ray-casting point-in-ring; holes are ignored (flood outlines rarely have meaningful holes). */
  M.inRing = (p, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
    }
    return inside;
  };
  /** polys = array of polygons, each an array of rings (GeoJSON MultiPolygon coordinates). */
  M.inPolys = (p, polys) => (polys || []).some((poly) => poly[0] && M.inRing(p, poly[0]));
  M.polysBBox = (polys) => {
    let w = 180, s = 90, e = -180, n = -90;
    (polys || []).forEach((poly) => (poly[0] || []).forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
    return { w, s, e, n, c: { lat: (s + n) / 2, lon: (w + e) / 2 } };
  };
  /** Distance (km) from p to the nearest polygon edge; 0 when inside. */
  M.distToPolys = (p, polys) => {
    if (M.inPolys(p, polys)) return 0;
    let d = Infinity;
    (polys || []).forEach((poly) => { const r = poly[0] || []; for (let i = 1; i < r.length; i++) d = Math.min(d, M.pointSegDist(p, { lon: r[i - 1][0], lat: r[i - 1][1] }, { lon: r[i][0], lat: r[i][1] })); });
    return d;
  };
  /** Approximate circle as a closed GeoJSON polygon ring (n vertices). */
  M.circleRing = (c, km, n = 16) => { const r = []; for (let k = 0; k <= n; k++) { const p = M.destination(c, (k % n) * (360 / n), km); r.push([+p.lon.toFixed(5), +p.lat.toFixed(5)]); } return r; };
  AA.math = M;

  /** Version of the forecast and planning models; back-test results and model cards refer to it. */
  AA.MODEL_VERSION = '3.1.2';

  // ---------- configuration (all editable in Settings) ----------
  AA.config = {
    epochHours: 6,
    horizonEpochs: 4,
    scenarioWeights: { low: 0.3, base: 0.4, high: 0.3 }, // Swanson–Megill
    mcDraws: 400,
    seed: 20261001,
    needWeights: { sev: 0.35, pop: 0.2, vul: 0.2, acc: 0.15, recv: 0.1 },
    objective: { alpha: 1, delta: 2, beta: 1, mu: 3, phi: 0.5 },
    criticality: { water: 3, medical: 3, food: 2, staff: 2, shelter: 1.5 },
    commodities: [
      { key: 'water', label: 'Water', unit: 'kL', kg: 1000, critical: true, cls: 'truck' },
      { key: 'food', label: 'Food', unit: 't', kg: 1000, critical: false, cls: 'truck' },
      { key: 'shelter', label: 'Shelter', unit: 'tents', kg: 35, critical: false, cls: 'truck' },
      { key: 'medical', label: 'Medical', unit: 'modules', kg: 50, critical: true, cls: 'truck' },
      { key: 'staff', label: 'Personnel', unit: 'staff', kg: 1, critical: false, cls: 'bus' },
    ],
    vehicles: {
      truck: { label: 'Truck', cap: 8000, cD: 1.2, cT: 40, cF: 150, speedFactor: 1.0, color: '#f59e0b' },
      bus: { label: 'Responder bus', cap: 30, cD: 0.9, cT: 35, cF: 100, speedFactor: 1.0, color: '#38bdf8' },
    },
    loadCostPerKg: 0.02,
    serviceHours: 0.5,
    bprCapacityPerEpoch: 12,
    roadAlpha: 0.7,
    thetaMax: 0.95,
    roadRecovery: 0.08,
    closureBufferKm: 0.25,
    circuity: 1.35,
    fallbackSpeedKmh: 40,
    coverageMinutes: 90,
    warehouses: 3,
    tomtomKey: '',
    showFleet: false,
    lowBandwidth: false, // Settings: no WorldPop, no street addresses, no 3D, street map instead of satellite
  };

  AA.fmt = {
    n: (x, d = 0) => (x == null || isNaN(x) ? '–' : Number(x).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })),
    k: (x) => (x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(1) + 'k' : Math.round(x) + ''),
    usd: (x) => '$' + AA.fmt.n(x, 0),
    min: (h) => Math.round(h * 60) + ' min',
  };
  AA.HAZARDS = {
    EQ: { label: 'Earthquake', lethal: 1.0, icon: '〰' },
    TC: { label: 'Tropical cyclone', lethal: 0.9, icon: '🌀' },
    FL: { label: 'Flood', lethal: 0.8, icon: '≈' },
    VO: { label: 'Volcano', lethal: 0.7, icon: '▲' },
    DR: { label: 'Drought', lethal: 0.6, icon: '☀' },
    WF: { label: 'Wildfire', lethal: 0.5, icon: '🔥' },
  };
})(typeof window !== 'undefined' ? window : globalThis);
