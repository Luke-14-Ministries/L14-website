-- 0144 — The payment-plan guard no longer cancels a cascaded delete
-- (29 Oct 2026, found during the G2 test-data purge).
--
-- guard_payment_plan_writes() (0111, restated in 0123) is a BEFORE trigger on
-- INSERT, UPDATE and DELETE. For anyone other than a signed-in or anonymous
-- site user it began `return new`. On a DELETE, NEW is null, and a BEFORE
-- trigger that returns null silently skips the row. So when a registration
-- was deleted as the database owner, its ON DELETE CASCADE to payment_plans
-- was skipped, leaving a plan pointing at a registration that no longer
-- exists (the foreign key still reads valid; PostgreSQL lets a trigger do
-- this). The purge left exactly one such plan, the test plan from 27 Oct, with
-- 20 scheduled charges the daily charger would have kept trying.
--
-- Restated in full with `return coalesce(new, old)` on the owner's path.
-- Signed-in and anonymous users are still refused a delete outright.

create or replace function public.guard_payment_plan_writes()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  -- The owner (webhook, charger, migrations, a cascade from a deleted
  -- registration) passes; OLD on a delete, or the row is silently skipped.
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
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
$function$;
