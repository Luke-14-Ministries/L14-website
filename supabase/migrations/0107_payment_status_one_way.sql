-- 0107_payment_status_one_way.sql
--
-- Platform security audit M1 (18 Oct 2026). Stripe does not guarantee the
-- order of events, and a retried or dashboard-"Resend" checkout.session.completed
-- upserts payments.status unconditionally (stripe-webhook, _shared/plans.ts).
-- A late event could therefore move a payment that is already received,
-- refunded or failed back to "processing" -- un-refunding it on the balance,
-- holding a payment plan on "still clearing", and recomputing the early
-- discount on a false state.
--
-- One rule, enforced in the database so it holds for every writer, the
-- webhooks' service role included: a payment never moves BACK to
-- processing/pending once it has succeeded, been refunded or failed. A
-- refunded payment may still return to succeeded -- the refund webhook does
-- that when a refund fails or is cancelled, from the refunds on file. The
-- received date is never cleared by a late event either.

create or replace function public.guard_payment_status_one_way()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status in ('processing', 'pending')
     and old.status in ('succeeded', 'refunded', 'failed') then
    new.status := old.status;
  end if;
  if old.received_on is not null and new.received_on is null then
    new.received_on := old.received_on;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_status_one_way on public.payments;
create trigger payments_status_one_way before update on public.payments
  for each row execute function public.guard_payment_status_one_way();

-- Found the same day by Testing Script 5 (13.42): the staff access log was
-- created in 0058 with an administrator read policy but no table grant, so
-- Staff & Access -> Access changes has always said "permission denied". RLS
-- without a grant is the first trap in CLAUDE.md. Read only; the log is
-- written by trigger.
grant select on public.staff_access_log to authenticated;

-- ---------------------------------------------------------------------------
-- Platform security audit M2 (18 Oct 2026): a refund could be paid twice.
-- The staff action called Stripe first and recorded second, with no
-- idempotency key, and the over-refund guard took no lock. A double submit
-- or two tabs of a 40% refund both passed, Stripe paid both, both recorded.
--
-- Now (with refundPayment in app/admin/registrations/[id]/actions.js):
--   1. each refund form carries a one-time request_key; the database keeps it
--      unique among live refunds, so a second submit of the same form is
--      refused before Stripe is called;
--   2. the row is RESERVED (pending) before Stripe is called, so the guard
--      below runs before money moves, and the guard locks the payment row so
--      two refunds of one payment are checked one after the other;
--   3. Stripe gets the reserved row's id as its idempotency key and in
--      metadata, so a retried call returns the same refund and the refund
--      webhook fills that row instead of adding a second one. A refusal
--      cancels the reservation.
-- The fee-cover check now counts fee cover already refunded, not just this
-- refund's share.
-- ---------------------------------------------------------------------------

alter table public.payment_refunds add column if not exists request_key text;
create unique index if not exists payment_refunds_request_key_live
  on public.payment_refunds (request_key)
  where request_key is not null and status in ('pending', 'succeeded');

create or replace function public.payment_refunds_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_payment record;
  v_already int;
  v_fee_already int;
begin
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

  -- Refunding something that never settled is a contradiction; cancel it
  -- instead. ('processing' is allowed: an ACH debit already on its way can be
  -- refunded once it lands, and staff queue that deliberately.)
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
