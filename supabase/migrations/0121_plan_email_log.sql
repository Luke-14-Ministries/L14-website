-- 0121_plan_email_log.sql
--
-- Every payment-plan email is logged (Lawrence, 22 Oct 2026).
--
-- The payment-plan code (supabase/functions/_shared/plans.ts, shared by
-- stripe-plans-webhook and charge-payment-plans) sends the family a receipt,
-- a payment-problem notice, or the out-of-tries notice, and alerts staff when
-- a plan stops, a completed plan reopens, or a plan's deposit bounces. None of
-- it was recorded. message_log (0001) exists for exactly this -- "We told you
-- on the first" must be answerable from a record -- so sendEmail() in
-- plans.ts now writes one row per email, sent or failed, with Resend's id:
--
--   template_key              who
--   plan_receipt              family: an automatic payment was received
--   plan_payment_problem      family: a payment failed, will retry
--   plan_stopped_family       family: the third try failed, the plan stopped
--   plan_stopped_staff        staff:  a plan stopped after 3 failed payments
--   plan_reopened_staff       staff:  a completed plan reopened on a bounce
--   plan_deposit_failed_staff staff:  a plan's deposit bounced, plan undone
--
-- The edge functions write with the service-role client, which RLS does not
-- apply to; log_family_email() (0120) is the STAFF path and is not involved.
-- A logging failure is printed and never stops a charge being recorded.
--
-- What this migration does:
--
-- 1. template_key. 0001 made it free text, and nothing since (0001-0120) has
--    added a check constraint, so there is nothing to extend. The post-check
--    below fails loudly if the database has one anyway (drift), rather than
--    every plan email's log row being refused in silence.
--
-- 2. service_role. 0001's table grants name only authenticated (and anon on
--    the catalogue); 0006 found the webhook refused on payments for that
--    reason, and every money table since grants service_role what it needs
--    by name. message_log is written by service_role for the first time
--    here, so it is granted SELECT and INSERT -- no UPDATE or DELETE: the
--    record is not tidied afterwards. Idempotent if a default privilege
--    already gave it.
--
-- Staff read is unchanged (message_log_staff, 0113: is_staff()); families
-- read nothing. Not applied to the production project yet; the lead applies.

grant select, insert on public.message_log to service_role;

comment on column public.message_log.template_key is
  'Which email. Free text by design (0001). In use: family_update, waiver_needed (staff-pressed, 0120); plan_receipt, plan_payment_problem, plan_stopped_family, plan_stopped_staff, plan_reopened_staff, plan_deposit_failed_staff (payment-plan edge functions, 0121).';

-- Post-check: the grant took, and no check constraint limits template_key.
do $$
begin
  if not has_table_privilege('service_role', 'public.message_log', 'INSERT') then
    raise exception '0121: service_role still cannot insert into message_log';
  end if;
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.message_log'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%template_key%') then
    raise exception '0121: message_log has a check constraint on template_key; extend it for the plan_* keys before applying';
  end if;
end;
$$;
