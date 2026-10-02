/* Workspace: people, roles, saved plans, watch areas, inventory sources. Skill: skills/workspace/SKILL.md
   Works fully in the browser (localStorage). When a Supabase project is configured in Settings, the same calls
   go to the shared team database instead (js/cloud.js), where row-level security enforces the roles. */
(function (root) {
  const AA = root.AA, M = AA.math;
  const W = {};
  const LS = (() => { try { const k = '__aa'; root.localStorage.setItem(k, '1'); root.localStorage.removeItem(k); return root.localStorage; } catch (e) { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; } })();
  W._ls = LS;
  const get = (k, d) => { try { const v = LS.getItem('aa.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const set = (k, v) => { try { LS.setItem('aa.' + k, JSON.stringify(v)); } catch (e) { /* quota: ignore */ } };
  W.get = get; W.set = set;

  // ---------------- roles ----------------
  /** viewer: read plans and reports · planner: also change and save plans, manage watch areas · admin: also team and settings
   *  field: field-app teams, send field reports (and read plans) */
  W.ROLES = {
    viewer: { label: 'Viewer', can: ['view', 'report'] },
    planner: { label: 'Planner', can: ['view', 'report', 'edit', 'save', 'watch', 'inventory', 'field'] },
    admin: { label: 'Admin', can: ['view', 'report', 'edit', 'save', 'watch', 'inventory', 'team', 'settings', 'field'] },
    field: { label: 'Field team', can: ['view', 'report', 'field'] },
  };
  const DEFAULT_ME = { name: 'Local user', email: '', org: '', role: 'planner' };
  W.me = () => (W.cloud?.user ? { ...W.cloud.user } : { ...DEFAULT_ME, ...get('me', {}) });
  W.setMe = (p) => { const cur = get('me', {}); set('me', { ...cur, ...p, role: W.ROLES[p.role || cur.role] ? p.role || cur.role : 'planner' }); emit('me'); };
  W.can = (action) => (W.ROLES[W.me().role] || W.ROLES.viewer).can.includes(action);
  W.mode = () => (W.cloud?.ready ? 'cloud' : 'local');

  // local team list (who is involved; real access control needs the cloud back end)
  W.team = () => get('team', []);
  W.setTeam = (list) => { if (!W.can('team')) throw new Error('Only an admin can change the team.'); set('team', list.filter((x) => x && x.name).map((x) => ({ name: String(x.name).slice(0, 80), email: String(x.email || '').slice(0, 120), role: W.ROLES[x.role] ? x.role : 'viewer' }))); emit('team'); };

  const listeners = new Set();
  W.on = (fn) => listeners.add(fn);
  const emit = (type, data) => listeners.forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } });
  W._emit = emit;

  // ---------------- saved plans ----------------
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  W.plans = {
    async list() {
      if (W.mode() === 'cloud') return W.cloud.listPlans();
      return get('plans', []).map(({ id, name, savedAt, savedBy, summary }) => ({ id, name, savedAt, savedBy, summary })).sort((a, b) => (b.savedAt > a.savedAt ? 1 : -1));
    },
    async save(snap, id) {
      if (!W.can('save')) throw new Error(`Your role (${W.me().role}) cannot save plans.`);
      if (W.mode() === 'cloud') return W.cloud.savePlan(snap, id);
      const all = get('plans', []);
      const rec = { ...snap, id: id || uid() };
      const i = all.findIndex((p) => p.id === rec.id);
      if (i >= 0) { rec.versions = [...(all[i].versions || []), { savedAt: all[i].savedAt, savedBy: all[i].savedBy, summary: all[i].summary }].slice(-20); all[i] = rec; } else all.push(rec);
      set('plans', all.slice(-50));
      if (JSON.stringify(get('plans', [])).length < 10) throw new Error('Browser storage is full or blocked; use “Download plan file” instead.');
      emit('plans');
      return rec.id;
    },
    async load(id) { if (W.mode() === 'cloud') return W.cloud.loadPlan(id); const p = get('plans', []).find((x) => x.id === id); if (!p) throw new Error('Plan not found'); return p; },
    async remove(id) { if (!W.can('save')) throw new Error('Your role cannot delete plans.'); if (W.mode() === 'cloud') return W.cloud.deletePlan(id); set('plans', get('plans', []).filter((p) => p.id !== id)); emit('plans'); },
  };

  /** Decision log → CSV (one row per decision). */
  W.decisionsCSV = (decisions) => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return ['time,plan_hour,by,role,action,what_changed,note', ...(decisions || []).map((d) => [d.at, `T+${(d.epoch || 0) * AA.config.epochHours}h`, d.by, d.role, d.type, d.reason, d.note].map(q).join(','))].join('\n');
  };

  // ---------------- watch areas ----------------
  const ALERT_RANK = { Green: 1, Orange: 2, Red: 3 };
  W.watch = {
    async list() { if (W.mode() === 'cloud') return W.cloud.listWatch(); return get('watch', []); },
    async add(a) {
      if (!W.can('watch')) throw new Error(`Your role (${W.me().role}) cannot add watch areas.`);
      const area = { id: uid(), name: String(a.name || 'Watch area').slice(0, 80), lat: +a.lat, lon: +a.lon, radiusKm: M.clamp(+a.radiusKm || 100, 5, 1000), hazards: (a.hazards && a.hazards.length ? a.hazards : ['EQ', 'TC', 'FL', 'VO', 'DR', 'WF']), minLevel: ALERT_RANK[a.minLevel] ? a.minLevel : 'Orange', email: String(a.email || '').slice(0, 120) };
      if (!isFinite(area.lat) || !isFinite(area.lon)) throw new Error('Watch area needs a location');
      if (W.mode() === 'cloud') return W.cloud.addWatch(area);
      set('watch', [...get('watch', []), area]); emit('watch'); return area.id;
    },
    async remove(id) { if (W.mode() === 'cloud') return W.cloud.deleteWatch(id); set('watch', get('watch', []).filter((a) => a.id !== id)); emit('watch'); },
  };
  /** Level of a live event on the GDACS scale; USGS PAGER and severity mapped onto it. */
  W.eventLevel = (e) => {
    // GDACS: the current episode's level (a decayed storm keeps its old event-level Red)
    if (e.alertlevel && ALERT_RANK[e.alertlevel]) return ALERT_RANK[e.episodealertlevel] ? e.episodealertlevel : e.alertlevel;
    if (e.pager) return { green: 'Green', yellow: 'Orange', orange: 'Red', red: 'Red' }[e.pager] || 'Green';
    if (e.hazard === 'EQ' && (e.magnitude ?? 0) >= 6.5) return 'Orange';
    return 'Green';
  };
  /** Which events fall inside which watch areas at or above the area's minimum level. Pure function (also used by tools/watch-alerts.js). */
  W.matchWatch = (areas, events) => {
    const out = [];
    (areas || []).forEach((a) => (events || []).forEach((e) => {
      if (!a.hazards.includes(e.hazard)) return;
      const lvl = W.eventLevel(e);
      if (ALERT_RANK[lvl] < ALERT_RANK[a.minLevel]) return;
      const d = M.haversine(a, e);
      if (d <= a.radiusKm) out.push({ area: a, event: e, level: lvl, distKm: d, key: `${a.id}|${e.id}|${lvl}` });
    }));
    return out.sort((x, y) => ALERT_RANK[y.level] - ALERT_RANK[x.level] || x.distKm - y.distKm);
  };
  /** Matches not yet seen on this device (so a notification fires once per event and level). */
  W.newMatches = (matches) => {
    const seen = new Set(get('seenAlerts', []));
    const fresh = matches.filter((m) => !seen.has(m.key));
    set('seenAlerts', [...seen, ...fresh.map((m) => m.key)].slice(-500));
    return fresh;
  };

  // ---------------- inventory source (Google Sheet / CSV / JSON URL) ----------------
  W.inventory = {
    source: () => get('invSource', null),
    setSource: (src) => { if (src && !W.can('inventory')) throw new Error('Your role cannot change the inventory source.'); set('invSource', src); emit('inventory'); },
    /** Fetch and parse rows: CSV (Google Sheets export or any CSV) or JSON (array of rows, or {stores:[...]}). */
    async fetchRows(url) {
      const u = AA.data.sheetCsvUrl(url);
      const text = await AA.data.fetchText(u);
      const t = text.trim();
      let rows;
      if (t.startsWith('[') || t.startsWith('{')) { const j = JSON.parse(t); rows = Array.isArray(j) ? j : j.stores || j.rows || j.data || []; }
      else rows = W.parseCSV(t);
      return W.normaliseRows(rows);
    },
  };
  /** CSV parser with quoted fields. */
  W.parseCSV = (text) => {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    return rows.filter((r) => r.some((x) => x.trim() !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
  };
  /** Accept common column spellings so a team's own sheet works without renaming everything. */
  const ALIASES = { name: ['name', 'store', 'depot', 'site'], lat: ['lat', 'latitude', 'y'], lon: ['lon', 'lng', 'long', 'longitude', 'x'], type: ['type', 'kind'], water_l: ['water_l', 'water_litres', 'water_liters', 'water'], food_kg: ['food_kg', 'food'], tents: ['tents', 'shelter', 'tent'], medkits: ['medkits', 'medical', 'medical_kits', 'med_kits'], staff: ['staff', 'personnel', 'workers'], trucks: ['trucks', 'truck'], buses: ['buses', 'bus'], ambulances: ['ambulances', 'ambulance'], beds: ['beds'], address: ['address', 'location', 'addr'] };
  W.normaliseRows = (rows) => (rows || []).map((r) => {
    const low = Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().toLowerCase().replace(/\s+/g, '_'), v]));
    const o = {};
    Object.entries(ALIASES).forEach(([k, al]) => { const hit = al.find((a) => low[a] !== undefined && low[a] !== ''); if (hit !== undefined) o[k] = k === 'name' || k === 'type' || k === 'address' ? String(low[hit]) : +String(low[hit]).replace(/[, ]/g, ''); });
    return o;
  }).filter((r) => isFinite(r.lat) && isFinite(r.lon) && Math.abs(r.lat) <= 90 && Math.abs(r.lon) <= 180);

  AA.workspace = W;
})(typeof window !== 'undefined' ? window : globalThis);
