-- 0169_person_deposit_in.sql
--
-- A background check waits for the person's OWN share of the deposit, not the
-- whole family's (Lawrence, 14 Nov 2026: "Their own share"). Ellen's
-- registration has her and a camper, $50 each; her $50 is covered by her
-- granted scholarship (0168), the camper's is not, and she was still held.
--
-- person_deposit_in(): one yes/no per person on each registration asked for.
-- A person is IN when any of these holds:
--   * the registration's deposit is waived by staff, or none is owed at all;
--   * the registration is a full-scholarship one (requested or granted for
--     everything owed), as before;
--   * their own share is covered by their own granted scholarship: the share
--     is the per-person deposit, never more than what they owe (0 for someone
--     with no fee);
--   * the money the family has paid covers their share: paid money is shared
--     out to the people still short, smallest need first (then by person, so
--     the answer never wobbles), and everyone it reaches is in. A family of
--     two that has paid $50 of $100 releases one of them.
-- Money paid is succeeded or refunded payments less succeeded refunds, as in
-- registration_review (0133). Same access as registration_deposit_in (0157):
-- Background checks write or Payments read; others get no rows. Yes/no only.
-- registration_deposit_in() stays for anything that wants the family answer.

create or replace function public.person_deposit_in(p_registration_ids uuid[])
returns table (registration_id uuid, person_id uuid, deposit_in boolean)
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
  -- One line per person per registration (a person is on a registration once,
  -- 0086; summed anyway).
  people as (
    select l.registration_id, l.person_id,
           sum(case when l.fee_cents > 0 then l.owes else 0 end) as owes,
           sum(case when l.fee_cents > 0 then least(l.owes, greatest(0, l.scholarship_cents)) else 0 end) as granted,
           bool_or(l.fee_cents > 0) as has_fee
    from live l group by l.registration_id, l.person_id
  ),
  need as (
    select p.registration_id, p.person_id,
           greatest(0, case when p.has_fee then least(g.deposit_cents, p.owes) else 0 end - p.granted) as need
    from people p join regs g on g.id = p.registration_id
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
  heads as (
    select l.registration_id, count(distinct l.person_id) filter (where l.fee_cents > 0) as fee_people
    from live l group by l.registration_id
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
  ),
  -- Paid money shared out, smallest need first.
  reach as (
    select n.registration_id, n.person_id, n.need,
           sum(n.need) over (partition by n.registration_id order by n.need, n.person_id
                             rows between unbounded preceding and current row) as running
    from need n
  )
  select x.registration_id, x.person_id,
         (
           g.deposit_waived_at is not null
           or g.deposit_cents * coalesce(h.fee_people, 0) = 0
           or (coalesce(s.owes, 0) > 0 and coalesce(s.requested, 0) >= s.owes)
           or x.need = 0
           or x.running <= coalesce(c.cents, 0)
         ) as deposit_in
  from reach x
  join regs g on g.id = x.registration_id
  left join heads h on h.registration_id = x.registration_id
  left join confirmed c on c.registration_id = x.registration_id
  left join sch s on s.registration_id = x.registration_id;
$$;

revoke execute on function public.person_deposit_in(uuid[]) from public, anon;
grant execute on function public.person_deposit_in(uuid[]) to authenticated;

comment on function public.person_deposit_in(uuid[]) is
  'Is each person''s own share of the deposit in (0169, Lawrence 14 Nov 2026)? Waived, none owed, full scholarship, their own granted scholarship, or the family''s paid money shared out smallest need first. Yes/no only, for Background screening. Background-checks write or Payments read; others get no rows.';

do $$
begin
  if has_function_privilege('anon', 'public.person_deposit_in(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.person_deposit_in(uuid[])', 'execute') then
    raise exception '0169: person_deposit_in grants are wrong';
  end if;
end;
$$;
