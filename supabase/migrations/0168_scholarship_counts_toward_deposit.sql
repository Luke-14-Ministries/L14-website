-- 0168_scholarship_counts_toward_deposit.sql
--
-- A granted scholarship pays toward the deposit first (Lawrence, 14 Nov 2026:
-- "my expectation is a $50 scholarship goes towards dep first and so should be
-- cleared now"; scope "everywhere", granted scholarships only). Ellen had a
-- $50 scholarship granted and was still held on Background screening for her
-- deposit, and her registration still read "Deposit short".
--
-- The granted amount is participant_money.scholarship_cents (what staff
-- decided, the figure balances and statements use), counted per person up to
-- what that person owes. A requested partial scholarship counts nothing until
-- it is granted; a FULL scholarship request still counts as before.
--
-- Restated, with only that changed:
--   registration_deposit_in()   the background-check hold (0157): IN when the
--                               money paid plus the granted scholarship covers
--                               the deposit expected.
--   registration_review         the deposit class and the deposit_short flag;
--                               DEFINER on purpose with its own row filter
--                               (has_grant('payments','read')), kept. One
--                               column is added at the end,
--                               deposit_scholarship_cents, so the "Deposit
--                               short -- $x of $y" words can count it.
-- A full scholarship keeps its own class ("To contact: full scholarship"): the
-- scholarship route into 'deposit_paid' applies only when the registration is
-- not a full-scholarship one.
--
-- The page side (lib/payments.js depositOwedCents) applies the same rule to
-- the family's deposit banner, Ways to pay and the confirm check. If these
-- rules change, change it with them.

-- ---------------------------------------------------------------------------
-- 1. registration_deposit_in() (0157)
-- ---------------------------------------------------------------------------
create or replace function public.registration_deposit_in(p_registration_ids uuid[])
returns table (registration_id uuid, deposit_in boolean)
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select public.has_grant('background_checks', 'write') or public.has_grant('payments', 'read') as ok
  ),
  regs as (
    select r.id, r.deposit_waived_at, coalesce(e.deposit_cents, 0) as deposit_cents
    from public.registrations r
    join public.events e on e.id = r.event_id
    where r.id = any (p_registration_ids)
      and (select ok from allowed)
  ),
  live as (
    select rp.registration_id, rp.id, rp.person_id, pm.fee_cents, pm.scholarship_cents,
           greatest(0, pm.fee_cents - pm.discount_cents - pm.early_discount_cents - pm.family_discount_cents) as owes
    from public.registration_participants rp
    join public.participant_money pm on pm.participant_id = rp.id
    where rp.status <> 'cancelled'
      and rp.registration_id in (select id from regs)
  ),
  heads as (
    select l.registration_id, count(distinct l.person_id) filter (where l.fee_cents > 0) as fee_people
    from live l group by l.registration_id
  ),
  confirmed as (
    select p.registration_id,
           sum(p.amount_cents) - coalesce((
             select sum(pr.amount_cents) from public.payment_refunds pr
             where pr.registration_id = p.registration_id and pr.status = 'succeeded'), 0) as cents
    from public.payments p
    where p.status in ('succeeded', 'refunded')
      and p.registration_id in (select id from regs)
    group by p.registration_id
  ),
  -- What staff granted, per person up to what they owe (0168).
  granted as (
    select l.registration_id, sum(least(l.owes, greatest(0, l.scholarship_cents))) as cents
    from live l
    where l.fee_cents > 0
    group by l.registration_id
  ),
  sch as (
    select l.registration_id,
           sum(l.owes) as owes,
           sum(case
                 when s.id is null then 0
                 when s.status = 'requested' then least(l.owes, coalesce(s.requested_cents, l.owes))
                 when s.status = 'granted' then least(l.owes, coalesce(s.granted_cents, 0))
                 else 0
               end) as requested
    from live l
    left join public.scholarships s
      on s.registration_participant_id = l.id and s.status in ('requested', 'granted')
    where l.fee_cents > 0
    group by l.registration_id
  )
  select g.id,
         (
           g.deposit_waived_at is not null
           or g.deposit_cents * coalesce(h.fee_people, 0) = 0
           or coalesce(c.cents, 0) + coalesce(gr.cents, 0) >= g.deposit_cents * coalesce(h.fee_people, 0)
           or (coalesce(s.owes, 0) > 0 and coalesce(s.requested, 0) >= s.owes)
         ) as deposit_in
  from regs g
  left join heads h on h.registration_id = g.id
  left join confirmed c on c.registration_id = g.id
  left join granted gr on gr.registration_id = g.id
  left join sch s on s.registration_id = g.id;
$$;

comment on function public.registration_deposit_in(uuid[]) is
  'Is each registration''s deposit in (waived, paid, paid plus a granted scholarship (0168), full scholarship, or none owed)? Yes/no only, for Background screening (0157, Ellen/Lawrence 9 Nov 2026). Background-checks write or Payments read; others get no rows. Mirrors registration_review''s money rules.';

-- ---------------------------------------------------------------------------
-- 2. registration_review (0133's columns, same order, one added at the end)
-- ---------------------------------------------------------------------------
create or replace view public.registration_review as
 WITH live AS (
         SELECT rp.registration_id,
            rp.id,
            rp.person_id,
            rp.camp_role,
            pm.fee_cents,
            pm.scholarship_cents,
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
        ), granted AS (
         SELECT l.registration_id,
            sum(LEAST(l.owes, GREATEST(0, l.scholarship_cents))) AS cents
           FROM live l
          WHERE (l.fee_cents > 0)
          GROUP BY l.registration_id
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
            WHEN ((r.deposit_waived_at IS NOT NULL)
               OR (((COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)) > 0) AND (COALESCE(c.cents, (0)::bigint) >= (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint))))
               OR (((COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)) = 0) AND (COALESCE(c.cents, (0)::bigint) > 0))
               -- 0168: money paid plus the granted scholarship covers it (not a full-scholarship registration).
               OR (((COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)) > 0)
                   AND NOT ((COALESCE(s.owes, (0)::bigint) > 0) AND (COALESCE(s.requested, (0)::bigint) >= s.owes))
                   AND ((COALESCE(c.cents, (0)::bigint) + COALESCE(g.cents, (0)::bigint)) >= (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)))))
            THEN 'deposit_paid'::text
            WHEN ((COALESCE(s.owes, (0)::bigint) > 0) AND (COALESCE(s.requested, (0)::bigint) >= s.owes)) THEN 'full_scholarship'::text
            ELSE 'neither'::text
        END AS review_class,
    array_remove(ARRAY[
        CASE
            -- 0168: short counts the granted scholarship toward the deposit too.
            WHEN ((r.deposit_waived_at IS NULL) AND (COALESCE(c.cents, (0)::bigint) > 0)
                  AND ((COALESCE(c.cents, (0)::bigint) + COALESCE(g.cents, (0)::bigint)) < (COALESCE(e.deposit_cents, 0) * COALESCE(h.fee_people, (0)::bigint)))) THEN 'deposit_short'::text
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
        END], NULL::text) AS flags,
    COALESCE(g.cents, (0)::bigint) AS deposit_scholarship_cents
   FROM (((((((public.registrations r
     JOIN public.events e ON ((e.id = r.event_id)))
     LEFT JOIN heads h ON ((h.registration_id = r.id)))
     LEFT JOIN confirmed c ON ((c.registration_id = r.id)))
     LEFT JOIN granted g ON ((g.registration_id = r.id)))
     LEFT JOIN sch s ON ((s.registration_id = r.id)))
     LEFT JOIN media_no mn ON ((mn.registration_id = r.id)))
     LEFT JOIN creed_no cn ON ((cn.registration_id = r.id)))
  WHERE public.has_grant('payments'::text, 'read'::text);

comment on column public.registration_review.deposit_scholarship_cents is
  'The granted scholarship counted toward the deposit (0168): participant_money.scholarship_cents per person, up to what each owes.';

-- ---------------------------------------------------------------------------
-- 3. Post-checks (the 0133 traps)
-- ---------------------------------------------------------------------------
do $$
begin
  if position('has_grant(''payments''' in pg_get_viewdef('public.registration_review'::regclass)) = 0 then
    raise exception '0168: registration_review lost its row filter';
  end if;
  if exists (select 1 from pg_class where oid = 'public.registration_review'::regclass
              and 'security_invoker=true' = any (coalesce(reloptions, '{}'))) then
    raise exception '0168: registration_review must stay a definer view';
  end if;
  if position('''refunded''' in pg_get_viewdef('public.registration_review'::regclass)) = 0 then
    raise exception '0168: registration_review does not count refunded payments';
  end if;
  if not has_function_privilege('authenticated', 'public.registration_deposit_in(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.registration_deposit_in(uuid[])', 'execute') then
    raise exception '0168: registration_deposit_in grants are wrong';
  end if;
end;
$$;
