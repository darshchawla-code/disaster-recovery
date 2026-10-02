/* Field app page (field.html): capture → save on the phone (IndexedDB outbox) → send.
   Sending: automatically to the shared workspace when signed in and online; otherwise Share (WhatsApp/SMS text
   with an AA1 code, plus the photo where the phone allows) or Copy. Skill: skills/field-app/SKILL.md */
(function (root) {
  const AA = root.AA, FR = AA.field, W = AA.workspace;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const qs = new URLSearchParams(location.search);
  const plan = { name: qs.get('plan') || '', lat: +qs.get('lat'), lon: +qs.get('lon') };
  const draft = { lat: null, lon: null, acc: null, damage: null, photo: null, photoUrl: null };

  // ---------------- toast ----------------
  let tt;
  const toast = (m, ms = 3500) => { const t = $('#ftoast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), ms); };

  // ---------------- outbox (IndexedDB, falls back to memory) ----------------
  const DB = (() => {
    let dbp = null; const mem = new Map();
    const open = () => dbp || (dbp = new Promise((res) => {
      try {
        const r = indexedDB.open('aidatlas-field', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('reports', { keyPath: 'id' });
        r.onsuccess = () => res(r.result); r.onerror = () => res(null);
      } catch (e) { res(null); }
    }));
    const tx = async (mode, fn) => { const db = await open(); if (!db) return fn(null); return new Promise((res, rej) => { const t = db.transaction('reports', mode); const st = t.objectStore('reports'); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };
    return {
      put: (rec) => tx('readwrite', (st) => (st ? st.put(rec) : mem.set(rec.id, rec))),
      all: async () => { const db = await open(); if (!db) return [...mem.values()]; return new Promise((res) => { const r = db.transaction('reports').objectStore('reports').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); },
      del: (id) => tx('readwrite', (st) => (st ? st.delete(id) : mem.delete(id))),
    };
  })();

  // ---------------- profile ----------------
  const PROFILE = 'aa.fieldProfile';
  const profile = () => { try { return JSON.parse(localStorage.getItem(PROFILE) || '{}'); } catch (e) { return {}; } };
  const saveProfile = () => { try { localStorage.setItem(PROFILE, JSON.stringify({ by: $('#by').value.trim(), team: $('#team').value.trim(), trained: $('#trained').checked })); } catch (e) { /* private mode */ } };

  // ---------------- location ----------------
  let watchId = null, watchStop = null;
  const showLoc = () => {
    const t = $('#locTxt');
    if (draft.lat == null) { t.textContent = 'Location not set yet.'; t.className = 'loc'; return; }
    const away = isFinite(plan.lat) && plan.lat ? ` · ${Math.round(AA.math.haversine(draft, plan))} km from the plan centre` : '';
    t.textContent = `${draft.lat.toFixed(5)}, ${draft.lon.toFixed(5)}${draft.acc != null ? ` (± ${Math.round(draft.acc)} m)` : ''}${away}`;
    t.className = 'loc ' + (draft.acc == null || draft.acc <= 100 ? 'ok' : 'bad');
    $('#lat').value = draft.lat.toFixed(5); $('#lon').value = draft.lon.toFixed(5);
  };
  const startGps = () => {
    if (!navigator.geolocation) { $('#locTxt').textContent = 'This phone cannot share its location here; type it below.'; return; }
    $('#locTxt').textContent = 'Finding your location…';
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = navigator.geolocation.watchPosition((p) => {
      draft.lat = p.coords.latitude; draft.lon = p.coords.longitude; draft.acc = p.coords.accuracy; showLoc();
      if (p.coords.accuracy <= 25) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    }, (e) => { $('#locTxt').textContent = e.code === 1 ? 'Location permission was refused. Allow it in the browser, or type the location below.' : 'No GPS fix yet. Step outside, or type the location below.'; $('#locTxt').className = 'loc bad'; }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
    clearTimeout(watchStop); watchStop = setTimeout(() => { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }, 90000);
  };

  // ---------------- photo (shrunk to ≤ 1280 px JPEG) ----------------
  const shrink = (file, max = 1280, q = 0.72) => new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new Error('Could not compress the photo'))), 'image/jpeg', q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('This file is not a photo the browser can read')); };
    img.src = url;
  });

  // ---------------- form ----------------
  const build = () => {
    $('#dmgs').innerHTML = FR.DAMAGE.map((d, k) => `<button type="button" data-d="${d.v}" aria-pressed="false"><i style="background:${['#16a34a', '#84cc16', '#f59e0b', '#ea580c', '#b91c1c'][k]}"></i><b>${esc(d.label)}</b><span>${esc(d.hint)}</span></button>`).join('');
    $('#dmgs').querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { draft.damage = +b.dataset.d; $('#dmgs').querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    $('#needs').innerHTML = FR.NEEDS.map(([k, l]) => `<label><input type="checkbox" value="${k}"> ${esc(l)}</label>`).join('');
    const p = profile(); $('#by').value = p.by || ''; $('#team').value = p.team || ''; $('#trained').checked = !!p.trained;
    if (plan.name) { const b = $('#planBanner'); b.hidden = false; b.innerHTML = `Reporting for the plan <b>${esc(plan.name)}</b>. Reports are matched to its areas by location.`; }
  };
  const reset = () => {
    draft.damage = null; draft.photo = null; if (draft.photoUrl) URL.revokeObjectURL(draft.photoUrl); draft.photoUrl = null;
    $('#dmgs').querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    $('#needs').querySelectorAll('input').forEach((i) => (i.checked = false));
    ['#pAff', '#pInj', '#pTrap', '#note'].forEach((s) => ($(s).value = ''));
    document.querySelector('input[name=road][value=open]').checked = true;
    $('#photo').value = ''; $('#photoPrev').hidden = true; $('#photoTxt').textContent = 'Photos are shrunk to about 150 KB before sending.';
  };

  const save = async () => {
    const lat = draft.lat ?? (+$('#lat').value || null), lon = draft.lon ?? (+$('#lon').value || null);
    if ($('#lat').value && $('#lon').value && (+$('#lat').value !== draft.lat || +$('#lon').value !== draft.lon)) { draft.lat = +$('#lat').value; draft.lon = +$('#lon').value; draft.acc = null; }
    if (draft.lat == null && (lat == null || lon == null)) { toast('Set the location first (step 1).'); $('#gps').focus(); return; }
    if (draft.damage == null) { toast('Choose how bad the damage is (step 3).'); $('#dmgs').scrollIntoView({ block: 'center' }); return; }
    saveProfile();
    let report;
    try {
      report = FR.normalise({ lat: draft.lat ?? lat, lon: draft.lon ?? lon, acc: draft.acc, damage: draft.damage, needs: [...$('#needs').querySelectorAll('input:checked')].map((i) => i.value),
        people: { affected: $('#pAff').value, injured: $('#pInj').value, trapped: $('#pTrap').value }, road: document.querySelector('input[name=road]:checked').value,
        note: $('#note').value.trim(), by: $('#by').value.trim(), team: $('#team').value.trim(), trained: $('#trained').checked, place: $('#place').value.trim(), plan: plan.name });
    } catch (e) { toast(e.message); return; }
    await DB.put({ id: report.id, report, photo: draft.photo, status: 'queued', savedAt: new Date().toISOString() });
    reset();
    toast('Saved on this phone.');
    await sendQueued();
    await renderOutbox();
    $('#outboxSec').scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // ---------------- sending ----------------
  const cloudOk = () => FR.cloudAvailable() && navigator.onLine !== false;
  let sending = false;
  const sendQueued = async () => {
    if (sending || !cloudOk()) return 0; sending = true; let n = 0;
    try {
      for (const rec of await DB.all()) {
        if (rec.status === 'sent') continue;
        try { await FR.cloudSend(rec.report, rec.photo); rec.status = 'sent'; rec.sentAt = new Date().toISOString(); await DB.put(rec); n++; } catch (e) { rec.error = e.message; await DB.put(rec); break; }
      }
    } finally { sending = false; }
    if (n) toast(`${n} report${n === 1 ? '' : 's'} sent to the control room.`);
    return n;
  };
  const share = async (rec) => {
    const text = FR.shareText(rec.report);
    const file = rec.photo ? new File([rec.photo], `field-${rec.id}.jpg`, { type: 'image/jpeg' }) : null;
    try {
      if (navigator.share) {
        const data = file && navigator.canShare && navigator.canShare({ files: [file] }) ? { text, files: [file] } : { text };
        await navigator.share(data); rec.status = rec.status === 'sent' ? 'sent' : 'shared'; await DB.put(rec); renderOutbox(); return;
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); rec.status = rec.status === 'sent' ? 'sent' : 'shared'; await DB.put(rec); toast('Copied. Paste it into WhatsApp or SMS to your control room.'); renderOutbox(); }
    catch (e) { const ta = document.getElementById('code-' + rec.id); if (ta) { ta.hidden = false; ta.select(); } toast('Select the code below and copy it.'); }
  };

  const renderOutbox = async () => {
    const list = (await DB.all()).sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
    $('#obEmpty').hidden = list.length > 0;
    $('#outbox').innerHTML = list.slice(0, 30).map((rec) => {
      const r = rec.report, lbl = { sent: 'sent', queued: cloudOk() ? 'sending…' : 'waiting', shared: 'shared' }[rec.status];
      return `<li><b>${esc(FR.damageLabel(r.damage))}</b> · ${esc(FR.ROAD[r.road])}${r.place ? ` · ${esc(r.place)}` : ''} <span class="st ${rec.status}">${lbl}</span><br><span class="small muted">${new Date(r.at).toLocaleString()} · ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}${rec.photo ? ' · photo' : ''}${rec.error ? ` · ${esc(rec.error)}` : ''}</span>
        <div class="btns"><button class="btn" type="button" data-share="${esc(rec.id)}">Share (WhatsApp/SMS)</button><button class="btn" type="button" data-copy="${esc(rec.id)}">Copy code</button><button class="linkbtn danger" type="button" data-del="${esc(rec.id)}">delete</button></div>
        <textarea class="codebox" id="code-${esc(rec.id)}" rows="2" readonly hidden>${esc(FR.encode(r))}</textarea></li>`;
    }).join('');
    const byId = (id) => list.find((x) => x.id === id);
    $('#outbox').querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', () => share(byId(b.dataset.share))));
    $('#outbox').querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => { const rec = byId(b.dataset.copy), ta = document.getElementById('code-' + rec.id); ta.hidden = false; try { await navigator.clipboard.writeText(ta.value); toast('Code copied.'); } catch (e) { ta.select(); toast('Select the code and copy it.'); } }));
    $('#outbox').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (b.dataset.armed) { await DB.del(b.dataset.del); renderOutbox(); } else { b.dataset.armed = '1'; b.textContent = 'tap again to delete'; } }));
    connText();
  };

  const net = () => { const on = navigator.onLine !== false; const n = $('#net'); n.textContent = on ? 'online' : 'offline'; n.className = 'net' + (on ? '' : ' off'); };
  const connText = () => {
    const C = W.cloud;
    $('#connTxt').innerHTML = FR.cloudAvailable() ? `Signed in as <b>${esc(C.user?.email || '')}</b> · team <b>${esc(C.team?.name || '')}</b>. Reports are sent automatically when there is a signal.`
      : C?.config() ? 'Connected to a shared workspace but not signed in: sign in below, or use Share.' : 'Not connected to a shared workspace: after saving, press <b>Share</b> and send the message to your control room by WhatsApp or SMS.';
  };

  // ---------------- shared workspace sign-in (same back end as the app) ----------------
  const bindCloud = () => {
    const C = W.cloud, msg = (t) => ($('#sbMsg').textContent = t);
    const cfg = C.config(); if (cfg) { $('#sbUrl').value = cfg.url; $('#sbKey').value = cfg.key; }
    $('#sbSave').addEventListener('click', async () => { msg('Connecting…'); try { const signed = await C.configure({ url: $('#sbUrl').value, key: $('#sbKey').value }); msg(signed ? 'Connected and signed in.' : 'Connected. Now sign in with your e-mail.'); connText(); sendQueued().then(renderOutbox); } catch (e) { msg(e.message); } });
    $('#sbOff').addEventListener('click', async () => { await C.signOut(); await C.configure(null); msg('Disconnected.'); connText(); });
    $('#sbSend').addEventListener('click', async () => { try { await C.sendCode($('#sbEmail').value.trim()); msg('Code sent. Check your e-mail.'); } catch (e) { msg(e.message); } });
    $('#sbVerify').addEventListener('click', async () => { try { await C.verifyCode($('#sbEmail').value.trim(), $('#sbCode').value); msg('Signed in.'); connText(); await sendQueued(); renderOutbox(); } catch (e) { msg(e.message); } });
    if (cfg) C.init().then(() => { connText(); sendQueued().then(renderOutbox); }).catch((e) => msg(e.message));
  };

  const boot = () => {
    build(); net(); connText(); renderOutbox();
    $('#gps').addEventListener('click', startGps);
    ['#lat', '#lon'].forEach((s) => $(s).addEventListener('change', () => { const a = +$('#lat').value, o = +$('#lon').value; if ($('#lat').value && $('#lon').value && isFinite(a) && isFinite(o)) { draft.lat = a; draft.lon = o; draft.acc = null; showLoc(); } }));
    $('#photo').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const b = await shrink(f); draft.photo = b; if (draft.photoUrl) URL.revokeObjectURL(draft.photoUrl); draft.photoUrl = URL.createObjectURL(b); $('#photoPrev').src = draft.photoUrl; $('#photoPrev').hidden = false; $('#photoTxt').textContent = `Photo ready (${Math.round(b.size / 1024)} KB).`; }
      catch (er) { toast(er.message); }
    });
    $('#save').addEventListener('click', save);
    addEventListener('online', () => { net(); sendQueued().then(renderOutbox); });
    addEventListener('offline', net);
    bindCloud();
    if (navigator.geolocation && navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') startGps(); }).catch(() => {});
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  };
  AA.fieldPage = { DB, sendQueued, renderOutbox, draft, share };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
