-- 0115_payment_route_counts_requests_only.sql
--
-- The 21 Oct screen walk of 0114 (item 9): with a $1 scholarship granted by
-- staff and no family request, the registration page's "How this
-- registration is being paid" read "Scholarship requested", and Event
-- Payments' "Paying by" column with it. registration_payment_routes (0080)
-- counted any scholarships row, granted included, as a request. 0112 fixed
-- the same confusion in registration_review but not here. A request is a row
-- the family made, status 'requested'; a grant is the ministry's answer and
-- says nothing about how the family is paying. Restated in full from 0114
-- with only that status test changed.

drop view if exists public.registration_payment_routes;
create view public.registration_payment_routes
with (security_invoker = on)
as
select r.id as registration_id,
       r.household_id,
       r.event_id,
       pp.id as plan_id,
       pp.status as plan_status,
       pp.schedule as plan_schedule,
       pp.payment_method_label,
       coalesce(sch.any_request, false) as scholarship_requested,
       case
         when pp.status in ('active', 'paused', 'failed', 'completed') then 'plan'
         when coalesce(b.balance_cents, 0) <= 0 and coalesce(b.paid_cents, 0) > 0 then 'paid_in_full'
         when coalesce(b.balance_cents, 0) <= 0 then 'nothing_owed'
         when coalesce(sch.any_request, false) then 'scholarship'
         else 'none'
       end as route
  from public.registrations r
  left join public.payment_plans pp on pp.registration_id = r.id
  left join public.registration_balances b on b.registration_id = r.id
  left join lateral (
    select true as any_request
      from public.scholarships s
      join public.registration_participants rp on rp.id = s.registration_participant_id
     where rp.registration_id = r.id
       and s.status = 'requested'
     limit 1
  ) sch on true;

grant select on public.registration_payment_routes to authenticated, service_role;
