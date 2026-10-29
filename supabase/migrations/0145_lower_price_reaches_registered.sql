-- 0145 -- A lowered price reaches the people already registered (29 Oct 2026)
--
-- Lawrence, 29 Oct 2026: "if payment/cost gets adjusted DOWN families who have
-- registered will see the new amounts; if it gets adjusted UP they will not
-- (by default)". Until now a price change on Setup reached only the NEXT
-- registration (0001: the fee is copied at sign-up), in both directions.
--
-- lower_registered_fees(p_option_id) brings every live participant on the
-- option whose fee is ABOVE the option's current fee down to it. A raise
-- changes nobody: the family keeps the fee they signed up at, which is what
-- they agreed to. Setup calls it after saving a price.
--
--   * Live means not cancelled. A cancelled place keeps its record.
--   * A person whose scholarship plus hand-set discount is more than the new
--     fee is LEFT ALONE and counted: the table's CHECK refuses it, and a
--     staff decision is never erased silently (0070, 0114). Staff adjust
--     those first and save the price again.
--   * The discount rules run afterwards (recalc_event_discounts), so the
--     early and family discounts are re-capped at what each person now owes.
--   * A family that had already paid more than the new total reads a
--     negative balance: the money is theirs, and refunding it is a staff act
--     on the registration page. The count comes back so Setup can say so.
--   * Each row's change lands in money_change_log through its own trigger
--     (0111), so the paper trail is the usual one.
--
-- Setup write is the check (who may set a price at all). DEFINER because
-- nobody signed in writes participant_money (0114).

create or replace function public.lower_registered_fees(p_option_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   uuid;
  v_fee     integer;
  v_lowered integer := 0;
  v_skipped integer := 0;
  v_over    integer := 0;
begin
  if not public.has_grant('setup', 'write') then
    raise exception 'Only someone with Setup write can change an event''s price.'
      using errcode = 'insufficient_privilege';
  end if;

  select eo.event_id, coalesce(eo.fee_cents, 0) into v_event, v_fee
    from public.event_options eo
   where eo.id = p_option_id;
  if v_event is null then
    raise exception 'No such event option.';
  end if;

  -- Left alone: the decisions on file add up to more than the new fee.
  select count(*) into v_skipped
    from public.participant_money pm
    join public.registration_participants rp on rp.id = pm.participant_id
   where rp.event_option_id = p_option_id
     and rp.status <> 'cancelled'
     and pm.fee_cents > v_fee
     and pm.scholarship_cents + pm.discount_cents > v_fee;

  update public.participant_money pm
     set fee_cents = v_fee, updated_at = now()
    from public.registration_participants rp
   where rp.id = pm.participant_id
     and rp.event_option_id = p_option_id
     and rp.status <> 'cancelled'
     and pm.fee_cents > v_fee
     and pm.scholarship_cents + pm.discount_cents <= v_fee;
  get diagnostics v_lowered = row_count;

  if v_lowered > 0 then
    perform public.recalc_event_discounts(v_event);
  end if;

  -- Registrations now holding more than they owe (refunds are staff's).
  select count(*) into v_over
    from public.registration_balances b
    join public.registrations r on r.id = b.registration_id
   where r.event_id = v_event
     and b.balance_cents < 0;

  return jsonb_build_object('lowered', v_lowered, 'skipped', v_skipped, 'overpaid', v_over);
end;
$$;

revoke all on function public.lower_registered_fees(uuid) from public, anon;
grant execute on function public.lower_registered_fees(uuid) to authenticated;

comment on function public.lower_registered_fees(uuid) is
  'Brings every live participant on the option whose fee is above the option''s current fee down to it (a raise changes nobody). Skips anyone whose scholarship plus hand-set discount exceeds the new fee. Setup write. 0145.';

comment on column public.participant_money.fee_cents is
  'Copied from the event option by trigger at insert, and again when event_option_id changes. A price RAISED on Setup leaves it alone (the family keeps the fee they signed up at); a price LOWERED brings it down, through lower_registered_fees() (0145).';
