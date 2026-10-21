-- 0112_review_class_counts_requests_only.sql
--
-- Found by the 20 Oct screen test of Testing Script 5 (13.46). When staff
-- granted a $1 scholarship to a person whose family had never asked for one,
-- the registration's review class became "Full scholarship requested" and the
-- Review card offered approval without a deposit. registration_review's
-- scholarship arithmetic read a scholarships row with requested_cents NULL as
-- a request for everything the person owes -- right for a family that asked
-- for "help with the whole fee", wrong for a staff grant, which has no
-- request at all.
--
-- Now: a REQUESTED row counts what was asked for (NULL = everything owed); a
-- GRANTED row counts what was granted; a declined or withdrawn row counts
-- nothing. The view is restated in full from 0109 with only that CASE
-- changed; it stays a definer view with its own Payments-read filter.

create or replace view public.registration_review as
 WITH live AS (
         SELECT rp.registration_id,
            rp.id,
            rp.person_id,
            rp.camp_role,
            rp.fee_cents,
            GREATEST(0, rp.fee_cents - rp.discount_cents - rp.early_discount_cents - rp.family_discount_cents) AS owes
           FROM registration_participants rp
          WHERE rp.status <> 'cancelled'::text
        ), heads AS (
         SELECT live.registration_id,
            count(DISTINCT live.person_id) FILTER (WHERE live.fee_cents > 0) AS fee_people
           FROM live
          GROUP BY live.registration_id
        ), confirmed AS (
         SELECT pm.registration_id,
            sum(pm.amount_cents) - COALESCE(( SELECT sum(pr.amount_cents) AS sum
                   FROM payment_refunds pr
                  WHERE pr.registration_id = pm.registration_id AND pr.status = 'succeeded'::text), 0::bigint) AS cents
           FROM payments pm
          WHERE pm.status = 'succeeded'::text
          GROUP BY pm.registration_id
        ), sch AS (
         SELECT l.registration_id,
            sum(l.owes) AS owes,
            sum(
                CASE
                    WHEN s_1.id IS NULL THEN 0
                    WHEN s_1.status = 'requested'::text THEN LEAST(l.owes, COALESCE(s_1.requested_cents, l.owes))
                    WHEN s_1.status = 'granted'::text THEN LEAST(l.owes, COALESCE(s_1.granted_cents, 0))
                    ELSE 0
                END) AS requested
           FROM live l
             LEFT JOIN scholarships s_1 ON s_1.registration_participant_id = l.id AND (s_1.status = ANY (ARRAY['requested'::text, 'granted'::text]))
          WHERE l.fee_cents > 0
          GROUP BY l.registration_id
        ), media_no AS (
         SELECT l.registration_id,
            count(DISTINCT l.person_id) AS n
           FROM live l
             JOIN LATERAL ( SELECT pc.granted
                   FROM person_consents pc
                  WHERE pc.person_id = l.person_id AND pc.kind = 'media'::text
                  ORDER BY pc.recorded_at DESC
                 LIMIT 1) m ON true
          WHERE m.granted = false
          GROUP BY l.registration_id
        ), creed_no AS (
         SELECT l.registration_id,
            count(*) AS n
           FROM live l
             LEFT JOIN volunteer_applications va ON va.registration_participant_id = l.id
          WHERE l.camp_role = 'volunteer'::text AND COALESCE(va.creed_affirmed, false) = false
          GROUP BY l.registration_id
        )
 SELECT r.id AS registration_id,
    r.household_id,
    r.event_id,
    COALESCE(c.cents, 0::bigint) AS confirmed_paid_cents,
    COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, 0::bigint) AS deposit_expected_cents,
        CASE
            WHEN r.deposit_waived_at IS NOT NULL
              OR (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, 0::bigint) > 0
                  AND COALESCE(c.cents, 0::bigint) >= COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, 0::bigint))
              OR (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, 0::bigint) = 0
                  AND COALESCE(c.cents, 0::bigint) > 0) THEN 'deposit_paid'::text
            WHEN COALESCE(s.owes, 0::bigint) > 0 AND COALESCE(s.requested, 0::bigint) >= s.owes THEN 'full_scholarship'::text
            ELSE 'neither'::text
        END AS review_class,
    array_remove(ARRAY[
        CASE
            WHEN r.deposit_waived_at IS NULL AND COALESCE(c.cents, 0::bigint) > 0 AND COALESCE(c.cents, 0::bigint) < (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, 0::bigint)) THEN 'deposit_short'::text
            ELSE NULL::text
        END,
        CASE
            WHEN r.deposit_waived_at IS NOT NULL THEN 'deposit_waived'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(mn.n, 0::bigint) > 0 THEN 'media_declined'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(cn.n, 0::bigint) > 0 THEN 'creed_not_affirmed'::text
            ELSE NULL::text
        END,
        CASE
            WHEN r.hold_since IS NOT NULL THEN 'on_hold'::text
            ELSE NULL::text
        END], NULL::text) AS flags
   FROM registrations r
     JOIN events e ON e.id = r.event_id
     LEFT JOIN heads h ON h.registration_id = r.id
     LEFT JOIN confirmed c ON c.registration_id = r.id
     LEFT JOIN sch s ON s.registration_id = r.id
     LEFT JOIN media_no mn ON mn.registration_id = r.id
     LEFT JOIN creed_no cn ON cn.registration_id = r.id
  WHERE has_grant('payments'::text, 'read'::text);
