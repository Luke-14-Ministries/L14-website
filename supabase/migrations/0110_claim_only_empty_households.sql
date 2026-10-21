-- 0110_claim_only_empty_households.sql
--
-- Adversarial audit, 20 Oct 2026 (identity pass, LOW). 0105 let a signed-in
-- person make themselves owner of an "unclaimed" household, meaning one with
-- no member rows. Today that is only ever the household a family is creating
-- for itself: submit_family_registration() inserts the household and the
-- member row together, before any people. Nothing is exploitable now. But a
-- future path that created a household WITH people before adding a member --
-- a bulk import, a walk-in pre-registration -- would leave those children's
-- rows claimable by the first signed-in caller who learned the household id.
--
-- The rule is now "unclaimed AND empty": a household with people is never
-- self-claimed; admin_link_login_to_household() (0024) is the way to attach a
-- login to a populated household.

create or replace function public.household_is_unclaimed(p_household_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.household_members m where m.household_id = p_household_id)
     and not exists (select 1 from public.people p where p.household_id = p_household_id);
$$;
