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

-- 0111: the insider and family limits from the 20 Oct money audit.
begin;
insert into public.payments (id, registration_id, amount_cents, fee_cover_cents, method, status, received_on, stripe_payment_intent_id)
values ('70000000-0000-0000-0000-0000000000f2','50000000-0000-0000-0000-000000000001',10000,0,'card','succeeded','2026-10-01','pi_test_0111');
insert into public.payment_refunds (id, payment_id, registration_id, amount_cents, status, method, stripe_refund_id)
values ('71000000-0000-0000-0000-0000000000f2','70000000-0000-0000-0000-0000000000f2','50000000-0000-0000-0000-000000000001',10000,'succeeded','stripe','re_test_0111');
do $$ declare s text; n int; begin
  -- 8. the payment settled itself from the refund on file
  select status into s from public.payments where id='70000000-0000-0000-0000-0000000000f2';
  if s <> 'refunded' then raise exception 'FAIL 8: % after a full refund', s; end if;
  raise notice 'PASS 8 a fully refunded payment is marked refunded by the database';

  -- 3. a signed-in Payments-write insider cannot cancel a succeeded refund or change its money
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  set local role authenticated;
  begin
    update public.payment_refunds set status='canceled' where id='71000000-0000-0000-0000-0000000000f2';
    raise exception 'FAIL 3a: succeeded refund cancelled';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 3a a settled refund is not cancelled by hand (%)', sqlerrm;
  end;
  begin
    update public.payment_refunds set amount_cents=1 where id='71000000-0000-0000-0000-0000000000f2';
    raise exception 'FAIL 3b: refund amount changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 3b a refund''s amount does not change';
  end;
  update public.payment_refunds set note='a word from the registrar' where id='71000000-0000-0000-0000-0000000000f2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 3c: note edit refused'; end if;
  raise notice 'PASS 3c the registrar''s words may still be edited';

  -- 4. plans are not inserted by hand
  begin
    insert into public.payment_plans (registration_id, schedule, status, stripe_customer_id, stripe_payment_method_id)
    values ('50000000-0000-0000-0000-000000000001','monthly','active','cus_x','pm_x');
    raise exception 'FAIL 4: plan inserted by hand';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 4 a plan cannot be entered by hand';
  end;

  -- 5. scholarship + discount capped at the fee
  begin
    update public.registration_participants set scholarship_cents=99999 where id='60000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 5: scholarship over the fee accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 5 scholarship capped at the fee';
  end;

  -- 6. coupons: no signed-in writer
  begin
    insert into public.coupons (code, amount_off_cents) values ('X', 100);
    raise exception 'FAIL 6: coupon written';
  exception when insufficient_privilege then
    raise notice 'PASS 6 coupons have no signed-in writer';
  end;

  -- 7. the audit trail saw the note edit
  reset role;
  select count(*) into n from public.money_change_log where table_name='payment_refunds' and row_id='71000000-0000-0000-0000-0000000000f2' and op='UPDATE';
  if n < 1 then raise exception 'FAIL 7: no log row'; end if;
  raise notice 'PASS 7 money_change_log recorded the edit (% rows)', n;

  -- 1. a family cannot run the discount rules on another registration
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  set local role authenticated;
  begin
    perform public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000002');
    raise exception 'FAIL 1: recalc on another family allowed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS 1 the discount rules refuse another family''s registration';
  end;
  perform public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
  raise notice 'PASS 1b ... and run for the family''s own';
  reset role;
end $$;
rollback;
\echo ALL 0111 CHECKS PASSED
