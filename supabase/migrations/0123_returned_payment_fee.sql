-- 0123_returned_payment_fee.sql
--
-- A returned-bank-payment fee (Lawrence, 22 Oct 2026). When a bank (ACH)
-- debit fails, Stripe charges the ministry a fee. The ministry may pass a fee
-- on to the family -- with notice, and only the fee the family was told about.
--
-- WHAT CHANGES
--   * events.returned_payment_fee_cents: the setting, per event, on Setup next
--     to the other money settings (0096). 0 = off, the default.
--   * payment_plans.returned_payment_fee_cents: the fee the family was SHOWN
--     when they agreed to the plan, carried through Stripe Checkout's metadata
--     and stored by the plans webhook when the plan activates. The automatic
--     fee on a plan's charges uses this snapshot, never the event's current
--     value: a fee set or raised after a family agreed does not apply to
--     them, and $0 at agreement means no fee ever for that plan. Not a staff
--     column: guard_payment_plan_writes (0111) is restated with it.
--     A pay-in-full (or deposit, or part) bank payment carries its own
--     snapshot in the Checkout metadata the same way (no table needed; the
--     webhook passes it to record_returned_payment_fee()).
--   * public.registration_fees: one row per fee. Readable by the registration's
--     own household and by Payments read (participant_money's rule, 0114). No
--     signed-in insert, update or delete: staff go through
--     add_registration_fee() (Payments write) / waive_registration_fee() (Payments and Registration write, as a scholarship is); the
--     automatic fee is recorded by the edge functions (service role) through
--     record_returned_payment_fee(). Every write lands in money_change_log
--     (0111). Unique on the PaymentIntent: each plan try and each checkout is
--     its own PaymentIntent, so a Stripe retry of the same webhook -- or the
--     charger and the webhook both seeing one failure -- records one fee.
--     A fee is recorded only for a debit the bank actually RETURNED (the
--     caller says so from Stripe's latest charge) and at most once per plan
--     installment, so a blocked account's instant refusals add nothing.
--   * registration_payment_routes (0115) restated: "paid in full" / "nothing
--     owed" ask about the camp (balance less fees), so a fee does not turn a
--     paid family back into "not finished"; the fee shows as its own line.
--   * registration_balances: unwaived fees are owed. A fees_cents column at
--     the end, and balance_cents includes it. Restated in full, exactly as
--     0114 left it otherwise: security invoker, the same row filter.
--   * recalc_early_registration_discount (0114) restated in full: the
--     early-registration rule asks whether the CAMP is paid, so it sets the
--     fees aside -- a $4 fee added after a family paid in full must not take
--     away their early discount and turn $4 into $104 owed.
--
-- Fees are NOT added to a plan's stored schedule rows. Because the charger
-- works each charge out on the day from the live balance (0080), an unpaid
-- fee is collected with the plan's remaining charges and the plan still
-- closes on exactly $0 -- the plan "settled balance" (plans.ts) includes it.
-- The agreement the family ticks and the payment-problem email say so.

-- ---------------------------------------------------------------------------
-- 1. The setting, and the snapshot on a plan
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists returned_payment_fee_cents integer not null default 0
    check (returned_payment_fee_cents >= 0);
comment on column public.events.returned_payment_fee_cents is
  'Returned bank payment fee passed on to the family (0123). 0 = off. Disclosed on Ways to pay and in the plan agreement when > 0; what is charged is the amount snapshotted when the family agreed, never this current value.';

alter table public.payment_plans
  add column if not exists returned_payment_fee_cents integer not null default 0
    check (returned_payment_fee_cents >= 0);
comment on column public.payment_plans.returned_payment_fee_cents is
  'The returned-payment fee the family was shown when they agreed to this plan (0123), from the Checkout metadata. A failed bank charge on this plan adds exactly this; 0 means never. Set only by the plans webhook.';

-- 0111's guard restated in full with the snapshot added to what staff may not
-- change. Invoker on purpose: current_user tells a signed-in writer from the
-- service role (CLAUDE.md: a definer trigger sees its owner).
create or replace function public.guard_payment_plan_writes()
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
     -- 0123: what the family agreed to is not changed by hand.
     or new.returned_payment_fee_cents is distinct from old.returned_payment_fee_cents
     or new.created_at          is distinct from old.created_at then
    raise exception 'Only a plan''s status, early-discount decision, cancellation stamps and note are changed by staff.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The fees
-- ---------------------------------------------------------------------------
create table if not exists public.registration_fees (
  id                       uuid primary key default gen_random_uuid(),
  registration_id          uuid not null references public.registrations (id) on delete restrict,
  kind                     text not null check (kind in ('returned_payment', 'manual')),
  amount_cents             integer not null check (amount_cents > 0),
  reason                   text,
  payment_id               uuid references public.payments (id) on delete set null,
  -- One fee per failed attempt: each plan try and each checkout is its own
  -- PaymentIntent. NULLs are distinct, so manual fees are not limited.
  stripe_payment_intent_id text unique,
  payment_installment_id   uuid references public.payment_installments (id) on delete set null,
  created_at               timestamptz not null default now(),
  created_by               uuid references public.profiles (id) on delete set null,  -- null = automatic
  waived_at                timestamptz,
  waived_by                uuid references public.profiles (id) on delete set null,
  waived_reason            text,
  constraint registration_fees_returned_has_intent
    check (kind <> 'returned_payment' or stripe_payment_intent_id is not null),
  constraint registration_fees_waiver_has_reason
    check (waived_at is null or nullif(btrim(waived_reason), '') is not null)
);
create index if not exists registration_fees_registration_idx on public.registration_fees (registration_id);
-- At most ONE returned-payment fee per plan installment (review, 22 Oct):
-- after a return such as R02 (account closed) Stripe blocks the account, and
-- the next tries fail at once, each a new PaymentIntent. However many tries an
-- installment takes, one returned debit is one fee.
create unique index if not exists registration_fees_one_per_installment
  on public.registration_fees (payment_installment_id)
  where kind = 'returned_payment' and payment_installment_id is not null;

comment on table public.registration_fees is
  'Fees added to a registration (0123): the automatic returned-bank-payment fee and staff-added fees. Unwaived fees count in registration_balances. Readable by the household and Payments read; written only through record_returned_payment_fee() (service role), add_registration_fee() (Payments write) and waive_registration_fee() (Payments and Registration write).';

alter table public.registration_fees enable row level security;

-- Who may READ a fee: the registration's own household, or Payments read --
-- participant_money's rule (0114). No insert, update or delete policy:
-- nobody signed in writes this table directly.
drop policy if exists registration_fees_select on public.registration_fees;
create policy registration_fees_select on public.registration_fees
  for select to authenticated
  using (public.has_grant('payments', 'read')
         or registration_id in (select public.my_registration_ids()));

-- RLS without a grant is permission denied (CLAUDE.md, the first trap).
-- SELECT only for signed-in users (the balances view is invoker and reads
-- it); nothing for anon. The service role reads it for the balances view and
-- the staff alerts, and inserts the automatic fee through the invoker
-- function below -- so it is the writer the audit log names.
revoke all on public.registration_fees from public, anon, authenticated;
grant select on public.registration_fees to authenticated;
grant select, insert on public.registration_fees to service_role;

-- The audit trail (0111's logger, unchanged: the table has an `id`).
drop trigger if exists registration_fees_money_log on public.registration_fees;
create trigger registration_fees_money_log
  after insert or update or delete on public.registration_fees
  for each row execute function public.log_money_change();

-- ---------------------------------------------------------------------------
-- 3. The automatic fee (edge functions only, as the service role)
-- ---------------------------------------------------------------------------
-- Records the returned-payment fee for one failed bank payment, once.
--   p_installment_id given -> a plan charge: the amount is the plan's
--                             snapshot (payment_plans.returned_payment_fee_cents)
--   otherwise              -> a checkout: the amount is p_disclosed_cents, the
--                             snapshot that rode in the Checkout metadata
-- The event's current setting is never read. Refused (0, false) unless
--   * p_returned: the caller saw a debit that was actually SUBMITTED and came
--     back (Stripe's latest charge on the PaymentIntent failed with a failure
--     code). A try Stripe refuses at once -- an account it blocked after an
--     earlier return -- never reached the bank and costs the ministry no
--     return fee, so it adds none (review, 22 Oct);
--   * the payment row for this PaymentIntent is a FAILED BANK payment on this
--     registration: a card decline costs the ministry nothing, so no fee,
--     whatever the caller thought;
--   * for a plan charge, the installment has no returned-payment fee yet.
-- Returns the fee on file for THIS PaymentIntent and whether this call added
-- it (only the caller that added it tells the family; a second failure of an
-- installment that already carries a fee reports 0, so no email says a fee
-- was added again).
-- INVOKER on purpose: the service role writes, as the money_change_log rows
-- with no person (changed_by null) show.
create or replace function public.record_returned_payment_fee(
  p_registration_id   uuid,
  p_payment_intent_id text,
  p_installment_id    uuid,
  p_disclosed_cents   integer,
  p_returned          boolean
)
returns table (fee_cents integer, added boolean)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_amount     integer;
  v_new_id     uuid;
begin
  if p_registration_id is null or nullif(btrim(p_payment_intent_id), '') is null then
    return query select 0, false; return;
  end if;

  -- Already on file (a Stripe retry, or the charger and the webhook both).
  select f.amount_cents into v_amount
    from public.registration_fees f where f.stripe_payment_intent_id = p_payment_intent_id;
  if v_amount is not null then
    return query select v_amount, false; return;
  end if;

  -- Never submitted to the bank, so never returned by it: no fee.
  if p_returned is not true then
    return query select 0, false; return;
  end if;

  -- One returned-payment fee per installment, whichever try it came from.
  if p_installment_id is not null and exists (
       select 1 from public.registration_fees f
        where f.payment_installment_id = p_installment_id and f.kind = 'returned_payment') then
    return query select 0, false; return;
  end if;

  select p.id into v_payment_id
    from public.payments p
   where p.stripe_payment_intent_id = p_payment_intent_id
     and p.registration_id = p_registration_id
     and p.method = 'bank_transfer'
     and p.status = 'failed';
  if v_payment_id is null then
    return query select 0, false; return;
  end if;

  if p_installment_id is not null then
    select pp.returned_payment_fee_cents into v_amount
      from public.payment_installments i
      join public.payment_plans pp on pp.id = i.payment_plan_id
     where i.id = p_installment_id
       and pp.registration_id = p_registration_id;
  else
    v_amount := p_disclosed_cents;
  end if;
  if coalesce(v_amount, 0) <= 0 then
    return query select 0, false; return;
  end if;

  insert into public.registration_fees
    (registration_id, kind, amount_cents, reason, payment_id, stripe_payment_intent_id, payment_installment_id)
  values
    (p_registration_id, 'returned_payment', v_amount, 'The bank returned a payment.',
     v_payment_id, p_payment_intent_id, p_installment_id)
  -- No conflict target: either uniqueness (the PaymentIntent, or one fee per
  -- installment) turns a racing second insert into nothing.
  on conflict do nothing
  returning id into v_new_id;

  if v_new_id is null then
    -- Lost a race to the other writer: report what it recorded for THIS
    -- PaymentIntent (0 if the race was another try of the installment).
    select f.amount_cents into v_amount
      from public.registration_fees f where f.stripe_payment_intent_id = p_payment_intent_id;
    return query select coalesce(v_amount, 0), false; return;
  end if;
  return query select v_amount, true;
end;
$$;
revoke all on function public.record_returned_payment_fee(uuid, text, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.record_returned_payment_fee(uuid, text, uuid, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Staff: add a fee by hand (Payments write), waive a fee (Payments + Registration write)
-- ---------------------------------------------------------------------------
create or replace function public.add_registration_fee(
  p_registration_id uuid,
  p_amount_cents    integer,
  p_reason          text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_grant('payments', 'write') then
    raise exception 'Adding a fee needs Payments write.' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'A fee must be more than $0.';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Give the reason for the fee; the family sees it.';
  end if;
  if not exists (select 1 from public.registrations r where r.id = p_registration_id) then
    raise exception 'No such registration.';
  end if;

  insert into public.registration_fees (registration_id, kind, amount_cents, reason, created_by)
  values (p_registration_id, 'manual', p_amount_cents, btrim(p_reason), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_registration_fee(uuid, integer, text) from public, anon;
grant execute on function public.add_registration_fee(uuid, integer, text) to authenticated;

-- Waiving is a hand-set money decision, like a scholarship or a hand-set
-- discount (0102): Payments AND Registration write, can_decide_scholarships().
-- Adding a fee stays bookkeeping (Payments write).
create or replace function public.waive_registration_fee(p_fee_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_decide_scholarships() then
    raise exception 'Waiving a fee is decided by Payments and Registration together.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Give the reason for waiving the fee.';
  end if;

  update public.registration_fees
     set waived_at = now(),
         waived_by = (select auth.uid()),
         waived_reason = btrim(p_reason)
   where id = p_fee_id
     and waived_at is null;
  if not found then
    raise exception 'That fee is already waived, or does not exist.';
  end if;
end;
$$;
revoke all on function public.waive_registration_fee(uuid, text) from public, anon;
grant execute on function public.waive_registration_fee(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. registration_balances: 0114's view, restated in full, plus the fees
-- ---------------------------------------------------------------------------
-- registration_balances (0001, 0038, 0053, 0080, 0081, 0114): invoker, so it
-- runs with the caller's rights. discount_cents means ALL discounts (0080);
-- early_discount_cents and family_discount_cents are named at the end.
--
-- 0114: the money comes from participant_money, which a staffer without
-- Payments read cannot see. Such a staffer gets NO ROW for a registration
-- with live participants (the pages show "--"), never a row of zeros that
-- reads as "paid $0" (0111 item 11). A registration with no live participant
-- has nothing to hide and keeps its zero row for anyone who can see it.
-- registration_paid_cents() remains the deposit question for any staff member.
--
-- 0123: fees_cents (unwaived registration_fees) is added at the END (CREATE
-- OR REPLACE VIEW keeps existing columns in place, so registration_payment_routes,
-- built on this view, stands) and balance_cents includes it.
create or replace view public.registration_balances
with (security_invoker = on)
as
select r.id as registration_id,
       r.household_id,
       r.event_id,
       coalesce(f.fee_cents, 0::bigint) as fee_cents,
       coalesce(f.discount_cents, 0::bigint) as discount_cents,
       coalesce(f.scholarship_cents, 0::bigint) as scholarship_cents,
       coalesce(c.coupon_cents, 0::bigint) as coupon_cents,
       coalesce(p.paid_cents, 0::bigint) - coalesce(rf.refunded_cents, 0::bigint) as paid_cents,
       coalesce(f.fee_cents, 0::bigint)
         - coalesce(f.discount_cents, 0::bigint)
         - coalesce(f.scholarship_cents, 0::bigint)
         - coalesce(c.coupon_cents, 0::bigint)
         + coalesce(x.fees_cents, 0::bigint)
         - (coalesce(p.paid_cents, 0::bigint) - coalesce(rf.refunded_cents, 0::bigint))
         as balance_cents,
       coalesce(rf.refunded_cents, 0::bigint) as refunded_cents,
       coalesce(rp.refund_pending_cents, 0::bigint) as refund_pending_cents,
       coalesce(f.early_discount_cents, 0::bigint) as early_discount_cents,
       coalesce(f.family_discount_cents, 0::bigint) as family_discount_cents,
       coalesce(x.fees_cents, 0::bigint) as fees_cents
  from public.registrations r
  left join (
    select rp2.registration_id,
           sum(pm.fee_cents) as fee_cents,
           sum(pm.discount_cents + pm.early_discount_cents + pm.family_discount_cents) as discount_cents,
           sum(pm.scholarship_cents) as scholarship_cents,
           sum(pm.early_discount_cents) as early_discount_cents,
           sum(pm.family_discount_cents) as family_discount_cents
      from public.registration_participants rp2
      join public.participant_money pm on pm.participant_id = rp2.id
     where rp2.status <> 'cancelled'
     group by rp2.registration_id
  ) f on f.registration_id = r.id
  left join (
    select cr.registration_id, sum(cr.applied_cents) as coupon_cents
      from public.coupon_redemptions cr
     group by cr.registration_id
  ) c on c.registration_id = r.id
  left join (
    select pm.registration_id, sum(pm.amount_cents) as paid_cents
      from public.payments pm
     where pm.status = any (array['succeeded', 'processing'])
     group by pm.registration_id
  ) p on p.registration_id = r.id
  left join (
    select pr.registration_id, sum(pr.amount_cents) as refunded_cents
      from public.payment_refunds pr
     where pr.status = 'succeeded'
     group by pr.registration_id
  ) rf on rf.registration_id = r.id
  left join (
    select pr.registration_id, sum(pr.amount_cents) as refund_pending_cents
      from public.payment_refunds pr
     where pr.status = 'pending'
     group by pr.registration_id
  ) rp on rp.registration_id = r.id
  left join (
    select rfee.registration_id, sum(rfee.amount_cents) as fees_cents
      from public.registration_fees rfee
     where rfee.waived_at is null
     group by rfee.registration_id
  ) x on x.registration_id = r.id
 where f.registration_id is not null
    or not exists (select 1 from public.registration_participants rp3
                    where rp3.registration_id = r.id and rp3.status <> 'cancelled');

grant select on public.registration_balances to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The early-registration rule sets fees aside (0114's function, restated)
-- ---------------------------------------------------------------------------
-- 0080's rule: the early discount, recomputed from stored facts (the 0070
-- pattern): clear it, then re-earn it. Safe to call as often as you like.
-- QUALIFIES when the person was registered by the early date AND either the
-- registration has an activated plan that still keeps the discount, or the
-- family has paid everything the discounted total asks for.
-- 0123: "everything" means the camp, not a returned-payment fee -- the fees
-- are taken back out of the balance before the comparison.
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

  update public.participant_money pm
     set early_discount_cents = 0, updated_at = now()
    from public.registration_participants rp
   where rp.id = pm.participant_id
     and rp.registration_id = p_registration_id
     and pm.early_discount_cents <> 0;

  select coalesce(sum(amount_cents), 0) into v_pot
    from public.early_discount_candidates(p_registration_id);
  if v_pot = 0 then return; end if;

  select exists (
    select 1 from public.payment_plans pp
     where pp.registration_id = p_registration_id
       and pp.activated_at is not null
       and pp.keeps_early_discount
  ) into v_has_plan;

  -- The camp's balance: what is owed less any fees (0123).
  select b.balance_cents - b.fees_cents into v_balance
    from public.registration_balances b where b.registration_id = p_registration_id;

  if v_has_plan or coalesce(v_balance, 0) - v_pot <= 0 then
    update public.participant_money pm
       set early_discount_cents = c.amount_cents, updated_at = now()
      from public.early_discount_candidates(p_registration_id) c
     where pm.participant_id = c.participant_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. registration_payment_routes: 0115's view, restated in full
-- ---------------------------------------------------------------------------
-- registration_payment_routes (0080, 0114, 0115): how each registration is
-- being paid -- the "finished registering" test.
--   plan          a plan that got past its deposit (active, paused, failed or completed)
--   paid_in_full  nothing owed and something was paid
--   nothing_owed  nothing owed and nothing paid (e.g. a zero-fee volunteer)
--   scholarship   a scholarship requested for someone on it (0115: a request,
--                 status 'requested' -- never a grant read as a request)
--   none          NOT FINISHED -- the family still has to choose
-- 0123: "owed" here is the camp -- balance_cents less fees_cents. A $4
-- returned-payment fee on a family who paid in full is a line on their
-- balance, not an unfinished payment choice. Otherwise exactly 0115; CREATE
-- OR REPLACE with the same columns in the same order.
create or replace view public.registration_payment_routes
with (security_invoker = on)
as
select r.id as registration_id,
       r.household_id,
       r.event_id,
       pp.id as plan_id,
       pp.status as plan_status,
       pp.schedule as plan_schedule,
       pp.payment_method_label,
       coalesce(sch.any_request, false) as scholarship_requested,
       case
         when pp.status in ('active', 'paused', 'failed', 'completed') then 'plan'
         when coalesce(b.balance_cents - b.fees_cents, 0) <= 0 and coalesce(b.paid_cents, 0) > 0 then 'paid_in_full'
         when coalesce(b.balance_cents - b.fees_cents, 0) <= 0 then 'nothing_owed'
         when coalesce(sch.any_request, false) then 'scholarship'
         else 'none'
       end as route
  from public.registrations r
  left join public.payment_plans pp on pp.registration_id = r.id
  left join public.registration_balances b on b.registration_id = r.id
  left join lateral (
    select true as any_request
      from public.scholarships s
      join public.registration_participants rp on rp.id = s.registration_participant_id
     where rp.registration_id = r.id
       and s.status = 'requested'
     limit 1
  ) sch on true;

grant select on public.registration_payment_routes to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Post-checks: the restatements took
-- ---------------------------------------------------------------------------
do $$
begin
  if position('fees_cents' in pg_get_viewdef('public.registration_payment_routes'::regclass)) = 0
     or position('requested' in pg_get_viewdef('public.registration_payment_routes'::regclass)) = 0 then
    raise exception '0123: registration_payment_routes was not rewritten';
  end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.registration_payment_routes'::regclass
                  and 'security_invoker=on' = any (c.reloptions)) then
    raise exception '0123: registration_payment_routes lost security_invoker';
  end if;
  if to_regclass('public.registration_fees_one_per_installment') is null then
    raise exception '0123: the one-fee-per-installment index is missing';
  end if;
  if position('can_decide_scholarships' in pg_get_functiondef('public.waive_registration_fee(uuid, text)'::regprocedure)) = 0 then
    raise exception '0123: waive_registration_fee does not ask can_decide_scholarships()';
  end if;
  if position('registration_fees' in pg_get_viewdef('public.registration_balances'::regclass)) = 0
     or position('participant_money' in pg_get_viewdef('public.registration_balances'::regclass)) = 0 then
    raise exception '0123: registration_balances was not rewritten';
  end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.registration_balances'::regclass
                  and 'security_invoker=on' = any (c.reloptions)) then
    raise exception '0123: registration_balances lost security_invoker';
  end if;
  if (select attnum from pg_attribute where attrelid = 'public.registration_balances'::regclass and attname = 'fees_cents')
     <> (select max(attnum) from pg_attribute where attrelid = 'public.registration_balances'::regclass and attnum > 0) then
    raise exception '0123: fees_cents is not the last column of registration_balances';
  end if;
  if position('fees_cents' in pg_get_functiondef('public.recalc_early_registration_discount(uuid)'::regprocedure)) = 0
     or position('may_recalc_registration' in pg_get_functiondef('public.recalc_early_registration_discount(uuid)'::regprocedure)) = 0 then
    raise exception '0123: recalc_early_registration_discount was not rewritten';
  end if;
  if position('returned_payment_fee_cents' in pg_get_functiondef('public.guard_payment_plan_writes()'::regprocedure)) = 0 then
    raise exception '0123: guard_payment_plan_writes was not rewritten';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.registration_fees'::regclass
                  and tgname = 'registration_fees_money_log') then
    raise exception '0123: registration_fees is not in the money audit log';
  end if;
  if has_table_privilege('authenticated', 'public.registration_fees', 'insert')
     or has_table_privilege('authenticated', 'public.registration_fees', 'update')
     or has_table_privilege('authenticated', 'public.registration_fees', 'delete')
     or has_function_privilege('authenticated', 'public.record_returned_payment_fee(uuid, text, uuid, integer, boolean)', 'execute') then
    raise exception '0123: a signed-in user can write registration_fees';
  end if;
end $$;
