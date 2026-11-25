-- Checks for migrations 0165, 0167 and 0170: VolunteerBadge requests. Who may send and read them,
-- one open invite per person and per address, the adult / Not permitted guard,
-- the frozen columns, and OK to serve from a clear result (never from a sandbox one;
-- 0167: a completion date that fits the invite, and a newer check on file wins;
-- 0177: a family can't delete a screened person or change a locked date of birth).
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

-- 0167 refuses a completion date before the invite was sent, and sent_at is
-- frozen by the guard: date this invite 1 Nov 2026 with the guard off, so the
-- fixed completion times below come after it.
alter table public.volunteerbadge_requests disable trigger volunteerbadge_requests_guard;
update public.volunteerbadge_requests set sent_at = '2026-11-01 12:00+00' where id = '65000000-0000-0000-0000-000000000001';
alter table public.volunteerbadge_requests enable trigger volunteerbadge_requests_guard;

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

\echo == 6 (0167) the completion date must fit the invite, and a newer check on file wins
delete from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';

-- 6a a completion date before the invite was sent
begin;
update public.volunteerbadge_requests set completed_at = '2026-10-30 12:00+00' where id = '65000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
begin
  begin
    perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 6a: a completion date before the invite was accepted';
  exception when raise_exception then
    if sqlerrm not like '%doesn''t fit this invite%' then raise exception 'FAIL 6a: wrong words: %', sqlerrm; end if;
  end;
end $$;
\echo PASS 6a a completion date before the invite is refused
rollback;

-- 6b a completion date more than a day ahead
begin;
update public.volunteerbadge_requests set completed_at = now() + interval '2 days' where id = '65000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
begin
  begin
    perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 6b: a completion date in the future was accepted';
  exception when raise_exception then
    if sqlerrm not like '%doesn''t fit this invite%' then raise exception 'FAIL 6b: wrong words: %', sqlerrm; end if;
  end;
end $$;
\echo PASS 6b a completion date more than a day ahead is refused
rollback;

-- 6c a newer, current, ok check on file is kept; the request is still confirmed
begin;
update public.volunteerbadge_requests set completed_at = now() - interval '3 days' where id = '65000000-0000-0000-0000-000000000001';
insert into public.person_clearances (person_id, provider, screening_reason, background_check_on_file, background_check_date, verdict)
values ('20000000-0000-0000-0000-000000000002', 'checkr', 'volunteer', true, (now() at time zone 'America/New_York')::date - 1, 'ok');
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare words text; r record; q record;
begin
  words := public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
  if words is null or words not like 'A newer check (%) is already on file, so its date was kept.' then
    raise exception 'FAIL 6c: the function said %', coalesce(words, 'nothing');
  end if;
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if r.provider <> 'checkr' or r.background_check_date <> (now() at time zone 'America/New_York')::date - 1 or r.verdict <> 'ok' or r.expires_on is null then
    raise exception 'FAIL 6c: the newer check was changed: %', row_to_json(r);
  end if;
  select * into q from public.volunteerbadge_requests where id = '65000000-0000-0000-0000-000000000001';
  if q.confirmed_at is null then raise exception 'FAIL 6c: the request was not stamped confirmed'; end if;
  raise notice 'PASS 6c a newer current ok check is kept, the request is confirmed, and staff are told: %', words;
end $$;
rollback;

-- 6d a newer Follow up check is refused and left as it was
begin;
update public.volunteerbadge_requests set completed_at = now() - interval '3 days' where id = '65000000-0000-0000-0000-000000000001';
insert into public.person_clearances (person_id, provider, screening_reason, background_check_on_file, background_check_date, verdict)
values ('20000000-0000-0000-0000-000000000002', 'checkr', 'volunteer', true, (now() at time zone 'America/New_York')::date - 1, 'follow_up');
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record; q record;
begin
  begin
    perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 6d: a newer Follow up check was overwritten';
  exception when raise_exception then
    if sqlerrm not like '%marked Follow up%' then raise exception 'FAIL 6d: wrong words: %', sqlerrm; end if;
  end;
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  select * into q from public.volunteerbadge_requests where id = '65000000-0000-0000-0000-000000000001';
  if r.verdict is distinct from 'follow_up' or r.provider <> 'checkr' or q.confirmed_at is not null then
    raise exception 'FAIL 6d: % / confirmed %', row_to_json(r), q.confirmed_at;
  end if;
  raise notice 'PASS 6d a newer Follow up check is refused and left as it was';
end $$;
rollback;

-- 6e a newer check with no decision is refused and left as it was
begin;
update public.volunteerbadge_requests set completed_at = now() - interval '3 days' where id = '65000000-0000-0000-0000-000000000001';
insert into public.person_clearances (person_id, provider, screening_reason, background_check_on_file, background_check_date, verdict)
values ('20000000-0000-0000-0000-000000000002', 'checkr', 'volunteer', true, (now() at time zone 'America/New_York')::date - 1, null);
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record; q record;
begin
  begin
    perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 6e: a newer check with no decision was overwritten';
  exception when raise_exception then
    if sqlerrm not like '%no decision yet%' then raise exception 'FAIL 6e: wrong words: %', sqlerrm; end if;
  end;
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  select * into q from public.volunteerbadge_requests where id = '65000000-0000-0000-0000-000000000001';
  if r.verdict is distinct from null or r.provider <> 'checkr' or q.confirmed_at is not null then
    raise exception 'FAIL 6e: % / confirmed %', row_to_json(r), q.confirmed_at;
  end if;
  raise notice 'PASS 6e a newer check with no decision is refused and left as it was';
end $$;
rollback;

-- 6f an older check on file is replaced, as before
begin;
update public.volunteerbadge_requests set completed_at = now() - interval '3 days' where id = '65000000-0000-0000-0000-000000000001';
insert into public.person_clearances (person_id, provider, screening_reason, background_check_on_file, background_check_date, verdict)
values ('20000000-0000-0000-0000-000000000002', 'checkr', 'volunteer', true, (now() at time zone 'America/New_York')::date - 40, 'follow_up');
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare words text; r record;
begin
  words := public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
  if words is not null then raise exception 'FAIL 6f: the function said %', words; end if;
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if r.provider <> 'volunteerbadge' or r.verdict <> 'ok'
     or r.background_check_date <> ((now() - interval '3 days') at time zone 'America/New_York')::date then
    raise exception 'FAIL 6f: the older check was not replaced: %', row_to_json(r);
  end if;
  raise notice 'PASS 6f an older check is replaced by the VolunteerBadge result';
end $$;
rollback;

\echo == 7 (0170) templates per group, and the check of a family adult is recorded as theirs
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare t record;
begin
  perform public.set_vb_templates('tpl_volunteer_1', 'tpl_family_1');
  select vb_template_volunteer, vb_template_family into t from public.background_check_settings;
  if t.vb_template_volunteer <> 'tpl_volunteer_1' or t.vb_template_family <> 'tpl_family_1' then
    raise exception 'FAIL 7a: templates read % / %', t.vb_template_volunteer, t.vb_template_family;
  end if;
  begin
    perform public.set_vb_templates('bad id!', null);
    raise exception 'FAIL 7b: a malformed template id was saved';
  exception when check_violation then raise notice 'PASS 7b a malformed template id is refused';
  end;
  raise notice 'PASS 7a a checks writer sets each group''s template';
end $$;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
begin
  begin
    perform public.set_vb_templates('tpl_x', 'tpl_y');
    raise exception 'FAIL 7c: background_checks read set the templates';
  exception when insufficient_privilege then raise notice 'PASS 7c read-only staff cannot set the templates';
  end;
end $$;
rollback;

-- Pa (a parent, no volunteer place): an adult participant's check.
begin;
update public.volunteerbadge_requests set completed_at = now() - interval '1 day' where id = '65000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if r.provider <> 'volunteerbadge' or r.screening_reason <> 'adult_participant' then
    raise exception 'FAIL 7d: % / %', r.provider, r.screening_reason;
  end if;
  raise notice 'PASS 7d a family adult''s VolunteerBadge check is recorded as an adult participant''s';
end $$;
rollback;

-- The same person as a volunteer: a volunteer's check.
begin;
update public.volunteerbadge_requests set completed_at = now() - interval '1 day' where id = '65000000-0000-0000-0000-000000000001';
update public.registration_participants set camp_role = 'volunteer' where id = '60000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  perform public.confirm_volunteerbadge_clear('65000000-0000-0000-0000-000000000001');
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if r.screening_reason <> 'volunteer' then raise exception 'FAIL 7e: %', r.screening_reason; end if;
  raise notice 'PASS 7e a volunteer''s check is recorded as a volunteer''s';
end $$;
rollback;

-- 0177 (23 Nov 2026): records a family can't remove or rewrite. Ad (...03)
-- has a VolunteerBadge invite; Cam (...01) a submitted place; ...04 a place
-- and no date of birth; ...05 nothing at all.
\echo == 8 a family cannot delete a screened person or change a locked date of birth
begin;
insert into public.volunteerbadge_requests (id, person_id, invited_email, sandbox)
values ('65000000-0000-0000-0000-000000000077','20000000-0000-0000-0000-000000000003','ad3@example.test', false);
insert into public.people (id, household_id, first_name, last_name) values
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','No','Birthday'),
 ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Wrong','Entry');
insert into public.registration_participants (id, registration_id, person_id, event_option_id, camp_role, status) values
 ('60000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','sibling','submitted');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true),
       set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a"}',true) \g /dev/null
do $$
declare n int;
begin
  begin
    delete from public.people where id = '20000000-0000-0000-0000-000000000003';
    raise exception 'FAIL 8a: a family deleted a person with an invite on file';
  exception when insufficient_privilege then
    if sqlerrm <> 'Ask the office to remove this person.' then raise exception 'FAIL 8a words: %', sqlerrm; end if;
  end;
  raise notice 'PASS 8a a family can''t delete a person with a background check invite on file';

  begin
    update public.people set date_of_birth = '1971-01-01' where id = '20000000-0000-0000-0000-000000000003';
    raise exception 'FAIL 8b: a family changed a screened person''s date of birth';
  exception when insufficient_privilege then
    if sqlerrm not like 'To correct a date of birth after registering, email registration@%' then raise exception 'FAIL 8b words: %', sqlerrm; end if;
  end;
  begin
    update public.people set date_of_birth = '2014-04-04' where id = '20000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 8c: a family changed a registered camper''s date of birth';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.people set date_of_birth = null where id = '20000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 8d: a family blanked a registered camper''s date of birth';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 8b a family can''t change or blank a locked date of birth';

  update public.people set date_of_birth = '2012-02-02' where id = '20000000-0000-0000-0000-000000000004';
  update public.people set first_name = 'Ad' where id = '20000000-0000-0000-0000-000000000003';
  raise notice 'PASS 8c a missing date of birth can be filled in; other edits still save';

  if not public.person_dob_locked('20000000-0000-0000-0000-000000000003')
     or not public.person_dob_locked('20000000-0000-0000-0000-000000000001')
     or public.person_dob_locked('20000000-0000-0000-0000-000000000005') then
    raise exception 'FAIL 8d: person_dob_locked() reads wrong for the family';
  end if;
  raise notice 'PASS 8d the family reads which dates are locked';

  delete from public.people where id = '20000000-0000-0000-0000-000000000005';
  select count(*) into n from public.people where id = '20000000-0000-0000-0000-000000000005';
  if n <> 0 then raise exception 'FAIL 8e: a wrong entry was not deleted'; end if;
  raise notice 'PASS 8e a person with nothing on file can still be deleted';
end $$;

-- Another family learns nothing about this household's people.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',true) \g /dev/null
do $$
begin
  if public.person_screening_on_file('20000000-0000-0000-0000-000000000003')
     or public.person_dob_locked('20000000-0000-0000-0000-000000000001') then
    raise exception 'FAIL 8f: another login read this household''s locks';
  end if;
  raise notice 'PASS 8f the locks answer only for your own household';
end $$;

-- The seed's registrar (Registration write) corrects it.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","aal":"aal2"}',true) \g /dev/null
do $$
begin
  update public.people set date_of_birth = '1971-01-01' where id = '20000000-0000-0000-0000-000000000003';
  if (select date_of_birth from public.people where id = '20000000-0000-0000-0000-000000000003') <> '1971-01-01' then
    raise exception 'FAIL 8g: the registrar''s correction did not save';
  end if;
  raise notice 'PASS 8g staff with Registration write correct a date of birth';
end $$;
rollback;

\echo == 9 recorded as cancelled in VolunteerBadge (0187)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','16500000-0000-4000-8000-000000000001',true),
       set_config('request.jwt.claims','{"sub":"16500000-0000-4000-8000-000000000001","aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  insert into public.volunteerbadge_requests (id, person_id, invited_email, sandbox, vb_cancelled_at)
  values ('65000000-0000-0000-0000-000000000091','20000000-0000-0000-0000-000000000002','cancel9@example.test', false, now());
  select * into r from public.volunteerbadge_requests where id = '65000000-0000-0000-0000-000000000091';
  if r.vb_cancelled_at is not null then raise exception 'FAIL 9a: a new row came in already marked cancelled in VB'; end if;
  raise notice 'PASS 9a a new row can''t start marked cancelled in VolunteerBadge';
  begin
    update public.volunteerbadge_requests set vb_cancelled_at = now() where id = '65000000-0000-0000-0000-000000000091';
    raise exception 'FAIL 9b: an open invite was marked cancelled in VB';
  exception when sqlstate 'P0001' then raise notice 'PASS 9b only a taken-back or replaced invite can be marked';
  end;
  update public.volunteerbadge_requests set status = 'cancelled' where id = '65000000-0000-0000-0000-000000000091';
  update public.volunteerbadge_requests
     set vb_cancelled_at = '2000-01-01', vb_cancelled_by = '00000000-0000-0000-0000-00000000000b'
   where id = '65000000-0000-0000-0000-000000000091';
  select * into r from public.volunteerbadge_requests where id = '65000000-0000-0000-0000-000000000091';
  if r.vb_cancelled_at < now() - interval '1 minute'
     or r.vb_cancelled_by is distinct from '16500000-0000-4000-8000-000000000001' then
    raise exception 'FAIL 9c: the stamp reads % / %', r.vb_cancelled_at, r.vb_cancelled_by;
  end if;
  raise notice 'PASS 9c the stamp is now() and the signed-in writer, whatever was sent';
  begin
    update public.volunteerbadge_requests set vb_cancelled_at = null, vb_cancelled_by = null
     where id = '65000000-0000-0000-0000-000000000091';
    raise exception 'FAIL 9d: the stamp was cleared';
  exception when sqlstate 'P0001' then raise notice 'PASS 9d the stamp can''t be cleared or changed';
  end;
end $$;
-- The seed's registrar holds Background checks read only: may see the row, can't stamp one.
update public.volunteerbadge_requests set status = 'superseded' where id = '65000000-0000-0000-0000-000000000091';
insert into public.volunteerbadge_requests (id, person_id, invited_email, sandbox)
values ('65000000-0000-0000-0000-000000000092','20000000-0000-0000-0000-000000000003','cancel9b@example.test', false);
update public.volunteerbadge_requests set status = 'cancelled' where id = '65000000-0000-0000-0000-000000000092';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","aal":"aal2"}',true) \g /dev/null
do $$
declare n int;
begin
  update public.volunteerbadge_requests set vb_cancelled_at = now() where id = '65000000-0000-0000-0000-000000000092';
  get diagnostics n = row_count;
  if n > 0 then raise exception 'FAIL 9e: a reader marked an invite cancelled in VB'; end if;
  raise notice 'PASS 9e a reader can''t mark it (no row reached)';
exception when sqlstate '42501' then raise notice 'PASS 9e a reader can''t mark it';
end $$;
rollback;

\echo ALL VOLUNTEERBADGE CHECKS PASSED
