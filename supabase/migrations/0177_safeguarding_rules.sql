-- 0177 -- Safeguarding rules in the database (security review, 23 Nov 2026)
--
-- The review found that several safeguarding rules lived only in the pages,
-- or could be stepped around from a family account:
--
--   1. "Not permitted" (0162) held one people row. A second row with the same
--      name and date of birth (another household, or a fresh entry) started
--      clean. person_not_permitted() now also holds a person whose name and
--      date of birth match someone marked not_permitted, until staff decide
--      THIS record (a verdict on its own row recorded after that one).
--   2. A family could delete a person who has a background check or a
--      VolunteerBadge invite on file, and the cascade took the record (and a
--      Not permitted verdict) with it. Refused now; the office removes them.
--   3. A family could change a registered or screened person's date of birth
--      (the wizard re-sends it; the household page only checked in the
--      browser's server action). The date of birth decides who is screened,
--      so once a person is registered or has a check on file it is the
--      office's to correct. Filling in a missing date stays allowed.
--   4. person_not_permitted(), volunteer_clearance_ok() and
--      volunteer_not_cleared_message() were callable by any signed-in family
--      as a yes/no oracle on anyone's background check. Staff only now (the
--      guards that call them from a trigger are unaffected).
--   5. activity_signups had no family-side guard in the database: a family
--      could sign a person up for another event's activity, outside the
--      sign-up window, on a cancelled place, or stamp the row as added by
--      staff. guard_activity_signup_family() enforces the page's rules.
--   6. A family insert into registration_participants did not check the
--      option or event was published (RLS happened to hide them); stated.
--
-- Lawrence's open questions, decided for now and flagged for review:
--   * a family cannot change a date of birth once registered or screened;
--   * Not permitted holds a same-name, same-birthday record until decided;
--   * adding a person to an existing registration after registration closes
--     is still allowed (as the wizard allows); only "published and not
--     archived" is enforced;
--   * an activity's minimum age is not enforced on family sign-ups.

-- ---------------------------------------------------------------------------
-- 0. Who is asking? One rule for the definer helpers below.
-- ---------------------------------------------------------------------------
-- A definer function sees current_user as its owner, so it cannot ask
-- "is this a family?" the way the invoker guards do. The role GUC still
-- says what PostgREST set (authenticated / anon / service_role); 'none' is
-- a direct connection (migrations, the harness, pg_cron). Inside a trigger
-- the guard that called us has already decided who may act, so a family's
-- own write that reaches a guard still gets its yes/no.
create or replace function public.api_caller_not_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
     and pg_trigger_depth() = 0
     and not public.is_staff();
$$;
comment on function public.api_caller_not_staff() is
  'True for a signed-in or signed-out API caller who is not staff, outside a trigger (0177). The background-check helpers refuse them.';
revoke all on function public.api_caller_not_staff() from public, anon, authenticated;
grant execute on function public.api_caller_not_staff() to service_role;

-- ---------------------------------------------------------------------------
-- 1. Not permitted: why, and the same name and birth date
-- ---------------------------------------------------------------------------
-- 'own'           -- this person's own check or search is marked not_permitted
-- 'same_name_dob' -- another people row with the same first and last name
--                    (trimmed, any case) and the same date of birth is marked
--                    not_permitted, and this record has no verdict of its own
--                    recorded after that one
-- null            -- neither
create or replace function public.not_permitted_reason(p_person_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_own    text;
  v_own_at timestamptz;
  v_first  text;
  v_last   text;
  v_dob    date;
begin
  if public.api_caller_not_staff() then
    raise exception 'Only staff can read background check results.' using errcode = '42501';
  end if;

  select c.verdict, c.verdict_at into v_own, v_own_at
    from public.person_clearances c where c.person_id = p_person_id;
  if v_own = 'not_permitted' then
    return 'own';
  end if;

  select lower(btrim(p.first_name)), lower(btrim(p.last_name)), p.date_of_birth
    into v_first, v_last, v_dob
    from public.people p where p.id = p_person_id;
  if v_dob is null or coalesce(v_first, '') = '' or coalesce(v_last, '') = '' then
    return null;
  end if;

  if exists (
    select 1
      from public.person_clearances oc
      join public.people o on o.id = oc.person_id
     where oc.verdict = 'not_permitted'
       and o.id <> p_person_id
       and o.date_of_birth = v_dob
       and lower(btrim(o.first_name)) = v_first
       and lower(btrim(o.last_name)) = v_last
       -- Staff decided THIS record after the other was marked: their call.
       and not (v_own is not null
                and coalesce(v_own_at, '-infinity'::timestamptz) > coalesce(oc.verdict_at, '-infinity'::timestamptz))
  ) then
    return 'same_name_dob';
  end if;
  return null;
end;
$$;
comment on function public.not_permitted_reason(uuid) is
  'own | same_name_dob | null: why a person is held as Not permitted (0177). Staff only from the API.';
revoke all on function public.not_permitted_reason(uuid) from public, anon;
grant execute on function public.not_permitted_reason(uuid) to authenticated, service_role;

-- 0162's yes/no, restated: now also the same name and birth date.
create or replace function public.person_not_permitted(p_person_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.api_caller_not_staff() then
    raise exception 'Only staff can read background check results.' using errcode = '42501';
  end if;
  return public.not_permitted_reason(p_person_id) is not null;
end;
$$;
revoke all on function public.person_not_permitted(uuid) from public, anon;
grant execute on function public.person_not_permitted(uuid) to authenticated, service_role;

-- For the Review card and the Volunteers page: which of these people are held
-- only because of a same-name, same-birthday record. One call per page.
create or replace function public.not_permitted_name_matches(p_person_ids uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.api_caller_not_staff() then
    raise exception 'Only staff can read background check results.' using errcode = '42501';
  end if;
  return query
    select x.id
      from unnest(coalesce(p_person_ids, '{}'::uuid[])) as x(id)
     where public.not_permitted_reason(x.id) = 'same_name_dob';
end;
$$;
revoke all on function public.not_permitted_name_matches(uuid[]) from public, anon;
grant execute on function public.not_permitted_name_matches(uuid[]) to authenticated, service_role;

-- 0162's guard restated: the same hold, and the words say which reason.
create or replace function public.guard_not_permitted_place()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name   text;
  v_reason text;
begin
  if new.status = 'confirmed'
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    v_reason := public.not_permitted_reason(new.person_id);
    if v_reason is not null then
      select coalesce(nullif(btrim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'This person')
        into v_name from public.people p where p.id = new.person_id;
      if v_reason = 'own' then
        raise exception '% can''t be approved: their background check or registry search is marked Not permitted to attend.',
          coalesce(v_name, 'This person')
          using errcode = 'P0001';
      end if;
      raise exception '% can''t be approved: same name and birth date as someone marked Not permitted to attend. Record a decision for this person on Background Checks first.',
        coalesce(v_name, 'This person')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The volunteer gate's helpers: staff only from the API
-- ---------------------------------------------------------------------------
-- 0161's volunteer_clearance_ok() restated in plpgsql for the caller check;
-- the rule itself is unchanged (under 18 on the day, or a current full check
-- marked OK; a registry search never clears a volunteer).
create or replace function public.volunteer_clearance_ok(p_person_id uuid, p_on date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.api_caller_not_staff() then
    raise exception 'Only staff can read background check results.' using errcode = '42501';
  end if;
  return
    coalesce(
      (select p.date_of_birth is not null
              and p.date_of_birth > (coalesce(p_on, current_date) - interval '18 years')::date
         from public.people p where p.id = p_person_id),
      false)
    or exists (
      select 1 from public.person_clearances c
       where c.person_id = p_person_id
         and c.background_check_on_file
         and (c.expires_on is null or c.expires_on >= current_date)
         and c.verdict = 'ok'
         and c.provider is distinct from 'registry_search'
    );
end;
$$;
revoke all on function public.volunteer_clearance_ok(uuid, date) from public, anon;
grant execute on function public.volunteer_clearance_ok(uuid, date) to authenticated, service_role;

-- Null for a family caller (the guards coalesce it to a plain sentence).
create or replace function public.volunteer_not_cleared_message(p_person_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.api_caller_not_staff() then
    return null;
  end if;
  return (
    select coalesce(nullif(btrim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'This volunteer')
           || ' cannot be approved yet: no background check on file marked OK to serve. Record it on Volunteers first.'
      from public.people p where p.id = p_person_id
  );
end;
$$;
revoke all on function public.volunteer_not_cleared_message(uuid) from public, anon;
grant execute on function public.volunteer_not_cleared_message(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Records a family can't remove or rewrite
-- ---------------------------------------------------------------------------
-- A background check or a VolunteerBadge invite on file. Definer: a family
-- can't read either table. Answers only for a person in the caller's own
-- household, or for staff (false otherwise, so it says nothing about anyone
-- else's family).
create or replace function public.person_screening_on_file(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
          or public.is_staff()
          or exists (select 1 from public.people p
                      where p.id = p_person_id
                        and p.household_id in (select public.my_household_ids())))
     and (exists (select 1 from public.person_clearances c where c.person_id = p_person_id)
          or exists (select 1 from public.volunteerbadge_requests v where v.person_id = p_person_id));
$$;
comment on function public.person_screening_on_file(uuid) is
  'A background check or VolunteerBadge invite is on file for this person (0177). Own household or staff only.';
revoke all on function public.person_screening_on_file(uuid) from public, anon;
grant execute on function public.person_screening_on_file(uuid) to authenticated, service_role;

-- The date of birth is the office's to correct once the person has a check
-- or invite on file, or a submitted, confirmed or waitlisted place at an
-- event that isn't archived. Manage Household reads it to grey out the box.
create or replace function public.person_dob_locked(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.person_screening_on_file(p_person_id)
      or ((coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
           or public.is_staff()
           or exists (select 1 from public.people p
                       where p.id = p_person_id
                         and p.household_id in (select public.my_household_ids())))
          and exists (
            select 1
              from public.registration_participants rp
              join public.registrations r on r.id = rp.registration_id
              join public.events e on e.id = r.event_id
             where rp.person_id = p_person_id
               and rp.status in ('submitted', 'confirmed', 'waitlisted')
               and e.archived_at is null));
$$;
comment on function public.person_dob_locked(uuid) is
  'A family may no longer change this person''s date of birth (0177). Own household or staff only.';
revoke all on function public.person_dob_locked(uuid) from public, anon;
grant execute on function public.person_dob_locked(uuid) to authenticated, service_role;

-- 0105's guard restated in full; the people branch gains the date of birth.
create or replace function public.guard_family_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.has_grant('registration', 'write') then
    return new;
  end if;
  if tg_table_name = 'people' then
    if new.profile_id is not null and new.profile_id <> (select auth.uid())
       and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id) then
      raise exception 'A person can only be linked to your own login.' using errcode = '42501';
    end if;
    -- 0177: changing (or blanking) a known date of birth once registered or
    -- screened. Filling in a missing one is still the family's.
    if tg_op = 'UPDATE'
       and old.date_of_birth is not null
       and new.date_of_birth is distinct from old.date_of_birth
       and public.person_dob_locked(old.id) then
      raise exception 'To correct a date of birth after registering, email registration@luke14ministries.net.'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'households' then
    if new.primary_contact_person_id is not null
       and (tg_op = 'INSERT' or new.primary_contact_person_id is distinct from old.primary_contact_person_id)
       and not exists (select 1 from public.people p
                        where p.id = new.primary_contact_person_id and p.household_id = new.id) then
      raise exception 'The primary contact must be someone in this household.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- A family can't delete a person whose background check or invite is on
-- file: the cascade would take the record with it. Invoker (CLAUDE.md: a
-- definer trigger can't tell who is calling); returns old, never new.
create or replace function public.guard_people_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or public.has_grant('registration', 'write') then
    return old;
  end if;
  if public.person_screening_on_file(old.id) then
    raise exception 'Ask the office to remove this person.' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists people_delete_guard on public.people;
create trigger people_delete_guard
  before delete on public.people
  for each row execute function public.guard_people_delete();

-- ---------------------------------------------------------------------------
-- 4. Activity sign-ups from a family account
-- ---------------------------------------------------------------------------
-- The rules setActivityChoice() checks, held by the database too. Skipped
-- for staff with Activities write and for non-API roles. min_age is left out
-- on purpose: the family page only shows it today (open question).
create or replace function public.guard_activity_signup_family()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_act  record;
  v_part record;
begin
  if current_user not in ('authenticated', 'anon') or public.has_grant('activities', 'write') then
    return new;
  end if;

  select rp.status, r.event_id into v_part
    from public.registration_participants rp
    join public.registrations r on r.id = rp.registration_id
   where rp.id = new.registration_participant_id;
  if not found then
    raise exception 'That person is not on one of your registrations.' using errcode = '42501';
  end if;

  -- RLS shows a family only active activities at published events.
  select a.event_id, a.active, a.signup_opens_at, a.signup_closes_at into v_act
    from public.activities a where a.id = new.activity_id;
  if not found then
    raise exception 'That activity is not open at the moment.' using errcode = '42501';
  end if;
  if v_act.event_id is distinct from v_part.event_id then
    raise exception 'That activity is not part of this person''s event.' using errcode = '42501';
  end if;

  -- Giving a place back is always allowed; taking or keeping one is not,
  -- outside these.
  if new.status <> 'cancelled' then
    if not v_act.active then
      raise exception 'That activity is not open at the moment.' using errcode = '42501';
    end if;
    if v_act.signup_opens_at is not null and v_act.signup_opens_at > now() then
      raise exception 'Sign-ups for this one have not opened yet.' using errcode = '42501';
    end if;
    if v_act.signup_closes_at is not null and v_act.signup_closes_at < now() then
      raise exception 'Sign-ups for this one have closed. Please ask camp staff.' using errcode = '42501';
    end if;
    if v_part.status = 'cancelled' then
      raise exception 'That person''s place at camp is cancelled.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.added_source := 'family';
    new.added_by := (select auth.uid());
    -- The outside provider's acknowledgement is stamped by the database.
    if new.waiver_acknowledged_at is not null then
      new.waiver_acknowledged_at := now();
    end if;
  else
    new.added_source := old.added_source;
    new.added_by := old.added_by;
    if new.waiver_acknowledged_at is not null
       and new.waiver_acknowledged_at is distinct from old.waiver_acknowledged_at then
      new.waiver_acknowledged_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists activity_signups_family_guard on public.activity_signups;
create trigger activity_signups_family_guard
  before insert or update on public.activity_signups
  for each row execute function public.guard_activity_signup_family();

-- ---------------------------------------------------------------------------
-- 5. A family's new place: a published option at a published, open event
-- ---------------------------------------------------------------------------
-- 0114's guard_participant_money() restated in full; only the INSERT
-- branch's option and event checks are new.
create or replace function public.guard_participant_money()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_opt record;
  v_ev  record;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Staff with Payments write or Registration write move status, check-in and
  -- program through their own paths; the money is no longer on this row.
  if public.has_grant('payments', 'write') or public.has_grant('registration', 'write') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- F8: the person must belong to the registration's household.
    if not exists (
      select 1 from public.people p
        join public.registrations r on r.household_id = p.household_id
       where p.id = new.person_id and r.id = new.registration_id
    ) then
      raise exception 'That person is not in this household.' using errcode = '42501';
    end if;
    select eo.participant_role, eo.event_id, eo.published into v_opt
      from public.event_options eo where eo.id = new.event_option_id;
    -- 0177: said, not left to RLS hiding the row.
    if v_opt.event_id is null or not coalesce(v_opt.published, false) then
      raise exception 'That option is not available.' using errcode = '42501';
    end if;
    select r.event_id, e.published, e.archived_at into v_ev
      from public.registrations r
      left join public.events e on e.id = r.event_id
     where r.id = new.registration_id;
    if v_opt.event_id is distinct from v_ev.event_id then
      raise exception 'That option is not part of this event.' using errcode = '42501';
    end if;
    if not coalesce(v_ev.published, false) or v_ev.archived_at is not null then
      raise exception 'That event is not taking registrations.' using errcode = '42501';
    end if;
    if v_opt.participant_role is not null and v_opt.participant_role is distinct from new.camp_role then
      raise exception 'That option is only for the % role.', v_opt.participant_role using errcode = '42501';
    end if;
    if v_opt.participant_role is not null and not exists (
      select 1
        from public.registration_participants rp2
        join public.event_options eo2 on eo2.id = rp2.event_option_id
       where rp2.registration_id = new.registration_id
         and rp2.person_id = new.person_id
         and rp2.status <> 'cancelled'
         and eo2.participant_role is null
    ) then
      raise exception 'A second role needs a place on the registration first.' using errcode = '42501';
    end if;
    -- 0114: the fee is filled from the option by the trigger on this table.
    new.created_at            := now();
    -- F5: staff facts start empty.
    new.checked_in_at         := null;
    new.checked_in_by         := null;
    new.program_id            := null;
    new.confirmed_at          := null;
    return new;
  end if;

  if new.event_option_id       is distinct from old.event_option_id
  or new.registration_id       is distinct from old.registration_id
  or new.person_id             is distinct from old.person_id
  or new.created_at            is distinct from old.created_at then
    raise exception 'Fees, discounts and registration dates are set by the ministry, not from a family account.'
      using errcode = '42501';
  end if;

  -- F5: check-in, program and confirmation are staff facts.
  if new.checked_in_at is distinct from old.checked_in_at
  or new.checked_in_by is distinct from old.checked_in_by
  or new.program_id    is distinct from old.program_id
  or new.confirmed_at  is distinct from old.confirmed_at then
    raise exception 'Check-in, programs and confirmation are recorded by camp staff.'
      using errcode = '42501';
  end if;

  if new.camp_role is distinct from old.camp_role
     and exists (select 1 from public.event_options eo
                  where eo.id = old.event_option_id and eo.participant_role is not null) then
    raise exception 'That place is for a set role and cannot be changed from a family account.'
      using errcode = '42501';
  end if;

  -- Status: a family may submit a draft, drop a draft, and a role change on a
  -- confirmed person sends it back for review (submit_family_registration).
  -- Anything else -- above all cancelling a submitted place, which takes it
  -- out of the balance -- goes through the staff-reviewed cancellation request.
  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
     and not (old.status = 'confirmed' and new.status = 'submitted') then
    raise exception 'Places are cancelled by the ministry. Please use "Request a cancellation".'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Post-checks: the restatements took (CLAUDE.md: check a rewrite).
-- ---------------------------------------------------------------------------
do $$
begin
  if position('not_permitted_reason' in pg_get_functiondef('public.guard_not_permitted_place()'::regprocedure)) = 0 then
    raise exception '0177: guard_not_permitted_place() was not restated';
  end if;
  if position('person_dob_locked' in pg_get_functiondef('public.guard_family_links()'::regprocedure)) = 0 then
    raise exception '0177: guard_family_links() was not restated';
  end if;
  if position('That option is not available' in pg_get_functiondef('public.guard_participant_money()'::regprocedure)) = 0 then
    raise exception '0177: guard_participant_money() was not restated';
  end if;
  if position('registry_search' in pg_get_functiondef('public.volunteer_clearance_ok(uuid, date)'::regprocedure)) = 0 then
    raise exception '0177: volunteer_clearance_ok() lost the registry-search rule';
  end if;
end $$;
