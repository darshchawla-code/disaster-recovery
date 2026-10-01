/* Workspace UI: profile & roles, team, shared back end, saved plans, decision log, watch areas, inventory sync.
   Skill: skills/workspace/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math, W = AA.workspace, ENG = AA.engine;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (s, el = document) => el.querySelector(s);
  const UI = {};
  const toast = (m, o) => AA.app && AA.app.toast(m, o);
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso || ''; } };

  UI.download = (name, text, type = 'application/json') => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  const slug = (s) => String(s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'plan';

  /** Note typed by the user for the next action; ENG.event receives it as meta.note. */
  UI.takeNote = () => { const i = $('#decNote'); const v = i ? i.value.trim() : ''; if (i) i.value = ''; return v; };
  UI.act = (type, p = {}) => ENG.event(type, p, { note: UI.takeNote() });

  UI.roleBadge = () => { const me = W.me(); return `<span class="prov" title="${esc(W.mode() === 'cloud' ? 'Signed in to the shared workspace' : 'Local profile on this browser')}">${esc(me.name)} · ${esc(W.ROLES[me.role]?.label || me.role)}${W.mode() === 'cloud' ? ' · shared' : ''}</span>`; };
  UI.refreshBadge = () => { const b = $('#wsBadge'); if (!b) return; const me = W.me(); b.hidden = false; b.textContent = W.ROLES[me.role]?.label || me.role; b.className = 'wsbadge ' + me.role; };

  // ================= plan view: save, share, decision log, inventory =================
  UI.planSection = (st) => {
    const can = W.can('save'), src = W.inventory.source();
    const decs = (st.decisions || []).slice().reverse();
    return `<div class="sec" id="wsPlan"><h3>Save, share and decision log <a href="guide.html#saved-plans" target="_blank" rel="noopener">?</a></h3>
      <p class="small" style="margin:0">${UI.roleBadge()}${st.savedName ? ` · saved as <b>${esc(st.savedName)}</b>` : ' · not saved yet'}</p>
      ${can ? `<label class="field">Plan name<input id="planName" type="text" maxlength="80" value="${esc(st.savedName || st.sit.name || 'Plan')}"></label>
      <div class="btns"><button class="btn primary" id="planSave" type="button">${st.savedId ? 'Save changes' : 'Save plan'}</button>${st.savedId ? '<button class="btn" id="planSaveNew" type="button">Save as new</button>' : ''}<button class="btn" id="planFile" type="button">Download plan file</button></div>
      <label class="field">Note for the log <span class="muted">(optional: why you are making the next change)</span><input id="decNote" type="text" maxlength="200" placeholder="e.g. District officer confirmed bridge at Km 12 is down"></label>`
      : `<p class="note">View only: your role can read this plan and its reports, but not change or save it.</p><div class="btns"><button class="btn" id="planFile" type="button">Download plan file</button></div>`}
      ${W.can('inventory') ? `<div class="card small" style="display:grid;gap:6px"><b>Live inventory</b>${src ? `<span>Source: ${esc(src.label || src.url)}${src.everyMin ? ` · auto-sync every ${src.everyMin} min` : ''}${st.invSyncedAt ? ` · last synced ${fmtDate(st.invSyncedAt)}` : ''}</span><div class="btns"><button class="btn" id="invSync" type="button">Sync stock and fleet now</button></div>` : `<span>Connect a Google Sheet or CSV so stock and vehicles are real, not assumed.</span><div class="btns"><button class="btn" id="invConnect" type="button">Connect inventory</button></div>`}</div>` : ''}
      <div class="log" style="margin-top:6px">${decs.slice(0, 8).map((d) => `<div class="e"><b>${fmtDate(d.at)}</b> · T+${(d.epoch || 0) * AA.config.epochHours} h · ${esc(d.by)} (${esc(d.role)})<div class="d">${esc(d.reason)}${d.note ? ` — <i>${esc(d.note)}</i>` : ''}</div></div>`).join('') || '<p class="small muted">No decisions yet.</p>'}</div>
      ${decs.length ? `<div class="btns"><button class="btn" id="decCsv" type="button">Download decision log (CSV)</button></div>` : ''}</div>`;
  };
  UI.bindPlan = (st) => {
    const save = async (asNew) => {
      const name = ($('#planName')?.value || '').trim() || st.sit.name || 'Plan';
      try {
        const id = await W.plans.save(ENG.snapshot(name), asNew ? null : st.savedId);
        st.savedId = id; st.savedName = name;
        ENG.decide('save', {}, `Plan saved as “${name}”${W.mode() === 'cloud' ? ' (shared with the team)' : ' (this browser)'}`, UI.takeNote());
        toast(`Saved “${esc(name)}”.`); AA.app.rerender();
      } catch (e) { toast(esc(e.message), { err: true }); }
    };
    $('#planSave')?.addEventListener('click', () => save(false));
    $('#planSaveNew')?.addEventListener('click', () => save(true));
    $('#planFile')?.addEventListener('click', () => { const snap = ENG.snapshot(($('#planName')?.value || st.savedName || st.sit.name)); UI.download(`aidatlas-${slug(snap.name)}.json`, JSON.stringify(snap)); });
    $('#decCsv')?.addEventListener('click', () => UI.download(`aidatlas-decisions-${slug(st.savedName || st.sit.name)}.csv`, W.decisionsCSV(st.decisions), 'text/csv'));
    $('#invSync')?.addEventListener('click', () => UI.syncInventory(true));
    $('#invConnect')?.addEventListener('click', () => UI.openWorkspace('inventory'));
  };

  // inventory sync: fetch rows, apply when they changed (or when forced)
  let invTimer = null, lastInvHash = '';
  UI.syncInventory = async (force = false) => {
    const st = ENG.state, src = W.inventory.source(); if (!st || !src) return;
    try {
      const rows = await W.inventory.fetchRows(src.url);
      if (!rows.length) throw new Error('No rows with lat and lon found in the inventory source.');
      const h = JSON.stringify(rows);
      st.invSyncedAt = new Date().toISOString();
      if (!force && h === lastInvHash) return;
      lastInvHash = h;
      await ENG.event('importDepots', { rows, source: src.label || src.url }, { note: force ? 'Manual inventory sync' : 'Automatic inventory sync' });
      toast(`Inventory synced: ${rows.length} stores.`);
    } catch (e) { toast(`Inventory sync failed: ${esc(e.message)}`, { err: true }); }
  };
  UI.startInventoryAuto = () => {
    clearInterval(invTimer); lastInvHash = '';
    const src = W.inventory.source();
    if (!src || !W.can('inventory')) return;
    if (src.applyOnOpen !== false) UI.syncInventory(false);
    if (src.everyMin > 0) invTimer = setInterval(() => { if (ENG.state) UI.syncInventory(false); }, src.everyMin * 60e3);
  };
  UI.stopInventoryAuto = () => clearInterval(invTimer);

  // ================= plan start: saved plans =================
  UI.savedPlansSection = () => `<div class="sec card" id="savedPlans"><h3>Saved plans</h3><div id="savedList" class="small"><span class="spin"></span> Loading…</div>
      <label class="field">Open a plan file<input id="planIn" type="file" accept=".json,application/json"></label></div>`;
  UI.fillSavedPlans = async () => {
    const box = $('#savedList'); if (!box) return;
    try {
      const list = await W.plans.list();
      box.innerHTML = list.length ? `<ul class="plist">${list.map((p) => `<li><button class="linkbtn" type="button" data-open="${esc(p.id)}"><b>${esc(p.name)}</b></button><br><span class="muted">${fmtDate(p.savedAt)} · ${esc(p.savedBy || '')}${p.summary ? ` · ${AA.HAZARDS[p.summary.hazard]?.label || ''} · ${AA.fmt.k(p.summary.affected)} affected · T+${(p.summary.epoch || 0) * AA.config.epochHours} h` : ''}</span>${W.can('save') ? ` <button class="linkbtn danger" type="button" data-del="${esc(p.id)}">delete</button>` : ''}</li>`).join('')}</ul>`
        : `<span class="muted">No saved plans ${W.mode() === 'cloud' ? 'in your team yet' : 'in this browser yet'}. Build a plan, then press “Save plan”.</span>`;
      box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => { try { const snap = await W.plans.load(b.dataset.open); snap.id = b.dataset.open; AA.app.openSnapshot(snap); } catch (e) { toast(esc(e.message), { err: true }); } }));
      box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (b.dataset.armed) { try { await W.plans.remove(b.dataset.del); UI.fillSavedPlans(); } catch (e) { toast(esc(e.message), { err: true }); } } else { b.dataset.armed = '1'; b.textContent = 'click again to delete'; } }));
    } catch (e) { box.innerHTML = `<span class="muted">${esc(e.message)}</span>`; }
    $('#planIn')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const snap = JSON.parse(await file.text()); AA.app.openSnapshot(snap); } catch (er) { toast(`Not a valid plan file: ${esc(er.message)}`, { err: true }); }
    });
  };

  // ================= live view: watch areas =================
  UI.watchSection = () => `<div class="sec" id="watchSec"><h3>Watch areas <a href="guide.html#watch-areas" target="_blank" rel="noopener">?</a></h3><div id="watchList" class="small"><span class="spin"></span></div>
      ${W.can('watch') ? `<details class="card small"><summary><b>Add a watch area</b> (centred on the map view)</summary>
        <label class="field">Name<input id="waName" type="text" maxlength="80" placeholder="e.g. My district"></label>
        <div class="grid2"><label class="field">Radius (km)<input id="waR" type="number" min="5" max="1000" value="150"></label>
        <label class="field">Alert me at<select id="waLvl"><option value="Orange">Orange or Red</option><option value="Red">Red only</option><option value="Green">Any level</option></select></label></div>
        <div class="checks">${Object.entries(AA.HAZARDS).map(([k, v]) => `<label><input type="checkbox" data-wh="${k}" checked> ${v.label}</label>`).join(' ')}</div>
        <div class="btns"><button class="btn primary" id="waAdd" type="button">Add watch area</button></div></details>` : ''}
      <div class="btns"><button class="btn" id="waNotify" type="button">Turn on browser alerts</button><button class="btn" id="waExport" type="button">Export for scheduled alerts</button></div>
      <p class="small muted" style="margin:0">Browser alerts work while AidAtlas is open. For e-mail or chat alerts when it is closed, export the list and use the scheduled checker (guide → Watch areas).</p></div>`;
  UI.fillWatch = async (events) => {
    const box = $('#watchList'); if (!box) return;
    let areas = [];
    try { areas = await W.watch.list(); } catch (e) { box.innerHTML = `<span class="muted">${esc(e.message)}</span>`; return; }
    const matches = W.matchWatch(areas, events || AA.app.live || []);
    UI.lastWatch = { areas, matches };
    box.innerHTML = areas.length ? `<ul class="plist">${areas.map((a) => { const hits = matches.filter((m) => m.area.id === a.id); return `<li><b>${esc(a.name)}</b> <span class="muted">${Math.round(a.radiusKm)} km · ${esc(a.minLevel)}+ · ${a.hazards.length === 6 ? 'all hazards' : a.hazards.join(', ')}</span>${hits.length ? `<br>${hits.slice(0, 3).map((m) => `<button class="linkbtn alerthit ${m.level}" type="button" data-ev="${esc(m.event.id)}">${esc(m.level)}: ${esc(m.event.name)} · ${Math.round(m.distKm)} km</button>`).join('<br>')}` : '<br><span class="muted">Nothing active at this level.</span>'}${W.can('watch') ? ` <button class="linkbtn danger" type="button" data-wdel="${esc(a.id)}">remove</button>` : ''}</li>`; }).join('')}</ul>`
      : '<span class="muted">No watch areas yet. Move the map to a place you are responsible for, then add one.</span>';
    box.querySelectorAll('[data-ev]').forEach((b) => b.addEventListener('click', () => { const e = (AA.app.live || []).find((x) => x.id === b.dataset.ev); if (e) AA.app.openEvent(e); }));
    box.querySelectorAll('[data-wdel]').forEach((b) => b.addEventListener('click', async () => { await W.watch.remove(b.dataset.wdel); UI.fillWatch(events); }));
    UI.notify(matches);
  };
  /** Toast + browser notification once per (area, event, level). */
  UI.notify = (matches) => {
    const fresh = W.newMatches(matches);
    if (!fresh.length) return;
    const m = fresh[0];
    toast(`<b>Watch alert:</b> ${esc(m.level)} ${esc(AA.HAZARDS[m.event.hazard]?.label || '')} near ${esc(m.area.name)} — ${esc(m.event.name)}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`, { sticky: true });
    try { if (root.Notification && Notification.permission === 'granted') fresh.slice(0, 3).forEach((x) => new Notification(`AidAtlas: ${x.level} alert near ${x.area.name}`, { body: `${x.event.name} · ${Math.round(x.distKm)} km away` })); } catch (e) { /* not supported */ }
  };
  UI.bindWatch = () => {
    $('#waAdd')?.addEventListener('click', async () => {
      const c = AA.map.map().getCenter();
      const hazards = [...document.querySelectorAll('[data-wh]')].filter((i) => i.checked).map((i) => i.dataset.wh);
      try { await W.watch.add({ name: $('#waName').value.trim() || `Area at ${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`, lat: c.lat, lon: c.lng, radiusKm: +$('#waR').value, minLevel: $('#waLvl').value, hazards }); UI.fillWatch(); toast('Watch area added.'); }
      catch (e) { toast(esc(e.message), { err: true }); }
    });
    $('#waNotify')?.addEventListener('click', async () => {
      if (!root.Notification) { toast('This browser does not support notifications.', { err: true }); return; }
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'Browser alerts are on while AidAtlas is open.' : 'Browser alerts were not allowed.', { err: p !== 'granted' });
    });
    $('#waExport')?.addEventListener('click', async () => { const a = await W.watch.list(); UI.download('watch-areas.json', JSON.stringify(a.map(({ name, lat, lon, radiusKm, hazards, minLevel }) => ({ name, lat: +lat.toFixed(4), lon: +lon.toFixed(4), radiusKm, hazards, minLevel })), null, 2)); });
  };

  // ================= workspace modal =================
  UI.openWorkspace = async (focus) => {
    const m = $('#workspace'), me = W.me(), cloud = W.cloud, cfg = cloud?.config();
    m.hidden = false;
    const local = W.mode() === 'local';
    m.innerHTML = `<div class="box wide" role="dialog" aria-label="Workspace"><h2>Workspace</h2>
      <section><div class="eyebrow">You</div>
        ${local ? `<div class="grid2"><label class="field">Name<input id="wsName" type="text" maxlength="80" value="${esc(me.name)}"></label><label class="field">Organisation<input id="wsOrg" type="text" maxlength="80" value="${esc(me.org || '')}"></label></div>
        <label class="field">Role on this browser<select id="wsRole">${Object.entries(W.ROLES).map(([k, v]) => `<option value="${k}" ${me.role === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <p class="small muted">Local roles help a shared control-room computer show the right buttons. They are not security: anyone at this computer can change them. For real access control, connect the shared back end below.</p>`
        : `<p class="small">Signed in as <b>${esc(me.email)}</b> · team <b>${esc(me.org || 'none')}</b> · role <b>${esc(W.ROLES[me.role]?.label || me.role)}</b>${cloud.teams.length > 1 ? ` · <select id="wsTeam">${cloud.teams.map((t) => `<option value="${t.id}" ${t.id === cloud.team?.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}</p><div class="btns"><button class="btn" id="wsOut" type="button">Sign out</button></div>`}
      </section>
      <section id="wsTeamSec"><div class="eyebrow">Team</div><div id="wsTeamBody" class="small"></div></section>
      <section id="wsInv"><div class="eyebrow">Inventory source</div>
        <p class="small muted" style="margin:0">A Google Sheet (shared “anyone with the link can view”, or File → Share → Publish to web → CSV), any CSV link, or a JSON link. Columns: name, lat, lon, type, water_l, food_kg, tents, medkits, staff, trucks, buses, ambulances, beds. Common spellings (latitude, lng, water, ambulance…) are recognised. <a href="guide.html#inventory" target="_blank" rel="noopener">Guide</a></p>
        <label class="field">Link<input id="wsInvUrl" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(W.inventory.source()?.url || '')}" ${W.can('inventory') ? '' : 'disabled'}></label>
        <div class="grid2"><label class="field">Auto-sync while a plan is open<select id="wsInvEvery" ${W.can('inventory') ? '' : 'disabled'}>${[0, 5, 15, 30, 60].map((n) => `<option value="${n}" ${(W.inventory.source()?.everyMin ?? 15) === n ? 'selected' : ''}>${n ? `every ${n} min` : 'off (manual only)'}</option>`).join('')}</select></label>
        <label class="field">Use it when a plan opens<select id="wsInvOpen" ${W.can('inventory') ? '' : 'disabled'}><option value="1">Yes, replace assumed stock</option><option value="0" ${W.inventory.source()?.applyOnOpen === false ? 'selected' : ''}>No, only when I press Sync</option></select></label></div>
        <div class="btns">${W.can('inventory') ? '<button class="btn" id="wsInvTest" type="button">Test link</button><button class="btn" id="wsInvSave" type="button">Save source</button>' : ''}${W.inventory.source() && W.can('inventory') ? '<button class="btn" id="wsInvClear" type="button">Disconnect</button>' : ''}</div><div id="wsInvMsg" class="small"></div></section>
      <section><div class="eyebrow">Shared back end (optional)</div>
        <p class="small muted" style="margin:0">Connect a free Supabase project to share saved plans and watch areas across a team, with sign-in by e-mailed code and roles enforced by the database. Set-up: run <span class="mono">supabase/schema.sql</span> once in the Supabase SQL editor, then paste the project URL and the public “anon” key here. <a href="guide.html#shared-workspace" target="_blank" rel="noopener">Guide</a></p>
        ${W.can('settings') || !cfg ? `<div class="grid2"><label class="field">Project URL<input id="wsSbUrl" type="url" placeholder="https://xxxx.supabase.co" value="${esc(cfg?.url || '')}"></label><label class="field">Public anon key<input id="wsSbKey" type="text" value="${esc(cfg?.key || '')}"></label></div>
        <div class="btns"><button class="btn" id="wsSbSave" type="button">${cfg ? 'Update connection' : 'Connect'}</button>${cfg ? '<button class="btn" id="wsSbOff" type="button">Disconnect</button>' : ''}</div>` : '<p class="small">Connected. Only an admin can change the connection.</p>'}
        ${cfg && local ? `<div class="grid2"><label class="field">Your e-mail<input id="wsEmail" type="email" placeholder="name@agency.gov"></label><label class="field">6-digit code<input id="wsCode" type="text" inputmode="numeric" maxlength="10" placeholder="from the e-mail"></label></div><div class="btns"><button class="btn" id="wsSend" type="button">Send code</button><button class="btn primary" id="wsVerify" type="button">Sign in</button></div>` : ''}
        <div id="wsSbMsg" class="small"></div></section>
      <div class="btns"><button class="btn primary" id="wsDone" type="button">Done</button></div></div>`;
    const close = () => { m.hidden = true; AA.app.rerender(); UI.refreshBadge(); };
    $('#wsDone').addEventListener('click', () => { if (local && $('#wsName')) { W.setMe({ name: $('#wsName').value.trim() || 'Local user', org: $('#wsOrg').value.trim(), role: $('#wsRole').value }); } close(); });
    m.onclick = (e) => { if (e.target === m) close(); };
    $('#wsOut')?.addEventListener('click', async () => { await cloud.signOut(); UI.openWorkspace(); });
    $('#wsTeam')?.addEventListener('change', (e) => { cloud.useTeam(e.target.value); UI.openWorkspace(); });
    UI.renderTeam();
    // inventory
    const invSrc = () => ({ url: $('#wsInvUrl').value.trim(), everyMin: +$('#wsInvEvery').value, applyOnOpen: $('#wsInvOpen').value === '1', label: (() => { try { const u = new URL($('#wsInvUrl').value.trim()); return /docs\.google\.com/.test(u.host) ? 'Google Sheet' : u.host; } catch (e) { return 'link'; } })() });
    $('#wsInvTest')?.addEventListener('click', async () => { const msg = $('#wsInvMsg'); msg.innerHTML = '<span class="spin"></span> Reading…'; try { const rows = await W.inventory.fetchRows(invSrc().url); msg.innerHTML = rows.length ? `Found <b>${rows.length}</b> stores with locations, e.g. ${esc(rows[0].name || 'unnamed')} (${rows[0].lat}, ${rows[0].lon}): ${rows[0].water_l ?? 0} L water, ${rows[0].trucks ?? 0} trucks.` : 'Read the link, but found no rows with lat and lon.'; } catch (e) { msg.textContent = `Could not read it: ${e.message}. For Google Sheets, share as “anyone with the link can view”.`; } });
    $('#wsInvSave')?.addEventListener('click', () => { const s = invSrc(); if (!/^https:\/\//.test(s.url)) { $('#wsInvMsg').textContent = 'Enter an https:// link.'; return; } W.inventory.setSource(s); $('#wsInvMsg').textContent = 'Saved. It will be used for the next plan you open.'; });
    $('#wsInvClear')?.addEventListener('click', () => { W.inventory.setSource(null); UI.stopInventoryAuto(); UI.openWorkspace('inventory'); });
    // cloud
    const sbMsg = (t) => { $('#wsSbMsg').textContent = t; };
    $('#wsSbSave')?.addEventListener('click', async () => { sbMsg('Connecting…'); try { const signed = await cloud.configure({ url: $('#wsSbUrl').value, key: $('#wsSbKey').value }); sbMsg(signed ? 'Connected and signed in.' : 'Connected. Now sign in with your e-mail.'); UI.openWorkspace(); } catch (e) { sbMsg(e.message); } });
    $('#wsSbOff')?.addEventListener('click', async () => { await cloud.signOut(); await cloud.configure(null); UI.openWorkspace(); });
    $('#wsSend')?.addEventListener('click', async () => { try { await cloud.sendCode($('#wsEmail').value.trim()); sbMsg('Code sent. Check your e-mail and type the code.'); } catch (e) { sbMsg(e.message); } });
    $('#wsVerify')?.addEventListener('click', async () => { try { await cloud.verifyCode($('#wsEmail').value.trim(), $('#wsCode').value); UI.openWorkspace(); toast('Signed in to the shared workspace.'); } catch (e) { sbMsg(e.message); } });
    if (focus) { const el = $(focus === 'inventory' ? '#wsInv' : '#wsTeamSec'); el?.scrollIntoView({ block: 'center' }); }
  };

  UI.renderTeam = async () => {
    const box = $('#wsTeamBody'); if (!box) return;
    const cloud = W.cloud;
    if (W.mode() === 'cloud') {
      if (!cloud.team) { box.innerHTML = `<p>You are not in a team yet. Ask an admin to invite your e-mail, or start one:</p><div class="btns"><input id="wsNewTeam" type="text" placeholder="Team name, e.g. Gurugram DDMA"><button class="btn" id="wsMkTeam" type="button">Create team</button></div>`; $('#wsMkTeam').addEventListener('click', async () => { try { await cloud.createTeam($('#wsNewTeam').value.trim() || 'My team'); UI.openWorkspace(); } catch (e) { toast(esc(e.message), { err: true }); } }); return; }
      try {
        const mem = await cloud.listMembers();
        box.innerHTML = `<table class="t"><thead><tr><th>Person</th><th>Role</th><th></th></tr></thead><tbody>${mem.map((x) => `<tr><td>${esc(x.name || x.email)}<br><span class="muted">${esc(x.email)}${x.user_id ? '' : ' · invited'}</span></td><td>${W.can('team') ? `<select data-role="${esc(x.email)}">${Object.keys(W.ROLES).map((r) => `<option ${x.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : esc(x.role)}</td><td>${W.can('team') && x.email !== W.me().email ? `<button class="linkbtn danger" data-rm="${esc(x.email)}" type="button">remove</button>` : ''}</td></tr>`).join('')}</tbody></table>
          ${W.can('team') ? `<div class="grid2"><label class="field">Invite by e-mail<input id="wsInvEmail" type="email"></label><label class="field">Role<select id="wsInvRole">${Object.keys(W.ROLES).map((r) => `<option>${r}</option>`).join('')}</select></label></div><div class="btns"><button class="btn" id="wsInvite" type="button">Invite</button></div><p class="muted">They sign in with that e-mail and join automatically.</p>` : ''}`;
        box.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => { try { await cloud.setRole(s.dataset.role, s.value); toast('Role updated.'); } catch (e) { toast(esc(e.message), { err: true }); } }));
        box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => { try { await cloud.removeMember(b.dataset.rm); UI.renderTeam(); } catch (e) { toast(esc(e.message), { err: true }); } }));
        $('#wsInvite')?.addEventListener('click', async () => { try { await cloud.invite($('#wsInvEmail').value, $('#wsInvRole').value); UI.renderTeam(); } catch (e) { toast(esc(e.message), { err: true }); } });
      } catch (e) { box.textContent = e.message; }
      return;
    }
    const team = W.team();
    box.innerHTML = `<p class="muted" style="margin-top:0">A contact list for this browser (who is involved and in what role). Sharing plans across computers needs the shared back end, or a plan file.</p>
      <table class="t"><tbody>${team.map((x, k) => `<tr><td>${esc(x.name)}<br><span class="muted">${esc(x.email)}</span></td><td>${esc(W.ROLES[x.role]?.label || x.role)}</td><td>${W.can('team') ? `<button class="linkbtn danger" data-tdel="${k}" type="button">remove</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">Nobody added yet.</td></tr>'}</tbody></table>
      ${W.can('team') ? `<div class="grid2"><label class="field">Name<input id="wtName" type="text"></label><label class="field">E-mail<input id="wtEmail" type="email"></label></div><label class="field">Role<select id="wtRole">${Object.entries(W.ROLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label><div class="btns"><button class="btn" id="wtAdd" type="button">Add person</button></div>` : '<p class="muted">Only an admin can edit the team.</p>'}`;
    $('#wtAdd')?.addEventListener('click', () => { try { W.setTeam([...team, { name: $('#wtName').value.trim(), email: $('#wtEmail').value.trim(), role: $('#wtRole').value }]); UI.renderTeam(); } catch (e) { toast(esc(e.message), { err: true }); } });
    box.querySelectorAll('[data-tdel]').forEach((b) => b.addEventListener('click', () => { W.setTeam(team.filter((_, k) => k !== +b.dataset.tdel)); UI.renderTeam(); }));
  };

  AA.wsui = UI;
})(window);
