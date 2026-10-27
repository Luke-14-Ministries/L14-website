-- 0136_plan_payment_method_changed_at.sql
--
-- When the card or bank account behind a payment plan last changed
-- (Lawrence, 27 Oct 2026, Testing Script 6 item 17.11: a failed plan charge
-- should stay flagged "until fixed"). Resuming a plan sets its failed charges
-- aside and rebuilds the schedule, which cleared the flag although the card
-- that failed was still the one on file. The pages now keep a set-aside
-- failure flagged until a later charge succeeds or the payment method changes
-- after it (planFailingSince in lib/plans.js) -- and "changed after it" needs
-- this stamp.
--
-- payment_plans.payment_method_changed_at: stamped by a trigger whenever
-- stripe_payment_method_id changes (the plans webhook saving a new card or
-- bank account, applyNewPaymentMethod in _shared/plans.ts). The trigger owns
-- the column: any other write to it is put back, so it cannot be set by hand.
-- Null on plans whose method never changed.

alter table public.payment_plans
  add column payment_method_changed_at timestamptz;

comment on column public.payment_plans.payment_method_changed_at is
  'When stripe_payment_method_id last changed (0136); set by trigger only. Null if the method never changed.';

create function public.stamp_plan_payment_method_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stripe_payment_method_id is distinct from old.stripe_payment_method_id then
    new.payment_method_changed_at := clock_timestamp();
  else
    new.payment_method_changed_at := old.payment_method_changed_at;
  end if;
  return new;
end;
$$;

create trigger payment_plans_method_changed
  before update on public.payment_plans
  for each row execute function public.stamp_plan_payment_method_change();

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'payment_plans'
                    and column_name = 'payment_method_changed_at') then
    raise exception '0136: payment_plans.payment_method_changed_at is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'payment_plans_method_changed') then
    raise exception '0136: the stamping trigger is missing';
  end if;
end;
$$;
