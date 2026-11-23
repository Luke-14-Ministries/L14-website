-- Checks for migration 0177 (23 Nov 2026): what a family account may write.
--   * activity_signups: the activity belongs to the person's event, is active,
--     inside its sign-up window (giving a place back is always allowed), the
--     place isn't cancelled, and the row says the family added it, stamped by
--     the database. Staff with Activities write are not held to the window.
--   * registration_participants: a family's new place needs a published option
--     at a published event that isn't archived.
-- Run on a fresh database seeded with payment_plans_seed.sql (see README.md):
--   L14_DB=l14_act bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d l14_act -f supabase/tests/activity_signup_rules.sql
\set ON_ERROR_STOP on
\pset footer off
begin;
-- A second published event, and four activities: open at the family's event,
-- at the other event, closed, and switched off.
insert into public.events (id, name, event_type, starts_on, ends_on, deposit_cents, published)
 values ('30000000-0000-0000-0000-000000000002','Camp Celebrate 2027 — Week 2','camp_week','2027-07-25','2027-07-30',5000,true);
insert into public.activities (id, event_id, name, booking_mode, active, signup_closes_at) values
 ('a1770000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Fishing','signup',true,null),
 ('a1770000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','Week 2 Fishing','signup',true,null),
 ('a1770000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','Archery','signup',true,now() - interval '1 day'),
 ('a1770000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001','Canoeing','signup',false,null);
-- Cam already holds Archery from before it closed.
insert into public.activity_signups (registration_participant_id, activity_id, status, added_source)
 values ('60000000-0000-0000-0000-000000000001','a1770000-0000-0000-0000-000000000003','signed_up','family');
-- An unpublished option at the family's event; a person to add.
insert into public.event_options (id, event_id, name, fee_cents, published)
 values ('40000000-0000-0000-0000-000000000077','30000000-0000-0000-0000-000000000001','Hidden',1000,false);
insert into public.people (id, household_id, first_name, last_name, date_of_birth)
 values ('20000000-0000-0000-0000-000000000077','10000000-0000-0000-0000-000000000001','New','Person','2012-05-05');
-- A staff member with Activities write only.
insert into auth.users (id, email) values ('17700000-0000-4000-8000-000000000001','activities@example.test');
insert into public.staff (profile_id, role) values ('17700000-0000-4000-8000-000000000001','coordinator');
insert into public.staff_grants (profile_id, area, level) values ('17700000-0000-4000-8000-000000000001','activities','write');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true) \g /dev/null
do $$
declare r record;
begin
  -- 1. Another event's activity.
  begin
    insert into public.activity_signups (registration_participant_id, activity_id, status)
    values ('60000000-0000-0000-0000-000000000001','a1770000-0000-0000-0000-000000000002','signed_up');
    raise exception 'FAIL 1: signed up for another event''s activity';
  exception when insufficient_privilege then
    if sqlerrm not like '%not part of this person''s event%' then raise exception 'FAIL 1 words: %', sqlerrm; end if;
  end;
  raise notice 'PASS 1 another event''s activity is refused';

  -- 2. A closed sign-up window.
  begin
    insert into public.activity_signups (registration_participant_id, activity_id, status)
    values ('60000000-0000-0000-0000-000000000002','a1770000-0000-0000-0000-000000000003','signed_up');
    raise exception 'FAIL 2: signed up after the window closed';
  exception when insufficient_privilege then
    if sqlerrm not like 'Sign-ups for this one have closed%' then raise exception 'FAIL 2 words: %', sqlerrm; end if;
  end;
  raise notice 'PASS 2 a closed window is refused';

  -- 3. An activity switched off.
  begin
    insert into public.activity_signups (registration_participant_id, activity_id, status)
    values ('60000000-0000-0000-0000-000000000001','a1770000-0000-0000-0000-000000000004','signed_up');
    raise exception 'FAIL 3: signed up for an inactive activity';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 3 an inactive activity is refused';

  -- 4. An open one: saved, as the family's, stamped by the database.
  insert into public.activity_signups (registration_participant_id, activity_id, status, added_source, added_by, waiver_acknowledged_at)
  values ('60000000-0000-0000-0000-000000000001','a1770000-0000-0000-0000-000000000001','signed_up','staff',
          '00000000-0000-0000-0000-00000000000b','2020-01-01');
  select * into r from public.activity_signups
   where registration_participant_id = '60000000-0000-0000-0000-000000000001' and activity_id = 'a1770000-0000-0000-0000-000000000001';
  if r.added_source <> 'family' or r.added_by is distinct from '00000000-0000-0000-0000-00000000000a'
     or r.waiver_acknowledged_at < now() - interval '1 minute' then
    raise exception 'FAIL 4: row reads % / % / %', r.added_source, r.added_by, r.waiver_acknowledged_at;
  end if;
  raise notice 'PASS 4 a family signup is the family''s, stamped now';

  -- 5. An update can't relabel it.
  update public.activity_signups set added_source = 'staff', added_by = '00000000-0000-0000-0000-00000000000b'
   where registration_participant_id = '60000000-0000-0000-0000-000000000001' and activity_id = 'a1770000-0000-0000-0000-000000000001';
  select * into r from public.activity_signups
   where registration_participant_id = '60000000-0000-0000-0000-000000000001' and activity_id = 'a1770000-0000-0000-0000-000000000001';
  if r.added_source <> 'family' or r.added_by is distinct from '00000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL 5: relabelled to % / %', r.added_source, r.added_by;
  end if;
  raise notice 'PASS 5 an update keeps who added it';

  -- 6. Giving a place back after the window closed is allowed.
  update public.activity_signups set status = 'cancelled'
   where registration_participant_id = '60000000-0000-0000-0000-000000000001' and activity_id = 'a1770000-0000-0000-0000-000000000003';
  raise notice 'PASS 6 a place can be given back after the window closes';

  -- 7. Not on a place that is cancelled.
  -- (Set by the ministry; the family can't cancel a submitted place itself.)
end $$;
reset role;
update public.registration_participants set status = 'cancelled' where id = '60000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true) \g /dev/null
do $$
begin
  begin
    insert into public.activity_signups (registration_participant_id, activity_id, status)
    values ('60000000-0000-0000-0000-000000000002','a1770000-0000-0000-0000-000000000001','signed_up');
    raise exception 'FAIL 7: signed up on a cancelled place';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 7 a cancelled place takes no activity';

  -- 8. A family's new place on an unpublished option.
  begin
    insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
    values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000077','40000000-0000-0000-0000-000000000077','sibling','submitted');
    raise exception 'FAIL 8: a family used an unpublished option';
  exception when insufficient_privilege then
    if sqlerrm <> 'That option is not available.' then raise exception 'FAIL 8 words: %', sqlerrm; end if;
  end;
  raise notice 'PASS 8 an unpublished option is refused';
end $$;
reset role;

-- 9. An archived event takes no new places from a family.
update public.events set archived_at = now() where id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true) \g /dev/null
do $$
begin
  begin
    insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
    values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000077','40000000-0000-0000-0000-000000000001','sibling','submitted');
    raise exception 'FAIL 9: a family added a place at an archived event';
  exception when insufficient_privilege then
    if sqlerrm <> 'That event is not taking registrations.' then raise exception 'FAIL 9 words: %', sqlerrm; end if;
  end;
  raise notice 'PASS 9 an archived event is refused';
end $$;
reset role;
update public.events set archived_at = null where id = '30000000-0000-0000-0000-000000000001';

-- 10. Staff with Activities write may sign someone up after the window closes.
set local role authenticated;
select set_config('request.jwt.claim.sub', '17700000-0000-4000-8000-000000000001', true) \g /dev/null
select set_config('request.jwt.claims', '{"sub":"17700000-0000-4000-8000-000000000001","aal":"aal2"}', true) \g /dev/null
do $$
begin
  update public.activity_signups set status = 'signed_up', added_source = 'staff'
   where registration_participant_id = '60000000-0000-0000-0000-000000000001' and activity_id = 'a1770000-0000-0000-0000-000000000003';
  if (select added_source from public.activity_signups
       where registration_participant_id = '60000000-0000-0000-0000-000000000001' and activity_id = 'a1770000-0000-0000-0000-000000000003') <> 'staff' then
    raise exception 'FAIL 10: the staff signup did not save';
  end if;
  raise notice 'PASS 10 staff with Activities write are not held to the window';
end $$;
reset role;
rollback;
\echo ALL ACTIVITY SIGNUP CHECKS PASSED
