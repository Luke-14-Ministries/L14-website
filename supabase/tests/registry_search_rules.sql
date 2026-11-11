-- Checks for migration 0161: an adult camper's registry search never clears a
-- volunteer, never carries into a Checkr order, and shows its provider to staff
-- (and nothing to a family) through clearance_status.
-- Run on a fresh database seeded with payment_plans_seed.sql (see README.md):
--   L14_DB=l14_reg bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d l14_reg -f supabase/tests/registry_search_rules.sql
\set ON_ERROR_STOP on
\pset footer off
begin;
insert into auth.users (id, email) values ('16100000-0000-4000-8000-000000000001','reg-staff@example.test');
insert into public.staff (profile_id, role) values ('16100000-0000-4000-8000-000000000001','registrar');

-- Pa (seed person ...02) has no date of birth, so the gate treats them as an adult.
insert into public.person_clearances (person_id, provider, screening_reason, background_check_on_file, background_check_date, verdict)
values ('20000000-0000-0000-0000-000000000002', 'registry_search', 'adult_participant', true, current_date, 'ok');

do $$
declare r record;
begin
  -- 1. A current, clear registry search does not clear a volunteer.
  if public.volunteer_clearance_ok('20000000-0000-0000-0000-000000000002', current_date) then
    raise exception 'FAIL 1: a registry search cleared a volunteer';
  end if;
  raise notice 'PASS 1 a registry search does not clear a volunteer';

  -- 2. The same facts recorded as a full check do.
  update public.person_clearances set provider = 'manual' where person_id = '20000000-0000-0000-0000-000000000002';
  if not public.volunteer_clearance_ok('20000000-0000-0000-0000-000000000002', current_date) then
    raise exception 'FAIL 2: a full check did not clear a volunteer';
  end if;
  raise notice 'PASS 2 a full check still clears a volunteer';

  -- 3. A registry row switched to a Checkr order sheds the registry's facts.
  update public.person_clearances
     set provider = 'registry_search', background_check_on_file = true, background_check_date = current_date, verdict = 'ok', verdict_note = 'n'
   where person_id = '20000000-0000-0000-0000-000000000002';
  -- As markBatchOrdered() writes it (0093: an order carries the invited email).
  update public.person_clearances set provider = 'checkr', checkr_status = 'invited', invited_email = 'pa@example.test'
   where person_id = '20000000-0000-0000-0000-000000000002';
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if r.background_check_on_file or r.background_check_date is not null or r.expires_on is not null
     or r.verdict is not null or r.verdict_note is not null then
    raise exception 'FAIL 3: registry facts carried into the Checkr order (%, %, %, %)', r.background_check_on_file, r.background_check_date, r.expires_on, r.verdict;
  end if;
  if public.volunteer_clearance_ok('20000000-0000-0000-0000-000000000002', current_date) then
    raise exception 'FAIL 3b: a fresh Checkr order cleared a volunteer';
  end if;
  raise notice 'PASS 3 a Checkr order starts clean';

  -- Back to a registry search for the view checks.
  update public.person_clearances
     set provider = 'registry_search', background_check_on_file = true, background_check_date = current_date, verdict = 'ok'
   where person_id = '20000000-0000-0000-0000-000000000002';
end $$;

-- 4. Staff read the provider through clearance_status.
set local role authenticated;
select set_config('request.jwt.claim.sub', '16100000-0000-4000-8000-000000000001', true) \g /dev/null
select set_config('request.jwt.claims', '{"aal":"aal2"}', true) \g /dev/null
do $$
declare p text;
begin
  select provider into p from public.clearance_status where person_id = '20000000-0000-0000-0000-000000000002';
  if p is distinct from 'registry_search' then raise exception 'FAIL 4: staff read provider %', p; end if;
  raise notice 'PASS 4 staff see how a check was done';
end $$;

-- 5. A family reads no rows from it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.clearance_status;
  if n <> 0 then raise exception 'FAIL 5: a family read % clearance rows', n; end if;
  raise notice 'PASS 5 a family reads nothing from clearance_status';
end $$;
reset role;
rollback;
\echo ALL REGISTRY SEARCH CHECKS PASSED
