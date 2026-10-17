-- 0099_event_archived_at.sql
--
-- An ARCHIVE mark on events (Larry and Ellen's inked read-through, 15 Oct
-- 2026; the call of 16 Oct, 3:11-3:13 pm; Lawrence 16 Oct; build plan item
-- 12). "Current" on every staff page is a rule -- until two weeks after the
-- event ends (lib/events.js eventWindow, 14 days from this date; 30 before)
-- -- and nothing is ever deleted. This column is the one exception a human
-- makes: a cancelled week, a duplicate, an event that should drop out of the
-- pill rows now rather than two weeks after a date that will not happen.
--
-- Archived events stay in the database, in the roster's full history and in
-- every "Other events" search box; they are never current, and registration
-- is never open for them (registrationOpen() in lib/events.js). Set and
-- cleared on Setup. Nothing else changes: published stays what it was.

alter table public.events
  add column if not exists archived_at timestamptz;

comment on column public.events.archived_at is
  'Set on Setup to take the event out of every "current" pill row now (0099). Never current, never open for registration; still in history and search. Null = decided by date.';
