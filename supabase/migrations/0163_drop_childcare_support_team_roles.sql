-- 0163 -- Drop the 'childcare' and 'support_team' roles (11 Nov 2026)
--
-- Lawrence, relayed 11 Nov 2026: "those people are volunteers". Both roles
-- came with the first schema (0001), were never defined for staff or
-- families, and nobody holds either one (checked live: no participant row and
-- no event option uses them). The people who do childcare or support-team
-- work sign up as Volunteers and get the full background check, the
-- application and the Creed.
--
-- The two CHECK constraints are restated without them, from 0155's lists.
-- No function or view names either role (checked live, 11 Nov 2026).

alter table public.registration_participants
  drop constraint registration_participants_camp_role_check;
alter table public.registration_participants
  add constraint registration_participants_camp_role_check
  check (camp_role in ('camper', 'parent_guardian', 'sibling', 'caregiver', 'volunteer', 'volunteer_child'));

alter table public.event_options
  drop constraint event_options_participant_role_check;
alter table public.event_options
  add constraint event_options_participant_role_check
  check (participant_role is null
         or participant_role in ('camper', 'parent_guardian', 'sibling', 'caregiver', 'volunteer', 'volunteer_child'));
