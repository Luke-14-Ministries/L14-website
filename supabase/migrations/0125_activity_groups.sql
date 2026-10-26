-- 0125_activity_groups.sql
--
-- ACTIVITY GROUPS: rafts for white water rafting, boats for the pontoon next.
--
-- 26 October 2026, Lawrence (decided, build now). Rafting has 100+ people to
-- coordinate -- campers, their paired buddies, siblings, parents -- and staff
-- need lists. The decisions:
--   * groups are generic, for any activity; rafting is the first user;
--   * a group's size is adjustable, default 6;
--   * the outfitter needs only names (we set the boats);
--   * anyone signed up for the activity can go, and a camper's paired buddy
--     goes with them automatically (buddy_assignments). The pairing is the
--     page's business: this table holds one row per PERSON placed, and the
--     board places a camper and their buddy together;
--   * a minimum age of 8, with a flag to check with camp staff for possible
--     exceptions -- a flag, never a block.
--
-- 1. activities.min_age (nullable; 0-120). Set to 8 for every activity named
--    like "White water rafting" on a non-archived event, where nobody has set
--    one yet (idempotent: a value staff set is kept).
-- 2. admin_create_event() restated in full (0122's text) so a copied event
--    keeps each activity's minimum age. The only change is min_age in the
--    activities copy; the post-check reads the stored body back.
-- 3. activity_groups and activity_group_members. A member row carries the
--    activity_id of its group (denormalised) so that
--    unique (registration_participant_id, activity_id) can say "one group per
--    person per activity" in the database. A trigger fills activity_id from
--    the group, refuses a mismatch, refuses a person from another event, and
--    stamps placed_by / placed_at.
-- 4. RLS and grants. The area is `activities` -- 0101's mapping table:
--    "activities (write): activity_signups, and the capacity guards'
--    override", i.e. the placements; the DEFINITIONS of activities are Setup.
--    A group and who is in it are placements, so:
--      read  = has_grant('activities', 'read')
--      write = has_grant('activities', 'write')
--    No family or program-leader access: no policy names them, so they see
--    nothing. anon gets no grant at all.
--
-- Not applied to the production project; the lead applies.

-- ---------------------------------------------------------------------------
-- 1. Minimum age
-- ---------------------------------------------------------------------------
alter table public.activities
  add column if not exists min_age integer
    constraint activities_min_age_range check (min_age between 0 and 120);

comment on column public.activities.min_age is
  'Youngest age (at the start of the event) the activity takes, or null for no minimum. A FLAG on the groups board and its print sheet ("Under 8 -- check with camp staff"), never a block: camp staff may make exceptions. 0125, 26 Oct 2026.';

update public.activities a
   set min_age = 8
 where a.min_age is null
   and a.name ~* '^\s*white\s*water\s+rafting'
   and a.event_id in (select e.id from public.events e where e.archived_at is null);

-- ---------------------------------------------------------------------------
-- 2. admin_create_event(): copy min_age with the activity (0122 restated)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_event(
  p_name          text,
  p_event_type    text,
  p_starts_on     date,
  p_ends_on       date,
  p_fee_cents     integer,
  p_deposit_cents integer,
  p_capacity      integer default null,
  p_location      text    default null,
  p_copy_from     uuid    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_src   public.events%rowtype;
  v_shift integer := 0;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  if not public.has_grant('setup', 'write') then
    raise exception 'Only administrators can create events.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'An event needs a name.';
  end if;
  if p_event_type not in ('camp_week', 'retreat', 'dinner', 'other') then
    raise exception 'Unknown event type: %', p_event_type;
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'Check the dates: the last day must be on or after the first.';
  end if;
  if coalesce(p_fee_cents, -1) < 0 or coalesce(p_deposit_cents, -1) < 0 then
    raise exception 'Price and deposit must be zero or more.';
  end if;
  if p_capacity is not null and p_capacity < 0 then
    raise exception 'Capacity must be zero or more, or blank.';
  end if;

  if p_copy_from is not null then
    select * into v_src from public.events where id = p_copy_from;
    if not found then
      raise exception 'The event to copy from no longer exists.';
    end if;
    v_shift := p_starts_on - v_src.starts_on;
  end if;

  -- 1. The event. Volunteers on a camp arrive a day early (30 Sep 2026); a
  --    copy keeps its source's offset instead.
  insert into public.events (
    name, event_type, description, starts_on, ends_on, deposit_cents, location,
    capacity, published, campus_map_url, volunteer_arrives_on
  ) values (
    v_name, p_event_type,
    case when p_copy_from is not null then v_src.description end,
    p_starts_on, p_ends_on, p_deposit_cents,
    coalesce(nullif(btrim(p_location), ''), case when p_copy_from is not null then v_src.location end),
    p_capacity, false,
    case when p_copy_from is not null then v_src.campus_map_url end,
    case
      when p_event_type <> 'camp_week' then null
      when p_copy_from is not null and v_src.volunteer_arrives_on is not null
        then v_src.volunteer_arrives_on + v_shift
      else p_starts_on - 1
    end
  )
  returning id into v_id;

  -- 2. The two options every event needs.
  insert into public.event_options (event_id, name, description, participant_role, fee_cents,
                                    deposit_cents, published, sort_order)
  values
    (v_id, v_name || ' Enrollment', null, null, p_fee_cents, p_deposit_cents, true, 1),
    (v_id, 'Volunteer (second role, no extra fee)',
     'For someone already registered for this event in another role who is also volunteering. Their fee is charged once, on their first role.',
     'volunteer', 0, 0, true, 100);

  -- 3. Activities and slots (copy only), dates moved with the event.
  -- Old-id -> new-id maps live in temp tables for this transaction only.
  -- The minimum age travels with the activity (0125). Groups do not: they
  -- are people, and next year's people are different.
  if to_regclass('pg_temp._ace_activity_map') is null then
    create temp table _ace_activity_map (old_id uuid, new_id uuid) on commit drop;
  end if;
  delete from _ace_activity_map where true;  -- 0122: a bare DELETE is refused
  if p_copy_from is not null then
    insert into _ace_activity_map (old_id, new_id)
    select id, gen_random_uuid() from public.activities where event_id = p_copy_from;

    insert into public.activities (id, event_id, name, description, booking_mode, capacity,
                                   fee_cents, provider_name, provider_url, signup_opens_at,
                                   signup_closes_at, active, sort_order, min_age)
    select m.new_id, v_id, a.name, a.description, a.booking_mode, a.capacity, a.fee_cents,
           a.provider_name, a.provider_url,
           a.signup_opens_at + make_interval(days => v_shift),
           a.signup_closes_at + make_interval(days => v_shift),
           a.active, a.sort_order, a.min_age
      from public.activities a
      join _ace_activity_map m on m.old_id = a.id;

    insert into public.activity_slots (activity_id, starts_at, ends_at, capacity, label,
                                       slot_date, start_time, end_time)
    select m.new_id,
           s.starts_at + make_interval(days => v_shift),
           s.ends_at + make_interval(days => v_shift),
           s.capacity, s.label, s.slot_date + v_shift, s.start_time, s.end_time
      from public.activity_slots s
      join _ace_activity_map m on m.old_id = s.activity_id;
  end if;

  -- 4. Agreements: the source's set (activity waivers re-pointed at the new
  --    activities), or the standard household four for a blank event --
  --    always at the current active version.
  --
  --    A requirement is scoped to the event OR to one activity (0001), so an
  --    activity waiver has no event_id: it is found through the activity map,
  --    and the copied row is scoped the same way as its source (0117).
  if p_copy_from is not null then
    insert into public.agreement_requirements (agreement_id, event_id, activity_id, applies_to,
                                               is_required, due_on)
    select cur.id,
           case when r.activity_id is null then v_id end,
           m.new_id, r.applies_to, r.is_required, r.due_on + v_shift
      from public.agreement_requirements r
      join public.agreements old on old.id = r.agreement_id
      join lateral (
        select a.id from public.agreements a
         where a.key = old.key and a.active
         order by a.version desc limit 1
      ) cur on true
      left join _ace_activity_map m on m.old_id = r.activity_id
     where r.event_id = p_copy_from
        or r.activity_id in (select old_id from _ace_activity_map);
  else
    insert into public.agreement_requirements (agreement_id, event_id, applies_to, is_required)
    select distinct on (a.key) a.id, v_id, 'household', true
      from public.agreements a
     where a.active
       and a.key in ('emergency_consent', 'hold_harmless', 'event_rules', 'communication_consent')
     order by a.key, a.version desc;
  end if;

  -- 5. Rooms and cabins: camps only, copy only. Parents first, then children,
  --    through a map so each child points at its NEW parent.
  if p_copy_from is not null and p_event_type = 'camp_week' then
    if to_regclass('pg_temp._ace_lodging_map') is null then
      create temp table _ace_lodging_map (old_id uuid, new_id uuid) on commit drop;
    end if;
    delete from _ace_lodging_map where true;  -- 0122
    insert into _ace_lodging_map (old_id, new_id)
    select id, gen_random_uuid() from public.lodgings where event_id = p_copy_from;

    insert into public.lodgings (id, event_id, parent_id, name, kind, capacity, accessible,
                                 accessible_notes, notes, sort_order, active, beds,
                                 staff_capacity, schematic_url)
    select m.new_id, v_id, null, l.name, l.kind, l.capacity, l.accessible, l.accessible_notes,
           l.notes, l.sort_order, l.active, l.beds, l.staff_capacity, l.schematic_url
      from public.lodgings l
      join _ace_lodging_map m on m.old_id = l.id;

    update public.lodgings child
       set parent_id = pm.new_id
      from _ace_lodging_map cm, public.lodgings src, _ace_lodging_map pm
     where child.id = cm.new_id
       and src.id = cm.old_id
       and src.parent_id is not null
       and pm.old_id = src.parent_id;
  end if;

  return v_id;
end;
$$;

comment on function public.admin_create_event(text, text, date, date, integer, integer, integer, text, uuid) is
  'Setup write. Creates an UNPUBLISHED event with its enrollment + volunteer options and household agreements; optionally copies activities (with their minimum age, 0125), their waivers and (camps) rooms from another event, shifted to the new dates. 0083, 2 Oct 2026; activity waivers copied since 0117, 21 Oct 2026; creates again since 0122, 22 Oct 2026.';

revoke execute on function public.admin_create_event(text, text, date, date, integer, integer, integer, text, uuid) from public, anon;
grant execute on function public.admin_create_event(text, text, date, date, integer, integer, integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The tables
-- ---------------------------------------------------------------------------
create table if not exists public.activity_groups (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  capacity    integer not null default 6 check (capacity > 0),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  -- Two rafts both called "Raft 3" make every list ambiguous.
  constraint activity_groups_name_unique unique (activity_id, name)
);

create index if not exists activity_groups_activity_idx
  on public.activity_groups (activity_id, sort_order);

comment on table public.activity_groups is
  'A group within one activity -- a raft, a pontoon boat. Capacity is a WARNING on the board (over is allowed, shown red), default 6. Activities read / write (0125).';

create table if not exists public.activity_group_members (
  id                          uuid primary key default gen_random_uuid(),
  group_id                    uuid not null references public.activity_groups (id) on delete cascade,
  -- The group's activity, copied by trigger, so the unique constraint below
  -- can say "one group per person per activity".
  activity_id                 uuid not null references public.activities (id) on delete cascade,
  registration_participant_id uuid not null
                                references public.registration_participants (id) on delete cascade,
  placed_by                   uuid references public.profiles (id) on delete set null,
  placed_at                   timestamptz not null default now(),
  constraint activity_group_members_one_group unique (registration_participant_id, activity_id)
);

create index if not exists activity_group_members_group_idx
  on public.activity_group_members (group_id);
create index if not exists activity_group_members_activity_idx
  on public.activity_group_members (activity_id);

comment on table public.activity_group_members is
  'One row per PERSON placed in an activity group. A camper and their paired buddy are two rows the board writes together; the database knows nothing of pairings. activity_id is the group''s, kept by trigger. Activities read / write (0125).';

-- The trigger: activity_id follows the group (filled when missing, refused
-- when different), the person must be on the activity's event, and the
-- placement is stamped. SECURITY DEFINER so the lookups do not depend on the
-- caller's reads; it decides nothing about WHO is calling (the policies do
-- that), so 0105's lesson about current_user in a definer trigger does not
-- bite here.
create or replace function public.activity_group_members_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity uuid;
  v_event    uuid;
begin
  select g.activity_id, a.event_id into v_activity, v_event
    from public.activity_groups g
    join public.activities a on a.id = g.activity_id
   where g.id = new.group_id;
  if v_activity is null then
    raise exception 'That group no longer exists.' using errcode = '23503';
  end if;

  if new.activity_id is null then
    new.activity_id := v_activity;
  elsif new.activity_id <> v_activity then
    raise exception 'That group belongs to a different activity.' using errcode = '23514';
  end if;

  if not exists (
    select 1
      from public.registration_participants rp
      join public.registrations r on r.id = rp.registration_id
     where rp.id = new.registration_participant_id
       and r.event_id = v_event
  ) then
    raise exception 'That person is not registered for this activity''s event.' using errcode = '23514';
  end if;

  new.placed_at := now();
  new.placed_by := (select auth.uid());
  return new;
end;
$$;

revoke execute on function public.activity_group_members_fill() from public, anon, authenticated;

drop trigger if exists activity_group_members_fill on public.activity_group_members;
create trigger activity_group_members_fill
  before insert or update on public.activity_group_members
  for each row execute function public.activity_group_members_fill();

-- ---------------------------------------------------------------------------
-- 4. RLS and grants (the area is `activities`, 0101)
-- ---------------------------------------------------------------------------
alter table public.activity_groups        enable row level security;
alter table public.activity_group_members enable row level security;

revoke all on public.activity_groups, public.activity_group_members from public, anon;
grant select, insert, update, delete
  on public.activity_groups, public.activity_group_members to authenticated;

drop policy if exists activity_groups_select on public.activity_groups;
create policy activity_groups_select on public.activity_groups
  for select to authenticated using (public.has_grant('activities', 'read'));
drop policy if exists activity_groups_insert on public.activity_groups;
create policy activity_groups_insert on public.activity_groups
  for insert to authenticated with check (public.has_grant('activities', 'write'));
drop policy if exists activity_groups_update on public.activity_groups;
create policy activity_groups_update on public.activity_groups
  for update to authenticated
  using (public.has_grant('activities', 'write')) with check (public.has_grant('activities', 'write'));
drop policy if exists activity_groups_delete on public.activity_groups;
create policy activity_groups_delete on public.activity_groups
  for delete to authenticated using (public.has_grant('activities', 'write'));

drop policy if exists activity_group_members_select on public.activity_group_members;
create policy activity_group_members_select on public.activity_group_members
  for select to authenticated using (public.has_grant('activities', 'read'));
drop policy if exists activity_group_members_insert on public.activity_group_members;
create policy activity_group_members_insert on public.activity_group_members
  for insert to authenticated with check (public.has_grant('activities', 'write'));
drop policy if exists activity_group_members_update on public.activity_group_members;
create policy activity_group_members_update on public.activity_group_members
  for update to authenticated
  using (public.has_grant('activities', 'write')) with check (public.has_grant('activities', 'write'));
drop policy if exists activity_group_members_delete on public.activity_group_members;
create policy activity_group_members_delete on public.activity_group_members
  for delete to authenticated using (public.has_grant('activities', 'write'));

-- ---------------------------------------------------------------------------
-- 5. Post-checks
-- ---------------------------------------------------------------------------
do $$
declare
  def text := pg_get_functiondef('public.admin_create_event(text, text, date, date, integer, integer, integer, text, uuid)'::regprocedure);
  n   int;
begin
  -- admin_create_event: the 0125 change took, and nothing 0117/0122 fixed was lost.
  if position('a.active, a.sort_order, a.min_age' in def) = 0 then
    raise exception '0125: admin_create_event does not copy min_age';
  end if;
  if position('delete from _ace_activity_map where true' in def) = 0
     or position('delete from _ace_lodging_map where true' in def) = 0 then
    raise exception '0125: admin_create_event empties a map with a bare DELETE again';
  end if;
  if position('or r.activity_id in (select old_id from _ace_activity_map)' in def) = 0 then
    raise exception '0125: admin_create_event lost 0117''s activity-waiver copy';
  end if;
  if position('public.has_grant(''setup'', ''write'')' in def) = 0 then
    raise exception '0125: admin_create_event lost the Setup-write check';
  end if;

  -- Rafting on a current event has its minimum age.
  select count(*) into n
    from public.activities a join public.events e on e.id = a.event_id
   where e.archived_at is null
     and a.name ~* '^\s*white\s*water\s+rafting'
     and a.min_age is null;
  if n > 0 then
    raise exception '0125: % rafting activit(ies) on a current event still have no minimum age', n;
  end if;

  -- RLS on, and exactly the eight policies, each asking the activities grant.
  if exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
              where s.nspname = 'public'
                and c.relname in ('activity_groups', 'activity_group_members')
                and not c.relrowsecurity) then
    raise exception '0125: RLS is not enabled on an activity group table';
  end if;
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and tablename in ('activity_groups', 'activity_group_members')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'has_grant\(''activities'''
     and not ((coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_staff|my_household|leads_program');
  if n <> 8 then
    raise exception '0125: expected 8 activities-grant policies on the group tables, found %', n;
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public'
                and table_name in ('activity_groups', 'activity_group_members')
                and grantee = 'anon') then
    raise exception '0125: anon holds a grant on an activity group table';
  end if;
end;
$$;
