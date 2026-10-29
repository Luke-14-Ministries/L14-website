-- 0146 -- The refund email is claimed by a stamp, not by a status change (29 Oct 2026)
--
-- Found in Stage B's first live refund: no email went to the family. The
-- refund webhook (W66) emailed only on the move INTO 'succeeded', made by
-- the webhook itself. A card refund succeeds at once, so the staff screen's
-- own action records it as succeeded before Stripe's event arrives; the
-- webhook then finds nothing to move, and the most common refund of all
-- never emailed anyone.
--
-- Now the webhook claims the email: once a refund is succeeded, it sets
-- receipt_emailed_at where it is still null, and only the delivery whose
-- update took sends. Whoever recorded the success, the family is emailed
-- once, however many events Stripe sends.
--
-- Backfill: refunds already succeeded before today's test are stamped, so a
-- late or re-sent Stripe event never emails a family about an old refund.
-- (The purge left none; the stamp is belt and braces.)

alter table public.payment_refunds
  add column if not exists receipt_emailed_at timestamptz;

comment on column public.payment_refunds.receipt_emailed_at is
  'When the family''s refund email was sent (or claimed for sending) by stripe-refund-webhook. Null = not yet. Set once, by the webhook, when the refund is succeeded. 0146.';

update public.payment_refunds
   set receipt_emailed_at = updated_at
 where status = 'succeeded'
   and receipt_emailed_at is null
   and created_at < '2026-10-29 18:00+00';
