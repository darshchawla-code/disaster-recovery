/* Checks supabase/schema.sql in a real Postgres (PGlite, WASM): tables, functions and row-level security.
   Supabase's auth schema is stubbed (auth.users, auth.uid(), auth.jwt()) and roles switched per test user.
   Run: npm i @electric-sql/pglite && node tests/schema.test.mjs */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '..', 'supabase', 'schema.sql'), 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const t = async (name, fn) => { try { const ok = await fn(); if (ok === false) throw new Error('assertion false'); pass++; console.log('  ✓', name); } catch (e) { fail++; console.log('  ✗', name, '—', e.message); } };

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create role authenticated nologin; create role anon nologin;
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('test.email', true)) $$;
  grant usage on schema auth to authenticated; grant usage on schema public to authenticated;
`);
await db.exec(sql);
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated; grant usage, select on all sequences in schema public to authenticated;`);
const U = { admin: '11111111-1111-1111-1111-111111111111', planner: '22222222-2222-2222-2222-222222222222', viewer: '33333333-3333-3333-3333-333333333333', outsider: '44444444-4444-4444-4444-444444444444' };
await db.exec(`insert into auth.users values ('${U.admin}','admin@x.org'),('${U.planner}','plan@x.org'),('${U.viewer}','view@x.org'),('${U.outsider}','out@y.org');`);
const as = async (who, q, params) => {
  await db.exec(`reset role; select set_config('test.uid', '${U[who]}', false), set_config('test.email', '${{ admin: 'admin@x.org', planner: 'plan@x.org', viewer: 'view@x.org', outsider: 'out@y.org' }[who]}', false); set role authenticated;`);
  try { return await db.query(q, params); } finally { await db.exec('reset role'); }
};

let team;
await t('schema installs and is idempotent (second run succeeds)', async () => { await db.exec(sql); return true; });
await t('any signed-in user can create a team and becomes its admin', async () => { team = (await as('admin', `select public.create_team('Gurugram DDMA') as id`)).rows[0].id; const r = await as('admin', `select role from members where team_id = $1`, [team]); return r.rows[0].role === 'admin'; });
await t('admin invites by e-mail; invited users join on first sign-in (claim_invites)', async () => {
  await as('admin', `insert into members(team_id, email, role) values ($1,'plan@x.org','planner'),($1,'view@x.org','viewer')`, [team]);
  await as('planner', `select public.claim_invites()`); await as('viewer', `select public.claim_invites()`);
  const r = await as('admin', `select email, user_id is not null as joined from members where team_id = $1 order by email`, [team]);
  return r.rows.length === 3 && r.rows.every((x) => x.joined);
});
await t('planner can save a plan; viewer can read it but not write, update or delete', async () => {
  await as('planner', `insert into plans(team_id, name, data) values ($1, 'P1', '{"v":1}')`, [team]);
  const read = (await as('viewer', `select name from plans where team_id = $1`, [team])).rows.length === 1;
  let ins = false; try { await as('viewer', `insert into plans(team_id, name, data) values ($1, 'X', '{}')`, [team]); } catch (e) { ins = true; }
  const upd = (await as('viewer', `update plans set name = 'hacked' returning id`)).rows.length === 0;
  const del = (await as('viewer', `delete from plans returning id`)).rows.length === 0;
  return read && ins && upd && del;
});
await t('someone outside the team sees nothing and cannot add members to it', async () => {
  const see = (await as('outsider', `select * from plans`)).rows.length + (await as('outsider', `select * from members`)).rows.length + (await as('outsider', `select * from teams`)).rows.length;
  let blocked = false; try { await as('outsider', `insert into members(team_id, email, role) values ($1, 'out@y.org', 'admin')`, [team]); } catch (e) { blocked = true; }
  return see === 0 && blocked;
});
await t('planner cannot promote themself to admin; admin can change roles', async () => {
  const self = (await as('planner', `update members set role = 'admin' where email = 'plan@x.org' returning role`)).rows.length === 0;
  const adm = (await as('admin', `update members set role = 'admin' where team_id = $1 and email = 'view@x.org' returning role`, [team])).rows[0].role === 'admin';
  await as('admin', `update members set role = 'viewer' where team_id = $1 and email = 'view@x.org'`, [team]);
  return self && adm;
});
await t('overwriting a plan keeps the previous version', async () => {
  await as('planner', `update plans set data = '{"v":1,"n":2}' where team_id = $1`, [team]);
  const v = await as('viewer', `select count(*)::int as n from plan_versions where team_id = $1`, [team]);
  return v.rows[0].n === 1;
});
await t('watch areas: planner adds, viewer reads, bad values rejected', async () => {
  await as('planner', `insert into watch_areas(team_id, name, lat, lon, radius_km) values ($1,'Gurugram',28.46,77.03,150)`, [team]);
  let bad = false; try { await as('planner', `insert into watch_areas(team_id, name, lat, lon, radius_km) values ($1,'Bad',123,0,10)`, [team]); } catch (e) { bad = true; }
  return (await as('viewer', `select * from watch_areas`)).rows.length === 1 && bad;
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
