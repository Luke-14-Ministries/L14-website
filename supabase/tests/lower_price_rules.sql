-- Checks for migration 0145 (a lowered price reaches people already registered).
-- Run after supabase_stubs.sql, every migration, and payment_plans_seed.sql:
--   bash supabase/tests/run_rls_local.sh supabase/tests/lower_price_rules.sql
\set ON_ERROR_STOP on
\pset footer off
\i supabase/tests/payment_plans_seed.sql
-- An administrator with Setup write (recalc_event_discounts needs is_admin()).
update public.staff set role = 'admin' where profile_id = '00000000-0000-0000-0000-00000000000b';
insert into public.staff_grants (profile_id, area, level) values ('00000000-0000-0000-0000-00000000000b','setup','write') on conflict do nothing;
-- The parent has a $550 scholarship on file: more than a $500 price.
update public.participant_money set scholarship_cents = 55000 where participant_id = '60000000-0000-0000-0000-000000000002';

\echo == 1 a family cannot call it
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$ begin
  perform public.lower_registered_fees('40000000-0000-0000-0000-000000000001');
  raise exception 'FAIL: family allowed';
exception when insufficient_privilege then raise notice 'PASS family refused';
end $$;
rollback;

\echo == 2 a raise changes nobody
begin; set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true), set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
update public.event_options set fee_cents = 70000 where id = '40000000-0000-0000-0000-000000000001';
do $$ declare r jsonb; n int; begin
  r := public.lower_registered_fees('40000000-0000-0000-0000-000000000001');
  select count(*) into n from public.participant_money where fee_cents <> 60000
     and participant_id in ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002');
  if (r->>'lowered')::int <> 0 or n <> 0 then raise exception 'FAIL 2: %, % changed', r, n; end if;
  raise notice 'PASS raise: %', r;
end $$;
rollback;

\echo == 3 a cut reaches the camper; the parent with a scholarship keeps the old fee
begin; set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true), set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
update public.event_options set fee_cents = 50000 where id = '40000000-0000-0000-0000-000000000001';
do $$ declare r jsonb; c int; p int; begin
  r := public.lower_registered_fees('40000000-0000-0000-0000-000000000001');
  select fee_cents into c from public.participant_money where participant_id = '60000000-0000-0000-0000-000000000001';
  select fee_cents into p from public.participant_money where participant_id = '60000000-0000-0000-0000-000000000002';
  if c <> 50000 or p <> 60000 or (r->>'lowered')::int <> 1 or (r->>'skipped')::int <> 1 then
    raise exception 'FAIL 3: camper % parent % result %', c, p, r;
  end if;
  raise notice 'PASS cut: camper 50000, parent kept 60000, %', r;
end $$;
rollback;

\echo == 4 paid in full, then cut: the family reads a credit and it is counted
insert into public.payments (registration_id, amount_cents, method, status) values ('50000000-0000-0000-0000-000000000001', 65000, 'card', 'succeeded');
begin; set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true), set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
update public.event_options set fee_cents = 50000 where id = '40000000-0000-0000-0000-000000000001';
do $$ declare r jsonb; b bigint; begin
  r := public.lower_registered_fees('40000000-0000-0000-0000-000000000001');
  select balance_cents into b from public.registration_balances where registration_id = '50000000-0000-0000-0000-000000000001';
  if b >= 0 or (r->>'overpaid')::int <> 1 then raise exception 'FAIL 4: balance % result %', b, r; end if;
  raise notice 'PASS overpaid: balance %, %', b, r;
end $$;
rollback;
\echo ALL LOWER-PRICE CHECKS PASSED
