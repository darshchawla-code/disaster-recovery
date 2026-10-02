/* Field reports: what a field team sees on the ground (location, photo, damage, needs, road access), shared with
   the control room and fed into the plan's Bayesian severity update.
   Two ways to send: (1) the shared back end (Supabase table field_reports + storage bucket field-photos), or
   (2) with no back end, a short text code ("AA1.…") sent by WhatsApp/SMS and pasted into the plan.
   Used by field.html (the field app) and the plan view. Skill: skills/field-app/SKILL.md */
(function (root) {
  const AA = root.AA, M = AA.math;
  const FR = {};

  FR.DAMAGE = [
    { v: 0, key: 'none', label: 'No damage', hint: 'Buildings and roads intact' },
    { v: 0.25, key: 'minor', label: 'Minor', hint: 'Cracks, broken windows, some flooding of streets' },
    { v: 0.5, key: 'moderate', label: 'Moderate', hint: 'Some homes unsafe, water inside houses, people leaving' },
    { v: 0.75, key: 'severe', label: 'Severe', hint: 'Many homes collapsed or flooded to the roof, injuries' },
    { v: 1, key: 'destroyed', label: 'Destroyed', hint: 'Most buildings down or washed away' },
  ];
  FR.NEEDS = [['water', 'Water'], ['food', 'Food'], ['shelter', 'Shelter'], ['medical', 'Medical'], ['rescue', 'Search & rescue']];
  FR.ROAD = { open: 'Road open', partly: 'Road partly blocked', blocked: 'Road blocked' };
  FR.SD = { trained: 0.1, crowd: 0.2 };
  FR.damageLabel = (v) => (FR.DAMAGE.slice().sort((a, b) => Math.abs(a.v - v) - Math.abs(b.v - v))[0] || FR.DAMAGE[0]).label;

  const uid = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const num = (x, d = 0) => (isFinite(+x) ? Math.max(0, Math.round(+x)) : d);

  /** Clean and validate a report; throws with a plain message when unusable. */
  FR.normalise = (r) => {
    if (!r || typeof r !== 'object') throw new Error('Empty report');
    const lat = +r.lat, lon = +r.lon;
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Report has no valid location');
    const damage = M.clamp(+r.damage, 0, 1);
    if (!isFinite(damage)) throw new Error('Report has no damage level');
    const needs = [...new Set((r.needs || []).filter((n) => FR.NEEDS.some(([k]) => k === n)))];
    return {
      id: String(r.id || uid()).slice(0, 40), at: r.at && !isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : new Date().toISOString(),
      lat: +lat.toFixed(6), lon: +lon.toFixed(6), acc: isFinite(+r.acc) ? Math.round(+r.acc) : null,
      damage, needs, people: { affected: num(r.people?.affected), injured: num(r.people?.injured), trapped: num(r.people?.trapped) },
      road: FR.ROAD[r.road] ? r.road : 'open', note: String(r.note || '').slice(0, 500), by: String(r.by || '').slice(0, 80), team: String(r.team || '').slice(0, 80),
      trained: !!r.trained, place: String(r.place || '').slice(0, 120), photo: r.photo || null, photoUrl: r.photoUrl || null, plan: String(r.plan || '').slice(0, 80),
    };
  };

  // ---------------- text code (no back end) ----------------
  const b64 = {
    enc: (s) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); return typeof atob === 'function' ? decodeURIComponent(escape(atob(t))) : Buffer.from(t, 'base64').toString('utf8'); },
  };
  const check = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).slice(-4).padStart(4, '0'); };
  /** Compact code for WhatsApp/SMS. The photo is not included (send it separately). */
  FR.encode = (r) => {
    const n = FR.normalise(r);
    const o = { i: n.id, t: n.at, a: n.lat, o: n.lon, c: n.acc, d: n.damage, n: n.needs, p: [n.people.affected, n.people.injured, n.people.trapped], r: n.road, x: n.note, b: n.by, m: n.team, q: n.trained ? 1 : 0, l: n.place, g: n.plan };
    Object.keys(o).forEach((k) => (o[k] === '' || o[k] == null || (Array.isArray(o[k]) && !o[k].length)) && delete o[k]);
    const body = b64.enc(JSON.stringify(o));
    return `AA1.${body}.${check(body)}`;
  };
  /** Every valid code in a pasted text (a WhatsApp message may hold several, with chat text around them). */
  FR.decodeAll = (text) => {
    const out = [], errors = [];
    String(text || '').replace(/AA1\.([A-Za-z0-9_-]+)\.([0-9a-z]{4})/g, (m, body, sum) => {
      if (check(body) !== sum) { errors.push('A code was damaged in sending (checksum does not match).'); return m; }
      try {
        const o = JSON.parse(b64.dec(body));
        out.push(FR.normalise({ id: o.i, at: o.t, lat: o.a, lon: o.o, acc: o.c, damage: o.d, needs: o.n, people: { affected: o.p?.[0], injured: o.p?.[1], trapped: o.p?.[2] }, road: o.r, note: o.x, by: o.b, team: o.m, trained: o.q === 1, place: o.l, plan: o.g, via: 'code' }));
      } catch (e) { errors.push(`A code could not be read: ${e.message}`); }
      return m;
    });
    return { reports: out, errors };
  };
  FR.shareText = (r) => {
    const n = FR.normalise(r);
    const needs = n.needs.map((k) => FR.NEEDS.find(([x]) => x === k)[1].toLowerCase()).join(', ');
    return `AidAtlas field report${n.place ? ` · ${n.place}` : ''}\n${FR.damageLabel(n.damage)} damage · ${FR.ROAD[n.road]}${needs ? ` · needs ${needs}` : ''}${n.people.trapped ? ` · ${n.people.trapped} trapped` : ''}\n${n.lat.toFixed(5)}, ${n.lon.toFixed(5)}\nPaste into AidAtlas → plan → Field reports:\n${FR.encode(n)}`;
  };

  // ---------------- matching to the plan ----------------
  /** Nearest demand zone, if the report is close enough to describe it (its catchment, at least 3 km, at most 25 km). */
  FR.match = (r, zones) => {
    let best = null;
    (zones || []).forEach((z) => { const d = M.haversine(r, z); if (!best || d < best.distKm) best = { zone: z, distKm: d }; });
    if (!best) return null;
    const lim = M.clamp((best.zone.catchKm || 6) * 1.2, 3, 25);
    return best.distKm <= lim ? best : { ...best, outside: true };
  };
  /** Engine events a report turns into: a Bayesian severity update for its area, plus a road closure when blocked. */
  FR.toEvents = (r, st) => {
    const ev = [];
    const m = FR.match(r, st?.zones);
    if (m && !m.outside) ev.push({ type: 'report', p: { zoneId: m.zone.id, value: r.damage, sd: r.trained ? FR.SD.trained : FR.SD.crowd, fieldId: r.id } });
    if (r.road === 'blocked') ev.push({ type: 'closure', p: { lat: r.lat, lon: r.lon, fieldId: r.id } });
    return { events: ev, match: m };
  };
  /** Reports inside or near the plan's impact area (radius + 30 km). */
  FR.inPlanArea = (reports, st) => { const c = st.sit.focus || st.sit; return (reports || []).filter((r) => M.haversine(c, r) <= st.sit.radiusKm + 30); };

  // ---------------- shared back end ----------------
  const cloud = () => AA.workspace?.cloud;
  const ready = () => { const C = cloud(); if (!C?.ready || !C.team) throw new Error('Sign in to the shared workspace first (Workspace → Shared back end).'); return C; };
  FR.cloudAvailable = () => { const C = cloud(); return !!(C && C.ready && C.team); };
  /** Upload the photo (if any) and insert the report. photoBlob: a JPEG Blob. */
  FR.cloudSend = async (r, photoBlob = null) => {
    const C = ready(), n = FR.normalise(r);
    let photo_path = null;
    if (photoBlob) {
      photo_path = `${C.team.id}/${n.id}.jpg`;
      const up = await C.client.storage.from('field-photos').upload(photo_path, photoBlob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw new Error(`Photo upload failed: ${up.error.message}`);
    }
    const row = { id: n.id, team_id: C.team.id, at: n.at, lat: n.lat, lon: n.lon, acc_m: n.acc, damage: n.damage, needs: n.needs, people: n.people, road: n.road, note: n.note, by_name: n.by || C.user?.name || '', team_name: n.team, trained: n.trained, place: n.place, plan: n.plan, photo_path };
    const ins = await C.client.from('field_reports').upsert(row);
    if (ins.error) throw new Error(ins.error.message);
    return n.id;
  };
  /** Reports of my team since a time (ISO), newest first, with signed photo links (1 hour). */
  FR.cloudList = async (sinceIso = null, limit = 300) => {
    const C = ready();
    let q = C.client.from('field_reports').select('*').eq('team_id', C.team.id).order('at', { ascending: false }).limit(limit);
    if (sinceIso) q = q.gte('at', sinceIso);
    const { data, error } = await q; if (error) throw new Error(error.message);
    const rows = data || [];
    const paths = rows.map((x) => x.photo_path).filter(Boolean);
    let urls = {};
    if (paths.length) { const s = await C.client.storage.from('field-photos').createSignedUrls(paths, 3600); (s.data || []).forEach((u) => { if (u.signedUrl) urls[u.path] = u.signedUrl; }); }
    return rows.map((x) => { try { return FR.normalise({ id: x.id, at: x.at, lat: x.lat, lon: x.lon, acc: x.acc_m, damage: x.damage, needs: x.needs, people: x.people, road: x.road, note: x.note, by: x.by_name, team: x.team_name, trained: x.trained, place: x.place, plan: x.plan, photoUrl: urls[x.photo_path] || null, via: 'cloud' }); } catch (e) { return null; } }).filter(Boolean);
  };

  AA.field = FR;
})(typeof window !== 'undefined' ? window : globalThis);
