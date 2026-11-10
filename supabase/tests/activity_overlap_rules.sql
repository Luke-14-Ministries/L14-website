-- Checks for migration 0156: one person cannot hold two activity sittings that
-- overlap on the same day (Ellen, 9 Nov 2026). Back to back is allowed, other
-- days are allowed, another person is unaffected, cancelled rows hold nothing.
-- Run on a fresh database seeded with payment_plans_seed.sql (see README.md):
--   L14_DB=l14_overlap bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d l14_overlap -f supabase/tests/activity_overlap_rules.sql
\set ON_ERROR_STOP on
\pset footer off
begin;
insert into public.activities (id, event_id, name, booking_mode) values
 ('a0000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Haircut','signup'),
 ('a0000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Massage','signup');
insert into public.activity_slots (id, activity_id, slot_date, start_time, end_time, capacity) values
 ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','2027-07-22','13:00','13:20',10),
 ('b0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','2027-07-22','13:00','13:30',10),
 ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','2027-07-22','13:20','13:50',10),
 ('b0000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000002','2027-07-21','13:00','13:30',10);

do $$
declare n int;
begin
  insert into public.activity_signups (registration_participant_id, activity_id, slot_id)
  values ('60000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001');

  -- 1. The 1pm Massage on the same day as the 1pm Haircut is refused.
  begin
    insert into public.activity_signups (registration_participant_id, activity_id, slot_id)
    values ('60000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002');
    raise exception 'FAIL 1: overlapping sitting accepted';
  exception when check_violation then
    if sqlerrm not like '%clashes with%' then raise exception 'FAIL 1 words: %', sqlerrm; end if;
    raise notice 'PASS 1 overlap refused (%)', sqlerrm;
  end;

  -- 2. Back to back (1:20) is allowed.
  insert into public.activity_signups (registration_participant_id, activity_id, slot_id)
  values ('60000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000003');
  raise notice 'PASS 2 back to back allowed';

  -- 3. Moving the Massage onto the clashing time is refused too (an update).
  begin
    update public.activity_signups set slot_id = 'b0000000-0000-0000-0000-000000000002'
    where registration_participant_id = '60000000-0000-0000-0000-000000000001'
      and activity_id = 'a0000000-0000-0000-0000-000000000002';
    raise exception 'FAIL 3: move onto an overlap accepted';
  exception when check_violation then
    raise notice 'PASS 3 moving onto an overlap refused';
  end;

  -- 4. Another day at the same hour is fine.
  update public.activity_signups set slot_id = 'b0000000-0000-0000-0000-000000000004'
  where registration_participant_id = '60000000-0000-0000-0000-000000000001'
    and activity_id = 'a0000000-0000-0000-0000-000000000002';
  raise notice 'PASS 4 same time on another day allowed';

  -- 5. Another person may take the clashing time.
  insert into public.activity_signups (registration_participant_id, activity_id, slot_id)
  values ('60000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000002');
  raise notice 'PASS 5 another person unaffected';

  -- 6. Once the Haircut is cancelled, the 1pm Massage is free for the first person.
  update public.activity_signups set status = 'cancelled', slot_id = null
  where registration_participant_id = '60000000-0000-0000-0000-000000000001'
    and activity_id = 'a0000000-0000-0000-0000-000000000001';
  update public.activity_signups set slot_id = 'b0000000-0000-0000-0000-000000000002'
  where registration_participant_id = '60000000-0000-0000-0000-000000000001'
    and activity_id = 'a0000000-0000-0000-0000-000000000002';
  raise notice 'PASS 6 a cancelled signup holds nothing';
end $$;
rollback;
