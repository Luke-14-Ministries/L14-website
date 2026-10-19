-- 0109_medical_contact_private_and_full_deposit.sql
--
-- Two answers from Lawrence, 18 Oct 2026.
--
-- 1. THE EVENT'S MEDICAL CONTACT IS FOR THE PEOPLE AT THAT EVENT. The camp
--    nurse's name and phone lived on `events`, whose read policy is
--    "published or staff" for anon and authenticated alike -- so once a phone
--    was set, anyone with the public API key could read it. They move to
--    their own table, readable by staff, by an active program leader at that
--    event, and by a household with someone registered (not cancelled) for
--    it: campers, volunteers, parents. Writing is Setup write, as before.
--
-- 2. "DEPOSIT RECEIVED" MEANS THE WHOLE DEPOSIT. registration_review called a
--    registration deposit_paid on ANY received payment, so $10 against a $250
--    deposit read "Deposit received -- review and approve". Now it needs the
--    full $50 per fee-paying person (or a waiver). A registration with no
--    fee-paying people keeps the old rule (any payment). A short payment falls
--    to "neither" and keeps its deposit_short flag. The view is restated in
--    full from 0103 with only that CASE changed; it stays a definer view with
--    its own Payments-read filter (CLAUDE.md, traps).

-- ---------------------------------------------------------------------------
-- 1. event_medical_contacts
-- ---------------------------------------------------------------------------

create table if not exists public.event_medical_contacts (
  event_id uuid primary key references public.events(id) on delete cascade,
  name text,
  phone text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.event_medical_contacts enable row level security;

drop policy if exists event_medical_contacts_read on public.event_medical_contacts;
create policy event_medical_contacts_read on public.event_medical_contacts
  for select to authenticated
  using (
    public.is_staff()
    or (public.session_is_strong() and exists (
          select 1 from public.program_leaders pl
          where pl.profile_id = (select auth.uid())
            and pl.event_id = event_medical_contacts.event_id
            and pl.active))
    or exists (
          select 1
          from public.registrations r
          join public.registration_participants rp on rp.registration_id = r.id
          where r.event_id = event_medical_contacts.event_id
            and r.household_id in (select public.my_household_ids())
            and rp.status <> 'cancelled')
  );

drop policy if exists event_medical_contacts_write on public.event_medical_contacts;
create policy event_medical_contacts_write on public.event_medical_contacts
  for all to authenticated
  using (public.has_grant('setup', 'write'))
  with check (public.has_grant('setup', 'write'));

-- RLS without a grant is permission denied (CLAUDE.md, the first trap). No anon.
grant select, insert, update, delete on public.event_medical_contacts to authenticated;

insert into public.event_medical_contacts (event_id, name, phone)
select id, medical_contact_name, medical_contact_phone
from public.events
where medical_contact_name is not null or medical_contact_phone is not null
on conflict (event_id) do nothing;

alter table public.events drop column if exists medical_contact_name;
alter table public.events drop column if exists medical_contact_phone;

-- ---------------------------------------------------------------------------
-- 2. registration_review: the whole deposit
-- ---------------------------------------------------------------------------

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
                    ELSE LEAST(l.owes, COALESCE(s_1.requested_cents, l.owes))
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
