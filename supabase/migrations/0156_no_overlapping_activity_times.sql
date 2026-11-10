-- 0156 -- One person, one place at a time (9 Nov 2026)
--
-- Ellen, Website Feedback, 9 Nov 2026: a camper could take the 1pm Haircut and
-- the 1pm Massage on the same Thursday. "We don't want campers to double book
-- themselves." The family's activity page now greys out a time that clashes
-- with one already booked (ActivityPicker.jsx); this is the same rule in the
-- database, so a stale page or a second tab cannot get round it.
--
-- THE RULE: a person (registration_participant_id) may not hold two active
-- signups whose sittings overlap on the same day. Wall-clock overlap (0052):
-- same slot_date, and each starts before the other ends. Back to back is fine:
-- Haircut 1:00-1:20 and Massage 1:20-2:00 do not overlap.
--
-- Everyone, staff included: only families write activity_signups today, and a
-- person cannot be in two places at once whoever booked it. (Unlike the
-- capacity guards, where coordinators may go over on purpose.)
--
-- Signups without a time (interest-mode, or an activity with no sittings) are
-- not checked: there is nothing to clash. Cancelled rows hold nothing.
--
-- Rows that already overlap are not touched. On 9 Nov 2026 there was one, on a
-- staff test registration; the family page shows it as a clash to fix, and any
-- later change to either row has to resolve it.
--
-- Errors are read by the site by their words ("clashes with"), the way 0052's
-- "That time is full" is, so keep the phrase if this is ever reworded.

create or replace function public.activity_signup_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clash text;
begin
  if new.slot_id is null or new.status = 'cancelled' then
    return new;
  end if;

  select a.name || ', ' || to_char(o.start_time, 'FMHH12:MI') || '-' || to_char(o.end_time, 'FMHH12:MI')
    into v_clash
  from public.activity_slots mine
  join public.activity_signups g
    on g.registration_participant_id = new.registration_participant_id
   and g.status <> 'cancelled'
   and g.slot_id is not null
   and g.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
   and g.activity_id <> new.activity_id
  join public.activity_slots o on o.id = g.slot_id
  join public.activities a on a.id = g.activity_id
  where mine.id = new.slot_id
    and o.slot_date = mine.slot_date
    and o.start_time < mine.end_time
    and mine.start_time < o.end_time
  order by o.start_time
  limit 1;

  if v_clash is not null then
    raise exception 'That time clashes with % already booked for this person. Please choose another time.', v_clash
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.activity_signup_no_overlap() from public, anon, authenticated;

drop trigger if exists activity_signups_no_overlap on public.activity_signups;
create trigger activity_signups_no_overlap
  before insert or update on public.activity_signups
  for each row
  execute function public.activity_signup_no_overlap();

comment on function public.activity_signup_no_overlap() is
  'A person may not hold two active signups whose sittings overlap on the same day (0156, Ellen 9 Nov 2026). Everyone, staff included. The site matches the words "clashes with".';
