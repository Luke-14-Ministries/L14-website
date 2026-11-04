-- 0149 -- A new account can set up its household before registering (4 Nov 2026)
--
-- Lawrence, 4 Nov 2026: a new account's Manage Household page said "No
-- household on file yet — one is created the first time you register", so a
-- family could not fix their name, phone or address until they had signed up
-- for an event. Until now the only door that made a household was
-- submit_family_registration().
--
-- create_my_household(first, last, phone) does that first part on its own:
-- the household (named "<Last> family", the household email defaulting to the
-- login's own address), the caller as its owner, and the caller as a person in
-- it and its primary contact -- which, through trg_link_owner_to_primary_contact
-- (0074), links the person to the login. The wizard then finds the household
-- already there and fills in the rest, exactly as it does for a returning
-- family.
--
-- SECURITY INVOKER, as submit_family_registration is: the same RLS and the
-- family-link guards (0105) apply, so it can do nothing the caller could not
-- do row by row. One household per login: a caller who already has one is
-- refused, never given a second.

create or replace function public.create_my_household(
  p_first_name text,
  p_last_name text,
  p_phone text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_first text := nullif(trim(p_first_name), '');
  v_last text := nullif(trim(p_last_name), '');
  v_household_id uuid;
  v_person_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if v_first is null or v_last is null then
    raise exception 'Give your first and last name.';
  end if;
  if exists (select 1 from public.household_members hm where hm.profile_id = v_uid) then
    raise exception 'You already have a household.';
  end if;

  v_household_id := gen_random_uuid();
  insert into public.households (id, display_name, email, phone)
  values (
    v_household_id,
    v_last || ' family',
    nullif(lower(trim((select auth.jwt()) ->> 'email')), ''),
    nullif(trim(p_phone), '')
  );
  insert into public.household_members (household_id, profile_id, role)
  values (v_household_id, v_uid, 'owner');

  v_person_id := gen_random_uuid();
  insert into public.people (id, household_id, first_name, last_name, phone)
  values (v_person_id, v_household_id, v_first, v_last, nullif(trim(p_phone), ''));

  update public.households
     set primary_contact_person_id = v_person_id
   where id = v_household_id;

  return v_household_id;
end;
$$;

revoke all on function public.create_my_household(text, text, text) from public, anon;
grant execute on function public.create_my_household(text, text, text) to authenticated;
