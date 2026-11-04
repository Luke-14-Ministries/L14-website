-- 0152 -- A volunteer is approved once, and only with a background check (4 Nov 2026)
--
-- Lawrence, 4 Nov 2026, looking at Darlene's registration: her place read
-- "confirmed" while her volunteer application still "needs your decision"
-- and no background check was on file -- "a bit confusing". Decided:
--   * For a volunteer, approving the place and approving the application are
--     ONE decision. Confirming a volunteer's place approves their application
--     (this trigger); approving the application on Volunteers confirms the
--     place (the app calls the same status change the registration page uses,
--     so the deposit check and the discount recalcs run).
--   * A volunteer is not approved until a background check is on file,
--     current, and marked OK to serve by the ministry (verdict 'ok'). Under
--     18 at the start of the event is not screened (0056) and so not held.
--     An unknown birth date is treated as an adult.
--
-- The gate is here, not only in the pages, so every Approve button -- the
-- Review card's, the per-person dropdown, Volunteers' -- answers the same.
-- It fires on the change TO confirmed / approved only: anyone already
-- confirmed stays as they are.
--
-- Also closed: a signed-in caller without Registration write can no longer
-- set an application to 'approved' (guard_family_decision_columns() reset
-- who and when for families but left the status alone).

-- 1. Is this person cleared to serve at this date? Definer, because the
--    family-side caller cannot read person_clearances; it answers yes/no only.
create or replace function public.volunteer_clearance_ok(p_person_id uuid, p_on date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
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
    );
$$;

revoke all on function public.volunteer_clearance_ok(uuid, date) from public, anon;
grant execute on function public.volunteer_clearance_ok(uuid, date) to authenticated;

-- The words every refusal uses.
create or replace function public.volunteer_not_cleared_message(p_person_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'This volunteer')
         || ' cannot be approved yet: no background check on file marked OK to serve. Record it on Volunteers first.'
    from public.people p where p.id = p_person_id;
$$;

revoke all on function public.volunteer_not_cleared_message(uuid) from public, anon;
grant execute on function public.volunteer_not_cleared_message(uuid) to authenticated;

-- 2. The place: a volunteer becoming confirmed needs the check.
create or replace function public.guard_volunteer_place()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_on date;
begin
  if new.status = 'confirmed' and new.camp_role = 'volunteer'
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed' or old.camp_role is distinct from 'volunteer') then
    select e.starts_on into v_on
      from public.registrations r join public.events e on e.id = r.event_id
     where r.id = new.registration_id;
    if not public.volunteer_clearance_ok(new.person_id, v_on) then
      raise exception '%', coalesce(public.volunteer_not_cleared_message(new.person_id), 'This volunteer cannot be approved yet.')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists registration_participants_volunteer_place on public.registration_participants;
create trigger registration_participants_volunteer_place
  before insert or update of status, camp_role on public.registration_participants
  for each row execute function public.guard_volunteer_place();

-- 3. The application: approving needs Registration write and the check.
create or replace function public.guard_volunteer_application()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_person uuid;
  v_on date;
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    if current_user in ('authenticated', 'anon') and not public.has_grant('registration', 'write') then
      raise exception 'Only staff can approve a volunteer application.' using errcode = '42501';
    end if;
    select rp.person_id, e.starts_on into v_person, v_on
      from public.registration_participants rp
      join public.registrations r on r.id = rp.registration_id
      join public.events e on e.id = r.event_id
     where rp.id = new.registration_participant_id;
    if v_person is not null and not public.volunteer_clearance_ok(v_person, v_on) then
      raise exception '%', coalesce(public.volunteer_not_cleared_message(v_person), 'This volunteer cannot be approved yet.')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists volunteer_applications_approval on public.volunteer_applications;
create trigger volunteer_applications_approval
  before insert or update of status on public.volunteer_applications
  for each row execute function public.guard_volunteer_application();

-- 4. One decision: a volunteer's place confirmed approves their application
--    (an application they withdrew is left alone). Invoker: the caller who
--    may confirm a place holds Registration write, the grant the
--    application asks for.
create or replace function public.sync_volunteer_application()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.volunteer_applications a
     set status = 'approved',
         reviewed_by = (select auth.uid()),
         reviewed_at = now()
   where a.registration_participant_id = new.id
     and a.status in ('applied', 'declined');
  return null;
end;
$$;

drop trigger if exists registration_participants_volunteer_sync on public.registration_participants;
create trigger registration_participants_volunteer_sync
  after update of status on public.registration_participants
  for each row
  when (new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.camp_role = 'volunteer')
  execute function public.sync_volunteer_application();
