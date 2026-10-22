-- 0119_activity_slots_within_event.sql
--
-- An activity's times must fall within its event.
--
-- 22 October 2026, Lawrence. The 22 Oct bot run found Week 1's only Salon
-- sitting dated 15 July -- four days before the week starts -- and nothing
-- had said no: the Activities page only warned (an advisory kept since 25 Aug
-- so an arrival-evening sitting could be set). The rule now, held in three
-- places that say the same sentence:
--   * the browser: every slot date input carries min/max of this range, with
--     the range written under it ("Between Mon 19 Jul and Fri 23 Jul");
--   * the server action (app/admin/activities/actions.js, createSlot and
--     generateSlots): refuses before the database is asked;
--   * this trigger: refuses any other writer.
--
-- THE RANGE. From the event's first day -- or the volunteers' arrival day
-- (events.volunteer_arrives_on, 0081) when that is earlier, because an
-- orientation-evening sitting is real -- to the event's last day (a
-- departure-morning sitting is on it). Whole days, inclusive.
--
-- THE COLUMN. activity_slots.slot_date (0052): slots are wall-clock at camp,
-- a date and two times of day, and the wall-clock trio is required on every
-- row by 0052's check constraint. The old timestamptz starts_at/ends_at are
-- optional and unused, so no timezone conversion is involved.
--
-- WHEN IT IS ASKED. Before INSERT, and before an UPDATE that changes
-- slot_date or activity_id. Not on an update of the label or the capacity
-- alone, so an existing out-of-range row can still be edited while staff
-- sort it out. NOT when an event's dates change: moving an event does not
-- re-check its slots (the Activities page marks any slot outside the event's
-- days, "Not during the event"). admin_create_event() (0117) shifts every
-- copied slot by the same number of days as the event, so a copy stays
-- inside as long as the source's slots were inside and the new event is at
-- least as long; otherwise the copy is refused with this sentence, naming
-- the new event -- fix the source's slot first.
--
-- EXISTING ROWS ARE NOT REWRITTEN. The one known bad row is Week 1's Salon
-- sitting, dated 15 July, four days before the week starts. Staff fix it on
-- the Activities page: remove that time and add it on the right day (removal is
-- refused while anyone is booked on it -- move them first). The notice at the
-- end of this file lists every out-of-range slot it finds, so the lead sees
-- them when it is applied.
--
-- SECURITY DEFINER is deliberate and harmless here: this is a data rule, not
-- an access rule. It asks nothing about the caller (CLAUDE.md: a definer
-- trigger sees current_user as its owner -- which is why access guards are
-- invoker), and it only READS activities and events, so a writer who could
-- not see the event still gets the right answer. search_path is pinned.
--
-- Not applied to the production project yet; the lead applies.

begin;

create or replace function public.activity_slot_within_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity text;
  v_event    text;
  v_first    date;
  v_last     date;
begin
  if tg_op = 'UPDATE'
     and new.slot_date is not distinct from old.slot_date
     and new.activity_id is not distinct from old.activity_id then
    return new;
  end if;

  select a.name,
         e.name,
         least(e.starts_on, coalesce(e.volunteer_arrives_on, e.starts_on)),
         e.ends_on
    into v_activity, v_event, v_first, v_last
    from public.activities a
    join public.events e on e.id = a.event_id
   where a.id = new.activity_id;

  -- No such activity: the foreign key refuses the row with its own message.
  if not found then
    return new;
  end if;

  if new.slot_date is null or new.slot_date < v_first or new.slot_date > v_last then
    raise exception 'A time for % must fall during %: % to %.',
      v_activity, v_event,
      to_char(v_first, 'Dy FMDD Mon'), to_char(v_last, 'Dy FMDD Mon')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.activity_slot_within_event() is
  'Trigger: an activity slot''s slot_date must fall from the event''s first day (or the volunteers'' arrival day, if earlier) to its last day. Asked on insert and when slot_date or activity_id changes; not when an event''s dates change (0119).';

-- A trigger function is not called directly; nobody needs EXECUTE on it.
revoke execute on function public.activity_slot_within_event() from public, anon, authenticated;

drop trigger if exists activity_slots_within_event on public.activity_slots;
create trigger activity_slots_within_event
  before insert or update on public.activity_slots
  for each row
  execute function public.activity_slot_within_event();

-- Post-check: the trigger is in place, enabled, on the right function, and
-- the function carries the rule.
do $$
declare
  v_def text;
begin
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'activity_slots'
       and t.tgname = 'activity_slots_within_event'
       and t.tgfoid = 'public.activity_slot_within_event()'::regprocedure
       and t.tgenabled <> 'D'
  ) then
    raise exception '0119 post-check: trigger activity_slots_within_event is missing or disabled';
  end if;

  v_def := pg_get_functiondef('public.activity_slot_within_event()'::regprocedure);
  if position('must fall during' in v_def) = 0
     or position('volunteer_arrives_on' in v_def) = 0
     or position('new.slot_date > v_last' in v_def) = 0 then
    raise exception '0119 post-check: activity_slot_within_event() does not carry the range rule';
  end if;
end;
$$;

-- What is already outside its event (read only; nothing is changed).
do $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select a.name as activity, e.name as event, s.slot_date, s.start_time, s.label
      from public.activity_slots s
      join public.activities a on a.id = s.activity_id
      join public.events e on e.id = a.event_id
     where s.slot_date < least(e.starts_on, coalesce(e.volunteer_arrives_on, e.starts_on))
        or s.slot_date > e.ends_on
     order by e.starts_on, a.name, s.slot_date, s.start_time
  loop
    v_n := v_n + 1;
    raise notice '0119: outside its event -- % / % on % at % %',
      r.event, r.activity, r.slot_date, r.start_time,
      case when r.label is not null then ' (' || r.label || ')' else '' end;
  end loop;
  raise notice '0119: % existing slot(s) outside their event; staff fix them on the Activities page.', v_n;
end;
$$;

commit;
