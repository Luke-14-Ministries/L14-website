-- 0135_family_cancel_payment_plan.sql
--
-- A family can stop their own payment plan (Lawrence, 27 Oct 2026: "there
-- should be a way to cancel the payment plan"). Until now only staff could
-- (cancelPlan in app/admin/registrations/[id]/actions.js); families read
-- payment_plans and never write it (0080, 0111).
--
-- family_cancel_payment_plan(registration): the caller must belong to the
-- household that owns the registration -- checked here, not by RLS, because
-- a staff member's RLS reaches every plan and this is the family's own act
-- (the 0126 rule). It does what the staff cancel does: the plan becomes
-- 'cancelled' with the cancel stamps (cancelled_by is the family member), and
-- every scheduled or failed charge is cancelled, so the charger never runs
-- it again. What is still owed stays on the balance; nothing is refunded.
-- The early-discount decision is untouched: keeps_early_discount stays as it
-- is (true unless staff said otherwise), and staff decide it as for any
-- cancelled plan (agreed 30 Sep).
--
-- Refused while one of the plan's charges is still clearing the bank: that
-- payment settles or fails on its own, and a failure on a cancelled plan
-- would be a muddle to explain. The family tries again once it has.
--
-- Definer, owned by the migration role: the payment_plans write guard
-- (0111) and the money audit trigger see this as a server-side write, and
-- money_change_log records it.

create function public.family_cancel_payment_plan(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_plan   uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Please sign in to change your payment plan.' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.registrations r
      join public.household_members hm on hm.household_id = r.household_id
     where r.id = p_registration_id
       and hm.profile_id = v_uid
  ) then
    raise exception 'That registration is not on your account.' using errcode = '42501';
  end if;

  select id, status into v_plan, v_status
    from public.payment_plans
   where registration_id = p_registration_id
   for update;
  if v_plan is null then
    raise exception 'This registration has no payment plan.' using errcode = '22023';
  end if;
  if v_status not in ('active', 'paused', 'failed') then
    raise exception 'This payment plan has already ended.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_installments
              where payment_plan_id = v_plan and status = 'processing') then
    raise exception 'A payment from this plan is still clearing the bank. Please try again once it has settled.'
      using errcode = '22023';
  end if;

  update public.payment_plans
     set status       = 'cancelled',
         cancelled_at = clock_timestamp(),
         cancelled_by = v_uid
   where id = v_plan;

  update public.payment_installments
     set status = 'cancelled'
   where payment_plan_id = v_plan
     and status in ('scheduled', 'failed');
end;
$$;

comment on function public.family_cancel_payment_plan(uuid) is
  'A household member stops their own payment plan: the plan is cancelled with the stamps and its scheduled or failed charges are cancelled. Refused while a charge is clearing. 0135 (27 Oct 2026).';

revoke execute on function public.family_cancel_payment_plan(uuid) from public, anon;
grant execute on function public.family_cancel_payment_plan(uuid) to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'public.family_cancel_payment_plan(uuid)', 'execute')
     or has_function_privilege('anon', 'public.family_cancel_payment_plan(uuid)', 'execute') then
    raise exception '0135: family_cancel_payment_plan grants are wrong';
  end if;
end;
$$;
