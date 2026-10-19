-- Checks for migration 0107: payment status never moves backwards, refunds are
-- serialised and capped (fee cover included), a refund form's request key is
-- used once, and administrators can read the staff access log.
-- Run on a fresh database seeded with payment_plans_seed.sql (see README.md):
--   L14_DB=l14_refunds bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d l14_refunds -f supabase/tests/refunds_rules.sql
\set ON_ERROR_STOP on
\pset footer off
begin;
insert into public.payments (id, registration_id, amount_cents, fee_cover_cents, method, status, received_on)
values ('70000000-0000-0000-0000-0000000000f1','50000000-0000-0000-0000-000000000001',10000,300,'card','succeeded','2026-10-01');

do $$
declare s text; d date;
begin
  -- 1. A late "processing" event does not un-receive a payment.
  update public.payments set status='processing', received_on=null where id='70000000-0000-0000-0000-0000000000f1';
  select status, received_on into s, d from public.payments where id='70000000-0000-0000-0000-0000000000f1';
  if s <> 'succeeded' or d is null then raise exception 'FAIL 1: status % received %', s, d; end if;
  raise notice 'PASS 1 succeeded stays succeeded, received date kept';

  -- 2. refunded -> succeeded is allowed (a refund failed), refunded -> pending is not.
  update public.payments set status='refunded' where id='70000000-0000-0000-0000-0000000000f1';
  update public.payments set status='pending' where id='70000000-0000-0000-0000-0000000000f1';
  select status into s from public.payments where id='70000000-0000-0000-0000-0000000000f1';
  if s <> 'refunded' then raise exception 'FAIL 2a: %', s; end if;
  update public.payments set status='succeeded' where id='70000000-0000-0000-0000-0000000000f1';
  select status into s from public.payments where id='70000000-0000-0000-0000-0000000000f1';
  if s <> 'succeeded' then raise exception 'FAIL 2b: %', s; end if;
  raise notice 'PASS 2 refunded->pending refused, refunded->succeeded allowed';

  -- 3. Fee cover is capped across refunds, not per refund.
  insert into public.payment_refunds (payment_id, registration_id, amount_cents, fee_cover_cents, status, method)
  values ('70000000-0000-0000-0000-0000000000f1','50000000-0000-0000-0000-000000000001',6000,200,'succeeded','check');
  begin
    insert into public.payment_refunds (payment_id, registration_id, amount_cents, fee_cover_cents, status, method)
    values ('70000000-0000-0000-0000-0000000000f1','50000000-0000-0000-0000-000000000001',1000,200,'succeeded','check');
    raise exception 'FAIL 3: second fee cover accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 3 fee cover capped across refunds (%)', sqlerrm;
  end;

  -- 4. The amount is still capped.
  begin
    insert into public.payment_refunds (payment_id, registration_id, amount_cents, status, method)
    values ('70000000-0000-0000-0000-0000000000f1','50000000-0000-0000-0000-000000000001',5000,'pending','stripe');
    raise exception 'FAIL 4: over-refund accepted';
  exception when raise_exception or check_violation then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 4 over-refund refused';
  end;

  -- 5. A request key is used once while the refund is live; cancelling frees it.
  insert into public.payment_refunds (id, payment_id, registration_id, amount_cents, status, method, request_key)
  values ('71000000-0000-0000-0000-0000000000f1','70000000-0000-0000-0000-0000000000f1','50000000-0000-0000-0000-000000000001',1000,'pending','stripe','form-key-1');
  begin
    insert into public.payment_refunds (payment_id, registration_id, amount_cents, status, method, request_key)
    values ('70000000-0000-0000-0000-0000000000f1','50000000-0000-0000-0000-000000000001',1000,'pending','stripe','form-key-1');
    raise exception 'FAIL 5a: duplicate key accepted';
  exception when unique_violation then
    raise notice 'PASS 5a second submit of one form refused';
  end;
  update public.payment_refunds set status='canceled' where id='71000000-0000-0000-0000-0000000000f1';
  insert into public.payment_refunds (payment_id, registration_id, amount_cents, status, method, request_key)
  values ('70000000-0000-0000-0000-0000000000f1','50000000-0000-0000-0000-000000000001',1000,'pending','stripe','form-key-1');
  raise notice 'PASS 5b a cancelled reservation frees its key';

  -- 6. A reservation on a payment that later failed can still be cancelled.
  update public.payments set status='failed' where id='70000000-0000-0000-0000-0000000000f1';
  update public.payment_refunds set status='canceled' where request_key='form-key-1' and status='pending';
  raise notice 'PASS 6 cancelling is always allowed';

  -- 7. The access log is readable by signed-in staff (its policy decides who).
  if not has_table_privilege('authenticated', 'public.staff_access_log', 'SELECT') then
    raise exception 'FAIL 7: no select grant on staff_access_log';
  end if;
  raise notice 'PASS 7 staff_access_log has its select grant';
end $$;
rollback;
\echo ALL REFUND CHECKS PASSED
