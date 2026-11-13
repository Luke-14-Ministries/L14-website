-- Checks for migration 0165: VolunteerBadge requests. Who may send and read them,
-- one open invite per person and per address, the adult / Not permitted guard,
-- the frozen columns, and OK to serve from a clear result (never from a sandbox one).
-- Run on a fresh database seeded with payment_plans_seed.sql (see README.md):
--   L14_DB=l14_vb bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d l14_vb -f supabase/tests/volunteerbadge_rules.sql
\set ON_ERROR_STOP on
\pset footer off

-- A staff member with the background-checks write grant. The seed's registrar
-- (...0b) holds only background_checks read.
insert into auth.users (id, email) values ('16500000-0000-4000-8000-000000000001','checks@example.test');
insert into public.staff (profile_id, role) values ('16500000-0000-4000-8000-000000000001','coordinator');
insert into public.staff_grants (profile_id, area, level) values
  ('16500000-0000-4000-8000-000000000001','background_checks','write');
-- Pa (...02) an adult; Cam (...01) a child; a third adult on the household's address.
update public.people set date_of_birth = '1980-04-04' where id = '20000000-0000-0000-0000-000000000002';
update public.people set date_of_birth = '2015-04-04' where id = '20000000-0000-0000-0000-000000000001';
insert into public.people (id, household_id, first_name, last_name, date_of_birth)
values ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Ad','Ult','1970-01-01');

\echo == 1 a checks writer sends, one open invite per person and per address
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  insert into public.volunteerbadge_requests (id, person_id, invited_email, sandbox, status, sent_by)
  values ('65000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','home@example.test', false, 'clear', null);
  select * into r from public.volunteerbadge_requests where id = '65000000-0000-0000-0000-000000000001';
  if r.status <> 'sending' or r.sent_by is distinct from '16500000-0000-4000-8000-000000000001' then
    raise exception 'FAIL 1: a new row reads % / %', r.status, r.sent_by;
  end if;
  raise notice 'PASS 1 a new request starts as sending, stamped with who sent it';
  begin
    insert into public.volunteerbadge_requests (person_id, invited_email, sandbox)
    values ('20000000-0000-0000-0000-000000000002','other@example.test', false);
    raise exception 'FAIL 1b: a second open invite for one person';
  exception when unique_violation then raise notice 'PASS 1b one open invite per person';
  end;
  begin
    insert into public.volunteerbadge_requests (person_id, invited_email, sandbox)
    values ('20000000-0000-0000-0000-000000000003','home@example.test', false);
    raise exception 'FAIL 1c: two open invites at one address';
  exception when unique_violation then raise notice 'PASS 1c one open invite per address';
  end;
  -- A test-mode invite is counted apart from the live one.
  insert into public.volunteerbadge_requests (id, person_id, invited_email, sandbox)
  values ('65000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000002','pa@luke14ministries.net', true);
  raise notice 'PASS 1d a sandbox invite does not collide with a live one';
  begin
    insert into public.volunteerbadge_requests (person_id, invited_email, sandbox)
    values ('20000000-0000-0000-0000-000000000003','ad@example.test', true);
    raise exception 'FAIL 1d2: a test invite to a family address';
  exception when check_violation then raise notice 'PASS 1d2 test mode sends only to ministry addresses';
  end;
  begin
    insert into public.volunteerbadge_requests (person_id, invited_email, sandbox)
    values ('20000000-0000-0000-0000-000000000001','kid@example.test', false);
    raise exception 'FAIL 1e: a child was invited';
  exception when check_violation then raise notice 'PASS 1e a child is refused';
  end;
  begin
    insert into public.volunteerbadge_requests (person_id, invited_email, sandbox)
    values ('20000000-0000-0000-0000-000000000003','Ad@Example.test ', false);
    raise exception 'FAIL 1f: an untidy address was stored';
  exception when check_violation then raise notice 'PASS 1f the address is stored tidy or not at all';
  end;
end $$;
commit;

\echo == 1g a resend without the ID step needs its reason, and replaces the open invite
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  begin
    insert into public.volunteerbadge_requests (person_id, invited_email, sandbox, id_verification_waived)
    values ('20000000-0000-0000-0000-000000000003','ad@example.test', false, true);
    raise exception 'FAIL 1g: a waiver without a reason';
  exception when check_violation then raise notice 'PASS 1g a waived ID step needs its reason';
  end;
  update public.volunteerbadge_requests set status = 'superseded' where id = '65000000-0000-0000-0000-000000000001';
  insert into public.volunteerbadge_requests (id, person_id, invited_email, sandbox, id_verification_waived, id_verification_reason)
  values ('65000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','home@example.test', false, true, 'Declined the photo ID step; approved by Larry');
  select * into r from public.volunteerbadge_requests where id = '65000000-0000-0000-0000-000000000002';
  if r.status <> 'sending' or not r.id_verification_waived then raise exception 'FAIL 1h: %', row_to_json(r); end if;
  begin
    update public.volunteerbadge_requests set id_verification_waived = false, id_verification_reason = null
     where id = '65000000-0000-0000-0000-000000000002';
    raise exception 'FAIL 1i: the waiver was rewritten';
  exception when raise_exception then raise notice 'PASS 1i the waiver stays on the record';
  end;
  raise notice 'PASS 1h a superseded invite makes room for the resend';
end $$;
rollback;

\echo == 2 Not permitted is never invited, and the frozen columns stay frozen
insert into public.person_clearances (person_id, provider, verdict) values ('20000000-0000-0000-0000-000000000003','manual','not_permitted');
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
begin
  begin
    insert into public.volunteerbadge_requests (person_id, invited_email, sandbox)
    values ('20000000-0000-0000-0000-000000000003','ad@example.test', false);
    raise exception 'FAIL 2: Not permitted was invited';
  exception when raise_exception then raise notice 'PASS 2 Not permitted is refused';
  end;
  begin
    update public.volunteerbadge_requests set invited_email = 'x@example.test' where id = '65000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 2b: the address was changed';
  exception when raise_exception then raise notice 'PASS 2b the address sent cannot change';
  end;
  begin
    update public.volunteerbadge_requests set confirmed_at = now() where id = '65000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 2c: confirmed by hand';
  exception when raise_exception then raise notice 'PASS 2c confirming is the button''s job';
  end;
end $$;
rollback;
delete from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000003';

\echo == 3 read-only and family callers see and send nothing
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.volunteerbadge_requests;
  if n <> 0 then raise exception 'FAIL 3: background_checks read saw % requests', n; end if;
  begin
    insert into public.volunteerbadge_requests (person_id, invited_email, sandbox)
    values ('20000000-0000-0000-0000-000000000003','ad@example.test', false);
    raise exception 'FAIL 3b: background_checks read sent an invite';
  exception when insufficient_privilege then raise notice 'PASS 3b read-only staff cannot send';
  end;
  begin
    perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 3c: background_checks read confirmed a result';
  exception when insufficient_privilege then raise notice 'PASS 3c read-only staff cannot confirm';
  end;
  raise notice 'PASS 3 read-only staff see no requests';
end $$;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.volunteerbadge_requests;
  if n <> 0 then raise exception 'FAIL 3d: a family saw % requests', n; end if;
  raise notice 'PASS 3d a family sees no requests';
end $$;
rollback;

\echo == 4 OK to serve: only a clear, live result, and it clears the volunteer
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record; q record;
begin
  update public.volunteerbadge_requests
     set status = 'processing', vb_check_id = 'chk-1', vb_check_status = 'processing'
   where id = '65000000-0000-0000-0000-000000000001';
  begin
    perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 4: a running check was confirmed';
  exception when raise_exception then raise notice 'PASS 4 a check still running cannot be confirmed';
  end;

  update public.volunteerbadge_requests
     set status = 'clear', vb_result = 'clear', vb_check_status = 'complete', completed_at = '2026-11-14 03:30+00'
   where id = '65000000-0000-0000-0000-000000000001';
  perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  -- 03:30 UTC on the 14th is the evening of the 13th in Morristown.
  if r.provider <> 'volunteerbadge' or not r.background_check_on_file or r.background_check_date <> '2026-11-13'
     or r.verdict <> 'ok' or r.expires_on <> ('2026-11-13'::date + make_interval(months => public.clearance_interval_months()))::date
     or r.verdict_by is distinct from '16500000-0000-4000-8000-000000000001' then
    raise exception 'FAIL 4b: person_clearances reads %', row_to_json(r);
  end if;
  select * into q from public.volunteerbadge_requests where id = '65000000-0000-0000-0000-000000000001';
  if q.confirmed_at is null or q.confirmed_by is distinct from '16500000-0000-4000-8000-000000000001' then
    raise exception 'FAIL 4c: the request was not stamped confirmed';
  end if;
  if not public.volunteer_clearance_ok('20000000-0000-0000-0000-000000000002', '2027-07-18') then
    raise exception 'FAIL 4d: the gate does not accept a VolunteerBadge check';
  end if;
  perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
  raise notice 'PASS 4b OK to serve writes the check (provider, day in ministry time, expiry by the setting, verdict ok), stamps the request, and a second click changes nothing';

  -- One VB check answers one invite.
  insert into public.volunteerbadge_requests (id, person_id, invited_email, sandbox)
  values ('65000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','ad@example.test', false);
  begin
    update public.volunteerbadge_requests set vb_check_id = 'chk-1' where id = '65000000-0000-0000-0000-000000000003';
    raise exception 'FAIL 4f: one check was tied to two people';
  exception when unique_violation then raise notice 'PASS 4f one VolunteerBadge check belongs to one invite';
  end;

  update public.volunteerbadge_requests
     set status = 'clear', vb_result = 'clear', vb_check_id = 'chk_test_clear_x', completed_at = now()
   where id = '65000000-0000-0000-0000-000000000009';
  begin
    perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000009');
    raise exception 'FAIL 4e: a sandbox result was confirmed';
  exception when raise_exception then raise notice 'PASS 4e a sandbox result never clears anyone';
  end;
end $$;
rollback;

\echo == 5 Not permitted holds at confirm time too
insert into public.person_clearances (person_id, provider, verdict) values ('20000000-0000-0000-0000-000000000002','manual','not_permitted')
on conflict (person_id) do update set verdict = 'not_permitted';
update public.volunteerbadge_requests
   set status = 'clear', vb_result = 'clear', vb_check_id = 'chk-1', completed_at = now()
 where id = '65000000-0000-0000-0000-000000000001';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
begin
  begin
    perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 5: Not permitted was overwritten by a clear result';
  exception when raise_exception then raise notice 'PASS 5 Not permitted is not overwritten by a clear result';
  end;
end $$;
rollback;

\echo ALL VOLUNTEERBADGE CHECKS PASSED
