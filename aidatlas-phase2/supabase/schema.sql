-- AidAtlas shared workspace: run once in Supabase → SQL editor. Safe to re-run.
-- Roles: viewer (read), planner (read + change/save plans, watch areas), admin (planner + team management),
--        field (field-app teams: send field reports and photos; read the team's field reports).
-- Every table has row-level security, so the roles are enforced by the database, not the browser.

-- gen_random_uuid() is built into PostgreSQL 13+ (Supabase), no extension needed.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,      -- null until the invited person signs in
  email text not null,
  name text default '',
  role text not null default 'viewer' check (role in ('viewer', 'planner', 'admin', 'field')),
  created_at timestamptz not null default now(),
  primary key (team_id, email)
);
create index if not exists members_user on public.members(user_id);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  data jsonb not null,                -- full plan snapshot incl. decision log (ENG.snapshot)
  summary jsonb,
  saved_by text,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create index if not exists plans_team on public.plans(team_id, updated_at desc);

create table if not exists public.plan_versions (           -- every save keeps the previous version
  id bigserial primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  team_id uuid not null,
  data jsonb not null,
  saved_by text,
  saved_at timestamptz not null
);

create table if not exists public.watch_areas (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  radius_km double precision not null default 100 check (radius_km between 5 and 1000),
  hazards text[] not null default array['EQ','TC','FL','VO','DR','WF'],
  min_level text not null default 'Orange' check (min_level in ('Green','Orange','Red')),
  email text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- role of the signed-in user in a team (security definer avoids recursive RLS on members)
create or replace function public.role_in(t uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where team_id = t and user_id = auth.uid()
$$;

-- invited e-mail signs in → attach the account to its invitations
create or replace function public.claim_invites() returns void
language sql security definer set search_path = public as $$
  update public.members set user_id = auth.uid()
  where user_id is null and lower(email) = lower(auth.jwt() ->> 'email');
$$;

-- any signed-in user can start a team and becomes its admin
create or replace function public.create_team(team_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into public.teams(name) values (team_name) returning id into t;
  insert into public.members(team_id, user_id, email, role) values (t, auth.uid(), lower(auth.jwt() ->> 'email'), 'admin');
  return t;
end $$;

-- keep the old copy whenever a plan is overwritten
create or replace function public.keep_plan_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.plan_versions(plan_id, team_id, data, saved_by, saved_at) values (old.id, old.team_id, old.data, old.saved_by, old.updated_at);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists plans_version on public.plans;
create trigger plans_version before update on public.plans for each row execute function public.keep_plan_version();

alter table public.teams enable row level security;
alter table public.members enable row level security;
alter table public.plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.watch_areas enable row level security;

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select using (public.role_in(id) is not null);
drop policy if exists teams_admin on public.teams;
create policy teams_admin on public.teams for update using (public.role_in(id) = 'admin');

drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (public.role_in(team_id) is not null or user_id = auth.uid());
drop policy if exists members_admin_ins on public.members;
create policy members_admin_ins on public.members for insert with check (public.role_in(team_id) = 'admin');
drop policy if exists members_admin_upd on public.members;
create policy members_admin_upd on public.members for update using (public.role_in(team_id) = 'admin');
drop policy if exists members_admin_del on public.members;
create policy members_admin_del on public.members for delete using (public.role_in(team_id) = 'admin');

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (public.role_in(team_id) is not null);
drop policy if exists plans_write on public.plans;
create policy plans_write on public.plans for insert with check (public.role_in(team_id) in ('planner', 'admin'));
drop policy if exists plans_update on public.plans;
create policy plans_update on public.plans for update using (public.role_in(team_id) in ('planner', 'admin'));
drop policy if exists plans_delete on public.plans;
create policy plans_delete on public.plans for delete using (public.role_in(team_id) in ('planner', 'admin'));

drop policy if exists versions_read on public.plan_versions;
create policy versions_read on public.plan_versions for select using (public.role_in(team_id) is not null);

drop policy if exists watch_read on public.watch_areas;
create policy watch_read on public.watch_areas for select using (public.role_in(team_id) is not null);
drop policy if exists watch_write on public.watch_areas;
create policy watch_write on public.watch_areas for insert with check (public.role_in(team_id) in ('planner', 'admin'));
drop policy if exists watch_delete on public.watch_areas;
create policy watch_delete on public.watch_areas for delete using (public.role_in(team_id) in ('planner', 'admin'));

-- Phase 2: older installs had a role check without 'field'; replace it (safe to re-run)
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('viewer', 'planner', 'admin', 'field'));

-- Phase 2: field reports from the field app (field.html). id is made on the phone so a retried upload never duplicates.
create table if not exists public.field_reports (
  id text primary key check (char_length(id) between 4 and 40),
  team_id uuid not null references public.teams(id) on delete cascade,
  at timestamptz not null default now(),          -- when the team saw it
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  acc_m integer,                                  -- GPS accuracy in metres
  damage real not null check (damage between 0 and 1),
  needs text[] not null default '{}',
  people jsonb,                                   -- {affected, injured, trapped}
  road text not null default 'open' check (road in ('open', 'partly', 'blocked')),
  note text check (char_length(note) <= 500),
  by_name text, team_name text, trained boolean not null default false, place text, plan text,
  photo_path text,                                -- storage: field-photos/<team_id>/<id>.jpg
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists field_reports_team on public.field_reports(team_id, at desc);
alter table public.field_reports enable row level security;
drop policy if exists field_read on public.field_reports;
create policy field_read on public.field_reports for select using (public.role_in(team_id) is not null);
drop policy if exists field_insert on public.field_reports;
create policy field_insert on public.field_reports for insert with check (public.role_in(team_id) in ('field', 'planner', 'admin'));
drop policy if exists field_update_own on public.field_reports;
create policy field_update_own on public.field_reports for update using (created_by = auth.uid() and public.role_in(team_id) in ('field', 'planner', 'admin'));
drop policy if exists field_delete on public.field_reports;
create policy field_delete on public.field_reports for delete using (public.role_in(team_id) in ('planner', 'admin'));

-- Phase 2: private photo bucket; the first folder of every path is the team id
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('field-photos', 'field-photos', false) on conflict (id) do nothing;
    execute 'drop policy if exists field_photos_read on storage.objects';
    execute $p$create policy field_photos_read on storage.objects for select using (bucket_id = 'field-photos' and public.role_in(((storage.foldername(name))[1])::uuid) is not null)$p$;
    execute 'drop policy if exists field_photos_write on storage.objects';
    execute $p$create policy field_photos_write on storage.objects for insert with check (bucket_id = 'field-photos' and public.role_in(((storage.foldername(name))[1])::uuid) in ('field', 'planner', 'admin'))$p$;
    execute 'drop policy if exists field_photos_update on storage.objects';
    execute $p$create policy field_photos_update on storage.objects for update using (bucket_id = 'field-photos' and public.role_in(((storage.foldername(name))[1])::uuid) in ('field', 'planner', 'admin'))$p$;
  end if;
end $$;

grant execute on function public.claim_invites() to authenticated;
grant execute on function public.create_team(text) to authenticated;
