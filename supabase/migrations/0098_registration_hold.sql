-- 0098_registration_hold.sql
--
-- A registration can be put ON HOLD by staff (Larry and Ellen's inked
-- read-through, 15 Oct 2026; the call of 16 Oct, 3:04-3:06 pm; build plan
-- item 7). The case: a family changes something after approval -- a role, a
-- seizure plan, who is coming -- and staff want the registration back in
-- front of a reviewer before it counts as confirmed again. Until now the only
-- ways back were a per-person status change with nothing recording why, or
-- "waiting on the family" (0089), which is the opposite state: that one is
-- the family's move; a hold is staff's.
--
-- Three columns on the registration, set and cleared only by a registrar:
-- when, why, and who. The action that sets them also moves everyone
-- confirmed or waitlisted back to 'submitted', so the review queue and the
-- nav badge count the registration as waiting on staff again; approving or
-- waitlisting clears the hold. registration_review gains the flag 'on_hold'
-- so the queue and the Review card say so. The family's dashboard shows the
-- reason in amber, the way "waiting on the family" shows. No automatic
-- email (by hand from Outlook, as agreed on the call).

alter table public.registrations
  add column if not exists hold_since  timestamptz,
  add column if not exists hold_reason text,
  add column if not exists hold_by     uuid references public.profiles(id) on delete set null;

comment on column public.registrations.hold_since is
  'Set when staff put the registration on hold for re-review (0098); null otherwise. Cleared by approve / waitlist / lift.';
comment on column public.registrations.hold_reason is
  'Why staff put it on hold. Visible to the family on their dashboard.';
comment on column public.registrations.hold_by is
  'The staff profile id that set the hold.';

-- The family may update its own registration row (family_notes, through the
-- wizard), so without this guard a family could clear a hold itself. Same
-- shape as guard_awaiting_family (0089).
create or replace function public.guard_registration_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.hold_since  is distinct from old.hold_since
      or new.hold_reason is distinct from old.hold_reason
      or new.hold_by     is distinct from old.hold_by)
     and not public.is_registrar() then
    raise exception 'Only a registrar can put a registration on hold or lift a hold.';
  end if;
  return new;
end;
$$;

drop trigger if exists registrations_guard_hold on public.registrations;
create trigger registrations_guard_hold
  before update on public.registrations
  for each row execute function public.guard_registration_hold();

-- registration_review (0081, recreated in 0096): one more flag, 'on_hold'.
-- Same columns in the same order, so CREATE OR REPLACE is enough.
create or replace view public.registration_review as
with live as (
  select rp.registration_id, rp.id, rp.person_id, rp.camp_role, rp.fee_cents,
         greatest(0, rp.fee_cents - rp.discount_cents - rp.early_discount_cents - rp.family_discount_cents) as owes
  from public.registration_participants rp
  where rp.status <> 'cancelled'
), heads as (
  select live.registration_id,
         count(distinct live.person_id) filter (where live.fee_cents > 0) as fee_people
  from live group by live.registration_id
), confirmed as (
  select pm.registration_id,
         sum(pm.amount_cents) - coalesce((select sum(pr.amount_cents) from public.payment_refunds pr
                                          where pr.registration_id = pm.registration_id and pr.status = 'succeeded'), 0) as cents
  from public.payments pm
  where pm.status = 'succeeded'
  group by pm.registration_id
), sch as (
  select l.registration_id,
         sum(l.owes) as owes,
         sum(case when s_1.id is null then 0 else least(l.owes, coalesce(s_1.requested_cents, l.owes)) end) as requested
  from live l
  left join public.scholarships s_1 on s_1.registration_participant_id = l.id
       and s_1.status = any (array['requested','granted'])
  where l.fee_cents > 0
  group by l.registration_id
), media_no as (
  select l.registration_id, count(distinct l.person_id) as n
  from live l
  join lateral (select pc.granted from public.person_consents pc
                where pc.person_id = l.person_id and pc.kind = 'media'
                order by pc.recorded_at desc limit 1) m on true
  where m.granted = false
  group by l.registration_id
), creed_no as (
  select l.registration_id, count(*) as n
  from live l
  left join public.volunteer_applications va on va.registration_participant_id = l.id
  where l.camp_role = 'volunteer' and coalesce(va.creed_affirmed, false) = false
  group by l.registration_id
)
select r.id as registration_id,
       r.household_id,
       r.event_id,
       coalesce(c.cents, 0) as confirmed_paid_cents,
       coalesce(e.deposit_cents, 0) * coalesce(h.fee_people, 0) as deposit_expected_cents,
       case
         when coalesce(c.cents, 0) > 0 or r.deposit_waived_at is not null then 'deposit_paid'
         when coalesce(s.owes, 0) > 0 and coalesce(s.requested, 0) >= s.owes then 'full_scholarship'
         else 'neither'
       end as review_class,
       array_remove(array[
         case when r.deposit_waived_at is null and coalesce(c.cents, 0) > 0
                   and coalesce(c.cents, 0) < (coalesce(e.deposit_cents, 0) * coalesce(h.fee_people, 0))
              then 'deposit_short' else null end,
         case when r.deposit_waived_at is not null then 'deposit_waived' else null end,
         case when coalesce(mn.n, 0) > 0 then 'media_declined' else null end,
         case when coalesce(cn.n, 0) > 0 then 'creed_not_affirmed' else null end,
         case when r.hold_since is not null then 'on_hold' else null end
       ], null) as flags
from public.registrations r
join public.events e on e.id = r.event_id
left join heads h on h.registration_id = r.id
left join confirmed c on c.registration_id = r.id
left join sch s on s.registration_id = r.id
left join media_no mn on mn.registration_id = r.id
left join creed_no cn on cn.registration_id = r.id;
