-- 0147 -- An archived event can be cleared from family dashboards (4 Nov 2026)
--
-- Lawrence, 4 Nov 2026, after the Stage B "TEST retreat": a real event that
-- took place is ARCHIVED, and families keep its card on their dashboard for
-- their records (folded among the past ones). A test event, or one cancelled
-- before it ran, can also be cleared from family dashboards so it stops
-- appearing at all. Its registrations, payments and refunds stay, for staff
-- and in every export: this hides, it deletes nothing.
--
-- Only an archived event can be hidden (the CHECK). Setup clears the mark
-- whenever an event is moved back to Unpublished or Published. Setup write
-- already governs updates to events (0100/0101), so no new policy.

alter table public.events
  add column if not exists hidden_from_families_at timestamptz;

alter table public.events
  drop constraint if exists events_hidden_only_when_archived;
alter table public.events
  add constraint events_hidden_only_when_archived
    check (hidden_from_families_at is null or archived_at is not null);

comment on column public.events.hidden_from_families_at is
  'Set on Setup for an archived test or cancelled event: its registrations leave family dashboards. Records stay. 0147.';
