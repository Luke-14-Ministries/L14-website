-- Checks for migration 0182 (request keys on hand-recorded payments and
-- gifts; the export log). Run on a fresh database after every migration (no
-- seed needed):
--   L14_DB=l14_export bash supabase/tests/run_rls_local.sh supabase/tests/export_log_rules.sql
-- Raises on failure; ends ALL EXPORT LOG CHECKS PASSED.
\set ON_ERROR_STOP on
\pset footer off

-- A family login, a staff login with Registration read, an administrator,
-- and a program leader (no staff row).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000018201', 'fam182@example.test'),
  ('00000000-0000-0000-0000-000000018202', 'staff182@example.test'),
  ('00000000-0000-0000-0000-000000018203', 'admin182@example.test'),
  ('00000000-0000-0000-0000-000000018204', 'leader182@example.test');
insert into public.staff (profile_id, role) values
  ('00000000-0000-0000-0000-000000018202', 'coordinator'),
  ('00000000-0000-0000-0000-000000018203', 'admin');
insert into public.staff_grants (profile_id, area, level) values
  ('00000000-0000-0000-0000-000000018202', 'registration', 'read');
insert into public.events (id, name, event_type, starts_on, ends_on)
values ('00000000-0000-0000-0000-000000018210', 'Export test camp', 'camp_week', '2027-06-01', '2027-06-05');
insert into public.programs (id, name) values ('00000000-0000-0000-0000-000000018211', 'Export test program');
insert into public.program_leaders (profile_id, program_id, event_id) values
  ('00000000-0000-0000-0000-000000018204', '00000000-0000-0000-0000-000000018211', '00000000-0000-0000-0000-000000018210');

\echo == 1 a family cannot log an export or read the log
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000018201', true),
       set_config('request.jwt.claims', '{"aal":"aal2"}', true) \g /dev/null
do $$
declare n int;
begin
  begin
    perform public.log_export('rosters', '{}'::jsonb);
    raise exception 'FAIL 1: a family logged an export';
  exception when insufficient_privilege then raise notice 'PASS 1 a family cannot log an export';
  end;
  begin
    insert into public.export_log (kind) values ('rosters');
    raise exception 'FAIL 1: a family wrote the log directly';
  exception when insufficient_privilege then raise notice 'PASS 1 no direct insert';
  end;
  select count(*) into n from public.export_log;
  if n <> 0 then raise exception 'FAIL 1: a family reads % log rows', n; end if;
end $$;
rollback;

\echo == 2 staff log an export; a weak session cannot; staff without admin read nothing
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000018202', true),
       set_config('request.jwt.claims', '{"aal":"aal1"}', true) \g /dev/null
do $$
begin
  begin
    perform public.log_export('rosters', '{}'::jsonb);
    raise exception 'FAIL 2: a password-only session logged an export';
  exception when insufficient_privilege then raise notice 'PASS 2 weak session refused';
  end;
end $$;
select set_config('request.jwt.claims', '{"aal":"aal2"}', true) \g /dev/null
do $$
declare n int;
begin
  perform public.log_export('rosters', '{"event":"all","status":"confirmed"}'::jsonb);
  begin
    perform public.log_export('everything', '{}'::jsonb);
    raise exception 'FAIL 2: an unknown export kind was logged';
  exception when invalid_parameter_value then raise notice 'PASS 2 unknown kind refused';
  end;
  begin
    perform public.log_export('rosters', '["not","an","object"]'::jsonb);
    raise exception 'FAIL 2: filters that are not an object were logged';
  exception when invalid_parameter_value then raise notice 'PASS 2 odd filters refused';
  end;
  select count(*) into n from public.export_log;
  if n <> 0 then raise exception 'FAIL 2: staff without admin read % log rows', n; end if;
  begin
    update public.export_log set kind = 'giving' where true;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL 2: staff edited the log'; end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 2 staff can log, cannot read or edit';
end $$;
commit;

\echo == 3 a program leader logs their roster export
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000018204', true),
       set_config('request.jwt.claims', '{"aal":"aal2"}', true) \g /dev/null
select public.log_export('program_roster', '{"grant":"x"}'::jsonb) \g /dev/null
\echo PASS 3 leader logged
commit;

\echo == 4 the administrator reads the log, with who
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000018203', true),
       set_config('request.jwt.claims', '{"aal":"aal2"}', true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.export_log
   where (profile_id = '00000000-0000-0000-0000-000000018202' and kind = 'rosters' and filters ->> 'status' = 'confirmed')
      or (profile_id = '00000000-0000-0000-0000-000000018204' and kind = 'program_roster');
  if n <> 2 then raise exception 'FAIL 4: the administrator sees % of the 2 rows', n; end if;
  begin
    delete from public.export_log where true;
    raise exception 'FAIL 4: the administrator deleted log rows';
  exception when insufficient_privilege then raise notice 'PASS 4 administrator reads, cannot delete';
  end;
end $$;
rollback;

\echo == 5 a request key records one gift and one payment
do $$
declare v_reg uuid; v_hh uuid := gen_random_uuid();
begin
  insert into public.gifts (donor_name, amount_cents, fund, method, status, request_key)
  values ('Donor', 2500, 'General Operating Fund', 'check', 'succeeded', 'gift-key-1');
  begin
    insert into public.gifts (donor_name, amount_cents, fund, method, status, request_key)
    values ('Donor', 2500, 'General Operating Fund', 'check', 'succeeded', 'gift-key-1');
    raise exception 'FAIL 5: a second gift with the same key was recorded';
  exception when unique_violation then raise notice 'PASS 5 gift key unique';
  end;
  -- Keyless gifts (the webhook's) are never in each other's way.
  insert into public.gifts (donor_name, amount_cents, fund, method, status) values ('A', 100, 'General Operating Fund', 'check', 'succeeded');
  insert into public.gifts (donor_name, amount_cents, fund, method, status) values ('A', 100, 'General Operating Fund', 'check', 'succeeded');

  insert into public.households (id, display_name) values (v_hh, 'Key test family');
  insert into public.registrations (household_id, event_id)
  values (v_hh, '00000000-0000-0000-0000-000000018210') returning id into v_reg;
  insert into public.payments (registration_id, amount_cents, method, status, request_key)
  values (v_reg, 5000, 'check', 'succeeded', 'pay-key-1');
  begin
    insert into public.payments (registration_id, amount_cents, method, status, request_key)
    values (v_reg, 5000, 'check', 'succeeded', 'pay-key-1');
    raise exception 'FAIL 5: a second payment with the same key was recorded';
  exception when unique_violation then raise notice 'PASS 5 payment key unique';
  end;
end $$;

\echo == ALL EXPORT LOG CHECKS PASSED
