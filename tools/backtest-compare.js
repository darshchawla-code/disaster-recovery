/* Regression guard for the earthquake model: compare a new back-test run (JSON downloaded from the Validation page)
   with the best live result so far (tests/baseline/backtest-3.1.0.json). Exits 1 if the new run is worse.
   Usage: node tools/backtest-compare.js aidatlas-backtest-<version>.json
   Tolerance: public map servers sometimes fail, which moves a run by an event or two, so a run passes if
   coverage is within 2 events of the baseline and the typical error is at most 10 % above it — and fails otherwise. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
['js/core.js', 'js/data.js', 'js/workspace.js', 'js/models/fatality-params.js', 'js/models/prediction.js', 'js/models/backtest.js'].forEach((f) => require(path.join(ROOT, f)));
const AA = globalThis.AA, BT = AA.backtest;
const file = process.argv[2];
if (!file) { console.error('usage: node tools/backtest-compare.js <new-run.json>'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/baseline/backtest-3.1.0.json'), 'utf8'));
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
const s = BT.summarise(run.results.map((r) => ({ ...r, scored: r.mode === 'shaking' && !!r.fat, score: r.fat ? BT.scoreOne(r, r.fat) : null })));
const b = base.summary;
const checks = [
  ['reported tolls inside the range', s.inside, b.inside, s.inside >= b.inside - 2, `${s.inside}/${s.n} vs baseline ${b.inside}/${b.n}`],
  ['typical error factor', s.typicalFactor, b.typicalFactor, s.typicalFactor <= b.typicalFactor * 1.1, `×${s.typicalFactor.toFixed(1)} vs baseline ×${b.typicalFactor.toFixed(1)}`],
  ['within ×10', s.within10, b.within10, s.within10 >= b.within10 - 0.06, `${(s.within10 * 100).toFixed(0)} % vs baseline ${(b.within10 * 100).toFixed(0)} %`],
];
let bad = 0;
console.log(`Run ${run.model}${run.worldpop ? ' (WorldPop)' : ''} against baseline ${base.model} (${base.run_at.slice(0, 10)})`);
checks.forEach(([n, , , okk, msg]) => { console.log((okk ? 'PASS ' : 'FAIL ') + n + ': ' + msg); if (!okk) bad++; });
console.log(bad ? 'WORSE than the baseline: do not release this model version.' : 'Not worse than the baseline.');
process.exit(bad ? 1 : 0);
