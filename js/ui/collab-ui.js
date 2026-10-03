/* Plan view: tasks and comments (shared live plan). Skill: skills/collab/SKILL.md */
(function (root) {
  const AA = root.AA, COL = AA.collab, W = AA.workspace;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (s) => document.querySelector(s);
  const toast = (m, o) => AA.app && AA.app.toast(m, o);
  const UI = {};
  const ago = (iso) => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };
  const zname = (st, id) => { const z = st.zones.find((x) => x.id === id); return z ? `${z.id} ${z.name}` : ''; };

  UI.planSection = (st) => {
    const tasks = COL.tasks(st), comments = COL.comments(st), mode = COL.mode(st);
    const open = tasks.filter((t) => t.status !== 'done').length, late = tasks.filter((t) => COL.isOverdue(t)).length;
    const zoneOpts = `<option value="">Whole plan</option>${st.zones.map((z) => `<option value="${esc(z.id)}">${esc(z.id)} ${esc(z.name)}</option>`).join('')}`;
    const row = (t) => `<li class="trow ${t.status}${COL.isOverdue(t) ? ' late' : ''}"><span>${COL.canUpdate(t) ? `<select data-tstat="${esc(t.id)}" aria-label="Status of ${esc(t.title)}">${Object.entries(COL.STATUS).map(([k, v]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : `<span class="prov">${esc(COL.STATUS[t.status])}</span>`}</span>
      <span><b>${esc(t.title)}</b>${t.zoneId ? ` · <a href="#" data-tz="${esc(t.zoneId)}">${esc(zname(st, t.zoneId) || t.zoneId)}</a>` : ''}<br><span class="small muted">${t.assignee ? `→ ${esc(t.assignee)}` : 'unassigned'}${t.due ? ` · due ${esc(t.due)}${COL.isOverdue(t) ? ' <b class="warn">overdue</b>' : ''}` : ''} · added by ${esc(t.by)}</span></span>
      ${W.can('edit') ? `<button class="linkbtn danger" type="button" data-tdel="${esc(t.id)}" aria-label="Delete task">✕</button>` : '<span></span>'}</li>`;
    return `<div class="sec" id="collabSec"><h3>Tasks and comments <a href="guide.html#tasks" target="_blank" rel="noopener">?</a></h3>
      <p class="small" style="margin:0 0 6px">${mode === 'cloud' ? '<span class="live-dot" aria-hidden="true"></span><b>Live</b>: shared with your team; changes appear for everyone within seconds.' : W.mode() === 'cloud' ? 'Save the plan to share its tasks and comments live with your team.' : 'Kept inside this plan: saved plans and plan files carry them. Connect the shared back end to work on one plan together, live.'}${tasks.length ? ` · ${open} open${late ? `, <b class="warn">${late} overdue</b>` : ''}` : ''}</p>
      ${tasks.length ? `<ul class="tlist">${tasks.slice(0, 20).map(row).join('')}</ul>` : '<p class="small muted" style="margin:0 0 6px">No tasks yet.</p>'}
      ${COL.canCreate() ? `<details class="card small"><summary><b>Add a task</b></summary>
        <label class="field">What needs doing<input id="tTitle" type="text" maxlength="200" placeholder="e.g. Open the school in Sector 29 as a shelter"></label>
        <div class="grid2"><label class="field">Who<input id="tWho" type="text" maxlength="120" list="tPeople" placeholder="name or e-mail"><datalist id="tPeople">${W.team().map((p) => `<option value="${esc(p.email || p.name)}">${esc(p.name)}</option>`).join('')}</datalist></label>
        <label class="field">Due<input id="tDue" type="date"></label></div>
        <label class="field">Where<select id="tZone">${zoneOpts}</select></label>
        <div class="btns"><button class="btn primary" id="tAdd" type="button">Add task</button></div></details>` : ''}
      <div class="comments"><div class="eyebrow" style="margin-top:8px">Comments</div>
        <div class="grid2" style="align-items:end"><label class="field">Comment<input id="cText" type="text" maxlength="1000" placeholder="e.g. Bridge at Km 12 reopened at 14:00"></label><label class="field">About<select id="cZone">${zoneOpts}</select></label></div>
        <div class="btns"><button class="btn" id="cAdd" type="button">Post</button></div>
        <ul class="clist">${comments.slice(0, 15).map((c) => `<li><b>${esc(c.by)}</b>${c.role ? ` <span class="muted">(${esc(c.role)})</span>` : ''} · <span class="muted">${ago(c.at)}${c.zoneId ? ` · ${esc(zname(st, c.zoneId) || c.zoneId)}` : ''}</span><br>${esc(c.text)}</li>`).join('') || '<li class="muted">No comments yet.</li>'}</ul></div></div>`;
  };

  UI.bind = (st) => {
    const sec = $('#collabSec'); if (!sec) return;
    const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); AA.app.rerender(); } catch (e) { toast(esc(e.message), { err: true }); } };
    $('#tAdd')?.addEventListener('click', () => run(() => COL.addTask(st, { title: $('#tTitle').value, assignee: $('#tWho').value, due: $('#tDue').value, zoneId: $('#tZone').value }), 'Task added.'));
    sec.querySelectorAll('[data-tstat]').forEach((s) => s.addEventListener('change', () => run(() => COL.updateTask(st, s.dataset.tstat, { status: s.value }))));
    sec.querySelectorAll('[data-tdel]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.armed) run(() => COL.removeTask(st, b.dataset.tdel)); else { b.dataset.armed = '1'; b.textContent = 'delete?'; } }));
    sec.querySelectorAll('[data-tz]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const z = st.zones.find((x) => x.id === a.dataset.tz); if (z) AA.map.map().setView([z.lat, z.lon], Math.max(AA.map.map().getZoom(), 12)); }));
    $('#cAdd')?.addEventListener('click', () => run(() => COL.addComment(st, $('#cText').value, $('#cZone').value)));
    $('#cText')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cAdd').click(); });
    if (W.mode() === 'cloud' && W.cloud?.team) W.cloud.listMembers().then((m) => { const dl = $('#tPeople'); if (dl) dl.innerHTML = m.map((p) => `<option value="${esc(p.email)}">${esc(p.name || p.email)} · ${esc(p.role)}</option>`).join(''); }).catch(() => {});
  };

  COL.on((type, data) => {
    if (type === 'remote' && AA.engine.state === data) { const a = document.activeElement; if (a && a.closest && a.closest('#panel') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return; AA.app.rerender(); }
    if (type === 'newer') toast(`${esc(data.by || 'Someone')} saved a newer version of this plan. Reopen it from Saved plans to see their changes.`, { sticky: true });
  });

  AA.collabui = UI;
})(window);
