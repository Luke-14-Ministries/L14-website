-- 0137_event_details_set_by_hand.sql
--
-- Week 1's details are Week 2's defaults (Lawrence, 27 Oct 2026): saving an
-- earlier week of a camp on Setup copies its price, places, early
-- registration, balance due date, family discount and returned-payment fee to
-- the camp's later weeks -- "IF week 2 have been manually edited ever they
-- don't get updated/overwritten". This column is that "ever": stamped by
-- Setup's updateEventDetails when an event's own details are saved by hand,
-- never by the copy. Null = still following the earlier week.
--
-- The weeks of a camp are the events whose names share the part before
-- " — ", the pairing recalc_multi_week_discount() already uses. No new
-- grant: events' existing Setup-write policy covers the column.

alter table public.events
  add column details_set_by_hand_at timestamptz;

comment on column public.events.details_set_by_hand_at is
  'When this event''s details were last saved by hand on Setup (0137). Null = a later week still taking the earlier week''s details as defaults.';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'events'
                    and column_name = 'details_set_by_hand_at') then
    raise exception '0137: events.details_set_by_hand_at is missing';
  end if;
end;
$$;
