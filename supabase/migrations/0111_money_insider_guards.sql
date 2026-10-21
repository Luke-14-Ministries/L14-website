-- 0111_money_insider_guards.sql
--
-- The adversarial money audit, 20 Oct 2026. Nobody outside could move money;
-- these close what a FAMILY could tilt in its own favour and what an INSIDER
-- with Payments write could do through the API that no screen offers and no
-- log recorded. Each item was proven on a rolled-back probe first.
--
--  1. The discount rules (recalc_*) were callable by any signed-in person on
--     any registration. They are deterministic, but the caller chose WHEN they
--     ran. Now: staff, the family's own registration, or a server-side caller.
--  2. The "both weeks" volunteer discount counted a volunteer the family had
--     named but staff had not approved. It now needs the volunteer rows to be
--     confirmed; staff confirming them re-runs the rule.
--  3. A Payments-write insider could cancel a SUCCEEDED Stripe refund (the money
--     had left; the balance forgot it), rewrite a refund's amount, or move a
--     payment to another family. Refund rows are now edited only while pending;
--     money fields never change (a re-split of refund and fee cover, same
--     total, is allowed). Payments: the registration never changes once a
--     refund exists.
--  4. A Payments-write insider could insert a payment plan naming ANOTHER
--     family's saved card (ids readable from payment_plans), which the daily
--     charger would charge. Plans are created only by Stripe's webhook; staff
--     change status, the early-discount decision, the cancel stamps and the
--     note, nothing else.
--  5. scholarship + hand-set discount could exceed the fee at the API (the
--     screen capped it). Capped in the database for signed-in writers.
--  6. Coupons have no screen. Writing them is withdrawn from signed-in users
--     until one exists (the tables stay).
--  7. Every write to payments, refunds, plans and coupons is logged in
--     money_change_log with who did it: the audit trail an insider path lacked.
--  8. A card payment refunded in full never showed as "refunded" on the
--     Payments page: the staff client may not update card rows, so the flip
--     silently did nothing. The database now settles payments.status from the
--     refunds on file, for every writer.
--  9. A gift could move back from received to processing on a late Stripe
--     event (payments got this guard in 0107). Same trigger on gifts.
-- 10. A family could re-open a declined scholarship request. A decided
--     request's status is now the ministry's.
-- 11. Staff without Payments read saw "paid $0" on every registration, because
--     the balances view runs with their rights. registration_paid_cents()
--     answers the deposit question for any staff member.

-- ---------------------------------------------------------------------------
-- 1. Who may run a discount rule
-- ---------------------------------------------------------------------------
create or replace function public.may_recalc_registration(p_registration_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is null            -- a server-side caller (webhooks, the charger)
      or public.is_staff()
      or p_registration_id in (select public.my_registration_ids());
$$;
revoke all on function public.may_recalc_registration(uuid) from public, anon;
grant execute on function public.may_recalc_registration(uuid) to authenticated;

create or replace function public.may_recalc_person(p_person_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is null
      or public.is_staff()
      or exists (select 1 from public.people p
                  where p.id = p_person_id
                    and p.household_id in (select public.my_household_ids()));
$$;
revoke all on function public.may_recalc_person(uuid) from public, anon;
grant execute on function public.may_recalc_person(uuid) to authenticated;

-- 0080's rule, restated in full with the caller check (CLAUDE.md: restate,
-- do not patch).
create or replace function public.recalc_early_registration_discount(p_registration_id uuid)
returns void language plpgsql security definer set search_path = 'public'
as $$
declare
  v_pot       bigint;
  v_balance   bigint;
  v_has_plan  boolean;
begin
  if p_registration_id is null then return; end if;
  if not public.may_recalc_registration(p_registration_id) then
    raise exception 'The discount rules run for staff, or for your own registration.';
  end if;

  update public.registration_participants
     set early_discount_cents = 0
   where registration_id = p_registration_id
     and early_discount_cents <> 0;

  select coalesce(sum(amount_cents), 0) into v_pot
    from public.early_discount_candidates(p_registration_id);
  if v_pot = 0 then return; end if;

  select exists (
    select 1 from public.payment_plans pp
     where pp.registration_id = p_registration_id
       and pp.activated_at is not null
       and pp.keeps_early_discount
  ) into v_has_plan;

  select b.balance_cents into v_balance
    from public.registration_balances b where b.registration_id = p_registration_id;

  if v_has_plan or coalesce(v_balance, 0) - v_pot <= 0 then
    update public.registration_participants rp
       set early_discount_cents = c.amount_cents
      from public.early_discount_candidates(p_registration_id) c
     where rp.id = c.participant_id;
  end if;
end;
$$;

-- 0081's rule, restated with the caller check.
create or replace function public.recalc_family_discount(p_registration_id uuid)
returns void language plpgsql security definer set search_path = 'public'
as $$
declare
  c_from_person  int;
  c_amount_cents int;
begin
  if p_registration_id is null then return; end if;
  if not public.may_recalc_registration(p_registration_id) then
    raise exception 'The discount rules run for staff, or for your own registration.';
  end if;

  select e.family_discount_from_person, e.family_discount_cents
    into c_from_person, c_amount_cents
    from public.registrations r
    join public.events e on e.id = r.event_id
   where r.id = p_registration_id;
  if c_from_person is null then return; end if;

  update public.registration_participants
     set family_discount_cents = 0
   where registration_id = p_registration_id
     and family_discount_cents <> 0;

  if c_amount_cents <= 0 then return; end if;

  with people_in_order as (
    select distinct on (rp.person_id)
           rp.id, rp.person_id, rp.created_at,
           greatest(0, rp.fee_cents - rp.discount_cents - rp.scholarship_cents
                       - rp.early_discount_cents) as owes
      from public.registration_participants rp
     where rp.registration_id = p_registration_id
       and rp.status <> 'cancelled'
       and rp.fee_cents > 0
     order by rp.person_id, rp.fee_cents desc, rp.created_at, rp.id
  ),
  ranked as (
    select id, owes, row_number() over (order by created_at, id) as n
      from people_in_order
  )
  update public.registration_participants rp
     set family_discount_cents = least(c_amount_cents, r.owes)
    from ranked r
   where rp.id = r.id
     and r.n >= c_from_person;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 0070's rule, restated: the caller check, and the volunteer must be one
--    staff have CONFIRMED. Confirming a volunteer re-runs this (the status
--    action does), so the discount appears when the ministry says yes.
-- ---------------------------------------------------------------------------
create or replace function public.recalc_multi_week_discount(p_person_id uuid)
returns void language plpgsql security definer set search_path = 'public'
as $$
declare
  c_require_vol_both   constant bool := true;
  c_require_confirmed  constant bool := true;   -- 0111: a family-named volunteer earns nothing until approved
  c_reason             constant text := 'Both weeks';
  r record;
begin
  if p_person_id is null then return; end if;
  if not public.may_recalc_person(p_person_id) then
    raise exception 'The discount rules run for staff, or for your own household.';
  end if;

  update public.registration_participants rp
     set discount_cents = 0,
         discount_reason = null
   where rp.person_id = p_person_id
     and rp.discount_reason like c_reason || '%';

  for r in
    with live as (
      select
        rp.id,
        rp.camp_role,
        rp.status,
        rp.fee_cents,
        e.id                                       as event_id,
        e.starts_on,
        e.multi_week_discount_percent              as pct,
        btrim(split_part(e.name, ' — ', 1))        as program
      from public.registration_participants rp
      join public.registrations r2 on r2.id = rp.registration_id
      join public.events e         on e.id  = r2.event_id
      where rp.person_id = p_person_id
        and rp.status <> 'cancelled'
    ),
    grouped as (
      select
        program,
        count(distinct event_id)                                  as weeks,
        count(*) filter (where camp_role = 'volunteer'
                           and (not c_require_confirmed or status = 'confirmed')) as volunteer_rows,
        count(distinct event_id) filter (where camp_role = 'volunteer'
                           and (not c_require_confirmed or status = 'confirmed')) as volunteer_weeks
      from live
      group by program
    )
    select l.id, l.fee_cents, l.pct
    from live l
    join grouped g on g.program = l.program
    where g.weeks >= 2
      and case
            when c_require_vol_both then g.volunteer_weeks >= g.weeks
            else g.volunteer_rows >= 1
          end
      and l.fee_cents > 0
      and l.pct > 0
      and l.id = (
        select l2.id
        from live l2
        where l2.program = l.program
          and l2.fee_cents > 0
        order by l2.starts_on desc, l2.event_id desc, l2.id desc
        limit 1
      )
  loop
    update public.registration_participants
       set discount_cents  = round(r.fee_cents * r.pct / 100.0),
           discount_reason = c_reason || ' (' || r.pct || '% off the later week)'
     where id = r.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Refund rows: edited only while pending; the money never changes.
--    0107's guard restated in full with the signed-in-writer limits.
-- ---------------------------------------------------------------------------
create or replace function public.payment_refunds_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_payment record;
  v_already int;
  v_fee_already int;
begin
  -- What a signed-in writer (staff with Payments write) may change on an
  -- existing refund. Server-side writers (the refund webhook) are not held
  -- to this: Stripe's word on a status is authoritative.
  if tg_op = 'UPDATE' and (select auth.uid()) is not null then
    if new.payment_id is distinct from old.payment_id
       or new.method is distinct from old.method then
      raise exception 'A refund stays with its payment.';
    end if;
    if old.stripe_refund_id is not null and new.stripe_refund_id is distinct from old.stripe_refund_id then
      raise exception 'A refund''s Stripe reference does not change.';
    end if;
    if new.amount_cents + new.fee_cover_cents <> old.amount_cents + old.fee_cover_cents then
      raise exception 'A refund''s amount does not change once recorded; cancel it while pending, or record another.';
    end if;
    if new.status is distinct from old.status and old.status <> 'pending' then
      raise exception 'A % refund is settled; its status is not edited by hand.', old.status;
    end if;
  end if;

  -- The lock: a second refund of this payment waits here until the first
  -- commits, then sees it in the sums below.
  select p.registration_id, p.amount_cents, p.fee_cover_cents, p.status
    into v_payment
  from public.payments p
  where p.id = new.payment_id
  for update;

  if v_payment is null then
    raise exception 'payment not found';
  end if;

  if new.status in ('pending', 'succeeded')
     and v_payment.status not in ('succeeded', 'processing', 'refunded') then
    raise exception 'cannot refund a payment with status %', v_payment.status;
  end if;

  new.registration_id := v_payment.registration_id;

  select coalesce(sum(r.amount_cents), 0), coalesce(sum(r.fee_cover_cents), 0)
    into v_already, v_fee_already
  from public.payment_refunds r
  where r.payment_id = new.payment_id
    and r.status in ('pending', 'succeeded')
    and (tg_op = 'INSERT' or r.id <> new.id);

  if new.status in ('pending', 'succeeded') then
    if v_already + new.amount_cents > v_payment.amount_cents then
      raise exception
        'refund total (%) would exceed the payment (%)',
        v_already + new.amount_cents, v_payment.amount_cents;
    end if;
    if v_fee_already + new.fee_cover_cents > coalesce(v_payment.fee_cover_cents, 0) then
      raise exception 'fee-cover refund exceeds the fee cover paid';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- A payment with a refund on file stays with its family.
create or replace function public.guard_payment_with_refunds()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (new.registration_id is distinct from old.registration_id
      or new.amount_cents is distinct from old.amount_cents)
     and exists (select 1 from public.payment_refunds r
                  where r.payment_id = old.id and r.status in ('pending', 'succeeded')) then
    raise exception 'This payment has a refund on file; its amount and family do not change.';
  end if;
  return new;
end;
$$;
drop trigger if exists payments_with_refunds on public.payments;
create trigger payments_with_refunds before update on public.payments
  for each row execute function public.guard_payment_with_refunds();

-- ---------------------------------------------------------------------------
-- 8. payments.status follows the refunds on file, for every writer.
-- ---------------------------------------------------------------------------
create or replace function public.settle_payment_after_refund()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_pid uuid := coalesce(new.payment_id, old.payment_id);
  v_amount int; v_status text; v_refunded bigint;
begin
  select p.amount_cents, p.status into v_amount, v_status from public.payments p where p.id = v_pid;
  if v_amount is null then return null; end if;
  select coalesce(sum(r.amount_cents), 0) into v_refunded
    from public.payment_refunds r where r.payment_id = v_pid and r.status in ('pending', 'succeeded');
  if v_refunded >= v_amount and v_status = 'succeeded' then
    update public.payments set status = 'refunded' where id = v_pid;
  elsif v_refunded < v_amount and v_status = 'refunded' then
    update public.payments set status = 'succeeded' where id = v_pid;
  end if;
  return null;
end;
$$;
drop trigger if exists payment_refunds_settle on public.payment_refunds;
create trigger payment_refunds_settle after insert or update or delete on public.payment_refunds
  for each row execute function public.settle_payment_after_refund();

-- ---------------------------------------------------------------------------
-- 4. Payment plans: Stripe's webhook creates them; staff change five things.
-- ---------------------------------------------------------------------------
create or replace function public.guard_payment_plan_writes()
-- Invoker on purpose: current_user tells a signed-in writer from the
-- service role (CLAUDE.md: a definer trigger sees its owner).
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'Payment plans are created when a family chooses one; they are not entered by hand.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'A payment plan is cancelled, not deleted.';
  end if;
  if new.registration_id        is distinct from old.registration_id
     or new.payment_schedule_id is distinct from old.payment_schedule_id
     or new.schedule            is distinct from old.schedule
     or new.stripe_customer_id  is distinct from old.stripe_customer_id
     or new.stripe_payment_method_id is distinct from old.stripe_payment_method_id
     or new.payment_method_kind is distinct from old.payment_method_kind
     or new.payment_method_label is distinct from old.payment_method_label
     or new.consent_text        is distinct from old.consent_text
     or new.consented_by        is distinct from old.consented_by
     or new.consented_at        is distinct from old.consented_at
     or new.activated_at        is distinct from old.activated_at
     or new.deposit_payment_intent_id is distinct from old.deposit_payment_intent_id
     or new.created_at          is distinct from old.created_at then
    raise exception 'Only a plan''s status, early-discount decision, cancellation stamps and note are changed by staff.';
  end if;
  return new;
end;
$$;
drop trigger if exists payment_plans_writes on public.payment_plans;
create trigger payment_plans_writes before insert or update or delete on public.payment_plans
  for each row execute function public.guard_payment_plan_writes();

-- ---------------------------------------------------------------------------
-- 5. Scholarship plus hand-set discount never exceed the fee.
-- ---------------------------------------------------------------------------
create or replace function public.guard_participant_money_cap()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.scholarship_cents + new.discount_cents > new.fee_cents then
    raise exception 'Scholarship plus discount cannot exceed the fee for this person.';
  end if;
  return new;
end;
$$;
-- Named to fire AFTER registration_participants_guard_money (triggers run in
-- name order): that guard first replaces what a family may not set, and the
-- cap then judges what is left.
drop trigger if exists participants_money_cap on public.registration_participants;
drop trigger if exists registration_participants_zz_money_cap on public.registration_participants;
create trigger registration_participants_zz_money_cap before insert or update on public.registration_participants
  for each row execute function public.guard_participant_money_cap();

-- ---------------------------------------------------------------------------
-- 6. Coupons: no screen, so no signed-in writer (the tables and reads stay).
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.coupons, public.coupon_redemptions from authenticated;

-- ---------------------------------------------------------------------------
-- 7. The money audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.money_change_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      uuid,
  op          text not null,
  changed_by  uuid,                       -- auth.uid(); null for a server-side writer
  changed_as  text not null,              -- the database role that wrote
  changed_at  timestamptz not null default now(),
  before      jsonb,
  after       jsonb
);
create index if not exists money_change_log_row_idx on public.money_change_log (table_name, row_id, changed_at desc);
alter table public.money_change_log enable row level security;
drop policy if exists money_change_log_read on public.money_change_log;
create policy money_change_log_read on public.money_change_log
  for select to authenticated using (public.is_admin());
grant select on public.money_change_log to authenticated;   -- RLS without a grant is permission denied

create or replace function public.log_money_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after  jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row_id uuid := coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid);  -- before the diff strips it
  k text;
begin
  -- Only the columns that changed, so the log reads as a diff.
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_after) loop
      if v_after -> k = v_before -> k then
        v_after := v_after - k; v_before := v_before - k;
      end if;
    end loop;
    if v_after = '{}'::jsonb then return null; end if;
    v_after := v_after - 'updated_at'; v_before := v_before - 'updated_at';
    if v_after = '{}'::jsonb then return null; end if;
  end if;
  insert into public.money_change_log (table_name, row_id, op, changed_by, changed_as, before, after)
  values (tg_table_name, v_row_id, tg_op, (select auth.uid()), current_user, v_before, v_after);
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['payments', 'payment_refunds', 'payment_plans', 'coupons', 'coupon_redemptions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_money_log', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_money_change()', t || '_money_log', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Gifts never move back from received (0107's guard, same columns).
-- ---------------------------------------------------------------------------
drop trigger if exists gifts_status_one_way on public.gifts;
create trigger gifts_status_one_way before update on public.gifts
  for each row execute function public.guard_payment_status_one_way();

-- ---------------------------------------------------------------------------
-- 10. A decided scholarship request stays decided. 0105's guard restated.
-- ---------------------------------------------------------------------------
create or replace function public.guard_family_decision_columns()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_table_name = 'scholarships' then
    if public.can_decide_scholarships() then return new; end if;
    if tg_op = 'INSERT' then
      new.granted_cents := 0;
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.staff_note := null;
      if new.status not in ('requested', 'withdrawn') then new.status := 'requested'; end if;
    else
      new.granted_cents := old.granted_cents;
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.staff_note := old.staff_note;
      -- 0111: once the ministry has answered, the answer stands.
      if old.status in ('granted', 'declined') and new.status is distinct from old.status then
        raise exception 'This request has been decided; ask the ministry if something has changed.';
      end if;
    end if;

  elsif tg_table_name = 'volunteer_applications' then
    if public.has_grant('registration', 'write') then return new; end if;
    if tg_op = 'INSERT' then
      new.status := 'applied';
      new.reviewed_by := null;
      new.reviewed_at := null;
    else
      if new.reviewed_by is not null then new.reviewed_by := old.reviewed_by; end if;
      if new.reviewed_at is not null then new.reviewed_at := old.reviewed_at; end if;
    end if;

  elsif tg_table_name = 'registration_cancellation_requests' then
    if public.has_grant('registration', 'write') then return new; end if;
    if tg_op = 'INSERT' then
      new.status := 'open';
      new.handled_by := null;
      new.handled_at := null;
      new.staff_note := null;
      new.requested_by := (select auth.uid());
    else
      new.handled_by := old.handled_by;
      new.handled_at := old.handled_at;
      new.staff_note := old.staff_note;
      new.requested_by := old.requested_by;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. The deposit question, answered for any staff member.
-- ---------------------------------------------------------------------------
create or replace function public.registration_paid_cents(p_registration_id uuid)
returns bigint language sql stable security definer set search_path = ''
as $$
  select case when public.is_staff() or p_registration_id in (select public.my_registration_ids()) then
    (select coalesce(sum(p.amount_cents), 0) from public.payments p
      where p.registration_id = p_registration_id and p.status = 'succeeded')
    - (select coalesce(sum(r.amount_cents), 0) from public.payment_refunds r
        where r.registration_id = p_registration_id and r.status = 'succeeded')
  end;
$$;
revoke all on function public.registration_paid_cents(uuid) from public, anon;
grant execute on function public.registration_paid_cents(uuid) to authenticated;

-- Post-checks: the rewrites took.
do $$
begin
  if position('may_recalc_person' in pg_get_functiondef('public.recalc_multi_week_discount(uuid)'::regprocedure)) = 0
     or position('c_require_confirmed' in pg_get_functiondef('public.recalc_multi_week_discount(uuid)'::regprocedure)) = 0
     or position('may_recalc_registration' in pg_get_functiondef('public.recalc_family_discount(uuid)'::regprocedure)) = 0
     or position('may_recalc_registration' in pg_get_functiondef('public.recalc_early_registration_discount(uuid)'::regprocedure)) = 0
     or position('is settled' in pg_get_functiondef('public.payment_refunds_guard()'::regprocedure)) = 0
     or position('has been decided' in pg_get_functiondef('public.guard_family_decision_columns()'::regprocedure)) = 0 then
    raise exception '0111: a function was not rewritten';
  end if;
end $$;
