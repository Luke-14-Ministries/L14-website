-- 0133_paid_counts_refunded_payments.sql
--
-- "Paid" subtracted a fully refunded payment's refunds twice (Lawrence,
-- 26 Oct 2026: a registration read "Paid $-180.00 · Owed $900.00").
--
-- settle_payment_after_refund() (0053/0107) marks a payment 'refunded' once
-- its pending + succeeded refunds reach its amount. The three places that work
-- out what a family has paid summed only payments with status 'succeeded'
-- (plus 'processing' in the balances view) -- so a fully refunded payment fell
-- out of the gross while its succeeded refunds were still subtracted:
-- $470 bank + $490 card, $670 refunded, read $490 - $670 = -$180 instead of
-- $960 - $670 = $290. A 'refunded' payment is money that came in and then went
-- back; it belongs in the gross, and its refunds in the subtraction.
--
-- Restated with 'refunded' added to the gross, and nothing else changed:
--   registration_paid_cents()   (the deposit question for any staff member)
--   registration_balances        (paid_cents, balance_cents; invoker view)
--   registration_review          (confirmed_paid_cents, the deposit class and
--                                 flags; DEFINER on purpose with its own row
--                                 filter, has_grant('payments','read') -- kept)
-- A payment whose refunds are still PENDING is also marked 'refunded'; it now
-- counts in full until a refund clears, which is the rule everywhere else
-- ("money only counts once it has moved").

-- ---------------------------------------------------------------------------
-- 1. registration_paid_cents()
-- ---------------------------------------------------------------------------
create or replace function public.registration_paid_cents(p_registration_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select case when public.is_staff() or p_registration_id in (select public.my_registration_ids()) then
    (select coalesce(sum(p.amount_cents), 0) from public.payments p
      where p.registration_id = p_registration_id and p.status in ('succeeded', 'refunded'))
    - (select coalesce(sum(r.amount_cents), 0) from public.payment_refunds r
        where r.registration_id = p_registration_id and r.status = 'succeeded')
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. registration_balances (same columns, same order; invoker as before)
-- ---------------------------------------------------------------------------
create or replace view public.registration_balances
with (security_invoker = on) as
 SELECT r.id AS registration_id,
    r.household_id,
    r.event_id,
    COALESCE(f.fee_cents, (0)::bigint) AS fee_cents,
    COALESCE(f.discount_cents, (0)::bigint) AS discount_cents,
    COALESCE(f.scholarship_cents, (0)::bigint) AS scholarship_cents,
    COALESCE(c.coupon_cents, (0)::bigint) AS coupon_cents,
    (COALESCE(p.paid_cents, (0)::bigint) - COALESCE(rf.refunded_cents, (0)::bigint)) AS paid_cents,
    (((((COALESCE(f.fee_cents, (0)::bigint) - COALESCE(f.discount_cents, (0)::bigint)) - COALESCE(f.scholarship_cents, (0)::bigint)) - COALESCE(c.coupon_cents, (0)::bigint)) + COALESCE(x.fees_cents, (0)::bigint)) - (COALESCE(p.paid_cents, (0)::bigint) - COALESCE(rf.refunded_cents, (0)::bigint))) AS balance_cents,
    COALESCE(rf.refunded_cents, (0)::bigint) AS refunded_cents,
    COALESCE(rp.refund_pending_cents, (0)::bigint) AS refund_pending_cents,
    COALESCE(f.early_discount_cents, (0)::bigint) AS early_discount_cents,
    COALESCE(f.family_discount_cents, (0)::bigint) AS family_discount_cents,
    COALESCE(x.fees_cents, (0)::bigint) AS fees_cents
   FROM ((((((public.registrations r
     LEFT JOIN ( SELECT rp2.registration_id,
            sum(pm.fee_cents) AS fee_cents,
            sum(((pm.discount_cents + pm.early_discount_cents) + pm.family_discount_cents)) AS discount_cents,
            sum(pm.scholarship_cents) AS scholarship_cents,
            sum(pm.early_discount_cents) AS early_discount_cents,
            sum(pm.family_discount_cents) AS family_discount_cents
           FROM (public.registration_participants rp2
             JOIN public.participant_money pm ON ((pm.participant_id = rp2.id)))
          WHERE (rp2.status <> 'cancelled'::text)
          GROUP BY rp2.registration_id) f ON ((f.registration_id = r.id)))
     LEFT JOIN ( SELECT cr.registration_id,
            sum(cr.applied_cents) AS coupon_cents
           FROM public.coupon_redemptions cr
          GROUP BY cr.registration_id) c ON ((c.registration_id = r.id)))
     LEFT JOIN ( SELECT pm.registration_id,
            sum(pm.amount_cents) AS paid_cents
           FROM public.payments pm
          WHERE (pm.status = ANY (ARRAY['succeeded'::text, 'processing'::text, 'refunded'::text]))
          GROUP BY pm.registration_id) p ON ((p.registration_id = r.id)))
     LEFT JOIN ( SELECT pr.registration_id,
            sum(pr.amount_cents) AS refunded_cents
           FROM public.payment_refunds pr
          WHERE (pr.status = 'succeeded'::text)
          GROUP BY pr.registration_id) rf ON ((rf.registration_id = r.id)))
     LEFT JOIN ( SELECT pr.registration_id,
            sum(pr.amount_cents) AS refund_pending_cents
           FROM public.payment_refunds pr
          WHERE (pr.status = 'pending'::text)
          GROUP BY pr.registration_id) rp ON ((rp.registration_id = r.id)))
     LEFT JOIN ( SELECT rfee.registration_id,
            sum(rfee.amount_cents) AS fees_cents
           FROM public.registration_fees rfee
          WHERE (rfee.waived_at IS NULL)
          GROUP BY rfee.registration_id) x ON ((x.registration_id = r.id)))
  WHERE ((f.registration_id IS NOT NULL) OR (NOT (EXISTS ( SELECT 1
           FROM public.registration_participants rp3
          WHERE ((rp3.registration_id = r.id) AND (rp3.status <> 'cancelled'::text))))));

-- ---------------------------------------------------------------------------
-- 3. registration_review (DEFINER, its own row filter kept)
-- ---------------------------------------------------------------------------
create or replace view public.registration_review as
 WITH live AS (
         SELECT rp.registration_id,
            rp.id,
            rp.person_id,
            rp.camp_role,
            pm.fee_cents,
            GREATEST(0, (((pm.fee_cents - pm.discount_cents) - pm.early_discount_cents) - pm.family_discount_cents)) AS owes
           FROM (public.registration_participants rp
             JOIN public.participant_money pm ON ((pm.participant_id = rp.id)))
          WHERE (rp.status <> 'cancelled'::text)
        ), heads AS (
         SELECT live.registration_id,
            count(DISTINCT live.person_id) FILTER (WHERE (live.fee_cents > 0)) AS fee_people
           FROM live
          GROUP BY live.registration_id
        ), confirmed AS (
         SELECT pm.registration_id,
            (sum(pm.amount_cents) - COALESCE(( SELECT sum(pr.amount_cents) AS sum
                   FROM public.payment_refunds pr
                  WHERE ((pr.registration_id = pm.registration_id) AND (pr.status = 'succeeded'::text))), (0)::bigint)) AS cents
           FROM public.payments pm
          WHERE (pm.status = ANY (ARRAY['succeeded'::text, 'refunded'::text]))
          GROUP BY pm.registration_id
        ), sch AS (
         SELECT l.registration_id,
            sum(l.owes) AS owes,
            sum(
                CASE
                    WHEN (s_1.id IS NULL) THEN 0
                    WHEN (s_1.status = 'requested'::text) THEN LEAST(l.owes, COALESCE(s_1.requested_cents, l.owes))
                    WHEN (s_1.status = 'granted'::text) THEN LEAST(l.owes, COALESCE(s_1.granted_cents, 0))
                    ELSE 0
                END) AS requested
           FROM (live l
             LEFT JOIN public.scholarships s_1 ON (((s_1.registration_participant_id = l.id) AND (s_1.status = ANY (ARRAY['requested'::text, 'granted'::text])))))
          WHERE (l.fee_cents > 0)
          GROUP BY l.registration_id
        ), media_no AS (
         SELECT l.registration_id,
            count(DISTINCT l.person_id) AS n
           FROM (live l
             JOIN LATERAL ( SELECT pc.granted
                   FROM public.person_consents pc
                  WHERE ((pc.person_id = l.person_id) AND (pc.kind = 'media'::text))
                  ORDER BY pc.recorded_at DESC
                 LIMIT 1) m ON (true))
          WHERE (m.granted = false)
          GROUP BY l.registration_id
        ), creed_no AS (
         SELECT l.registration_id,
            count(*) AS n
           FROM (live l
             LEFT JOIN public.volunteer_applications va ON ((va.registration_participant_id = l.id)))
          WHERE ((l.camp_role = 'volunteer'::text) AND (COALESCE(va.creed_affirmed, false) = false))
          GROUP BY l.registration_id
        )
 SELECT r.id AS registration_id,
    r.household_id,
    r.event_id,
    COALESCE(c.cents, (0)::bigint) AS confirmed_paid_cents,
    (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)) AS deposit_expected_cents,
        CASE
            WHEN ((r.deposit_waived_at IS NOT NULL) OR (((COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)) > 0) AND (COALESCE(c.cents, (0)::bigint) >= (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)))) OR (((COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)) = 0) AND (COALESCE(c.cents, (0)::bigint) > 0))) THEN 'deposit_paid'::text
            WHEN ((COALESCE(s.owes, (0)::bigint) > 0) AND (COALESCE(s.requested, (0)::bigint) >= s.owes)) THEN 'full_scholarship'::text
            ELSE 'neither'::text
        END AS review_class,
    array_remove(ARRAY[
        CASE
            WHEN ((r.deposit_waived_at IS NULL) AND (COALESCE(c.cents, (0)::bigint) > 0) AND (COALESCE(c.cents, (0)::bigint) < (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)))) THEN 'deposit_short'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (r.deposit_waived_at IS NOT NULL) THEN 'deposit_waived'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(mn.n, (0)::bigint) > 0) THEN 'media_declined'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(cn.n, (0)::bigint) > 0) THEN 'creed_not_affirmed'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (r.hold_since IS NOT NULL) THEN 'on_hold'::text
            ELSE NULL::text
        END], NULL::text) AS flags
   FROM ((((((public.registrations r
     JOIN public.events e ON ((e.id = r.event_id)))
     LEFT JOIN heads h ON ((h.registration_id = r.id)))
     LEFT JOIN confirmed c ON ((c.registration_id = r.id)))
     LEFT JOIN sch s ON ((s.registration_id = r.id)))
     LEFT JOIN media_no mn ON ((mn.registration_id = r.id)))
     LEFT JOIN creed_no cn ON ((cn.registration_id = r.id)))
  WHERE public.has_grant('payments'::text, 'read'::text);

-- ---------------------------------------------------------------------------
-- 4. Post-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if position('''refunded''' in pg_get_functiondef('public.registration_paid_cents(uuid)'::regprocedure)) = 0 then
    raise exception '0133: registration_paid_cents does not count refunded payments';
  end if;
  if position('''refunded''' in pg_get_viewdef('public.registration_balances'::regclass)) = 0 then
    raise exception '0133: registration_balances does not count refunded payments';
  end if;
  if position('''refunded''' in pg_get_viewdef('public.registration_review'::regclass)) = 0 then
    raise exception '0133: registration_review does not count refunded payments';
  end if;
  -- The balances view still runs with the caller's rights (null means "not
  -- yours to see" for staff without Payments read -- CLAUDE.md, Money).
  if not exists (select 1 from pg_class where oid = 'public.registration_balances'::regclass
                  and ('security_invoker=on' = any (coalesce(reloptions, '{}'))
                       or 'security_invoker=true' = any (coalesce(reloptions, '{}')))) then
    raise exception '0133: registration_balances must stay a security invoker view';
  end if;
  -- The review view's own row filter survived the restatement (CLAUDE.md traps).
  if position('has_grant(''payments''' in pg_get_viewdef('public.registration_review'::regclass)) = 0 then
    raise exception '0133: registration_review lost its row filter';
  end if;
  if exists (select 1 from pg_class where oid = 'public.registration_review'::regclass
              and 'security_invoker=true' = any (coalesce(reloptions, '{}'))) then
    raise exception '0133: registration_review must stay a definer view';
  end if;
end;
$$;
