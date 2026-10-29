-- 0143 — A resumed payment plan always schedules what is owed, with notice
-- (29 Oct 2026; found by Larry's Claude session re-checking the 14 Oct review).
--
-- build_plan_installments() (0080, its guard renamed by 0101) inserted only
-- the dates plan_charge_dates() returned, and that returns none once the
-- balance due date is three days off or past. So a plan Resumed late read
-- Active and never charged again.
--
-- Two changes, restated in full (CLAUDE.md: never patch a function in place):
--
-- 1. p_min_lead_days (default 0, so Stripe's webhook, which builds a new
--    plan's schedule, is unchanged): no charge is scheduled sooner than this
--    many days from p_today. Resume passes the plan-notice lead plus one day
--    (8 for a card, 11 for a bank account), so the "your next payment" email
--    (lib/reminders/run.js: a week ahead for a card, 10 days for a bank
--    account) goes out before every rebuilt charge. The amounts change on a
--    resume, and US rules for automatic bank debits expect notice of a
--    changed amount about 10 days ahead.
-- 2. When no date is left and something is owed, one charge for the whole
--    balance on p_today + greatest(1, p_min_lead_days).
--
-- The signature gains a defaulted argument, so the old two-argument function
-- is dropped first: kept beside it, a two-argument call would be ambiguous.

drop function if exists public.build_plan_installments(uuid, date);

create function public.build_plan_installments(
  p_plan_id uuid,
  p_today date,
  p_min_lead_days int default 0
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    public.payment_plans%rowtype;
  v_due     date;
  v_balance bigint;
  v_n       int;
  v_lead    int := greatest(0, coalesce(p_min_lead_days, 0));
begin
  -- The service role (auth.uid() is null) or Payments write re-starting a
  -- paused plan from the registration page. Nobody else.
  if auth.uid() is not null and not public.has_grant('payments', 'write') then
    raise exception 'Only the ministry can change a payment schedule.' using errcode = '42501';
  end if;
  -- Locked: a repeated Stripe delivery and Resume at the same moment must not
  -- each insert a full schedule.
  select * into v_plan from public.payment_plans where id = p_plan_id for update;
  if v_plan.id is null then raise exception 'no such plan'; end if;

  select public.balance_due_on(r.event_id) into v_due
    from public.registrations r where r.id = v_plan.registration_id;

  delete from public.payment_installments
   where payment_plan_id = p_plan_id and status = 'scheduled';

  select count(*) into v_n
    from public.plan_charge_dates(p_today, v_due, v_plan.schedule) d
   where d >= p_today + v_lead;
  select greatest(0, b.balance_cents) into v_balance
    from public.registration_balances b where b.registration_id = v_plan.registration_id;

  if v_n > 0 then
    insert into public.payment_installments (payment_plan_id, due_on, amount_cents, status)
    select p_plan_id, d, ceil(coalesce(v_balance, 0)::numeric / v_n)::int, 'scheduled'
      from public.plan_charge_dates(p_today, v_due, v_plan.schedule) d
     where d >= p_today + v_lead;
  elsif coalesce(v_balance, 0) > 0 then
    insert into public.payment_installments (payment_plan_id, due_on, amount_cents, status)
    values (p_plan_id, p_today + greatest(1, v_lead), v_balance, 'scheduled');
    v_n := 1;
  end if;

  update public.payment_plans set final_due_on = v_due where id = p_plan_id;
  return v_n;
end;
$$;

revoke execute on function public.build_plan_installments(uuid, date, int) from public, anon;
grant execute on function public.build_plan_installments(uuid, date, int) to authenticated, service_role;
