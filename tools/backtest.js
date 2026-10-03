#!/usr/bin/env node
/* Run the AidAtlas back-test from the command line and write the results file the Validation page can open.
   node tools/backtest.js [--worldpop] [--out backtest-results.json]
   Needs internet access to OpenStreetMap (Overpass) and the World Bank (and WorldPop with --worldpop). */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const UA = 'AidAtlas-backtest (+https://github.com/darshchawla-code/disaster-recovery)';
const raw = globalThis.fetch; globalThis.fetch = (u, init = {}) => raw(u, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } });
globalThis.solver = require('javascript-lp-solver');
['js/core.js', 'js/data.js', 'js/workspace.js', 'js/models/fatality-params.js', 'js/models/prediction.js', 'js/models/fairness.js', 'js/models/efficiency.js', 'js/models/routing.js', 'js/models/facility.js', 'js/models/risk.js', 'js/engine.js', 'js/pipelines.js', 'js/models/backtest.js'].forEach((f) => require(path.join(ROOT, f)));
const AA = globalThis.AA;
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'backtest-results.json');
(async () => {
  const run = await AA.backtest.run({ worldpop: args.includes('--worldpop'), step: (m, k, n) => process.stdout.write(`\r[${Math.min(k + 1, n)}/${n}] ${m}`.padEnd(90)) });
  fs.writeFileSync(out, JSON.stringify(run, null, 1));
  const s = run.summary;
  console.log(`\n${s.n} scored · ${s.inside} inside P10–P90 (${Math.round(s.coverage * 100)} %) · typical gap ×${s.typicalFactor.toFixed(2)} · within ×3: ${Math.round(s.within3 * 100)} % · bias ×${s.bias.toFixed(2)}\nWrote ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
