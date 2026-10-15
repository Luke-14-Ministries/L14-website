-- 0089: a registration can wait on the FAMILY (Lawrence, 15 Oct 2026).
--
-- Until now the review queue had two outcomes a registrar could reach --
-- confirm somebody, or waitlist them -- and both were per-person status
-- changes buried in "People on this week". "Send it back for more
-- information" did not exist as a state: a registrar could write a note to
-- the family, but the registration stayed in Awaiting review looking exactly
-- like one nobody had opened yet, and the badge never dropped.
--
-- Two columns on the registration, set and cleared only by a registrar:
-- when staff asked the family for something, and what they asked for. The
-- review queue separates "waiting on staff" from "waiting on the family",
-- the nav badge counts only the first, and the family's dashboard shows the
-- ask in amber. Clearing it is a staff click ("the family has answered") or
-- automatic when everyone on the registration is confirmed or waitlisted.
--
-- The reason is readable by the family by design: it IS the message to them
-- (the same text is also written as a note to the family, so it sits with
-- the other notes and is never lost when the state is cleared).

alter table public.registrations
  add column awaiting_family_since  timestamptz,
  add column awaiting_family_reason text;

comment on column public.registrations.awaiting_family_since is
  'Set when staff sent the registration back to the family for more information; null when staff hold it.';
comment on column public.registrations.awaiting_family_reason is
  'What staff asked the family for. Visible to the family on their dashboard.';

-- The family may update its own registration row (family_notes, through the
-- wizard), so without this guard a family could clear the state itself.
-- Only a registrar moves these two columns; everything else on the row is
-- untouched by this trigger.
create or replace function public.guard_awaiting_family()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.awaiting_family_since  is distinct from old.awaiting_family_since
      or new.awaiting_family_reason is distinct from old.awaiting_family_reason)
     and not public.is_registrar() then
    raise exception 'Only a registrar can change whether a registration is waiting on the family.';
  end if;
  return new;
end;
$$;

drop trigger if exists registrations_guard_awaiting_family on public.registrations;
create trigger registrations_guard_awaiting_family
  before update on public.registrations
  for each row execute function public.guard_awaiting_family();
