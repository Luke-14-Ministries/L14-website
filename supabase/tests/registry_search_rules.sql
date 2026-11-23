-- Checks for migrations 0161 and 0162: an adult camper's registry search never clears a
-- volunteer, never carries into a Checkr order, and shows its provider to staff
-- (and nothing to a family) through clearance_status. 0177 (23 Nov 2026): Not
-- permitted also holds a same-name, same-birthday record until it is decided, a
-- registrar still gets 0162's words, and the helpers are staff only.
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

-- ---- 0162: every adult who isn't a volunteer, the age on the first day, Not permitted holds ----
-- A background-checks writer, and two siblings either side of 18 on the event's
-- first day (the seed event starts 2027-07-18).
insert into auth.users (id, email) values ('16200000-0000-4000-8000-000000000001','bgc-writer@example.test');
insert into public.staff (profile_id, role) values ('16200000-0000-4000-8000-000000000001','registrar');
insert into public.staff_grants (profile_id, area, level) values ('16200000-0000-4000-8000-000000000001','background_checks','write');
insert into public.people (id, household_id, first_name, last_name, date_of_birth) values
 ('20000000-0000-0000-0000-000000000018','10000000-0000-0000-0000-000000000001','Sib','Eighteen','2009-07-18'),
 ('20000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-000000000001','Sib','Seventeen','2009-07-19');
insert into public.registration_participants (id, registration_id, person_id, event_option_id, camp_role, status) values
 ('60000000-0000-0000-0000-000000000018','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000018','40000000-0000-0000-0000-000000000001','sibling','submitted'),
 ('60000000-0000-0000-0000-000000000017','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000017','40000000-0000-0000-0000-000000000001','sibling','submitted');
delete from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '16200000-0000-4000-8000-000000000001', true) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"16200000-0000-4000-8000-000000000001","aal":"aal2"}', true) \g /dev/null
do $$
declare r record;
begin
  -- 6. A sibling who is 18 on the first day of camp (17 today) can be recorded.
  perform public.record_registry_search('20000000-0000-0000-0000-000000000018', current_date, 'ok', null);
  select * into r from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000018';
  if r.provider <> 'registry_search' or not r.background_check_on_file or r.expires_on is null or r.verdict <> 'ok' then
    raise exception 'FAIL 6: sibling search not recorded (%, %, %)', r.provider, r.expires_on, r.verdict;
  end if;
  raise notice 'PASS 6 a sibling 18 on the first day of camp is recorded (age on the first day, not today)';

  -- 7. One who is 17 on the first day is not screened.
  begin
    perform public.record_registry_search('20000000-0000-0000-0000-000000000017', current_date, 'ok', null);
    raise exception 'FAIL 7: a sibling 17 on the first day was recorded';
  exception when check_violation then null;
  end;
  raise notice 'PASS 7 under 18 on the first day of camp is refused';

  -- 8. A parent can be recorded, here as Not permitted (a note is required).
  begin
    perform public.record_registry_search('20000000-0000-0000-0000-000000000002', current_date, 'not_permitted', null);
    raise exception 'FAIL 8a: not_permitted without a note was accepted';
  exception when check_violation then null;
  end;
  perform public.record_registry_search('20000000-0000-0000-0000-000000000002', current_date, 'not_permitted', 'Match confirmed by phone.');
  if (select verdict from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002') <> 'not_permitted' then
    raise exception 'FAIL 8b: parent not recorded as not_permitted';
  end if;
  raise notice 'PASS 8 a parent can be recorded; a finding needs a note';
end $$;

-- 9. Without the write grant: refused.
select set_config('request.jwt.claim.sub', '16100000-0000-4000-8000-000000000001', true) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"16100000-0000-4000-8000-000000000001","aal":"aal2"}', true) \g /dev/null
do $$
begin
  begin
    perform public.record_registry_search('20000000-0000-0000-0000-000000000018', current_date, 'ok', null);
    raise exception 'FAIL 9: a staff member without the grant recorded a search';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 9 recording needs the background checks grant';
end $$;
reset role;

do $$
declare v text;
begin
  -- 10. Not permitted holds approval, from any button.
  begin
    update public.registration_participants set status = 'confirmed' where id = '60000000-0000-0000-0000-000000000002';
    raise exception 'FAIL 10: a Not permitted parent was confirmed';
  exception when raise_exception then null;
  end;
  raise notice 'PASS 10 Not permitted holds approval';

  -- 11. A Checkr order does not erase Not permitted: it is refused.
  begin
    update public.person_clearances
       set provider = 'checkr', checkr_status = 'invited', ordered_at = now(), invited_email = 'pa@example.test'
     where person_id = '20000000-0000-0000-0000-000000000002';
    raise exception 'FAIL 11a: a Checkr order went through over Not permitted';
  exception when raise_exception then null;
  end;
  select verdict into v from public.person_clearances where person_id = '20000000-0000-0000-0000-000000000002';
  if v is distinct from 'not_permitted' then raise exception 'FAIL 11b: verdict is now %', v; end if;
  raise notice 'PASS 11 a Checkr order keeps Not permitted (refused)';

  -- 12. Follow-up is a warning, not a hold.
  update public.person_clearances set verdict = 'follow_up', verdict_note = 'Possible match'
   where person_id = '20000000-0000-0000-0000-000000000018';
  update public.registration_participants set status = 'confirmed' where id = '60000000-0000-0000-0000-000000000018';
  raise notice 'PASS 12 follow-up does not hold approval';
end $$;

-- ---- 0177: the same name and birth date, the 0162 message, staff-only helpers ----
-- Pa (...02) is marked Not permitted (test 8). A second record with the same
-- name (other spacing and case) and the same date of birth, on a place.
update public.people set date_of_birth = '1980-01-01' where id = '20000000-0000-0000-0000-000000000002';
insert into public.people (id, household_id, first_name, last_name, date_of_birth) values
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',' pa','RENT ','1980-01-01');
insert into public.registration_participants (id, registration_id, person_id, event_option_id, camp_role, status) values
 ('60000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','caregiver','submitted');
-- Pa's verdict a day older, so a decision on the second record can come after it.
update public.person_clearances set verdict_at = now() - interval '1 day'
 where person_id = '20000000-0000-0000-0000-000000000002';

-- As the seed's registrar (Registration write), on a strong session.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","aal":"aal2"}', true) \g /dev/null
do $$
declare n int;
begin
  -- 13. A registrar approving the Not permitted person still gets 0162's words.
  begin
    update public.registration_participants set status = 'confirmed' where id = '60000000-0000-0000-0000-000000000002';
    raise exception 'FAIL 13: a Not permitted parent was confirmed by a registrar';
  exception when raise_exception then
    if sqlerrm not like '%is marked Not permitted to attend.' or sqlerrm like '%same name%' then
      raise exception 'FAIL 13 words: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS 13 a registrar approving Not permitted gets the 0162 message';

  -- 14. The same name and birth date holds the second record, and says why.
  begin
    update public.registration_participants set status = 'confirmed' where id = '60000000-0000-0000-0000-000000000003';
    raise exception 'FAIL 14: a same-name, same-birthday record was confirmed';
  exception when raise_exception then
    if sqlerrm not like '%same name and birth date as someone marked Not permitted%' then
      raise exception 'FAIL 14 words: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS 14 the same name and birth date holds approval';

  -- 15. Staff read which records are held only by the match.
  select count(*) into n from public.not_permitted_name_matches(array[
    '20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001']::uuid[]) m
   where m = '20000000-0000-0000-0000-000000000003';
  if n <> 1 or (select count(*) from public.not_permitted_name_matches(array['20000000-0000-0000-0000-000000000002']::uuid[])) <> 0 then
    raise exception 'FAIL 15: name matches read %', n;
  end if;
  if public.not_permitted_reason('20000000-0000-0000-0000-000000000002') <> 'own'
     or not public.person_not_permitted('20000000-0000-0000-0000-000000000003') then
    raise exception 'FAIL 15b: reasons read wrong';
  end if;
  raise notice 'PASS 15 staff see the reason: own, or the same name and birth date';
end $$;
reset role;

do $$
begin
  -- 16. A decision recorded on the second record after the first clears the match.
  insert into public.person_clearances (person_id, provider, background_check_on_file, background_check_date, verdict)
  values ('20000000-0000-0000-0000-000000000003', 'manual', true, current_date, 'ok');
  if public.person_not_permitted('20000000-0000-0000-0000-000000000003') then
    raise exception 'FAIL 16: a decided record is still held';
  end if;
  update public.registration_participants set status = 'confirmed' where id = '60000000-0000-0000-0000-000000000003';
  raise notice 'PASS 16 deciding the second record clears the match';
end $$;

-- 17. A family can't ask the background-check helpers about anyone.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true) \g /dev/null
do $$
begin
  begin
    perform public.person_not_permitted('20000000-0000-0000-0000-000000000002');
    raise exception 'FAIL 17a: a family read person_not_permitted()';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.volunteer_clearance_ok('20000000-0000-0000-0000-000000000002', current_date);
    raise exception 'FAIL 17b: a family read volunteer_clearance_ok()';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.not_permitted_name_matches(array['20000000-0000-0000-0000-000000000003']::uuid[]);
    raise exception 'FAIL 17c: a family read not_permitted_name_matches()';
  exception when insufficient_privilege then null;
  end;
  if public.volunteer_not_cleared_message('20000000-0000-0000-0000-000000000002') is not null then
    raise exception 'FAIL 17d: a family read the not-cleared message';
  end if;
  raise notice 'PASS 17 the background-check helpers are staff only';
end $$;
reset role;
rollback;
\echo ALL REGISTRY SEARCH CHECKS PASSED
