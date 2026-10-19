-- 0105_family_write_guards.sql
--
-- Database security audit, 18 Oct 2026 (findings F1, F3–F6, F8–F10), each
-- proven on the live database inside a rolled-back transaction before fixing.
--
-- F1 (critical) -- any signed-in user could add themselves to ANY household
--   (household_members_insert accepted `profile_id = auth.uid()` for any
--   household id) and then read and edit everything in it; a registrar without
--   the Sensitive grant reached every child's medical notes that way. A
--   person may now only create the FIRST membership of an unclaimed household
--   (what submit_family_registration does for a new family); adding anyone
--   else is staff work (Registration write) or the admin link function.
-- F3 -- a family's INSERT could carry staff decisions: a self-approved
--   volunteer application, a "granted" scholarship naming a registrar, an
--   "actioned" cancellation. Family writes now have those columns pinned.
-- F4 -- a family's new registration could carry a deposit waiver, a hold or
--   "waiting on the family", be for an unpublished or archived event, and an
--   existing one could be moved to another event or household.
-- F5/F8 -- a family could mark its own camper checked in, placed in a program
--   or confirmed, and add another household's person to its registration.
-- F6 -- any staff member could download camper photos from storage, though
--   the photos table needs the Sensitive grant.
-- F9 -- a family could point people.profile_id at someone else's login, a
--   household's primary contact at another household's person, or a
--   signature at another family's registration.
-- F10 -- the change log's values could be rewritten by a reviewer; the leader
--   roster view showed every staff member dates of birth and flags whatever
--   their grants; leftover TRUNCATE/TRIGGER/REFERENCES rights; four functions
--   without a fixed search_path; a discount recalculation callable by anon.
--
-- Every guard below steps aside for definer functions (current_user is their
-- owner, not 'authenticated') and for staff holding the grant that owns the
-- column, so no staff page or RPC changes behaviour.

-- ---- F1: household membership ---------------------------------------------------------
create or replace function public.household_is_unclaimed(p_household_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select not exists (select 1 from public.household_members m where m.household_id = p_household_id) $$;
revoke all on function public.household_is_unclaimed(uuid) from public, anon;
grant execute on function public.household_is_unclaimed(uuid) to authenticated;

drop policy if exists household_members_insert on public.household_members;
create policy household_members_insert on public.household_members
  for insert to authenticated
  with check (
    (profile_id = (select auth.uid()) and role = 'owner' and public.household_is_unclaimed(household_id))
    or (public.has_grant('registration', 'write') and profile_id <> (select auth.uid()))
  );

-- ---- F3: staff decisions are not a family's to write -------------------------------------
create or replace function public.guard_family_decision_columns()
-- Runs with the CALLER's rights on purpose: inside a definer function
-- current_user is the owner, and the 'is this a family?' test would always
-- step aside (caught by the harness, 18 Oct 2026).
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name = 'scholarships' then
    if public.can_decide_scholarships() then return new; end if;
    if tg_op = 'INSERT' then
      new.granted_cents := 0;
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.staff_note := null;
      if new.status not in ('requested', 'withdrawn') then new.status := 'requested'; end if;
    else
      new.granted_cents := old.granted_cents;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.staff_note := old.staff_note;
    end if;

  elsif tg_table_name = 'volunteer_applications' then
    if public.has_grant('registration', 'write') then return new; end if;
    if tg_op = 'INSERT' then
      new.status := 'applied';
      new.reviewed_by := null;
      new.reviewed_at := null;
    else
      -- A family save clears the review (it goes back under review); it can
      -- never set one.
      if new.reviewed_by is not null then new.reviewed_by := old.reviewed_by; end if;
      if new.reviewed_at is not null then new.reviewed_at := old.reviewed_at; end if;
    end if;

  elsif tg_table_name = 'registration_cancellation_requests' then
    if public.has_grant('registration', 'write') then return new; end if;
    if tg_op = 'INSERT' then
      new.status := 'open';
      new.handled_by := null;
      new.handled_at := null;
      new.staff_note := null;
      new.requested_by := (select auth.uid());
    else
      new.handled_by := old.handled_by;
      new.handled_at := old.handled_at;
      new.staff_note := old.staff_note;
      new.requested_by := old.requested_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scholarships_family_guard on public.scholarships;
create trigger scholarships_family_guard before insert or update on public.scholarships
  for each row execute function public.guard_family_decision_columns();
drop trigger if exists volunteer_applications_family_guard on public.volunteer_applications;
create trigger volunteer_applications_family_guard before insert or update on public.volunteer_applications
  for each row execute function public.guard_family_decision_columns();
drop trigger if exists cancellation_requests_family_guard on public.registration_cancellation_requests;
create trigger cancellation_requests_family_guard before insert or update on public.registration_cancellation_requests
  for each row execute function public.guard_family_decision_columns();

-- ---- F4: registrations ----------------------------------------------------------------------
create or replace function public.guard_registration_family()
-- Runs with the CALLER's rights on purpose: inside a definer function
-- current_user is the owner, and the 'is this a family?' test would always
-- step aside (caught by the harness, 18 Oct 2026).
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_ev record;
begin
  if current_user not in ('authenticated', 'anon') or public.has_grant('registration', 'write') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.deposit_waived_at := null;
    new.deposit_waived_by := null;
    new.deposit_waived_reason := null;
    new.hold_since := null;
    new.hold_reason := null;
    new.hold_by := null;
    new.awaiting_family_since := null;
    new.awaiting_family_reason := null;
    select e.published, e.archived_at, e.registration_opens_at, e.registration_closes_at
      into v_ev from public.events e where e.id = new.event_id;
    if not found or not v_ev.published or v_ev.archived_at is not null
       or (v_ev.registration_opens_at is not null and v_ev.registration_opens_at > now())
       or (v_ev.registration_closes_at is not null and v_ev.registration_closes_at < now()) then
      raise exception 'Registration for that event is not open.' using errcode = '42501';
    end if;
  else
    if new.event_id is distinct from old.event_id or new.household_id is distinct from old.household_id then
      raise exception 'A registration cannot be moved to another event or household from a family account.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists registrations_family_guard on public.registrations;
create trigger registrations_family_guard before insert or update on public.registrations
  for each row execute function public.guard_registration_family();

-- ---- F5/F8: participants (guard_participant_money, restated with the additions) -------------
create or replace function public.guard_participant_money()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_opt record;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.has_grant('payments', 'write') then
    if tg_op = 'UPDATE'
       and (new.scholarship_cents is distinct from old.scholarship_cents
            or new.discount_cents is distinct from old.discount_cents
            or new.discount_reason is distinct from old.discount_reason)
       and not public.can_decide_scholarships() then
      raise exception 'Scholarships and discounts are decided by Registration & coordination.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  -- Registration write without payments: staff may move status, check-in and
  -- program through their own paths; only the money columns are refused below.
  if public.has_grant('registration', 'write') then
    if tg_op = 'UPDATE'
       and (new.fee_cents is distinct from old.fee_cents
            or new.scholarship_cents is distinct from old.scholarship_cents
            or new.discount_cents is distinct from old.discount_cents
            or new.discount_reason is distinct from old.discount_reason
            or new.early_discount_cents is distinct from old.early_discount_cents
            or new.family_discount_cents is distinct from old.family_discount_cents) then
      raise exception 'Fees and discounts need Payments write.' using errcode = '42501';
    end if;
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
    select eo.fee_cents, eo.participant_role, eo.event_id into v_opt
      from public.event_options eo where eo.id = new.event_option_id;
    if v_opt.event_id is distinct from
       (select r.event_id from public.registrations r where r.id = new.registration_id) then
      raise exception 'That option is not part of this event.' using errcode = '42501';
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
    new.fee_cents             := coalesce(v_opt.fee_cents, 0);
    new.discount_cents        := 0;
    new.discount_reason       := null;
    new.scholarship_cents     := 0;
    new.early_discount_cents  := 0;
    new.family_discount_cents := 0;
    new.created_at            := now();
    -- F5: staff facts start empty.
    new.checked_in_at         := null;
    new.checked_in_by         := null;
    new.program_id            := null;
    new.confirmed_at          := null;
    return new;
  end if;

  if new.fee_cents             is distinct from old.fee_cents
  or new.discount_cents        is distinct from old.discount_cents
  or new.discount_reason       is distinct from old.discount_reason
  or new.scholarship_cents     is distinct from old.scholarship_cents
  or new.early_discount_cents  is distinct from old.early_discount_cents
  or new.family_discount_cents is distinct from old.family_discount_cents
  or new.event_option_id       is distinct from old.event_option_id
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

  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
     and not (old.status = 'confirmed' and new.status = 'submitted') then
    raise exception 'Places are cancelled by the ministry. Please use "Request a cancellation".'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- ---- F6: camper photos in storage need Sensitive read ---------------------------------------
drop policy if exists "person photos: staff read all" on storage.objects;
create policy "person photos: staff read all" on storage.objects
  for select using (bucket_id = 'person-photos' and public.has_grant('sensitive', 'read'));

-- ---- F9: links a family may not forge -------------------------------------------------------
create or replace function public.guard_family_links()
-- Runs with the CALLER's rights on purpose: inside a definer function
-- current_user is the owner, and the 'is this a family?' test would always
-- step aside (caught by the harness, 18 Oct 2026).
returns trigger language plpgsql set search_path = ''
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
drop trigger if exists people_family_links_guard on public.people;
create trigger people_family_links_guard before insert or update on public.people
  for each row execute function public.guard_family_links();
drop trigger if exists households_family_links_guard on public.households;
create trigger households_family_links_guard before insert or update on public.households
  for each row execute function public.guard_family_links();

alter policy agreement_signatures_insert on public.agreement_signatures
  with check (
    public.is_staff()
    or (status = any (array['self_reported', 'signed_here'])
        and confirmed_by is null
        and (registration_id is null or registration_id in (select public.my_registration_ids()))
        and ((household_id in (select public.my_household_ids()))
             or exists (select 1 from public.people p
                         where p.id = agreement_signatures.person_id
                           and p.household_id in (select public.my_household_ids()))))
  );

-- ---- F10: hygiene ------------------------------------------------------------------------------
-- The change log: a reviewer may mark a row reviewed, never rewrite it.
create or replace function public.guard_change_log_values()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.household_id is distinct from old.household_id
          or new.person_id is distinct from old.person_id
          or new.actor_profile_id is distinct from old.actor_profile_id
          or new.source_table is distinct from old.source_table
          or new.field is distinct from old.field
          or new.old_value is distinct from old.old_value
          or new.new_value is distinct from old.new_value
          or new.changed_at is distinct from old.changed_at) then
    raise exception 'A change-log entry can be marked reviewed, not edited.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists family_change_log_values_guard on public.family_change_log;
create trigger family_change_log_values_guard before update on public.family_change_log
  for each row execute function public.guard_change_log_values();

-- The leader roster: staff need Programs read (a leader still reads their own).
do $$
declare def text;
begin
  def := pg_get_viewdef('public.program_roster'::regclass, true);
  if def !~ 'is_staff\(\)' then
    raise exception '0105: program_roster no longer filters on is_staff()';
  end if;
  def := regexp_replace(def, 'is_staff\(\)', 'has_grant(''programs''::text, ''read''::text)', 'g');
  execute 'create or replace view public.program_roster as ' || def;
  if pg_get_viewdef('public.program_roster'::regclass, true) !~ 'programs' then
    raise exception '0105: program_roster was not rewritten';
  end if;
end;
$$;

-- Leftover table rights from default privileges (TRUNCATE ignores RLS).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
do $$ begin
  execute 'revoke maintain on all tables in schema public from anon, authenticated';
exception when others then null;   -- MAINTAIN exists only from PostgreSQL 17
end $$;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- Fixed search_path on the four invoker functions the advisor lists.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('agreement_signature_names_contact', 'plan_charge_dates',
                                'clearance_interval_months', 'people_dob_sane')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- A discount recalculation is never anon's to call.
revoke execute on function public.recalc_multi_week_discount(uuid) from anon, public;
revoke execute on function public.recalc_family_discount(uuid) from anon, public;
revoke execute on function public.recalc_early_registration_discount(uuid) from anon, public;
grant execute on function public.recalc_multi_week_discount(uuid) to authenticated;
grant execute on function public.recalc_family_discount(uuid) to authenticated;
grant execute on function public.recalc_early_registration_discount(uuid) to authenticated;
