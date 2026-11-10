-- 0157 -- Background checks wait for the deposit (9 Nov 2026)
--
-- Ellen, Website Feedback, 9 Nov 2026: "Background checks will only be run
-- upon the collection of the deposit for the family. That way we are not out
-- money if we run a check on someone who backs out." Lawrence, same day: hold
-- until paid, but still flag that the check is missing or out of date.
--
-- So Background screening (/admin/volunteers/screening/) keeps listing every
-- volunteer whose check is missing or out of date, and holds back from the
-- Checkr batch those whose registration has not got its deposit in. It needs
-- one fact per registration: is the deposit in?
--
-- WHY A FUNCTION. registration_review (0081/0103) already answers it
-- (review_class 'deposit_paid' or 'full_scholarship'), but it returns rows only
-- to staff with Payments read, and Background screening is a background-checks
-- page. This gives that one yes/no, and nothing about amounts, to holders of
-- the background-checks write grant (the page's own gate), and to Payments
-- readers. Everyone else gets no rows.
--
-- "IN" means, as registration_review's review_class:
--   * the deposit is waived by staff, or
--   * confirmed payments (less succeeded refunds) cover the deposit expected
--     (event deposit x people with a fee), or
--   * a full scholarship is requested or granted for what is owed;
-- and, for screening only, a registration that owes no deposit at all
-- (nobody on it has a fee, or the event has no deposit) is IN: there is
-- nothing to collect, so nothing to wait for. (registration_review calls that
-- 'neither' until something is paid; for review that is right, here it would
-- hold a volunteer forever.)
--
-- If registration_review's money rules change, change this with it.

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
    select rp.registration_id, rp.id, rp.person_id, pm.fee_cents,
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
           or coalesce(c.cents, 0) >= g.deposit_cents * coalesce(h.fee_people, 0)
           or (coalesce(s.owes, 0) > 0 and coalesce(s.requested, 0) >= s.owes)
         ) as deposit_in
  from regs g
  left join heads h on h.registration_id = g.id
  left join confirmed c on c.registration_id = g.id
  left join sch s on s.registration_id = g.id;
$$;

revoke execute on function public.registration_deposit_in(uuid[]) from public, anon;
grant execute on function public.registration_deposit_in(uuid[]) to authenticated;

comment on function public.registration_deposit_in(uuid[]) is
  'Is each registration''s deposit in (waived, paid, full scholarship, or none owed)? Yes/no only, for Background screening (0157, Ellen/Lawrence 9 Nov 2026). Background-checks write or Payments read; others get no rows. Mirrors registration_review''s money rules.';
