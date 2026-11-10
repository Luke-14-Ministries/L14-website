-- Checks for migration 0158: how long a background check lasts is a setting,
-- changed only by a holder of the background-checks write grant, and a change
-- recalculates every expiry from its check date, logged per person.
-- Run on a fresh database seeded with payment_plans_seed.sql (see README.md):
--   L14_DB=l14_bgc bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d l14_bgc -f supabase/tests/background_check_length_rules.sql
\set ON_ERROR_STOP on
\pset footer off
begin;
insert into auth.users (id, email) values
 ('b9c00000-0000-4000-8000-000000000001','bgc-writer@example.test'),
 ('b9c00000-0000-4000-8000-000000000002','bgc-reader@example.test');
insert into public.staff (profile_id, role) values
 ('b9c00000-0000-4000-8000-000000000001','registrar'),
 ('b9c00000-0000-4000-8000-000000000002','registrar');
insert into public.staff_grants (profile_id, area, level) values
 ('b9c00000-0000-4000-8000-000000000001','background_checks','write'),
 ('b9c00000-0000-4000-8000-000000000002','background_checks','read');
insert into public.person_clearances (person_id, background_check_on_file, background_check_date)
values ('20000000-0000-0000-0000-000000000002', true, '2026-01-15');

do $$
declare d date; n int; logged int;
begin
  select expires_on into d from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if d <> '2027-01-15' then raise exception 'FAIL 1: expiry % (want 2027-01-15)', d; end if;
  raise notice 'PASS 1 a check lasts 12 months by default';

  -- 2. Without the write grant: refused.
  perform set_config('request.jwt.claim.sub', 'b9c00000-0000-4000-8000-000000000002', true);
  perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
  begin
    perform public.set_clearance_interval_months(24);
    raise exception 'FAIL 2: a background-checks reader changed the length';
  exception when insufficient_privilege then
    raise notice 'PASS 2 a reader cannot change the length';
  end;

  -- 3. With it: the length changes, the expiry follows, both are logged.
  perform set_config('request.jwt.claim.sub', 'b9c00000-0000-4000-8000-000000000001', true);
  n := public.set_clearance_interval_months(24);
  if n <> 1 then raise exception 'FAIL 3a: recalculated % (want 1)', n; end if;
  select expires_on into d from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if d <> '2028-01-15' then raise exception 'FAIL 3b: expiry % (want 2028-01-15)', d; end if;
  select count(*) into logged from public.clearance_review_log
   where person_id = '20000000-0000-0000-0000-000000000002' and field = 'expires_on' and new_value = '2028-01-15';
  if logged <> 1 then raise exception 'FAIL 3c: person log rows %', logged; end if;
  select count(*) into logged from public.background_check_settings_log where old_months = 12 and new_months = 24 and recalculated = 1;
  if logged <> 1 then raise exception 'FAIL 3d: settings log rows %', logged; end if;
  raise notice 'PASS 3 the length changes, every expiry is recalculated, both logged';

  -- 4. A new check uses the new length.
  update public.person_clearances set background_check_date = '2026-06-01'
   where person_id = '20000000-0000-0000-0000-000000000002';
  select expires_on into d from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if d <> '2028-06-01' then raise exception 'FAIL 4: expiry % (want 2028-06-01)', d; end if;
  raise notice 'PASS 4 a new check date uses the new length';

  -- 5. Out of range is refused.
  begin
    perform public.set_clearance_interval_months(0);
    raise exception 'FAIL 5: 0 months accepted';
  exception when check_violation then
    raise notice 'PASS 5 out-of-range length refused';
  end;

  -- 6. The table cannot be written directly.
  if has_table_privilege('authenticated', 'public.background_check_settings', 'UPDATE') then
    raise exception 'FAIL 6: authenticated can update the setting directly';
  end if;
  raise notice 'PASS 6 no direct writes';
end $$;
rollback;
