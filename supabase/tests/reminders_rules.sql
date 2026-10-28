-- Checks for migration 0138 (the automatic emails' tables), and the print
-- sheets' definer functions 0139 and 0140. Run after
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

\echo == 5 activity_safety_flags (0139): flags only, for Activities read, never for a family
insert into public.activities (id, event_id, name) values ('a0000000-0000-0000-0000-000000000001', (select event_id from public.registrations where id = '50000000-0000-0000-0000-000000000001'), 'Swimming');
insert into public.activity_signups (registration_participant_id, activity_id) values ('60000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001');
insert into public.person_support (person_id, has_allergies, allergy_severity, allergens, allergy_detail, details_saved_at)
values ('20000000-0000-0000-0000-000000000001', true, 'severe', array['peanut'], 'hives and swelling', now())
on conflict (person_id) do update set has_allergies = true, allergy_severity = 'severe', allergens = array['peanut'], allergy_detail = 'hives and swelling', details_saved_at = now();
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  select * into r from public.activity_safety_flags(array['20000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000002'::uuid]);
  if r.person_id is null or not r.has_allergies or r.allergy_severity <> 'severe' or r.allergens <> array['peanut'] then
    raise exception 'FAIL 5: flags read %', row_to_json(r);
  end if;
  raise notice 'PASS 5 Activities read gets the flags and allergen names (and only people with a signup)';
end $$;
select count(*) as expect_1_signed_up_person from public.activity_safety_flags(array['20000000-0000-0000-0000-000000000001'::uuid, '20000000-0000-0000-0000-000000000002'::uuid]);
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.activity_safety_flags(array['20000000-0000-0000-0000-000000000001'::uuid]);
  if n <> 0 then raise exception 'FAIL 5: a stranger read % flag rows', n; end if;
  raise notice 'PASS 5 a stranger reads no flags';
end $$;
rollback;

\echo == 6 buddy_sheet_support (0140): Buddies read, paired campers only, never a family
insert into public.buddy_assignments (event_id, buddy_participant_id, camper_participant_id)
values ((select event_id from public.registrations where id = '50000000-0000-0000-0000-000000000001'),
        '60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001');
update public.person_support set communication = 'Uses a few signs' where person_id = '20000000-0000-0000-0000-000000000001';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record; n int;
begin
  select * into r from public.buddy_sheet_support(array['60000000-0000-0000-0000-000000000001'::uuid]);
  if r.participant_id is null or not r.details_saved or r.communication <> 'Uses a few signs'
     or r.allergy_detail <> 'hives and swelling' then
    raise exception 'FAIL 6: support read %', row_to_json(r);
  end if;
  select count(*) into n from public.buddy_sheet_support(array['60000000-0000-0000-0000-000000000002'::uuid]);
  if n <> 0 then raise exception 'FAIL 6: an unpaired person (the buddy) returned % rows', n; end if;
  raise notice 'PASS 6 Buddies read gets a paired camper''s sheet details, and only theirs';
end $$;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',true) \g /dev/null
do $$
declare n int;
begin
  select count(*) into n from public.buddy_sheet_support(array['60000000-0000-0000-0000-000000000001'::uuid]);
  if n <> 0 then raise exception 'FAIL 6: a stranger read % support rows', n; end if;
  raise notice 'PASS 6 a stranger reads no buddy-sheet details';
end $$;
rollback;

\echo ALL REMINDER CHECKS PASSED
