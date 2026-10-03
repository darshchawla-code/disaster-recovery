/* Validation page: back-test runner, chart, table and model cards. Skill: skills/backtest/SKILL.md */
(function (root) {
  const AA = root.AA, BT = AA.backtest, f = AA.fmt;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const BLUE = '#1f5fbf', ORANGE = '#c2410c', GREY = '#8a9099', INK = '#23262b', MUTED = '#5b6068', RULE = '#e2e5e9';
  const LS = AA.workspace._ls;
  const cache = { get: (k) => { try { return JSON.parse(LS.getItem('aa.bt.' + k) || 'null'); } catch (e) { return null; } }, set: (k, v) => { try { LS.setItem('aa.bt.' + k, JSON.stringify(v)); } catch (e) { /* storage full */ } } };
  let run = null;

  const pct = (x) => `${Math.round(x * 100)} %`;
  const stats = () => {
    const s = run?.summary;
    const tile = (v, l) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    $('#btStats').innerHTML = s && s.n ? [
      tile(`${s.inside}/${s.n}`, `reported tolls inside the forecast range (${pct(s.coverage)}; ideal about 80 %)`),
      tile(`×${s.typicalFactor.toFixed(1)}`, 'typical gap between the most likely forecast and the reported toll'),
      tile(pct(s.within3), 'most-likely forecast within a factor of 3'),
      tile(s.bias >= 1 ? `×${s.bias.toFixed(1)} high` : `×${(1 / s.bias).toFixed(1)} low`, `median bias (${s.above} tolls above the range, ${s.below} below)`),
    ].concat(s.byQuality ? Object.entries(s.byQuality).map(([k, g]) => tile(`${g.inside}/${g.n}`, `inside the range when people were counted by ${{ worldpop: 'WorldPop', osm: 'OpenStreetMap towns', modelled: 'a modelled average (least reliable)' }[k]}; typical gap ×${g.typicalFactor.toFixed(1)}`)) : []).join('') : [tile('–', 'events scored'), tile('–', 'typical gap'), tile('–', 'within ×3'), tile('–', 'bias')].join('');
  };

  // log axis 1 … 1,000,000 deaths
  const chart = () => {
    const svg = $('#btChart'), rows = run ? run.results : BT.CATALOG.map((e) => ({ ...e }));
    const W = 1000, L = 300, R = 24, T = 34, RH = 22, H = T + rows.length * RH + 10;
    const lo = 0, hi = 6, x = (v) => L + ((Math.log10(Math.max(1, v)) - lo) / (hi - lo)) * (W - L - R);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
    let g = '';
    for (let p = 0; p <= 6; p++) { const xx = x(10 ** p); g += `<line x1="${xx}" x2="${xx}" y1="${T - 6}" y2="${H - 6}" stroke="${RULE}" stroke-width="1"/><text x="${xx}" y="${T - 12}" text-anchor="middle" font-size="12" fill="${MUTED}" font-family="IBM Plex Mono, monospace">${['1', '10', '100', '1k', '10k', '100k', '1M'][p]}</text>`; }
    g += `<text x="${L - 10}" y="${T - 12}" text-anchor="end" font-size="12" fill="${MUTED}">deaths (log scale)</text>`;
    rows.forEach((r, k) => {
      const y = T + k * RH + RH / 2, scored = r.mode === 'shaking';
      g += `<g class="row" data-k="${k}"><rect class="hit" x="0" y="${y - RH / 2}" width="${W}" height="${RH}" fill="transparent"/>`;
      g += `<text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="12.5" fill="${INK}">${esc(r.name.length > 34 ? r.name.slice(0, 33) + '…' : r.name)} ${r.date.slice(0, 4)}</text>`;
      if (r.fat) {
        const a = x(r.fat.p10), b = x(r.fat.p90);
        g += `<rect x="${a}" y="${y - 3}" width="${Math.max(4, b - a)}" height="6" rx="3" fill="${BLUE}" opacity="${scored ? 1 : 0.45}"/><circle cx="${x(r.fat.p50)}" cy="${y}" r="5" fill="${BLUE}" stroke="#fff" stroke-width="2" opacity="${scored ? 1 : 0.6}"/>`;
      } else if (r.error) g += `<text x="${L + 4}" y="${y + 4}" font-size="12" fill="${MUTED}">not run: ${esc(r.error).slice(0, 60)}</text>`;
      const dx = x(r.deaths);
      g += scored ? `<rect x="${dx - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${dx} ${y})" fill="${ORANGE}" stroke="#fff" stroke-width="2"/>` : `<rect x="${dx - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${dx} ${y})" fill="#fff" stroke="${GREY}" stroke-width="2"/>`;
      g += '</g>';
    });
    svg.innerHTML = g;
    const tip = $('#btTip');
    svg.querySelectorAll('.row').forEach((el) => {
      el.addEventListener('mousemove', (e) => {
        const r = rows[+el.dataset.k];
        tip.innerHTML = `<b>${esc(r.name)}</b> · ${esc(r.date)} · M ${r.mag}<br>Reported: <b>${f.n(r.deaths)}</b> deaths${r.note ? `<br><i>${esc(r.note)}</i>` : ''}${r.fat ? `<br>Forecast: ${f.n(r.fat.p10)} – <b>${f.n(r.fat.p50)}</b> – ${f.n(r.fat.p90)}` : ''}${r.score ? `<br>${r.mode !== 'shaking' ? 'Not scored' : r.score.inside ? 'Inside the range' : r.score.above ? 'Above the range (under-forecast)' : 'Below the range (over-forecast)'} · gap ×${r.score.factor.toFixed(1)}` : r.mode !== 'shaking' ? `<br>Not scored (${r.mode === 'tsunami' ? 'tsunami or liquefaction deaths' : r.mode === 'deep' ? 'deep earthquake' : 'disputed toll'})` : ''}`;
        tip.hidden = false; tip.style.left = `${Math.min(innerWidth - 310, e.clientX + 14)}px`; tip.style.top = `${e.clientY + 14}px`;
      });
      el.addEventListener('mouseleave', () => (tip.hidden = true));
    });
  };

  const table = () => {
    const rows = run ? run.results : BT.CATALOG;
    $('#btTable tbody').innerHTML = rows.map((r) => {
      const res = !r.fat ? (r.error ? `<span class="tag">not run</span>` : '<span class="tag">–</span>') : r.mode !== 'shaking' ? `<span class="tag">not scored: ${r.mode === 'tsunami' ? 'tsunami' : r.mode === 'deep' ? 'deep' : 'disputed'}</span>` : r.score.inside ? '<span class="tag in">inside</span>' : `<span class="tag out">${r.score.above ? 'under' : 'over'} ×${r.score.factor.toFixed(1)}</span>`;
      return `<tr><td class="mono">${r.date}</td><td>${esc(r.name)}${r.note ? `<br><span class="small muted">${esc(r.note)}</span>` : ''}</td><td class="num">${r.mag}</td><td class="num">${f.n(r.deaths)}</td><td class="num">${r.fat ? f.n(r.fat.p10) : ''}</td><td class="num">${r.fat ? f.n(r.fat.p50) : ''}</td><td class="num">${r.fat ? f.n(r.fat.p90) : ''}</td><td>${res}</td></tr>`;
    }).join('');
    $('#btSrc').innerHTML = `Reported deaths: <a href="${BT.SOURCE.url}" target="_blank" rel="noopener">${esc(BT.SOURCE.name)}</a> (${esc(BT.SOURCE.query)}, snapshot ${BT.SOURCE.snapshot}). Forecast: AidAtlas model ${esc(run?.model || AA.MODEL_VERSION)}, model alone (no USGS PAGER, no reported counts), ${run?.worldpop ? 'WorldPop 2020' : 'OpenStreetMap'} populations of today${run ? `, run ${esc(new Date(run.at).toLocaleString())}` : ''}.`;
  };

  const cards = () => {
    const s = run?.summary;
    $('#mCards').innerHTML = AA.cards.CARDS.map((c) => `<article class="vcard mcard"><h3>${esc(c.title)}</h3><span class="st ${c.status}">${esc(AA.cards.STATUS[c.status])}</span><p class="small" style="margin:0">${esc(c.purpose)}</p><dl>
      <dt>How it works</dt><dd><ul>${c.method.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></dd>
      <dt>Data</dt><dd>${esc(c.inputs)}</dd>
      <dt>Evidence</dt><dd>${esc(c.evidence)}${c.id === 'EQ' && s && s.n ? ` <b>Latest run on this device: ${s.inside} of ${s.n} reported tolls inside the range; typical gap ×${s.typicalFactor.toFixed(1)}.</b>` : ''}</dd>
      <dt>Do not rely on it for</dt><dd><ul>${c.limits.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></dd></dl></article>`).join('');
  };

  const render = () => { stats(); chart(); table(); cards(); $('#btCsv').disabled = $('#btJson').disabled = !run; };
  const download = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };

  const boot = () => {
    $('#mVer').textContent = AA.MODEL_VERSION;
    try { const last = JSON.parse(LS.getItem('aa.btLast') || 'null'); if (last && last.model === AA.MODEL_VERSION) { run = last; $('#btStatus').textContent = `Results from ${new Date(run.at).toLocaleString()} on this device. Run again to refresh.`; } } catch (e) { /* none */ }
    render();
    $('#btRun').addEventListener('click', async () => {
      const b = $('#btRun'); b.disabled = true;
      try {
        run = await BT.run({ worldpop: $('#btWp').checked, cache, step: (m, k, n) => ($('#btStatus').innerHTML = `<span class="spin"></span> ${esc(m)} (${k + 1 > n ? n : k + 1} of ${n})`) });
        try { LS.setItem('aa.btLast', JSON.stringify(run)); } catch (e) { /* storage full */ }
        const errs = run.results.filter((r) => r.error).length;
        $('#btStatus').textContent = `Done: ${run.summary.n} earthquakes scored${errs ? `, ${errs} could not be run (data service unavailable; run again later)` : ''}.`;
        render();
      } catch (e) { $('#btStatus').textContent = `Back-test failed: ${e.message}`; }
      finally { b.disabled = false; }
    });
    $('#btCsv').addEventListener('click', () => run && download(`aidatlas-backtest-${run.model}.csv`, BT.csv(run), 'text/csv'));
    $('#btJson').addEventListener('click', () => run && download(`aidatlas-backtest-${run.model}.json`, JSON.stringify(run, null, 1), 'application/json'));
    $('#btLoad').addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const j = JSON.parse(await file.text()); if (!Array.isArray(j.results)) throw new Error('not a back-test results file'); j.summary = BT.summarise(j.results); run = j; render(); $('#btStatus').textContent = `Loaded results from ${file.name} (model ${j.model}).`; } catch (er) { $('#btStatus').textContent = `Could not open it: ${er.message}`; } });
  };
  AA.validation = { render, get run() { return run; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
