-- 0184_event_notes.sql
--
-- Two facts staff set on Setup that the public pages print (Setup and events
-- review, 23 Nov 2026, findings A4-05 and A4-07).
--
-- events.arrival_note: a line such as "6:00 PM Thursday" or "Check in from
-- 2:00 PM Monday". The retreat page printed a time written into its code
-- (ARRIVAL_TIME); now it prints this when staff set it and falls back to
-- that line when they have not, so nothing changes on the live site until
-- someone fills the box. Plain text, short: it sits in the retreat page's
-- fact grid.
--
-- events.waitlist_notice_at: staff's switch "Tell families this event is
-- full (new registrations join the waiting list)". Set, the public headline
-- and the retreat's status line say the program is full and that registering
-- joins the waiting list. A switch, not a count: staff run the waiting list
-- by hand (approve or waitlist each person on Review), and a count of places
-- would announce "full" while staff still meant to take a family. The stamp
-- says when it was switched on; null is off.
--
-- Both are ordinary event columns: events_write (Setup write, 0101) is the
-- only writer and the table's existing grants cover new columns. Families
-- and anon read them with the rest of a published event.

alter table public.events add column if not exists arrival_note text;
alter table public.events add column if not exists waitlist_notice_at timestamptz;

alter table public.events drop constraint if exists events_arrival_note_short;
alter table public.events
  add constraint events_arrival_note_short
  check (arrival_note is null or length(arrival_note) <= 200);

comment on column public.events.arrival_note is
  'When people arrive, as the public page prints it (0184). Blank: the page''s own default line.';
comment on column public.events.waitlist_notice_at is
  'Set when staff tell families the event is full and new registrations join the waiting list (0184). Null: not shown.';
