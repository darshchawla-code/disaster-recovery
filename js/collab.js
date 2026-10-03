/* Shared live plan: tasks (who does what, where, by when) and comments, for many agencies on one plan.
   Without a back end they live inside the plan (saved plans and plan files carry them).
   With the shared back end and a saved plan they live in tables plan_tasks / plan_comments and update live
   (Supabase Realtime, with a 30-second check as fallback); a newer saved version of the plan is announced.
   Skill: skills/collab/SKILL.md */
(function (root) {
  const AA = root.AA, W = AA.workspace;
  const COL = {};
  COL.STATUS = { open: 'To do', doing: 'In progress', done: 'Done' };
  const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const listeners = new Set();
  COL.on = (fn) => listeners.add(fn);
  const emit = (type, data) => listeners.forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } });

  /** Where this plan's tasks live: 'cloud' (shared, live) or 'plan' (inside the plan). */
  COL.mode = (st) => (W.cloud?.ready && W.cloud.team && st?.savedId && W.mode() === 'cloud' ? 'cloud' : 'plan');
  const box = (st) => (st.collab = st.collab || { tasks: [], comments: [] });
  COL.tasks = (st) => box(st).tasks.slice().sort((a, b) => ({ doing: 0, open: 1, done: 2 }[a.status] - { doing: 0, open: 1, done: 2 }[b.status]) || String(a.due || '9').localeCompare(String(b.due || '9')) || (a.at < b.at ? 1 : -1));
  COL.comments = (st) => box(st).comments.slice().sort((a, b) => (a.at < b.at ? 1 : -1));

  const me = () => W.me();
  const isMine = (t) => { const m = me(); const a = String(t.assignee || '').toLowerCase(); return !!a && (a === String(m.email || '').toLowerCase() || a === String(m.name || '').toLowerCase()); };
  COL.canCreate = () => W.can('edit');
  COL.canUpdate = (t) => W.can('edit') || isMine(t);
  COL.canComment = () => true; // every role, incl. viewers and field teams, may comment
  COL.isOverdue = (t, now = new Date()) => t.status !== 'done' && t.due && t.due < now.toISOString().slice(0, 10);

  const clean = (t) => ({
    id: String(t.id || uid()).slice(0, 40), title: String(t.title || '').trim().slice(0, 200), zoneId: t.zoneId ? String(t.zoneId).slice(0, 12) : '',
    assignee: String(t.assignee || '').trim().slice(0, 120), due: /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '', status: COL.STATUS[t.status] ? t.status : 'open',
    note: String(t.note || '').slice(0, 500), by: String(t.by || me().name || '').slice(0, 80), at: t.at || new Date().toISOString(), updatedAt: t.updatedAt || t.at || new Date().toISOString(),
  });

  // ---------------- tasks ----------------
  COL.addTask = async (st, t) => {
    if (!COL.canCreate()) throw new Error(`Your role (${me().role}) can comment but not create tasks.`);
    const task = clean({ ...t, by: me().name });
    if (!task.title) throw new Error('Give the task a title.');
    if (COL.mode(st) === 'cloud') await cloud.upsertTask(st, task);
    box(st).tasks.push(task);
    AA.engine.decide('task', {}, `Task added: “${task.title}”${task.assignee ? ` → ${task.assignee}` : ''}${task.due ? ` by ${task.due}` : ''}`);
    emit('tasks', st); return task;
  };
  COL.updateTask = async (st, id, patch) => {
    const t = box(st).tasks.find((x) => x.id === id); if (!t) throw new Error('Task not found.');
    if (!COL.canUpdate(t)) throw new Error('Only planners or the person the task is assigned to can change it.');
    const next = clean({ ...t, ...patch, id: t.id, by: t.by, at: t.at, updatedAt: new Date().toISOString() });
    if (COL.mode(st) === 'cloud') await cloud.upsertTask(st, next);
    Object.assign(t, next);
    if (patch.status) AA.engine.decide('task', {}, `Task “${t.title}” → ${COL.STATUS[t.status].toLowerCase()}`);
    emit('tasks', st); return t;
  };
  COL.removeTask = async (st, id) => {
    if (!W.can('edit')) throw new Error('Only planners can delete tasks.');
    if (COL.mode(st) === 'cloud') await cloud.deleteTask(id);
    box(st).tasks = box(st).tasks.filter((x) => x.id !== id); emit('tasks', st);
  };

  // ---------------- comments ----------------
  COL.addComment = async (st, text, zoneId = '') => {
    const c = { id: uid(), text: String(text || '').trim().slice(0, 1000), zoneId: zoneId || '', by: me().name || 'someone', role: me().role, at: new Date().toISOString() };
    if (!c.text) throw new Error('Write something first.');
    if (COL.mode(st) === 'cloud') await cloud.insertComment(st, c);
    box(st).comments.push(c); emit('comments', st); return c;
  };

  // ---------------- plan files: tasks and comments travel with the snapshot ----------------
  COL.snapshot = (st) => JSON.parse(JSON.stringify(box(st)));
  COL.restore = (st, data) => { st.collab = { tasks: (data?.tasks || []).map(clean), comments: (data?.comments || []).slice(-500) }; };

  // ---------------- shared back end ----------------
  const C = () => W.cloud;
  const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
  const cloud = {
    upsertTask: async (st, t) => must(await C().client.from('plan_tasks').upsert({ id: t.id, plan_id: st.savedId, team_id: C().team.id, title: t.title, zone_id: t.zoneId, assignee: t.assignee, due: t.due || null, status: t.status, note: t.note, by_name: t.by, updated_at: t.updatedAt })),
    deleteTask: async (id) => must(await C().client.from('plan_tasks').delete().eq('id', id)),
    insertComment: async (st, c) => must(await C().client.from('plan_comments').insert({ id: c.id, plan_id: st.savedId, team_id: C().team.id, zone_id: c.zoneId, body: c.text, by_name: c.by, by_role: c.role })),
    load: async (st) => {
      const [t, c, p] = await Promise.all([
        C().client.from('plan_tasks').select('*').eq('plan_id', st.savedId),
        C().client.from('plan_comments').select('*').eq('plan_id', st.savedId).order('created_at', { ascending: false }).limit(300),
        C().client.from('plans').select('updated_at, saved_by').eq('id', st.savedId).single(),
      ]);
      return { tasks: (must(t) || []).map((r) => clean({ id: r.id, title: r.title, zoneId: r.zone_id, assignee: r.assignee, due: r.due || '', status: r.status, note: r.note, by: r.by_name, at: r.created_at, updatedAt: r.updated_at })),
        comments: (must(c) || []).map((r) => ({ id: r.id, text: r.body, zoneId: r.zone_id || '', by: r.by_name, role: r.by_role, at: r.created_at })), plan: must(p) };
    },
  };
  COL._cloud = cloud;

  /** Push the plan's own tasks and comments to the shared tables (after a first cloud save). */
  COL.pushLocal = async (st) => {
    if (COL.mode(st) !== 'cloud') return 0;
    let n = 0;
    for (const t of box(st).tasks) { await cloud.upsertTask(st, t); n++; }
    for (const c of box(st).comments) { try { await cloud.insertComment(st, c); n++; } catch (e) { /* already there */ } }
    return n;
  };

  /** Merge shared rows into the plan; returns what changed (for a toast). */
  COL.merge = (st, remote) => {
    const b = box(st), before = JSON.stringify(b);
    const byId = new Map(b.tasks.map((t) => [t.id, t]));
    remote.tasks.forEach((t) => { const mine = byId.get(t.id); if (!mine || mine.updatedAt < t.updatedAt) byId.set(t.id, t); });
    const remoteIds = new Set(remote.tasks.map((t) => t.id));
    b.tasks = [...byId.values()].filter((t) => remoteIds.has(t.id)); // deleted elsewhere → gone here
    const cIds = new Set(b.comments.map((c) => c.id));
    remote.comments.forEach((c) => { if (!cIds.has(c.id)) b.comments.push(c); });
    return before !== JSON.stringify(b);
  };

  let timer = null, channel = null, lastSeenSave = null;
  /** Start live updates for an open plan (cloud only): Realtime + 30-s polling fallback + newer-version notice. */
  COL.start = (st) => {
    COL.stop();
    if (COL.mode(st) !== 'cloud') return;
    lastSeenSave = null;
    const pull = async () => {
      if (AA.engine.state !== st) return COL.stop();
      try {
        const r = await cloud.load(st);
        if (COL.merge(st, r)) emit('remote', st);
        if (lastSeenSave && r.plan?.updated_at && r.plan.updated_at > lastSeenSave && r.plan.saved_by !== me().name) emit('newer', { by: r.plan.saved_by, at: r.plan.updated_at });
        lastSeenSave = r.plan?.updated_at || lastSeenSave;
      } catch (e) { emit('error', e.message); }
    };
    pull();
    timer = setInterval(pull, 30000);
    try {
      channel = C().client.channel(`plan-${st.savedId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_tasks', filter: `plan_id=eq.${st.savedId}` }, pull)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plan_comments', filter: `plan_id=eq.${st.savedId}` }, pull)
        .subscribe();
    } catch (e) { channel = null; /* realtime not available: polling still works */ }
  };
  COL.stop = () => { clearInterval(timer); timer = null; try { if (channel) C()?.client?.removeChannel(channel); } catch (e) { /* ignore */ } channel = null; };
  COL.markSaved = (at) => { lastSeenSave = at || new Date().toISOString(); };

  AA.collab = COL;
})(typeof window !== 'undefined' ? window : globalThis);
