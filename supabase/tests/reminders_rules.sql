-- Checks for migration 0138 (the automatic emails' tables). Run after
-- supabase_stubs.sql, every migration, and payment_plans_seed.sql:
--   L14_DB=l14_rem bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   psql ... -d l14_rem -f supabase/tests/reminders_rules.sql
-- Raises on failure; ends ALL REMINDER CHECKS PASSED.
\set ON_ERROR_STOP on
\pset footer off

\echo == 1 status_before follows a status change and cannot be set by hand
do $$
declare b text;
begin
  update public.registration_participants set status = 'waitlisted' where id = '60000000-0000-0000-0000-000000000001';
  update public.registration_participants set status = 'confirmed' where id = '60000000-0000-0000-0000-000000000001';
  select status_before into b from public.registration_participants where id = '60000000-0000-0000-0000-000000000001';
  if b is distinct from 'waitlisted' then raise exception 'FAIL 1: status_before is %', b; end if;
  update public.registration_participants set status_before = 'draft' where id = '60000000-0000-0000-0000-000000000001';
  select status_before into b from public.registration_participants where id = '60000000-0000-0000-0000-000000000001';
  if b is distinct from 'waitlisted' then raise exception 'FAIL 1: status_before was set by hand (%)', b; end if;
  raise notice 'PASS 1 status_before stamps the old status and keeps it';
end $$;

\echo == 2 a family sees no reminder rows and cannot pause
insert into public.reminder_sends (kind, item_key, registration_id, sent_on, status)
values ('deposit', '50000000-0000-0000-0000-000000000001:2026-11-15', '50000000-0000-0000-0000-000000000001', '2026-11-15', 'sent');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.reminder_sends;
  if n <> 0 then raise exception 'FAIL 2: a family reads % reminder rows', n; end if;
  begin
    perform public.set_reminder_pause('50000000-0000-0000-0000-000000000001', true, null);
    raise exception 'FAIL 2: a family paused reminders';
  exception when insufficient_privilege then raise notice 'PASS 2 a family cannot pause reminders';
  end;
  begin
    insert into public.reminder_pauses (registration_id) values ('50000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 2: a family wrote reminder_pauses';
  exception when insufficient_privilege then raise notice 'PASS 2 a family cannot write reminder_pauses';
  end;
end $$;
rollback;

\echo == 3 a registrar reads, pauses and resumes; the pause is stamped
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare n int; who uuid;
begin
  select count(*) into n from public.reminder_sends;
  if n <> 1 then raise exception 'FAIL 3: a registrar reads % reminder rows', n; end if;
  perform public.set_reminder_pause('50000000-0000-0000-0000-000000000001', true, 'Talking to them');
  select paused_by into who from public.reminder_pauses where registration_id = '50000000-0000-0000-0000-000000000001';
  if who is distinct from '00000000-0000-0000-0000-00000000000b' then raise exception 'FAIL 3: pause stamped %', who; end if;
  perform public.set_reminder_pause('50000000-0000-0000-0000-000000000001', false, null);
  select count(*) into n from public.reminder_pauses;
  if n <> 0 then raise exception 'FAIL 3: resume left % pauses', n; end if;
  begin
    insert into public.reminder_sends (kind, item_key, sent_on, status) values ('deposit', 'x', current_date, 'sent');
    raise exception 'FAIL 3: a registrar wrote reminder_sends';
  exception when insufficient_privilege then raise notice 'PASS 3 reminder_sends is read-only for staff';
  end;
  raise notice 'PASS 3 a registrar reads, pauses (stamped) and resumes';
end $$;
rollback;

\echo == 4 one row per (kind, item_key)
do $$
begin
  insert into public.reminder_sends (kind, item_key, sent_on, status)
  values ('deposit', '50000000-0000-0000-0000-000000000001:2026-11-15', '2026-11-15', 'sent');
  raise exception 'FAIL 4: the same reminder was recorded twice';
exception when unique_violation then raise notice 'PASS 4 a reminder is recorded once';
end $$;

\echo ALL REMINDER CHECKS PASSED
