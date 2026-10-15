-- 0086: one role per person per event (Lawrence, 14 Oct 2026, with Ellen).
--
-- "Someone registering as a camper can also register as a volunteer. We don't
-- prefer this to be the case" (Ellen, Website Feedback). Lawrence: a person
-- registers either as a volunteer or as a camper / family member for a given
-- event, never both. This SUPERSEDES the 29 August rule in 0069 (a parent
-- who also volunteers, charged once): the zero-fee second role is no longer
-- offered on the wizard, and the database refuses a second live row for the
-- same person at the same event however it arrives -- family wizard, staff
-- screen, or a hand-written insert.
--
-- Existing double rows (test data from 0069's own testing, e.g. Cal
-- BOTFAMILY-C as parent and volunteer at Week 1) are left alone: the check
-- runs only when a row is created, moved to another person or registration,
-- or brought back from cancelled. Confirming or editing an existing row is
-- never blocked by this, so staff are not stopped mid-review by old data.
-- The purge before launch removes the test rows.

create or replace function public.one_role_per_person_per_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
  v_other text;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  -- An update that keeps the same person on the same registration and was
  -- already live is not a new role; let it through untouched.
  if tg_op = 'UPDATE'
     and old.status <> 'cancelled'
     and old.person_id = new.person_id
     and old.registration_id = new.registration_id then
    return new;
  end if;

  select r.event_id into v_event from public.registrations r where r.id = new.registration_id;
  if v_event is null then
    return new;
  end if;

  select rp.camp_role into v_other
    from public.registration_participants rp
    join public.registrations r on r.id = rp.registration_id
   where rp.person_id = new.person_id
     and r.event_id = v_event
     and rp.status <> 'cancelled'
     and rp.id <> new.id
   limit 1;

  if v_other is not null then
    raise exception 'One role per person per event: this person is already registered for this event as %. Cancel that first, or pick a different person.', v_other
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists registration_participants_one_role on public.registration_participants;
create trigger registration_participants_one_role
  before insert or update of person_id, registration_id, status
  on public.registration_participants
  for each row execute function public.one_role_per_person_per_event();
