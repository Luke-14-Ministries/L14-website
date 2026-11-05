-- 0153 -- An activity says whether it splits into groups, what they are called and how big (4 Nov 2026)
--
-- Lawrence, 4 Nov 2026, on Activities' "Add an activity" card: it "has
-- sensible choices ... but not obvious that it could be used to re-create the
-- current list" -- "groups/boats for pontoons and rafting was the main
-- question". Until now the groups board (0125) was offered on EVERY activity,
-- and what a group was called was guessed from the name: "raft" in it meant
-- Rafts, anything else Groups -- so the pontoon's boats were "Groups", and an
-- activity renamed without the word lost its rafts. Each new group was six.
--
-- Now it is a setting on the activity, in the editor and the Add card:
--   group_label  the name of ONE group ("Raft", "Boat", "Table"); null means
--                the activity is not split into groups, and no board is offered.
--   group_size   how many go in one, the size each new group starts at (the
--                board's warning, never a lock, 0125); null means 6.
-- Today's activities are set from what the guess gave them: anything with
-- "raft" in the name is Rafts of 6, a pontoon is Boats, and any activity that
-- already has groups keeps its board as "Group".
--
-- admin_create_event() copies the two settings to a new event's activities
-- (restated in full below; the only change is the two columns).

alter table public.activities
  add column if not exists group_label text,
  add column if not exists group_size integer;

alter table public.activities
  drop constraint if exists activities_group_size_check;
alter table public.activities
  add constraint activities_group_size_check check (group_size is null or group_size between 1 and 500);

update public.activities set group_label = 'Raft', group_size = coalesce(group_size, 6)
 where group_label is null and name ~* '\mraft';
update public.activities set group_label = 'Boat'
 where group_label is null and name ~* '\mpontoon';
update public.activities a set group_label = 'Group'
 where a.group_label is null
   and exists (select 1 from public.activity_groups g where g.activity_id = a.id);

create or replace function public.admin_create_event(p_name text, p_event_type text, p_starts_on date, p_ends_on date, p_fee_cents integer, p_deposit_cents integer, p_capacity integer DEFAULT NULL::integer, p_location text DEFAULT NULL::text, p_copy_from uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into public.event_options (event_id, name, description, participant_role, fee_cents,
                                    deposit_cents, published, sort_order)
  values
    (v_id, v_name || ' Enrollment', null, null, p_fee_cents, p_deposit_cents, true, 1),
    (v_id, 'Volunteer (second role, no extra fee)',
     'For someone already registered for this event in another role who is also volunteering. Their fee is charged once, on their first role.',
     'volunteer', 0, 0, true, 100);

  if to_regclass('pg_temp._ace_activity_map') is null then
    create temp table _ace_activity_map (old_id uuid, new_id uuid) on commit drop;
  end if;
  delete from _ace_activity_map where true;  -- 0122: a bare DELETE is refused
  if p_copy_from is not null then
    insert into _ace_activity_map (old_id, new_id)
    select id, gen_random_uuid() from public.activities where event_id = p_copy_from;

    -- 0153: group_label and group_size come along.
    insert into public.activities (id, event_id, name, description, booking_mode, capacity,
                                   fee_cents, provider_name, provider_url, signup_opens_at,
                                   signup_closes_at, active, sort_order, min_age,
                                   group_label, group_size)
    select m.new_id, v_id, a.name, a.description, a.booking_mode, a.capacity, a.fee_cents,
           a.provider_name, a.provider_url,
           a.signup_opens_at + make_interval(days => v_shift),
           a.signup_closes_at + make_interval(days => v_shift),
           a.active, a.sort_order, a.min_age,
           a.group_label, a.group_size
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
$function$;

-- The rewrite took (CLAUDE.md: check a function restated in place).
do $$
begin
  if position('a.group_label, a.group_size' in pg_get_functiondef('public.admin_create_event'::regproc)) = 0 then
    raise exception '0153: admin_create_event was not restated';
  end if;
end;
$$;
