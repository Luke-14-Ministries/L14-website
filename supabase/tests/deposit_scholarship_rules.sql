-- Checks for migration 0168: a granted scholarship pays toward the deposit first.
-- Run on a fresh database seeded with payment_plans_seed.sql (see README.md):
--   L14_DB=l14_dep bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d l14_dep -f supabase/tests/deposit_scholarship_rules.sql
-- The seed: one registration, two people at $600 each, a $50-a-person deposit
-- ($100 expected), nothing paid. The registrar (...0b) has Payments write.
\set ON_ERROR_STOP on
\pset footer off

create or replace function pg_temp.look()
returns table (cls text, flags text[], sch bigint, dep_in boolean)
language sql as $$
  select v.review_class, v.flags, v.deposit_scholarship_cents,
         (select d.deposit_in from public.registration_deposit_in(array['50000000-0000-0000-0000-000000000001'::uuid]) d)
  from public.registration_review v where v.registration_id = '50000000-0000-0000-0000-000000000001';
$$;

\echo == 1 nothing paid, no scholarship: deposit short, held
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  select * into r from pg_temp.look();
  if r.cls <> 'neither' or r.dep_in or r.sch <> 0 then raise exception 'FAIL 1: % % % %', r.cls, r.flags, r.sch, r.dep_in; end if;
  raise notice 'PASS 1 nothing paid: neither, held';
end $$;
rollback;

\echo == 2 a $50 granted scholarship on one person covers half: still short, still held
begin;
update public.participant_money set scholarship_cents = 5000 where participant_id = '60000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  select * into r from pg_temp.look();
  if r.cls <> 'neither' or r.dep_in or r.sch <> 5000 then raise exception 'FAIL 2: % % % %', r.cls, r.flags, r.sch, r.dep_in; end if;
  raise notice 'PASS 2 $50 granted of a $100 deposit: neither, held, $50 counted';
end $$;
rollback;

\echo == 3 granted scholarships covering the deposit: deposit in, released
begin;
update public.participant_money set scholarship_cents = 5000
 where participant_id in ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  select * into r from pg_temp.look();
  if r.cls <> 'deposit_paid' or not r.dep_in or r.sch <> 10000 or 'deposit_short' = any(r.flags) then
    raise exception 'FAIL 3: % % % %', r.cls, r.flags, r.sch, r.dep_in;
  end if;
  raise notice 'PASS 3 $100 granted covers the deposit: deposit_paid, released';
end $$;
rollback;

\echo == 4 $25 paid plus $50 granted: short of $100, flagged deposit_short, held; $50 more paid: in
begin;
update public.participant_money set scholarship_cents = 5000 where participant_id = '60000000-0000-0000-0000-000000000001';
insert into public.payments (registration_id, amount_cents, method, status)
values ('50000000-0000-0000-0000-000000000001', 2500, 'card', 'succeeded');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  select * into r from pg_temp.look();
  if r.cls <> 'neither' or r.dep_in or not ('deposit_short' = any(r.flags)) then
    raise exception 'FAIL 4: % % % %', r.cls, r.flags, r.sch, r.dep_in;
  end if;
  raise notice 'PASS 4a $25 paid + $50 granted: deposit_short, held';
end $$;
reset role;
insert into public.payments (registration_id, amount_cents, method, status)
values ('50000000-0000-0000-0000-000000000001', 2500, 'card', 'succeeded');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from pg_temp.look();
  if r.cls <> 'deposit_paid' or not r.dep_in or 'deposit_short' = any(r.flags) then
    raise exception 'FAIL 4b: % % % %', r.cls, r.flags, r.sch, r.dep_in;
  end if;
  raise notice 'PASS 4b $50 paid + $50 granted: deposit_paid, released';
end $$;
rollback;

\echo == 5 a requested partial scholarship counts nothing until granted
begin;
insert into public.scholarships (registration_participant_id, status, requested_cents)
values ('60000000-0000-0000-0000-000000000001', 'requested', 10000),
       ('60000000-0000-0000-0000-000000000002', 'requested', 10000);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  select * into r from pg_temp.look();
  if r.cls <> 'neither' or r.dep_in or r.sch <> 0 then raise exception 'FAIL 5: % % % %', r.cls, r.flags, r.sch, r.dep_in; end if;
  raise notice 'PASS 5 a requested partial scholarship: neither, held';
end $$;
rollback;

\echo == 6 a full scholarship keeps its own class, and is released as before
begin;
insert into public.scholarships (registration_participant_id, status, granted_cents)
values ('60000000-0000-0000-0000-000000000001', 'granted', 60000),
       ('60000000-0000-0000-0000-000000000002', 'granted', 60000);
update public.participant_money set scholarship_cents = 60000
 where participant_id in ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true),
       set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
do $$
declare r record;
begin
  select * into r from pg_temp.look();
  if r.cls <> 'full_scholarship' or not r.dep_in then raise exception 'FAIL 6: % % % %', r.cls, r.flags, r.sch, r.dep_in; end if;
  raise notice 'PASS 6 full scholarship: full_scholarship, released';
end $$;
rollback;

\echo ALL DEPOSIT SCHOLARSHIP CHECKS PASSED
