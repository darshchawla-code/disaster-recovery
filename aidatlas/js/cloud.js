/* Optional shared back end (Supabase): sign-in by e-mailed code, teams, roles enforced by row-level security,
   shared saved plans and watch areas. Off until an admin enters the project URL and public (anon) key in Settings.
   Database set-up: supabase/schema.sql. Skill: skills/workspace/SKILL.md */
(function (root) {
  const AA = root.AA;
  const W = AA.workspace;
  const C = { ready: false, user: null, team: null, teams: [], client: null };
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

  const loadLib = () => new Promise((res, rej) => {
    if (root.supabase?.createClient) return res(root.supabase);
    const s = document.createElement('script'); s.src = LIB; s.async = true;
    s.onload = () => (root.supabase?.createClient ? res(root.supabase) : rej(new Error('Supabase library did not load')));
    s.onerror = () => rej(new Error('Could not load the Supabase library (network blocked?)'));
    document.head.appendChild(s);
  });
  const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };

  C.config = () => W.get('cloud', null);
  /** Connect with { url, key }. `client` may be injected (tests). Returns true when a session exists. */
  C.init = async (cfg = C.config(), client = null) => {
    C.ready = false; C.user = null;
    if (!cfg?.url || !cfg?.key) return false;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(cfg.url) && !client) throw new Error('Project URL should look like https://xxxx.supabase.co');
    C.client = client || (await loadLib()).createClient(cfg.url.replace(/\/$/, ''), cfg.key, { auth: { persistSession: true, storageKey: 'aa.sb' } });
    const sess = must(await C.client.auth.getSession());
    if (!sess?.session) { W._emit('cloud'); return false; }
    await C._afterLogin(sess.session.user);
    return true;
  };
  C.configure = async (cfg) => { W.set('cloud', cfg && cfg.url ? { url: cfg.url.trim(), key: cfg.key.trim() } : null); return C.init(); };

  /** Step 1: send a 6-digit code (works from file:// pages too, unlike magic links). */
  C.sendCode = async (email) => { must(await C.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })); };
  /** Step 2: verify the code, claim any team invites for this e-mail, load teams. */
  C.verifyCode = async (email, token) => { const d = must(await C.client.auth.verifyOtp({ email, token: String(token).trim(), type: 'email' })); await C._afterLogin(d.user); };
  C.signOut = async () => { try { await C.client.auth.signOut(); } catch (e) { /* ignore */ } C.ready = false; C.user = null; C.team = null; W._emit('cloud'); W._emit('me'); };

  C._afterLogin = async (user) => {
    try { await C.client.rpc('claim_invites'); } catch (e) { /* function missing → schema not installed */ }
    const rows = must(await C.client.from('members').select('team_id, role, name, teams(name)').eq('user_id', user.id));
    C.teams = (rows || []).map((r) => ({ id: r.team_id, name: r.teams?.name || 'Team', role: r.role, myName: r.name }));
    const pick = C.teams.find((t) => t.id === W.get('cloudTeam', null)) || C.teams[0] || null;
    C.useTeam(pick ? pick.id : null, user);
    C.ready = true;
    W._emit('cloud'); W._emit('me');
  };
  C.useTeam = (id, user = C._authUser) => {
    C._authUser = user;
    const t = C.teams.find((x) => x.id === id) || null;
    C.team = t; W.set('cloudTeam', t ? t.id : null);
    C.user = { name: t?.myName || user?.email || 'Signed-in user', email: user?.email || '', org: t?.name || '', role: t?.role || 'viewer', id: user?.id };
    W._emit('me');
  };
  const teamId = () => { if (!C.team) throw new Error('Create or join a team first (Settings → Team).'); return C.team.id; };

  C.createTeam = async (name) => {
    const t = must(await C.client.rpc('create_team', { team_name: String(name).slice(0, 80) }));
    await C._afterLogin(C._authUser); C.useTeam(t);
    return t;
  };

  // ---------------- plans ----------------
  C.listPlans = async () => (must(await C.client.from('plans').select('id, name, summary, saved_by, updated_at').eq('team_id', teamId()).order('updated_at', { ascending: false }).limit(100)) || [])
    .map((r) => ({ id: r.id, name: r.name, savedAt: r.updated_at, savedBy: r.saved_by, summary: r.summary }));
  C.savePlan = async (snap, id) => {
    const row = { team_id: teamId(), name: snap.name, data: snap, summary: snap.summary, saved_by: snap.savedBy };
    if (id) { must(await C.client.from('plans').update(row).eq('id', id)); W._emit('plans'); return id; }
    const r = must(await C.client.from('plans').insert(row).select('id').single()); W._emit('plans'); return r.id;
  };
  C.loadPlan = async (id) => { const r = must(await C.client.from('plans').select('data').eq('id', id).single()); return r.data; };
  C.deletePlan = async (id) => { must(await C.client.from('plans').delete().eq('id', id)); W._emit('plans'); };

  // ---------------- watch areas ----------------
  C.listWatch = async () => (must(await C.client.from('watch_areas').select('*').eq('team_id', teamId())) || [])
    .map((r) => ({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, radiusKm: r.radius_km, hazards: r.hazards, minLevel: r.min_level, email: r.email || '' }));
  C.addWatch = async (a) => { const r = must(await C.client.from('watch_areas').insert({ team_id: teamId(), name: a.name, lat: a.lat, lon: a.lon, radius_km: a.radiusKm, hazards: a.hazards, min_level: a.minLevel, email: a.email }).select('id').single()); W._emit('watch'); return r.id; };
  C.deleteWatch = async (id) => { must(await C.client.from('watch_areas').delete().eq('id', id)); W._emit('watch'); };

  // ---------------- team (admins) ----------------
  C.listMembers = async () => (must(await C.client.from('members').select('user_id, email, name, role').eq('team_id', teamId())) || []);
  C.invite = async (email, role = 'viewer', name = '') => { must(await C.client.from('members').insert({ team_id: teamId(), email: String(email).toLowerCase().trim(), role, name })); };
  C.setRole = async (email, role) => { must(await C.client.from('members').update({ role }).eq('team_id', teamId()).eq('email', String(email).toLowerCase())); };
  C.removeMember = async (email) => { must(await C.client.from('members').delete().eq('team_id', teamId()).eq('email', String(email).toLowerCase())); };

  W.cloud = C;
})(typeof window !== 'undefined' ? window : globalThis);
