/* Plan view: field reports from field teams (field.html) — list, map markers, apply to the plan.
   Skill: skills/field-app/SKILL.md */
(function (root) {
  const AA = root.AA, FR = AA.field, ENG = AA.engine, W = AA.workspace;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (s) => document.querySelector(s);
  const UI = {};
  const toast = (m, o) => AA.app && AA.app.toast(m, o);
  const ago = (iso) => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };

  /** Reports known for this plan: pasted codes + shared back end. Kept on the plan state while it is open. */
  const store = (st) => (st.field = st.field || { reports: [], applied: new Set(), lastFetch: null, err: '' });
  /** A report counts as applied when the plan's event list holds an event with its id (so saved plans remember). */
  const appliedIds = (st) => { const s = store(st).applied; (st.events || []).forEach((e) => e.p?.fieldId && s.add(e.p.fieldId)); return s; };
  UI.add = (st, reports) => {
    const f = store(st), known = new Set(f.reports.map((r) => r.id));
    const fresh = reports.filter((r) => !known.has(r.id));
    f.reports = [...fresh, ...f.reports].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 500);
    return fresh.length;
  };
  UI.reports = (st) => FR.inPlanArea(store(st).reports, st);

  UI.linkFor = (st) => {
    const base = location.href.replace(/[^/]*$/, '');
    const c = st.sit.focus || st.sit;
    return `${base}field.html?plan=${encodeURIComponent(st.savedName || st.sit.name || 'Plan')}&lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}`;
  };

  UI.planSection = (st) => {
    const list = UI.reports(st), applied = appliedIds(st), f = store(st);
    const fresh = list.filter((r) => !applied.has(r.id));
    const canEdit = W.can('edit');
    const row = (r) => {
      const m = FR.match(r, st.zones), dmg = FR.damageLabel(r.damage);
      const needs = r.needs.map((k) => FR.NEEDS.find(([x]) => x === k)?.[1]).filter(Boolean).join(', ');
      return `<li class="frow${applied.has(r.id) ? ' done' : ''}">${r.photoUrl ? `<a href="${esc(r.photoUrl)}" target="_blank" rel="noopener"><img class="fthumb" src="${esc(r.photoUrl)}" alt="Field photo"></a>` : '<span class="fthumb none" aria-hidden="true">◎</span>'}
        <span><b class="dmg d${Math.round(r.damage * 4)}">${esc(dmg)}</b> · ${esc(FR.ROAD[r.road])}${r.people.trapped ? ` · <b>${r.people.trapped} trapped</b>` : ''}${needs ? `<br>Needs: ${esc(needs)}` : ''}
        <br><span class="muted">${ago(r.at)} · ${esc(r.by || 'unnamed')}${r.trained ? ' (trained)' : ''} · ${m ? (m.outside ? `${Math.round(m.distKm)} km from the nearest area` : `${esc(m.zone.id)} ${esc(m.zone.name)}`) : 'no area'}${r.note ? ` · “${esc(r.note.slice(0, 120))}”` : ''}</span></span>
        <span class="fact">${applied.has(r.id) ? '<span class="prov">applied</span>' : canEdit ? `<button class="btn" type="button" data-fapply="${esc(r.id)}">Apply</button>` : ''}<button class="linkbtn" type="button" data-fgo="${esc(r.id)}">map</button></span></li>`;
    };
    return `<div class="sec" id="fieldSec"><h3>Field reports <a href="guide.html#field-app" target="_blank" rel="noopener">?</a></h3>
      <p class="small" style="margin:0 0 6px">${list.length ? `<b>${list.length}</b> report${list.length === 1 ? '' : 's'} in this area${fresh.length ? ` · <b>${fresh.length} not applied yet</b>` : ' · all applied'}` : 'No field reports for this area yet.'}${FR.cloudAvailable() ? ` · shared workspace${f.lastFetch ? `, checked ${ago(f.lastFetch)}` : ''}` : ''}${f.err ? ` · <span class="warn">${esc(f.err)}</span>` : ''}</p>
      ${list.length ? `<ul class="flist">${list.slice(0, 12).map(row).join('')}</ul>` : ''}
      <div class="btns">${canEdit && fresh.length ? '<button class="btn primary" id="fApplyAll" type="button">Apply all new reports</button>' : ''}${FR.cloudAvailable() ? '<button class="btn" id="fRefresh" type="button">Check for new reports</button>' : ''}<button class="btn" id="fLink" type="button">Copy field-app link</button></div>
      <details class="card small"><summary><b>Paste report codes</b> (from WhatsApp or SMS)</summary><textarea id="fPaste" rows="3" placeholder="Paste the whole message; every AA1… code in it is read"></textarea><div class="btns"><button class="btn" id="fAdd" type="button">Add reports</button></div></details>
      <details class="card small"><summary><b>Import from KoboToolbox or ODK</b></summary><p style="margin:4px 0">Teams already on KoboToolbox can use the AidAtlas form (<a href="examples/aidatlas-field-xlsform.xlsx" download>XLSForm</a>). Export the data as CSV with XML values and headers, then open it here.</p><label class="field">CSV file<input id="fKobo" type="file" accept=".csv,text/csv"></label></details>
      <p class="small muted" style="margin:0">Applying a report updates its area's severity by Bayesian update (trained assessor σ ${FR.SD.trained}, others σ ${FR.SD.crowd}) and closes the road at its location when the team marked it blocked. Each change is written to the decision log.</p></div>`;
  };

  const applyOne = async (st, r) => {
    const { events, match } = FR.toEvents(r, st);
    if (!events.length) { toast(`This report is ${match ? `${Math.round(match.distKm)} km from the nearest area` : 'outside the plan'}; nothing to apply.`, { err: true }); store(st).applied.add(r.id); return false; }
    for (const e of events) await ENG.event(e.type, e.p, { note: `Field report by ${r.by || 'field team'}${r.note ? `: ${r.note.slice(0, 80)}` : ''}` });
    store(st).applied.add(r.id);
    return true;
  };
  UI.apply = async (st, ids) => {
    const list = UI.reports(st).filter((r) => ids.includes(r.id)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let n = 0;
    for (const r of list) { if (ENG.state !== st) return; if (await applyOne(st, r)) n++; }
    if (n) toast(`${n} field report${n === 1 ? '' : 's'} applied to the plan.`);
    AA.app.rerender(); UI.draw(st);
  };

  UI.bind = (st) => {
    const sec = $('#fieldSec'); if (!sec) return;
    sec.querySelectorAll('[data-fapply]').forEach((b) => b.addEventListener('click', () => UI.apply(st, [b.dataset.fapply])));
    sec.querySelectorAll('[data-fgo]').forEach((b) => b.addEventListener('click', () => { const r = store(st).reports.find((x) => x.id === b.dataset.fgo); if (r) AA.map.map().setView([r.lat, r.lon], Math.max(AA.map.map().getZoom(), 13)); }));
    $('#fApplyAll')?.addEventListener('click', () => { const a = appliedIds(st); UI.apply(st, UI.reports(st).filter((r) => !a.has(r.id)).map((r) => r.id)); });
    $('#fRefresh')?.addEventListener('click', () => UI.fetch(st, true));
    $('#fLink')?.addEventListener('click', async () => { const l = UI.linkFor(st); try { await navigator.clipboard.writeText(l); toast('Field-app link copied. Send it to your field teams.'); } catch (e) { toast(`Field-app link: ${esc(l)}`, { sticky: true }); } });
    $('#fKobo')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const { reports, errors } = AA.exports.importKobo(await file.text());
      const n = UI.add(st, reports);
      toast(reports.length ? `${n} new report${n === 1 ? '' : 's'} imported from ${esc(file.name)}${errors.length ? ` (${errors.length} row${errors.length === 1 ? '' : 's'} skipped: ${esc(errors[0])})` : ''}.` : `No usable rows: ${esc(errors[0] || 'check that the export uses XML values')}`, { err: !reports.length });
      AA.app.rerender(); UI.draw(st);
    });
    $('#fAdd')?.addEventListener('click', () => {
      const { reports, errors } = FR.decodeAll($('#fPaste').value);
      const n = UI.add(st, reports);
      const out = reports.length - FR.inPlanArea(reports, st).length;
      toast(reports.length ? `${n} new report${n === 1 ? '' : 's'} added${out ? ` (${out} outside this plan's area)` : ''}.${errors.length ? ' ' + esc(errors[0]) : ''}` : esc(errors[0] || 'No report code (AA1…) found in the text.'), { err: !reports.length });
      AA.app.rerender(); UI.draw(st);
    });
  };

  /** Pull new reports from the shared back end (every minute while a plan is open). */
  UI.fetch = async (st, loud = false) => {
    if (!FR.cloudAvailable()) return;
    const f = store(st);
    try {
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const n = UI.add(st, await FR.cloudList(since));
      f.lastFetch = new Date().toISOString(); f.err = '';
      if (n || loud) { if (n) toast(`${n} new field report${n === 1 ? '' : 's'} from the shared workspace.`); if (ENG.state === st) { AA.app.rerender(); UI.draw(st); } }
    } catch (e) { f.err = e.message; if (loud) toast(`Field reports: ${esc(e.message)}`, { err: true }); }
  };
  let timer = null;
  UI.start = (st) => { clearInterval(timer); UI.fetch(st); timer = setInterval(() => { if (ENG.state === st) UI.fetch(st); else clearInterval(timer); }, 60e3); };
  UI.stop = () => clearInterval(timer);

  UI.draw = (st) => { if (AA.map.drawField) AA.map.drawField(UI.reports(st), appliedIds(st)); };

  AA.fieldui = UI;
})(window);
