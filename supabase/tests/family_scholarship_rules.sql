-- Checks for migration 0159: a family asks for one scholarship for the whole
-- registration; staff award dollars, split by each person's fee and never more
-- than each owes; a person removed has their share spread over the others, a
-- person added gets none, and both flag the request.
-- Run on a fresh database seeded with payment_plans_seed.sql (see README.md):
--   L14_DB=l14_fam bash supabase/tests/run_rls_local.sh supabase/tests/payment_plans_seed.sql
--   "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d l14_fam -f supabase/tests/family_scholarship_rules.sql
-- Seed: family 0..0a (Cam and Pa, $600 each on registration 5..1), staff 0..0b
-- (Payments and Registration write, so may decide).
\set ON_ERROR_STOP on
\pset footer off
begin;

-- ---- 1. The family asks for 50% ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true) \g /dev/null
do $$
declare v_id uuid; n int; bad int;
begin
  v_id := public.family_request_scholarship('50000000-0000-0000-0000-000000000001', 'percent', 50, null, 'Lost a job this spring.');
  select count(*) into n from public.scholarships where family_request_id = v_id and status = 'requested';
  if n <> 2 then raise exception 'FAIL 1a: % shares (want 2)', n; end if;
  select count(*) into bad
    from public.scholarships s join public.participant_money pm on pm.participant_id = s.registration_participant_id
   where s.family_request_id = v_id
     and s.requested_cents <> round(greatest(0, pm.fee_cents - pm.discount_cents - pm.early_discount_cents - pm.family_discount_cents) * 0.5);
  if bad <> 0 then raise exception 'FAIL 1b: % shares are not half of what each owes', bad; end if;
  raise notice 'PASS 1 a family asks for 50%%; each person carries half of what they owe';
end $$;

-- ---- 2. The family cannot edit a share directly, or decide ---------------------------------
do $$
begin
  begin
    update public.scholarships set requested_cents = 1
     where registration_participant_id = '60000000-0000-0000-0000-000000000001';
    raise exception 'FAIL 2a: a family edited its share directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.decide_family_scholarship('50000000-0000-0000-0000-000000000001', 1000, 'mine');
    raise exception 'FAIL 2b: a family decided its own scholarship';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 2 a family cannot edit a share or decide';
end $$;

-- ---- 3. Staff: a note is needed, and no more than the family owes --------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal2"}', true) \g /dev/null
do $$
begin
  begin
    perform public.decide_family_scholarship('50000000-0000-0000-0000-000000000001', 1000, '  ');
    raise exception 'FAIL 3a: an award without a note was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.decide_family_scholarship('50000000-0000-0000-0000-000000000001', 99999999, 'Board fund');
    raise exception 'FAIL 3b: an award above what the family owes was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS 3 an award needs a note and cannot pass what the family owes';
end $$;

-- ---- 4. Staff award $500: split by fee, onto each person's money ---------------------------
do $$
declare a int; b int; total bigint; st text;
begin
  perform public.decide_family_scholarship('50000000-0000-0000-0000-000000000001', 50000, 'Board hardship fund');
  select scholarship_cents into a from public.participant_money where participant_id = '60000000-0000-0000-0000-000000000001';
  select scholarship_cents into b from public.participant_money where participant_id = '60000000-0000-0000-0000-000000000002';
  if a <> 25000 or b <> 25000 then raise exception 'FAIL 4a: shares % and % (want 25000 each)', a, b; end if;
  select scholarship_cents into total from public.registration_balances where registration_id = '50000000-0000-0000-0000-000000000001';
  if total <> 50000 then raise exception 'FAIL 4b: balance shows % of scholarship', total; end if;
  select status into st from public.family_scholarship_requests where registration_id = '50000000-0000-0000-0000-000000000001';
  if st <> 'granted' then raise exception 'FAIL 4c: family request is %', st; end if;
  if (select count(*) from public.scholarships where family_request_id is not null and status = 'granted' and staff_note = 'Board hardship fund') <> 2 then
    raise exception 'FAIL 4d: the decision is not on each person';
  end if;
  raise notice 'PASS 4 $500 is split $250/$250 by fee and lands on the balance';
end $$;

-- ---- 5. Once decided, the family cannot change it ------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true) \g /dev/null
do $$
begin
  begin
    perform public.family_request_scholarship('50000000-0000-0000-0000-000000000001', 'amount', null, 90000, 'more please');
    raise exception 'FAIL 5: a decided family request was changed by the family';
  exception when raise_exception then null;
  end;
  raise notice 'PASS 5 a decided family request is closed to the family';
end $$;

-- ---- 6. Someone added after the award: no share, flagged; no per-person ask beside it -------
reset role;
insert into public.people (id, household_id, first_name, last_name) values
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Sib','Ling');
insert into public.registration_participants (id, registration_id, person_id, event_option_id, camp_role, status) values
 ('60000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','sibling','submitted');
set local role authenticated;
do $$
declare s int; why text;
begin
  select scholarship_cents into s from public.participant_money where participant_id = '60000000-0000-0000-0000-000000000003';
  if s <> 0 then raise exception 'FAIL 6a: the new person got %', s; end if;
  select needs_review_reason into why from public.family_scholarship_requests where registration_id = '50000000-0000-0000-0000-000000000001';
  if why is null or position('Sib Ling was added' in why) = 0 then raise exception 'FAIL 6b: not flagged (%)', why; end if;
  begin
    insert into public.scholarships (registration_participant_id, requested_cents) values ('60000000-0000-0000-0000-000000000003', 10000);
    raise exception 'FAIL 6c: a per-person request beside the family one was accepted';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 6 a person added later has no share, the request is flagged, no per-person ask beside it';
end $$;

-- ---- 7. Someone removed: their share spreads over the others -------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal2"}', true) \g /dev/null
reset role;
update public.registration_participants set status = 'cancelled' where id = '60000000-0000-0000-0000-000000000002';
do $$
declare a int; b int; owes int; why text;
begin
  select scholarship_cents, greatest(0, fee_cents - discount_cents - early_discount_cents - family_discount_cents)
    into a, owes from public.participant_money where participant_id = '60000000-0000-0000-0000-000000000001';
  select scholarship_cents into b from public.participant_money where participant_id = '60000000-0000-0000-0000-000000000002';
  if b <> 0 then raise exception 'FAIL 7a: the removed person still has %', b; end if;
  if a <> least(50000, owes) then
    raise exception 'FAIL 7b: Cam has % (owes %; want the whole $500, or all they owe)', a, owes;
  end if;
  select needs_review_reason into why from public.family_scholarship_requests where registration_id = '50000000-0000-0000-0000-000000000001';
  if position('Pa Rent was removed' in why) = 0 then raise exception 'FAIL 7d: not flagged (%)', why; end if;
  raise notice 'PASS 7 a removed person''s share moves to the others, flagged (Cam now %)', a;
end $$;

-- ---- 8. Decline: every share comes off ------------------------------------------------------
set local role authenticated;
do $$
declare total bigint;
begin
  perform public.decide_family_scholarship('50000000-0000-0000-0000-000000000001', 0, 'Fund is spent for this year');
  select coalesce(sum(pm.scholarship_cents), 0) into total
    from public.participant_money pm join public.registration_participants rp on rp.id = pm.participant_id
   where rp.registration_id = '50000000-0000-0000-0000-000000000001';
  if total <> 0 then raise exception 'FAIL 8a: % still awarded after a decline', total; end if;
  if (select status from public.family_scholarship_requests where registration_id = '50000000-0000-0000-0000-000000000001') <> 'declined'
     or (select needs_review_since from public.family_scholarship_requests where registration_id = '50000000-0000-0000-0000-000000000001') is not null then
    raise exception 'FAIL 8b: not declined, or still flagged';
  end if;
  raise notice 'PASS 8 a decline takes every share off and clears the flag';
end $$;

-- ---- 9. Nobody signed in writes the family table directly ----------------------------------
do $$
begin
  if has_table_privilege('authenticated', 'public.family_scholarship_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.family_scholarship_requests', 'INSERT') then
    raise exception 'FAIL 9: authenticated can write family_scholarship_requests directly';
  end if;
  raise notice 'PASS 9 no direct writes';
end $$;

-- ---- 10. A declined family may ask again; once withdrawn, per person (0160) ---------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true), set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}', true) \g /dev/null
do $$
declare st text; link uuid;
begin
  perform public.family_request_scholarship('50000000-0000-0000-0000-000000000001', 'amount', null, 30000, 'Asking again');
  if (select status from public.family_scholarship_requests where registration_id = '50000000-0000-0000-0000-000000000001') <> 'requested' then
    raise exception 'FAIL 10a: a declined family could not ask again';
  end if;
  perform public.family_withdraw_scholarship('50000000-0000-0000-0000-000000000001');
  update public.scholarships set requested_cents = 20000, status = 'requested', family_request_id = null
   where registration_participant_id = '60000000-0000-0000-0000-000000000001';
  select status, family_request_id into st, link from public.scholarships
   where registration_participant_id = '60000000-0000-0000-0000-000000000001';
  if st <> 'requested' or link is not null then raise exception 'FAIL 10b: % / %', st, link; end if;
  raise notice 'PASS 10 a declined family can ask again, and after withdrawing can ask per person';
end $$;

rollback;
