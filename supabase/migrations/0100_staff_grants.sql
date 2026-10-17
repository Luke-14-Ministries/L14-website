-- 0100_staff_grants.sql
--
-- THE GRANTS MODEL, STEP 1 (Luke14-Access-Model-Plan, 15-16 Oct 2026; build
-- plan item 16): add the read/write grants and keep the roles.
--
-- Today staff access is one role (registrar / coordinator / admin) plus three
-- tick boxes. The plan replaces "which role?" with "which areas, read or
-- write?" -- ten areas, each read or write, and a role becomes a PRESET an
-- administrator applies and then adjusts. This migration adds the record of
-- those grants and fills it in from each person's current role and ticks, so
-- nobody loses anything the day it lands. The role column stays, and still
-- decides what the database allows: the ~100 row-level rules and ~90 page
-- checks that ask is_registrar() / is_coordinator() / is_admin() are switched
-- over one area at a time in step 3, each verified by the test harness.
-- has_grant() below is what they will switch to.
--
-- Every change to a grant is written to staff_access_log (0058) by trigger,
-- with who did it and whether that was the holder themselves -- the same log
-- the three tick boxes already use, under the field 'grant:<area>'. The
-- backfill runs BEFORE the trigger exists, so the log does not fill with ten
-- rows per person "granted" by nobody.

create table if not exists public.staff_grants (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  area        text not null check (area in (
                'registration', 'payments', 'giving', 'background_checks', 'sensitive',
                'setup', 'activities', 'rooming', 'buddies', 'programs')),
  level       text not null check (level in ('read', 'write')),
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (profile_id, area)
);

comment on table public.staff_grants is
  'The grants model (0100): one row per staff member per area they may reach, read or write. Absent = no access. Presets on Staff & Access set these; every change is logged to staff_access_log as grant:<area>.';

alter table public.staff_grants enable row level security;

-- A staff member reads their own grants (lib/staff.js loads them with the
-- staff row); administrators read and write everyone's. The grant to
-- authenticated is what RLS-without-grant forgets (CLAUDE.md, working rules).
drop policy if exists staff_grants_read on public.staff_grants;
create policy staff_grants_read on public.staff_grants
  for select using (profile_id = (select auth.uid()) or public.is_admin());
drop policy if exists staff_grants_admin_write on public.staff_grants;
create policy staff_grants_admin_write on public.staff_grants
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.staff_grants to authenticated;

-- The one question the rules will ask: does the caller hold this area at
-- this level? Read is satisfied by read or write; write only by write. An
-- inactive staff row holds nothing, whatever rows it has.
create or replace function public.has_grant(p_area text, p_level text default 'read')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    join public.staff_grants g on g.profile_id = s.profile_id
    where s.profile_id = (select auth.uid())
      and s.active
      and g.area = p_area
      and (p_level = 'read' or g.level = 'write')
  );
$$;
grant execute on function public.has_grant(text, text) to authenticated;

-- Backfill: what each person can do TODAY, written as grants. Faithful, not
-- aspirational -- an administrator without the Sensitive tick stays without
-- it (protection for the room, 21 Aug); everyone on staff reads background
-- checks' three facts (0091); registrars and coordinators each read what the
-- other writes, which is how the staff policies already behave.
insert into public.staff_grants (profile_id, area, level, granted_by)
select s.profile_id, x.area, x.level, null
from public.staff s
cross join lateral (
  values
    ('registration',      case when s.role in ('admin', 'registrar') then 'write' else 'read' end),
    ('payments',          case when s.role in ('admin', 'registrar') then 'write' else null end),
    ('giving',            case when s.can_view_giving then 'write' else null end),
    ('background_checks', case when s.can_view_background_checks then 'write' else 'read' end),
    ('sensitive',         case when s.can_view_sensitive then 'write' else null end),
    ('setup',             case when s.role = 'admin' then 'write' else null end),
    ('activities',        case when s.role in ('admin', 'coordinator') then 'write' else 'read' end),
    ('rooming',           case when s.role in ('admin', 'coordinator') then 'write' else 'read' end),
    ('buddies',           case when s.role in ('admin', 'coordinator') then 'write' else 'read' end),
    ('programs',          case when s.role in ('admin', 'coordinator') then 'write' else 'read' end)
) as x(area, level)
where x.level is not null
on conflict (profile_id, area) do nothing;

-- The log, from here on.
create or replace function public.log_staff_grant_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := (select auth.uid());
  v_profile uuid := coalesce(new.profile_id, old.profile_id);
  v_area    text := coalesce(new.area, old.area);
begin
  if tg_op = 'UPDATE' and new.level = old.level then
    return new;
  end if;
  insert into public.staff_access_log
    (staff_profile_id, field, old_value, new_value, changed_by, changed_by_self)
  values (
    v_profile,
    'grant:' || v_area,
    case when tg_op = 'INSERT' then null else old.level end,
    case when tg_op = 'DELETE' then null else new.level end,
    v_actor,
    v_actor is not null and v_actor = v_profile
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_grants_logged on public.staff_grants;
create trigger staff_grants_logged
  after insert or update or delete on public.staff_grants
  for each row execute function public.log_staff_grant_change();
