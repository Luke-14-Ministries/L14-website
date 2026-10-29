-- Checks for migration 0080 (payment plans, early discount, money guard).
-- Run after supabase_stubs.sql, every migration, and payment_plans_seed.sql. Raises on failure.
\set ON_ERROR_STOP on
\pset footer off
update public.events set early_registration_ends_on='2026-12-31', early_registration_discount_cents=5000 where id='30000000-0000-0000-0000-000000000001';
\echo == 1 family cannot change a fee (0114: the fee lives on participant_money, which nobody signed in writes)
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$ begin
  update public.participant_money set fee_cents=0 where participant_id='60000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: fee change allowed';
exception when insufficient_privilege then raise notice 'PASS fee change refused';
end $$;
\echo == 2 family insert takes the option fee and zero discounts (0114: filled by trigger; the family sends no money)
insert into public.people (id, household_id, first_name, last_name) values ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','Sib','Ling');
insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000009','40000000-0000-0000-0000-000000000001','sibling','submitted');
select pm.fee_cents as expect_60000, pm.discount_cents as expect_0, pm.early_discount_cents as expect_0
  from public.participant_money pm join public.registration_participants rp on rp.id = pm.participant_id
 where rp.person_id='20000000-0000-0000-0000-000000000009';
rollback;
\echo == 3 candidates, pay-in-full amount, no qualification yet
select * from public.early_discount_candidates('50000000-0000-0000-0000-000000000001');
select public.pay_in_full_amount('50000000-0000-0000-0000-000000000001') as pay_in_full_expect_110000;
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents, early_discount_cents from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
select route from public.registration_payment_routes where registration_id='50000000-0000-0000-0000-000000000001';
\echo == 4 paid in full at the discounted amount
insert into public.payments (id, registration_id, amount_cents, method, status) values ('70000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',110000,'card','succeeded');
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents as expect_0, early_discount_cents as expect_10000 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents as still_0 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
select route as expect_paid_in_full from public.registration_payment_routes where registration_id='50000000-0000-0000-0000-000000000001';
\echo == 4b a returned-payment fee is owed but does not take the early discount away (0123)
insert into public.registration_fees (id, registration_id, kind, amount_cents, reason) values ('90000000-0000-0000-0000-0000000000f1','50000000-0000-0000-0000-000000000001','manual',400,'test');
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
do $$ declare b bigint; e bigint; f bigint; begin
  select balance_cents, early_discount_cents, fees_cents into b, e, f from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
  if b <> 400 or e <> 10000 or f <> 400 then raise exception 'FAIL 4b: balance % early % fees %', b, e, f; end if;
  raise notice 'PASS 4b fee owed (400), early discount kept (10000)';
  if (select route from public.registration_payment_routes where registration_id='50000000-0000-0000-0000-000000000001') <> 'paid_in_full' then
    raise exception 'FAIL 4b: a fee turned a paid-in-full family back into "not finished"';
  end if;
  raise notice 'PASS 4b the route stays paid_in_full with a fee owed';
end $$;
delete from public.registration_fees where id='90000000-0000-0000-0000-0000000000f1';
\echo == 5 payment fails -> discount goes
update public.payments set status='failed' where id='70000000-0000-0000-0000-000000000001';
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents as expect_120000, early_discount_cents as expect_0 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
\echo == 6 plan activated -> discount; registrar revokes -> gone
insert into public.payment_plans (id, registration_id, schedule, status, activated_at) values ('80000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','monthly','active',now());
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select balance_cents as expect_110000, early_discount_cents as expect_10000 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
select route as expect_plan from public.registration_payment_routes where registration_id='50000000-0000-0000-0000-000000000001';
update public.payment_plans set keeps_early_discount=false where id='80000000-0000-0000-0000-000000000001';
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select early_discount_cents as expect_0 from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
update public.payment_plans set keeps_early_discount=true where id='80000000-0000-0000-0000-000000000001';
\echo == 7 late-registered person and both-weeks coexistence
update public.registration_participants set created_at='2027-01-05 10:00-05' where id='60000000-0000-0000-0000-000000000002';
update public.participant_money set discount_cents=58000, discount_reason='Both weeks (test)' where participant_id='60000000-0000-0000-0000-000000000001';
select * from public.early_discount_candidates('50000000-0000-0000-0000-000000000001');
select 'expect camper only, 2000 (capped at what is left)' as note;
update public.registration_participants set created_at='2026-11-01 15:00-05' where id='60000000-0000-0000-0000-000000000002';
update public.participant_money set discount_cents=0, discount_reason=null where participant_id='60000000-0000-0000-0000-000000000001';
\echo == 8 charge dates
select array_agg(d order by d) as monthly from public.plan_charge_dates('2026-11-01','2027-07-04','monthly') d;
select array_agg(d order by d) as semi from public.plan_charge_dates('2026-11-01','2027-01-10','semi_monthly') d;
select count(*) as expect_0 from public.plan_charge_dates('2027-07-02','2027-07-04','monthly');
\echo == 9 build installments
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
insert into public.payments (registration_id, amount_cents, method, status) values ('50000000-0000-0000-0000-000000000001',10000,'card','succeeded');
select public.build_plan_installments('80000000-0000-0000-0000-000000000001','2026-11-01') as n;
select due_on, amount_cents from public.payment_installments where payment_plan_id='80000000-0000-0000-0000-000000000001' order by due_on;
select final_due_on from public.payment_plans where id='80000000-0000-0000-0000-000000000001';
\echo == 9b resume after the due date (0143): one charge for the whole balance, after the notice lead
do $$
declare v_n int; v_bal bigint; v_rows int; v_on date; v_amt int;
begin
  select greatest(0, balance_cents) into v_bal from public.registration_balances where registration_id='50000000-0000-0000-0000-000000000001';
  v_n := public.build_plan_installments('80000000-0000-0000-0000-000000000001','2027-08-01', 11);
  select count(*), min(due_on), min(amount_cents) into v_rows, v_on, v_amt
    from public.payment_installments where payment_plan_id='80000000-0000-0000-0000-000000000001' and status='scheduled';
  if v_n <> 1 or v_rows <> 1 or v_on <> date '2027-08-12' or v_amt <> v_bal then
    raise exception 'FAIL 9b: got % rows (n=%), on %, % cents; expected 1 on 2027-08-12 for %', v_rows, v_n, v_on, v_amt, v_bal;
  end if;
  raise notice 'PASS 9b a late resume schedules one charge on today + 11 for the balance';
  -- the lead also trims early dates from a normal rebuild
  v_n := public.build_plan_installments('80000000-0000-0000-0000-000000000001','2026-11-01', 400);
  if exists (select 1 from public.payment_installments where payment_plan_id='80000000-0000-0000-0000-000000000001'
              and status='scheduled' and due_on < date '2026-11-01' + 400) then
    raise exception 'FAIL 9b: a charge was scheduled inside the lead';
  end if;
  raise notice 'PASS 9b no charge inside the lead (% left)', v_n;
  perform public.build_plan_installments('80000000-0000-0000-0000-000000000001','2026-11-01');
end $$;
\echo == 10 family permissions
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
select route as family_sees_own_route from public.registration_payment_routes;
select count(*) as family_sees_installments from public.payment_installments;
do $$ begin
  perform public.build_plan_installments('80000000-0000-0000-0000-000000000001','2026-11-01');
  raise exception 'FAIL: family could build installments';
exception when insufficient_privilege then raise notice 'PASS build_plan_installments refused';
end $$;
do $$ begin
  update public.payment_plans set status='active', activated_at=now(), keeps_early_discount=true;
  if found then raise exception 'FAIL: family updated a plan'; end if;
  raise notice 'PASS family plan update touched 0 rows';
end $$;
rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',true) \g /dev/null
select public.pay_in_full_amount('50000000-0000-0000-0000-000000000001') as stranger_expect_null;
select count(*) as stranger_routes_expect_0 from public.registration_payment_routes;
rollback;
\echo == 11 registrar can still adjust money (0114: through set_participant_adjustments, on a code-verified session)
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',true), set_config('request.jwt.claims','{"aal":"aal2"}',true) \g /dev/null
select public.set_participant_adjustments('60000000-0000-0000-0000-000000000001', 0, 1000, null);
select discount_cents as expect_1000 from public.participant_money where participant_id='60000000-0000-0000-0000-000000000001';
select 'PASS registrar discount allowed' as ok;
rollback;
\echo == 12 multi-week rule still works when called by a family
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
select public.recalc_multi_week_discount('20000000-0000-0000-0000-000000000001');
select public.recalc_early_registration_discount('50000000-0000-0000-0000-000000000001');
select 'PASS rule functions run from a family session' as ok;
rollback;
\echo == 13 review fixes (30 Sep): a family cannot game "registered early", options or status
insert into public.events (id, name, event_type, starts_on, ends_on, published) values ('30000000-0000-0000-0000-000000000002','Cheap Dinner','dinner','2027-02-01','2027-02-01',true) on conflict do nothing;
insert into public.event_options (id, event_id, name, fee_cents, published) values ('40000000-0000-0000-0000-000000000009','30000000-0000-0000-0000-000000000002','Dinner',500,true) on conflict do nothing;
begin; set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$ begin
  update public.registration_participants set created_at='2026-01-01' where id='60000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: backdating allowed';
exception when insufficient_privilege then raise notice 'PASS backdating refused';
end $$;
do $$ begin
  update public.registration_participants set status='cancelled' where id='60000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: family cancelled a submitted place';
exception when insufficient_privilege then raise notice 'PASS family cancel refused';
end $$;
insert into public.people (id, household_id, first_name, last_name) values ('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','Other','Kid');
do $$ begin
  insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
  values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000009','camper','submitted');
  raise exception 'FAIL: option from another event allowed';
exception when insufficient_privilege then raise notice 'PASS other-event option refused';
end $$;
do $$ begin
  insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
  values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000002','camper','submitted');
  raise exception 'FAIL: camper on the free volunteer option allowed';
exception when insufficient_privilege then raise notice 'PASS volunteer option for a camper refused';
end $$;
do $$ begin
  insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
  values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000002','volunteer','submitted');
  raise exception 'FAIL: volunteer-only place on the free option allowed';
exception when insufficient_privilege then raise notice 'PASS free option needs a paid place first';
end $$;
insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status, created_at)
values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000001','sibling','submitted','2026-01-01');
-- The second role (0069) was retired by 0086: one role per person per event,
-- even after a paid place.
do $$ begin
  insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status)
  values ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000002','volunteer','submitted');
  raise exception 'FAIL: a second role on the same event was allowed';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS a second role on the same event is refused (0086)';
end $$;
select (created_at > now() - interval '1 minute') as created_at_forced_to_now from public.registration_participants where person_id='20000000-0000-0000-0000-000000000008';
rollback;
\echo == 14 a deposit waiver can be undone (0127)
-- Outside a transaction on purpose: each statement gets its own now(), as a
-- waiver and its undo would on the site, so the log lookup is tested against
-- real timestamps rather than one shared instant.
-- A third fee-paying person with no scholarship, and a Finance persona
-- (Payments write, Registration read): records money, does not decide (0102).
insert into public.people (id, household_id, first_name, last_name) values ('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','Sis','Ter');
insert into public.registration_participants (id, registration_id, person_id, event_option_id, camp_role, status) values
 ('60000000-0000-0000-0000-000000000007','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000001','sibling','submitted');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c','finance@example.org');
insert into public.staff (profile_id, role) values ('00000000-0000-0000-0000-00000000000c','registrar') on conflict do nothing;
insert into public.staff_grants (profile_id, area, level) values
 ('00000000-0000-0000-0000-00000000000c','payments','write'), ('00000000-0000-0000-0000-00000000000c','registration','read')
on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false), set_config('request.jwt.claims','{"aal":"aal2"}',false) \g /dev/null
-- The camper already holds a $20 scholarship; the waiver overwrites it.
select public.set_participant_adjustments('60000000-0000-0000-0000-000000000001', 2000, 0, null);
select public.waive_deposit('50000000-0000-0000-0000-000000000001', 'test waiver') as waived_expect_3;
-- Staff then decide the parent's scholarship themselves: no longer the waiver's.
select public.set_participant_adjustments('60000000-0000-0000-0000-000000000002', 7000, 0, null);
-- Finance may not undo it.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false) \g /dev/null
do $$ begin
  perform public.undo_deposit_waiver('50000000-0000-0000-0000-000000000001', 'finance try');
  raise exception 'FAIL 14: Finance (no Registration write) undid a waiver';
exception when insufficient_privilege then raise notice 'PASS 14 Finance cannot undo a waiver';
end $$;
-- Nor may the family.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
do $$ begin
  perform public.undo_deposit_waiver('50000000-0000-0000-0000-000000000001', 'family try');
  raise exception 'FAIL 14: a family undid a waiver';
exception when insufficient_privilege then raise notice 'PASS 14 a family cannot undo a waiver';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false) \g /dev/null
do $$ begin
  perform public.undo_deposit_waiver('50000000-0000-0000-0000-000000000001', '   ');
  raise exception 'FAIL 14: undo without a reason allowed';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS 14 a reason is required (%)', sqlerrm;
end $$;
select public.undo_deposit_waiver('50000000-0000-0000-0000-000000000001', 'waived in error') as undone_expect_2;
-- Review reads the real deposit again: $100 paid of a $150 deposit.
do $$ declare v record; begin
  select review_class, flags into v from public.registration_review where registration_id='50000000-0000-0000-0000-000000000001';
  if v.review_class is null or v.review_class = 'deposit_paid' or 'deposit_waived' = any(v.flags)
     or not ('deposit_short' = any(v.flags)) then
    raise exception 'FAIL 14: review after the undo reads % %', v.review_class, v.flags;
  end if;
  raise notice 'PASS 14 review reads the real deposit again (%, %)', v.review_class, v.flags;
end $$;
reset role;
do $$ declare r record; begin
  select deposit_waived_at, deposit_waived_by, deposit_waived_reason into r from public.registrations where id='50000000-0000-0000-0000-000000000001';
  if r.deposit_waived_at is not null or r.deposit_waived_by is not null or r.deposit_waived_reason is not null then
    raise exception 'FAIL 14: the waiver mark was not cleared';
  end if;
  raise notice 'PASS 14 the waiver mark is cleared';
  -- Camper: back to the $20 held before the waiver, still granted.
  select pm.scholarship_cents, s.granted_cents, s.status, s.staff_note, s.reviewed_by into r
    from public.participant_money pm join public.scholarships s on s.registration_participant_id = pm.participant_id
   where pm.participant_id='60000000-0000-0000-0000-000000000001';
  if r.scholarship_cents <> 2000 or r.granted_cents <> 2000 or r.status <> 'granted'
     or r.staff_note <> 'Deposit waiver undone: waived in error' or r.reviewed_by <> '00000000-0000-0000-0000-00000000000b' then
    raise exception 'FAIL 14: camper not restored to the prior $20 (%)', row_to_json(r);
  end if;
  raise notice 'PASS 14 a prior smaller scholarship is restored';
  -- Sibling: had none, so none again; the row says it is no longer granted.
  select pm.scholarship_cents, s.granted_cents, s.status into r
    from public.participant_money pm join public.scholarships s on s.registration_participant_id = pm.participant_id
   where pm.participant_id='60000000-0000-0000-0000-000000000007';
  if r.scholarship_cents <> 0 or r.granted_cents <> 0 or r.status <> 'declined' then
    raise exception 'FAIL 14: sibling not back to no scholarship (%)', row_to_json(r);
  end if;
  raise notice 'PASS 14 no prior scholarship -> 0, recorded as declined';
  -- Parent: staff's later $70 decision is left alone.
  select pm.scholarship_cents, s.granted_cents, s.staff_note into r
    from public.participant_money pm join public.scholarships s on s.registration_participant_id = pm.participant_id
   where pm.participant_id='60000000-0000-0000-0000-000000000002';
  if r.scholarship_cents <> 7000 or r.staff_note not like 'Deposit waived%' then
    raise exception 'FAIL 14: a scholarship staff changed after the waiver was touched (%)', row_to_json(r);
  end if;
  raise notice 'PASS 14 a scholarship staff changed since is left alone';
  -- The undo's own write is in the money log, under the registrar's name.
  if not exists (select 1 from public.money_change_log
                  where table_name='participant_money' and row_id='60000000-0000-0000-0000-000000000001'
                    and (before->>'scholarship_cents')::int = 5000 and (after->>'scholarship_cents')::int = 2000
                    and changed_by='00000000-0000-0000-0000-00000000000b') then
    raise exception 'FAIL 14: the undo is not in money_change_log';
  end if;
  raise notice 'PASS 14 the undo is logged in money_change_log';
end $$;
set role authenticated;
do $$ begin
  perform public.undo_deposit_waiver('50000000-0000-0000-0000-000000000001', 'again');
  raise exception 'FAIL 14: undo on an unwaived registration allowed';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS 14 undo on an unwaived registration refused (%)', sqlerrm;
end $$;
-- Waived twice, then undone: the second waiver re-stamps the mark but skips
-- everyone already holding the deposit, so the restore must still find the
-- first waiver's write.
select public.waive_deposit('50000000-0000-0000-0000-000000000001', 'again') as rewaived_expect_2;
select public.waive_deposit('50000000-0000-0000-0000-000000000001', 'twice') as waived_twice_expect_0;
select public.undo_deposit_waiver('50000000-0000-0000-0000-000000000001', 'twice in error') as undone_expect_2;
reset role;
do $$ begin
  if (select scholarship_cents from public.participant_money where participant_id='60000000-0000-0000-0000-000000000001') <> 2000
     or (select scholarship_cents from public.participant_money where participant_id='60000000-0000-0000-0000-000000000007') <> 0
     or (select scholarship_cents from public.participant_money where participant_id='60000000-0000-0000-0000-000000000002') <> 7000 then
    raise exception 'FAIL 14: a double waiver did not undo to the original scholarships';
  end if;
  raise notice 'PASS 14 a double waiver undoes to the original scholarships';
end $$;
\echo ALL DEPOSIT WAIVER CHECKS PASSED
\echo == 15 a family stops their own plan (0135)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000ff',true) \g /dev/null
do $$ begin
  perform public.family_cancel_payment_plan('50000000-0000-0000-0000-000000000001');
  raise exception 'FAIL 15: a stranger cancelled the family''s plan';
exception when insufficient_privilege then raise notice 'PASS 15 a stranger is refused';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',true) \g /dev/null
do $$
declare r record; n int;
begin
  perform public.family_cancel_payment_plan('50000000-0000-0000-0000-000000000001');
  select status, cancelled_at, cancelled_by, keeps_early_discount into r
    from public.payment_plans where id = '80000000-0000-0000-0000-000000000001';
  if r.status <> 'cancelled' or r.cancelled_at is null
     or r.cancelled_by <> '00000000-0000-0000-0000-00000000000a' or not r.keeps_early_discount then
    raise exception 'FAIL 15: plan after the family cancelled: %', row_to_json(r);
  end if;
  select count(*) into n from public.payment_installments
   where payment_plan_id = '80000000-0000-0000-0000-000000000001' and status in ('scheduled', 'failed');
  if n <> 0 then raise exception 'FAIL 15: % charges still scheduled', n; end if;
  raise notice 'PASS 15 the family''s plan and its charges are cancelled, stamped, discount untouched';
  begin
    perform public.family_cancel_payment_plan('50000000-0000-0000-0000-000000000001');
    raise exception 'FAIL 15: a cancelled plan was cancelled again';
  exception when invalid_parameter_value then raise notice 'PASS 15 an ended plan is refused';
  end;
end $$;
rollback;
\echo ALL FAMILY PLAN CANCEL CHECKS PASSED
\echo == 16 the plan's payment-method change is stamped by the database (0136)
begin;
do $$
declare t1 timestamptz; t2 timestamptz;
begin
  update public.payment_plans set stripe_payment_method_id = 'pm_test_new' where id = '80000000-0000-0000-0000-000000000001';
  select payment_method_changed_at into t1 from public.payment_plans where id = '80000000-0000-0000-0000-000000000001';
  if t1 is null then raise exception 'FAIL 16: a new payment method was not stamped'; end if;
  update public.payment_plans set payment_method_changed_at = '2020-01-01', note = 'x' where id = '80000000-0000-0000-0000-000000000001';
  select payment_method_changed_at into t2 from public.payment_plans where id = '80000000-0000-0000-0000-000000000001';
  if t2 is distinct from t1 then raise exception 'FAIL 16: the stamp was set by hand (% -> %)', t1, t2; end if;
  raise notice 'PASS 16 a method change is stamped, and the stamp cannot be set by hand';
end $$;
rollback;
\echo ALL PLAN METHOD STAMP CHECKS PASSED
\echo == 0144 deleting a registration as the owner takes its plan with it
do $$
declare v_reg uuid := '50000000-0000-0000-0000-000000000001';
begin
  delete from public.payment_installments where payment_plan_id in (select id from public.payment_plans where registration_id = v_reg);
  delete from public.payments where registration_id = v_reg;
  delete from public.registration_fees where registration_id = v_reg;
  delete from public.registrations where id = v_reg;
  if exists (select 1 from public.payment_plans where registration_id = v_reg) then
    raise exception 'FAIL 0144: the plan survived its registration';
  end if;
  raise notice 'PASS 0144 the plan went with its registration';
  raise exception 'rollback-only' using errcode = 'P0002';
exception when sqlstate 'P0002' then null;
end $$;
