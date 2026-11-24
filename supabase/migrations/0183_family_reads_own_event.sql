-- 0183_family_reads_own_event.sql
--
-- A family can read the event of its own registration, whatever the event's
-- status (Setup and events review, 23 Nov 2026, finding A4-01).
--
-- Why: events_select (0001) is `published or is_staff()`, and Setup stores an
-- archived event unpublished (26 Oct 2026). So the day staff archive a week,
-- every family registered for it reads the event as nothing: the dashboard
-- card loses its name, dates, deposit and due date ("Camp registration", no
-- money prompts), the archived event is never folded among past events as
-- CLAUDE.md says it is, and 0147's "Clear from family dashboards" cannot work
-- either, because the dashboard has to read hidden_from_families_at to leave
-- the card out. The same happened to a week set back to Unpublished while
-- families were registered.
--
-- The rule: a signed-in family reads an event when one of its households has
-- a registration for it (any status, cancelled people included, so a refund
-- or a statement still has its event). Nothing else changes: anon and every
-- other family still see published events only, and staff all of them.
--
-- Separate policies, not a wider events_select: events_select is for anon
-- too, and a function anon may not execute inside a policy anon reads under
-- is "permission denied" for every public page. The new policies are for
-- authenticated only, and Postgres ORs a table's permissive policies.
--
-- event_options gets the same so the published price of the family's own
-- event still embeds (Ways to pay, the dashboard's fee line). Unpublished
-- options stay staff-only. event_medical_contacts already reads by
-- registration (0109) and needs nothing.

create or replace function public.household_registered_for_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Definer: it reads registrations past their own RLS, and answers only
  -- yes or no about the caller's own households (my_household_ids(), which
  -- also asks family_session_ok(), 0176).
  select exists (
    select 1
    from public.registrations r
    where r.event_id = p_event_id
      and r.household_id in (select public.my_household_ids())
  );
$$;

comment on function public.household_registered_for_event(uuid) is
  'True when one of the caller''s households has a registration for the event (0183). Used by the events and event_options read policies.';

-- 0175: PUBLIC no longer gets EXECUTE; name the roles. Not anon (the new
-- policies are for authenticated only).
revoke all on function public.household_registered_for_event(uuid) from public, anon;
grant execute on function public.household_registered_for_event(uuid) to authenticated, service_role;

drop policy if exists events_select_own_registration on public.events;
create policy events_select_own_registration on public.events
  for select to authenticated
  using (public.household_registered_for_event(id));

drop policy if exists event_options_select_own_registration on public.event_options;
create policy event_options_select_own_registration on public.event_options
  for select to authenticated
  using (published and public.household_registered_for_event(event_id));
