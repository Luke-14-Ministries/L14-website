-- 0114_participant_money.sql
--
-- Money moves off registration_participants into its own table,
-- participant_money (Lawrence, 21 Oct 2026; the "separate money table" that
-- CLAUDE.md's access section said would wait until after launch).
--
-- WHY. Every staff member can read registration_participants: rosters,
-- check-in, buddies and programs all need the row. Since 0001 the row also
-- carried what the person owes (fee_cents, scholarship_cents, discount_cents,
-- discount_reason, early_discount_cents, family_discount_cents), so a
-- coordinator with no Payments grant could read every family's fee,
-- scholarship and discount through the API, whatever the pages showed. 0113
-- noted it and left it. A column cannot be hidden from someone who may select
-- the row; a second table can. What a person owes is now readable only by the
-- family it belongs to and by staff with Payments read -- in the database,
-- not just on the pages.
--
-- WHAT CHANGES
--   * public.participant_money: one row per participant, created by trigger
--     when the participant row is inserted, its fee copied from the event
--     option (0001's reason stands: a family who registered in March at the
--     March price keeps it when the price changes in May). Switching the
--     option re-copies the fee. Nothing else sets the fee.
--   * Nobody signed in writes the table directly. Staff decisions go through
--     set_participant_adjustments() (Payments AND Registration write, as 0102
--     decided for scholarships); the discount rules (0070, 0080, 0081) and
--     waive_deposit() (0096/0103) run as definer; the service role may read
--     it for the balances view. Every write lands in money_change_log (0111).
--   * The six columns are dropped from registration_participants after the
--     backfill. The views keep their column names so no caller changes.
--   * guard_participant_money (0080/0102/0105) keeps every non-money check;
--     guard_participant_money_cap (0111 item 5) goes -- the cap is the
--     table's CHECK plus the function.
--
-- ORDER MATTERS: the views that read the old columns are dropped first, the
-- functions are restated against participant_money, THEN the columns go,
-- then the views come back. early_discount_candidates is a SQL-language
-- function, so Postgres itself refuses the migration if its body still names
-- a dropped column. The post-checks at the end prove the rest.
--
-- Every function is restated in full (CLAUDE.md: never patch
-- pg_get_functiondef with replace()). The reasoning comments from the
-- migrations that first wrote them are kept where the rule is restated.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.participant_money (
  participant_id        uuid primary key references public.registration_participants(id) on delete cascade,
  fee_cents             integer not null default 0 check (fee_cents >= 0),
  scholarship_cents     integer not null default 0 check (scholarship_cents >= 0),
  discount_cents        integer not null default 0 check (discount_cents >= 0),
  discount_reason       text,
  early_discount_cents  integer not null default 0 check (early_discount_cents >= 0),
  family_discount_cents integer not null default 0 check (family_discount_cents >= 0),
  updated_at            timestamptz not null default now(),
  -- 0111 item 5, now a rule of the table: a scholarship plus a hand-set
  -- discount never exceed the fee. The two automatic discounts are capped by
  -- their own rules at what the person still owes.
  constraint participant_money_adjustments_within_fee check (scholarship_cents + discount_cents <= fee_cents)
);

comment on table public.participant_money is
  'What each participant owes: the fee copied from the event option when the row was created (or the option switched), and the reductions. Readable by the family it belongs to and by staff with Payments read. Written only by owner-run code: the fee trigger, set_participant_adjustments(), the discount rules, waive_deposit(). 0114.';
comment on column public.participant_money.fee_cents is
  'Copied from the event option by trigger at insert, and again when event_option_id changes -- a family who registered at the early rate keeps it when the price changes (0001). Nothing else sets it.';
comment on column public.participant_money.discount_reason is
  'Why discount_cents is what it is. NULL means somebody set it by hand and it is nobody else''s business. A non-null value marks a discount applied by a rule -- recalc_multi_week_discount() writes and clears only its own reason, never a manual one (0070).';
comment on column public.participant_money.early_discount_cents is
  'The early-registration discount (0080). Written ONLY by recalc_early_registration_discount(); never set by hand.';
comment on column public.participant_money.family_discount_cents is
  'Family discount on this row (0081: the Nth and later person on a registration). Written ONLY by recalc_family_discount(); never set by hand.';

alter table public.participant_money enable row level security;

-- Who may READ a person's money: the family it belongs to, or Payments read.
-- There is deliberately no insert, update or delete policy: nobody signed in
-- writes this table directly (see the header).
drop policy if exists participant_money_select on public.participant_money;
create policy participant_money_select on public.participant_money
  for select to authenticated
  using (public.has_grant('payments', 'read')
         or participant_id in (select public.my_participant_ids()));

-- RLS without a grant is permission denied (CLAUDE.md, the first trap).
-- SELECT only for signed-in users; nothing for anon. The service role reads
-- registration_balances (an invoker view) from the plans charger and
-- webhook, so it needs SELECT on what is underneath, as 0080 spelled out.
-- No server-side code writes a person's money, so it gets no write right.
grant select on public.participant_money to authenticated;
grant select on public.participant_money to service_role;

-- ---------------------------------------------------------------------------
-- 2. The fee is filled by trigger -- the only source of the fee
-- ---------------------------------------------------------------------------
-- DEFINER on purpose: the family wizard and the dashboard insert participant
-- rows as the family, under RLS, and a family has no right to write
-- participant_money. The trigger runs as the table owner and creates the
-- money row for whoever inserted the participant.
create or replace function public.fill_participant_money()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee integer;
begin
  select coalesce(eo.fee_cents, 0) into v_fee
    from public.event_options eo
   where eo.id = new.event_option_id;
  v_fee := coalesce(v_fee, 0);

  if tg_op = 'INSERT' then
    insert into public.participant_money (participant_id, fee_cents)
    values (new.id, v_fee)
    on conflict (participant_id) do update
      set fee_cents = excluded.fee_cents, updated_at = now();
  else
    -- AFTER UPDATE OF event_option_id: the new option's fee. A row that
    -- somehow has no money row gets one.
    update public.participant_money
       set fee_cents = v_fee, updated_at = now()
     where participant_id = new.id;
    if not found then
      insert into public.participant_money (participant_id, fee_cents) values (new.id, v_fee);
    end if;
  end if;
  return null;
exception when check_violation then
  -- A cheaper option than the scholarship and hand-set discount already on
  -- file. The decision is not erased silently (0070's rule for every
  -- discount): staff adjust it first, then switch.
  raise exception 'This person''s scholarship and discount add up to more than the new option''s fee; adjust them first.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists registration_participants_money_insert on public.registration_participants;
create trigger registration_participants_money_insert
  after insert on public.registration_participants
  for each row execute function public.fill_participant_money();

drop trigger if exists registration_participants_money_option on public.registration_participants;
create trigger registration_participants_money_option
  after update of event_option_id on public.registration_participants
  for each row
  when (old.event_option_id is distinct from new.event_option_id)
  execute function public.fill_participant_money();

-- ---------------------------------------------------------------------------
-- 3. Staff decisions: one definer function
-- ---------------------------------------------------------------------------
-- Replaces every direct `update registration_participants set
-- scholarship_cents, discount_cents` the app used to make. Deciding a
-- scholarship or a hand-set discount is a family act, not a finance act
-- (0102): Payments write AND Registration write.
--
-- discount_reason is written exactly as passed, null included. The app reads
-- the row's current discount and reason first and passes them back when it
-- only decides a scholarship, so a rule-applied discount ("Both weeks ...")
-- keeps its reason and the rule keeps maintaining it; a registrar changing
-- the discount by hand sends null, which 0070 defines as "set by hand".
create or replace function public.set_participant_adjustments(
  p_participant_id   uuid,
  p_scholarship_cents integer,
  p_discount_cents    integer,
  p_discount_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee integer;
  v_registration_id uuid;
begin
  if not public.can_decide_scholarships() then
    raise exception 'Scholarships and discounts are decided by Registration & coordination.'
      using errcode = '42501';
  end if;
  if p_scholarship_cents is null or p_discount_cents is null
     or p_scholarship_cents < 0 or p_discount_cents < 0 then
    raise exception 'A scholarship or discount cannot be negative.';
  end if;

  select pm.fee_cents, rp.registration_id into v_fee, v_registration_id
    from public.participant_money pm
    join public.registration_participants rp on rp.id = pm.participant_id
   where pm.participant_id = p_participant_id
   for update of pm;
  if v_fee is null then
    raise exception 'No such participant.';
  end if;
  if p_scholarship_cents + p_discount_cents > v_fee then
    raise exception 'Scholarship plus discount cannot exceed the fee for this person.';
  end if;

  update public.participant_money
     set scholarship_cents = p_scholarship_cents,
         discount_cents    = p_discount_cents,
         discount_reason   = p_discount_reason,
         updated_at        = now()
   where participant_id = p_participant_id;

  -- The two automatic discounts are capped at what the person still owes,
  -- which this decision just changed. Re-run them, as waive_deposit() does.
  perform public.recalc_family_discount(v_registration_id);
  perform public.recalc_early_registration_discount(v_registration_id);
end;
$$;
revoke all on function public.set_participant_adjustments(uuid, integer, integer, text) from public, anon;
grant execute on function public.set_participant_adjustments(uuid, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The money audit trail covers the new table
-- ---------------------------------------------------------------------------
-- 0111's logger restated in full with one addition: participant_money has no
-- `id` column -- its key is participant_id -- so the row id logged falls
-- back to that. Otherwise exactly 0111.
create or replace function public.log_money_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after  jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  -- Before the diff strips it. participant_money's key is participant_id (0114).
  v_row_id uuid := coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid,
                            (v_after ->> 'participant_id')::uuid, (v_before ->> 'participant_id')::uuid);
  k text;
begin
  -- Only the columns that changed, so the log reads as a diff.
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_after) loop
      if v_after -> k = v_before -> k then
        v_after := v_after - k; v_before := v_before - k;
      end if;
    end loop;
    if v_after = '{}'::jsonb then return null; end if;
    v_after := v_after - 'updated_at'; v_before := v_before - 'updated_at';
    if v_after = '{}'::jsonb then return null; end if;
  end if;
  insert into public.money_change_log (table_name, row_id, op, changed_by, changed_as, before, after)
  values (tg_table_name, v_row_id, tg_op, (select auth.uid()), current_user, v_before, v_after);
  return null;
end;
$$;
-- The trigger itself is attached in step 10, after the backfill, so the log
-- starts with real changes rather than 45 copies of what was already there.

-- ---------------------------------------------------------------------------
-- 5. Drop the views that read the old columns
-- ---------------------------------------------------------------------------
-- registration_payment_routes (0080) is built on registration_balances, so it
-- goes and comes back too, unchanged.
drop view if exists public.registration_payment_routes;
drop view if exists public.registration_balances;
drop view if exists public.registration_review;

-- ---------------------------------------------------------------------------
-- 6. The guards on registration_participants
-- ---------------------------------------------------------------------------
-- guard_participant_money (0080, 0081, 0101, 0102, 0105): restated without
-- its money branches -- families cannot write money at all now, and a
-- Payments-write staffer's scholarship goes through
-- set_participant_adjustments(). Everything else stays: the person must be
-- in the household (0105 F8), the option must belong to the event and the
-- role, created_at is now, check-in / program / confirmed_at start empty and
-- are staff facts (0105 F5), a set-role option keeps its role, and a family
-- moves status only draft -> submitted/cancelled or confirmed -> submitted.
--
-- Runs with the CALLER's rights on purpose: inside a definer function
-- current_user is the owner, and the 'is this a family?' test would always
-- step aside (caught by the harness, 18 Oct 2026).
create or replace function public.guard_participant_money()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_opt record;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Staff with Payments write or Registration write move status, check-in and
  -- program through their own paths; the money is no longer on this row.
  if public.has_grant('payments', 'write') or public.has_grant('registration', 'write') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- F8: the person must belong to the registration's household.
    if not exists (
      select 1 from public.people p
        join public.registrations r on r.household_id = p.household_id
       where p.id = new.person_id and r.id = new.registration_id
    ) then
      raise exception 'That person is not in this household.' using errcode = '42501';
    end if;
    select eo.participant_role, eo.event_id into v_opt
      from public.event_options eo where eo.id = new.event_option_id;
    if v_opt.event_id is distinct from
       (select r.event_id from public.registrations r where r.id = new.registration_id) then
      raise exception 'That option is not part of this event.' using errcode = '42501';
    end if;
    if v_opt.participant_role is not null and v_opt.participant_role is distinct from new.camp_role then
      raise exception 'That option is only for the % role.', v_opt.participant_role using errcode = '42501';
    end if;
    if v_opt.participant_role is not null and not exists (
      select 1
        from public.registration_participants rp2
        join public.event_options eo2 on eo2.id = rp2.event_option_id
       where rp2.registration_id = new.registration_id
         and rp2.person_id = new.person_id
         and rp2.status <> 'cancelled'
         and eo2.participant_role is null
    ) then
      raise exception 'A second role needs a place on the registration first.' using errcode = '42501';
    end if;
    -- 0114: the fee is filled from the option by the trigger on this table.
    new.created_at            := now();
    -- F5: staff facts start empty.
    new.checked_in_at         := null;
    new.checked_in_by         := null;
    new.program_id            := null;
    new.confirmed_at          := null;
    return new;
  end if;

  if new.event_option_id       is distinct from old.event_option_id
  or new.registration_id       is distinct from old.registration_id
  or new.person_id             is distinct from old.person_id
  or new.created_at            is distinct from old.created_at then
    raise exception 'Fees, discounts and registration dates are set by the ministry, not from a family account.'
      using errcode = '42501';
  end if;

  -- F5: check-in, program and confirmation are staff facts.
  if new.checked_in_at is distinct from old.checked_in_at
  or new.checked_in_by is distinct from old.checked_in_by
  or new.program_id    is distinct from old.program_id
  or new.confirmed_at  is distinct from old.confirmed_at then
    raise exception 'Check-in, programs and confirmation are recorded by camp staff.'
      using errcode = '42501';
  end if;

  if new.camp_role is distinct from old.camp_role
     and exists (select 1 from public.event_options eo
                  where eo.id = old.event_option_id and eo.participant_role is not null) then
    raise exception 'That place is for a set role and cannot be changed from a family account.'
      using errcode = '42501';
  end if;

  -- Status: a family may submit a draft, drop a draft, and a role change on a
  -- confirmed person sends it back for review (submit_family_registration).
  -- Anything else -- above all cancelling a submitted place, which takes it
  -- out of the balance -- goes through the staff-reviewed cancellation request.
  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
     and not (old.status = 'confirmed' and new.status = 'submitted') then
    raise exception 'Places are cancelled by the ministry. Please use "Request a cancellation".'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- 0111 item 5's cap trigger: the cap is the table's CHECK and
-- set_participant_adjustments() now.
drop trigger if exists registration_participants_zz_money_cap on public.registration_participants;
drop function if exists public.guard_participant_money_cap();

-- ---------------------------------------------------------------------------
-- 7. The discount rules, restated against participant_money
-- ---------------------------------------------------------------------------
-- Same caller checks as 0111: staff, the family's own registration, or a
-- server-side caller (may_recalc_registration / may_recalc_person).

-- 0080's early-registration candidates (0081 made the cap leave room for the
-- family discount): the early discount each person COULD earn on this
-- registration, before asking whether the family qualifies. One row per
-- person (the fee-bearing row -- a parent who is also volunteering has a
-- zero-fee second row), only for people registered by the early date, and
-- never more than what that person still owes after other reductions.
create or replace function public.early_discount_candidates(p_registration_id uuid)
returns table (participant_id uuid, amount_cents integer)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (rp.person_id)
         rp.id,
         least(e.early_registration_discount_cents,
               greatest(0, pm.fee_cents - pm.discount_cents - pm.scholarship_cents
                           - pm.family_discount_cents))::int
    from public.registration_participants rp
    join public.participant_money pm on pm.participant_id = rp.id
    join public.registrations r on r.id = rp.registration_id
    join public.events e        on e.id = r.event_id
   where rp.registration_id = p_registration_id
     and rp.status <> 'cancelled'
     and pm.fee_cents > 0
     and e.early_registration_discount_cents > 0
     and e.early_registration_ends_on is not null
     and (rp.created_at at time zone 'America/New_York')::date <= e.early_registration_ends_on
   order by rp.person_id, pm.fee_cents desc, rp.id;
$$;
-- Internal: called only from the definer functions, which run as the owner.
revoke execute on function public.early_discount_candidates(uuid) from public, anon, authenticated;

-- 0080's rule: the early discount, recomputed from stored facts (the 0070
-- pattern): clear it, then re-earn it. Safe to call as often as you like.
-- QUALIFIES when the person was registered by the early date AND either the
-- registration has an activated plan that still keeps the discount, or the
-- family has paid everything the discounted total asks for.
create or replace function public.recalc_early_registration_discount(p_registration_id uuid)
returns void language plpgsql security definer set search_path = 'public'
as $$
declare
  v_pot       bigint;
  v_balance   bigint;
  v_has_plan  boolean;
begin
  if p_registration_id is null then return; end if;
  if not public.may_recalc_registration(p_registration_id) then
    raise exception 'The discount rules run for staff, or for your own registration.';
  end if;

  update public.participant_money pm
     set early_discount_cents = 0, updated_at = now()
    from public.registration_participants rp
   where rp.id = pm.participant_id
     and rp.registration_id = p_registration_id
     and pm.early_discount_cents <> 0;

  select coalesce(sum(amount_cents), 0) into v_pot
    from public.early_discount_candidates(p_registration_id);
  if v_pot = 0 then return; end if;

  select exists (
    select 1 from public.payment_plans pp
     where pp.registration_id = p_registration_id
       and pp.activated_at is not null
       and pp.keeps_early_discount
  ) into v_has_plan;

  select b.balance_cents into v_balance
    from public.registration_balances b where b.registration_id = p_registration_id;

  if v_has_plan or coalesce(v_balance, 0) - v_pot <= 0 then
    update public.participant_money pm
       set early_discount_cents = c.amount_cents, updated_at = now()
      from public.early_discount_candidates(p_registration_id) c
     where pm.participant_id = c.participant_id;
  end if;
end;
$$;

-- 0081's rule (0096 moved the two numbers onto the event): the Nth and every
-- later person on a registration gets the family discount. One place per
-- PERSON (a parent who is also volunteering holds a zero-fee second row and
-- is one person), counted in the order they joined the registration. Only
-- fee-bearing places, never cancelled ones; capped at what the person owes.
create or replace function public.recalc_family_discount(p_registration_id uuid)
returns void language plpgsql security definer set search_path = 'public'
as $$
declare
  c_from_person  int;
  c_amount_cents int;
begin
  if p_registration_id is null then return; end if;
  if not public.may_recalc_registration(p_registration_id) then
    raise exception 'The discount rules run for staff, or for your own registration.';
  end if;

  select e.family_discount_from_person, e.family_discount_cents
    into c_from_person, c_amount_cents
    from public.registrations r
    join public.events e on e.id = r.event_id
   where r.id = p_registration_id;
  if c_from_person is null then return; end if;

  update public.participant_money pm
     set family_discount_cents = 0, updated_at = now()
    from public.registration_participants rp
   where rp.id = pm.participant_id
     and rp.registration_id = p_registration_id
     and pm.family_discount_cents <> 0;

  if c_amount_cents <= 0 then return; end if;

  with people_in_order as (
    select distinct on (rp.person_id)
           rp.id, rp.person_id, rp.created_at,
           greatest(0, pm.fee_cents - pm.discount_cents - pm.scholarship_cents
                       - pm.early_discount_cents) as owes
      from public.registration_participants rp
      join public.participant_money pm on pm.participant_id = rp.id
     where rp.registration_id = p_registration_id
       and rp.status <> 'cancelled'
       and pm.fee_cents > 0
     order by rp.person_id, pm.fee_cents desc, rp.created_at, rp.id
  ),
  ranked as (
    select id, owes, row_number() over (order by created_at, id) as n
      from people_in_order
  )
  update public.participant_money pm
     set family_discount_cents = least(c_amount_cents, r.owes), updated_at = now()
    from ranked r
   where pm.participant_id = r.id
     and r.n >= c_from_person;
end;
$$;

-- 0070's rule (0096: the percent is the later event's setting; 0111: the
-- volunteer must be one staff have CONFIRMED). "Both weeks" means two live
-- registrations for two different events in the same PROGRAM -- the part of
-- the event name before the em dash, as programOf() in lib/events.js. The
-- discount lands on the LATER-STARTING event's fee-bearing row, chosen
-- explicitly so two families with identical registrations get the same bill
-- whichever order they registered in. It only ever clears discounts carrying
-- its own reason: a staff member's manual discount is invisible to it.
-- Whether volunteering must cover both weeks is still with staff
-- (c_require_vol_both).
create or replace function public.recalc_multi_week_discount(p_person_id uuid)
returns void language plpgsql security definer set search_path = 'public'
as $$
declare
  c_require_vol_both   constant bool := true;
  c_require_confirmed  constant bool := true;   -- 0111: a family-named volunteer earns nothing until approved
  c_reason             constant text := 'Both weeks';
  r record;
begin
  if p_person_id is null then return; end if;
  if not public.may_recalc_person(p_person_id) then
    raise exception 'The discount rules run for staff, or for your own household.';
  end if;

  update public.participant_money pm
     set discount_cents = 0,
         discount_reason = null,
         updated_at = now()
    from public.registration_participants rp
   where rp.id = pm.participant_id
     and rp.person_id = p_person_id
     and pm.discount_reason like c_reason || '%';

  for r in
    with live as (
      select
        rp.id,
        rp.camp_role,
        rp.status,
        pm.fee_cents,
        e.id                                       as event_id,
        e.starts_on,
        e.multi_week_discount_percent              as pct,
        btrim(split_part(e.name, ' — ', 1))        as program
      from public.registration_participants rp
      join public.participant_money pm on pm.participant_id = rp.id
      join public.registrations r2 on r2.id = rp.registration_id
      join public.events e         on e.id  = r2.event_id
      where rp.person_id = p_person_id
        and rp.status <> 'cancelled'
    ),
    grouped as (
      select
        program,
        count(distinct event_id)                                  as weeks,
        count(*) filter (where camp_role = 'volunteer'
                           and (not c_require_confirmed or status = 'confirmed')) as volunteer_rows,
        count(distinct event_id) filter (where camp_role = 'volunteer'
                           and (not c_require_confirmed or status = 'confirmed')) as volunteer_weeks
      from live
      group by program
    )
    select l.id, l.fee_cents, l.pct
    from live l
    join grouped g on g.program = l.program
    where g.weeks >= 2
      and case
            when c_require_vol_both then g.volunteer_weeks >= g.weeks
            else g.volunteer_rows >= 1
          end
      and l.fee_cents > 0
      and l.pct > 0
      -- EXACTLY ONE ROW carries the credit: the later-starting event, and
      -- among rows at that event the fee-bearing one; ties broken by id so
      -- the answer is stable.
      and l.id = (
        select l2.id
        from live l2
        where l2.program = l.program
          and l2.fee_cents > 0
        order by l2.starts_on desc, l2.event_id desc, l2.id desc
        limit 1
      )
  loop
    update public.participant_money
       set discount_cents  = round(r.fee_cents * r.pct / 100.0),
           discount_reason = c_reason || ' (' || r.pct || '% off the later week)',
           updated_at      = now()
     where participant_id = r.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. waive_deposit (0096, 0102, 0103) and submit_family_registration (0037)
-- ---------------------------------------------------------------------------
-- The waiver: the mark on the registration, plus a scholarship of the
-- per-person deposit for each fee-bearing person who does not already hold
-- at least that much. A family's pending request stays pending (0103).
create or replace function public.waive_deposit(p_registration_id uuid, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deposit integer;
  n integer := 0;
  rec record;
  v_note text;
begin
  if not public.can_decide_scholarships() then
    raise exception 'Waiving a deposit is a scholarship decision: it needs Payments and Registration write.';
  end if;
  select e.deposit_cents into v_deposit
    from public.registrations r join public.events e on e.id = r.event_id
   where r.id = p_registration_id;
  if v_deposit is null then
    raise exception 'No such registration.';
  end if;

  update public.registrations
     set deposit_waived_at = now(),
         deposit_waived_by = auth.uid(),
         deposit_waived_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_registration_id;

  v_note := 'Deposit waived' || case when nullif(btrim(coalesce(p_reason, '')), '') is null
                                     then '' else ': ' || btrim(p_reason) end;

  for rec in
    select rp.id, pm.fee_cents, pm.scholarship_cents
      from public.registration_participants rp
      join public.participant_money pm on pm.participant_id = rp.id
     where rp.registration_id = p_registration_id
       and rp.status <> 'cancelled'
       and pm.fee_cents > 0
       and pm.scholarship_cents < least(v_deposit, pm.fee_cents)
       -- 0103: a family's pending request is theirs to have decided, not
       -- answered by the waiver.
       and not exists (select 1 from public.scholarships s
                        where s.registration_participant_id = rp.id
                          and s.status = 'requested')
  loop
    update public.participant_money
       set scholarship_cents = least(v_deposit, rec.fee_cents), updated_at = now()
     where participant_id = rec.id;
    -- The scholarship record, so the decision has a name and a note on it.
    update public.scholarships
       set granted_cents = least(v_deposit, rec.fee_cents), status = 'granted',
           staff_note = v_note, reviewed_by = auth.uid(), reviewed_at = now()
     where registration_participant_id = rec.id;
    if not found then
      insert into public.scholarships
        (registration_participant_id, granted_cents, status, staff_note, reviewed_by, reviewed_at)
      values (rec.id, least(v_deposit, rec.fee_cents), 'granted', v_note, auth.uid(), now());
    end if;
    n := n + 1;
  end loop;

  perform public.recalc_family_discount(p_registration_id);
  perform public.recalc_early_registration_discount(p_registration_id);
  return n;
end;
$function$;

-- The wizard's RPC, exactly as 0037 left it except that it no longer writes
-- fee_cents: the trigger fills the money row from the option. It runs with
-- the FAMILY's rights (invoker, as 0003 made it), so every guard on the
-- tables it writes still fires.
CREATE OR REPLACE FUNCTION public.submit_family_registration(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid := (payload->>'eventId')::uuid;
  v_option_id uuid := (payload->>'optionId')::uuid;
  v_fee int;
  v_household_id uuid;
  v_registration_id uuid;
  v_member jsonb;
  v_person_id uuid;
  v_claimed_id uuid;
  v_first text;
  v_last text;
  v_dob date;
  v_sex text;
  v_role text;
  v_needs text;
  v_diet text;
  v_tshirt text;
  v_first_time boolean;
  v_existing record;
  v_saved int := 0;
  v_signer_name text;
  v_signer_role text;
  v_agreement_key text;
  v_agreement_id uuid;
  v_signed int := 0;
  v_contact_first text;
  v_contact_last text;
  v_contact_person_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if v_event_id is null or v_option_id is null then raise exception 'missing event or option'; end if;

  -- 0114: the fee is no longer written here -- the trigger on
  -- registration_participants fills the participant_money row from the
  -- option. This lookup only proves the option belongs to the event.
  select eo.fee_cents into v_fee
  from public.event_options eo
  where eo.id = v_option_id and eo.event_id = v_event_id;
  if v_fee is null then raise exception 'camp option unavailable'; end if;

  select hm.household_id into v_household_id
  from public.household_members hm
  where hm.profile_id = v_uid
  limit 1;

  if v_household_id is null then
    v_household_id := gen_random_uuid();
    -- display_name is seeded from the family's LAST name only, and never
    -- touched again by this function. "TEST4 family", not "Victoria TEST4".
    insert into public.households (id, display_name, email, phone, address_line1,
                                   city, state, postal_code, home_church,
                                   how_did_you_hear, how_did_you_hear_from)
    values (
      v_household_id,
      coalesce(nullif(trim(payload#>>'{family,contactLast}'), '') || ' family', 'Family'),
      nullif(payload#>>'{family,email}', ''),
      nullif(payload#>>'{family,phone}', ''),
      nullif(payload#>>'{family,address}', ''),
      nullif(payload#>>'{family,city}', ''),
      upper(nullif(payload#>>'{family,state}', '')),
      nullif(payload#>>'{family,postalCode}', ''),
      nullif(payload#>>'{family,church}', ''),
      nullif(payload#>>'{family,heardAbout}', ''),
      nullif(payload#>>'{family,heardAboutFrom}', '')
    );
    insert into public.household_members (household_id, profile_id, role)
    values (v_household_id, v_uid, 'owner');
  else
    -- NOTE the absence of display_name here. Renaming a family as a
    -- side-effect of naming a contact is the bug this migration fixes.
    update public.households set
      email         = coalesce(nullif(payload#>>'{family,email}', ''), email),
      phone         = coalesce(nullif(payload#>>'{family,phone}', ''), phone),
      address_line1 = coalesce(nullif(payload#>>'{family,address}', ''), address_line1),
      city          = coalesce(nullif(payload#>>'{family,city}', ''), city),
      state         = coalesce(upper(nullif(payload#>>'{family,state}', '')), state),
      postal_code   = coalesce(nullif(payload#>>'{family,postalCode}', ''), postal_code),
      home_church   = coalesce(nullif(payload#>>'{family,church}', ''), home_church),
      how_did_you_hear      = coalesce(nullif(payload#>>'{family,heardAbout}', ''), how_did_you_hear),
      how_did_you_hear_from = coalesce(nullif(payload#>>'{family,heardAboutFrom}', ''), how_did_you_hear_from)
    where id = v_household_id;
  end if;

  insert into public.registrations (household_id, event_id, family_notes)
  values (v_household_id, v_event_id, nullif(payload->>'notes', ''))
  on conflict (household_id, event_id) do update set family_notes = excluded.family_notes
  returning id into v_registration_id;

  for v_member in select value from jsonb_array_elements(coalesce(payload->'members', '[]'::jsonb)) as x(value)
  loop
    v_first := nullif(trim(v_member->>'firstName'), '');
    v_last  := nullif(trim(v_member->>'lastName'), '');
    continue when v_first is null or v_last is null;

    v_dob  := nullif(v_member->>'dob','')::date;
    v_sex  := nullif(trim(v_member->>'sex'), '');
    v_role := coalesce(nullif(v_member->>'role',''), 'camper');
    v_needs := nullif(trim(v_member->>'needs'), '');
    v_diet  := nullif(trim(v_member->>'diet'), '');
    v_tshirt := nullif(trim(v_member->>'tshirt'), '');
    v_first_time := case
                      when v_member->>'firstTime' is null or v_member->>'firstTime' = '' then null
                      else (v_member->>'firstTime')::boolean
                    end;

    v_person_id := null;
    v_claimed_id := nullif(v_member->>'personId', '')::uuid;
    if v_claimed_id is not null then
      select p.id into v_person_id
      from public.people p
      where p.id = v_claimed_id and p.household_id = v_household_id;
    end if;

    if v_person_id is null then
      select p.id into v_person_id
      from public.people p
      where p.household_id = v_household_id
        and lower(p.first_name) = lower(v_first)
        and lower(p.last_name)  = lower(v_last)
        and p.date_of_birth is not distinct from v_dob
      limit 1;
    end if;

    -- Second chance: a person created earlier as the PRIMARY CONTACT has no
    -- date of birth, so the strict match above misses them and would create a
    -- duplicate the first time that contact also registers to attend. Match
    -- name-only against a row that has no date of birth yet, and fill it in.
    if v_person_id is null and v_dob is not null then
      select p.id into v_person_id
      from public.people p
      where p.household_id = v_household_id
        and lower(p.first_name) = lower(v_first)
        and lower(p.last_name)  = lower(v_last)
        and p.date_of_birth is null
      order by p.created_at
      limit 1;
    end if;

    if v_person_id is null then
      v_person_id := gen_random_uuid();
      insert into public.people (id, household_id, first_name, last_name, date_of_birth, gender)
      values (v_person_id, v_household_id, v_first, v_last, v_dob, v_sex);
    else
      update public.people set
        first_name = v_first,
        last_name = v_last,
        date_of_birth = v_dob,
        gender = coalesce(v_sex, gender)
      where id = v_person_id
        and (first_name is distinct from v_first
          or last_name is distinct from v_last
          or date_of_birth is distinct from v_dob
          or (v_sex is not null and gender is distinct from v_sex));
    end if;

    if v_needs is not null or v_diet is not null then
      insert into public.person_support (person_id, disabilities, dietary_needs)
      values (v_person_id, v_needs, v_diet)
      on conflict (person_id) do update
        set disabilities = coalesce(excluded.disabilities, public.person_support.disabilities),
            dietary_needs = coalesce(excluded.dietary_needs, public.person_support.dietary_needs)
      where public.person_support.disabilities is distinct from coalesce(excluded.disabilities, public.person_support.disabilities)
         or public.person_support.dietary_needs is distinct from coalesce(excluded.dietary_needs, public.person_support.dietary_needs);
    end if;

    if nullif(v_member->>'mediaConsent', '') is not null then
      insert into public.person_consents (person_id, kind, granted, recorded_by, recorded_as)
      select v_person_id, 'media', (v_member->>'mediaConsent')::boolean, v_uid,
             coalesce(nullif(payload#>>'{agreements,signerRole}', ''), 'self')
      where (v_member->>'mediaConsent')::boolean is distinct from (
        select c.granted from public.person_consents c
        where c.person_id = v_person_id and c.kind = 'media'
        order by c.recorded_at desc limit 1);
    end if;

    if nullif(v_member->>'directoryConsent', '') is not null then
      insert into public.person_consents (person_id, kind, granted, recorded_by, recorded_as)
      select v_person_id, 'directory', (v_member->>'directoryConsent')::boolean, v_uid,
             coalesce(nullif(payload#>>'{agreements,signerRole}', ''), 'self')
      where (v_member->>'directoryConsent')::boolean is distinct from (
        select c.granted from public.person_consents c
        where c.person_id = v_person_id and c.kind = 'directory'
        order by c.recorded_at desc limit 1);
    end if;

    select rp.id, rp.camp_role, rp.status into v_existing
    from public.registration_participants rp
    where rp.registration_id = v_registration_id
      and rp.person_id = v_person_id
      and rp.event_option_id = v_option_id;

    if v_existing.id is null then
      insert into public.registration_participants
        (registration_id, person_id, event_option_id, camp_role, status, submitted_at, furthest_step,
         tshirt_size, first_time_attending)
      values
        (v_registration_id, v_person_id, v_option_id, v_role, 'submitted', now(), 5,
         v_tshirt, v_first_time);
    elsif v_existing.camp_role is distinct from v_role then
      update public.registration_participants
         set camp_role = v_role,
             status = case when status = 'confirmed' then 'submitted' else status end,
             tshirt_size = coalesce(v_tshirt, tshirt_size),
             first_time_attending = coalesce(v_first_time, first_time_attending),
             last_activity_at = now()
       where id = v_existing.id;
    else
      update public.registration_participants
         set tshirt_size = coalesce(v_tshirt, tshirt_size),
             first_time_attending = coalesce(v_first_time, first_time_attending),
             last_activity_at = now()
       where id = v_existing.id
         and status in ('draft', 'submitted', 'cancelled');
    end if;

    v_saved := v_saved + 1;
  end loop;

  -- ---- the primary contact, resolved to a person -------------------------
  -- Deliberately AFTER the members loop: if the contact is also attending,
  -- their real record (with a date of birth) already exists by now and is
  -- matched, instead of a second, thinner copy being created beside it.
  v_contact_first := nullif(trim(payload#>>'{family,contactFirst}'), '');
  v_contact_last  := nullif(trim(payload#>>'{family,contactLast}'), '');

  if v_contact_first is not null and v_contact_last is not null then
    select p.id into v_contact_person_id
    from public.people p
    where p.household_id = v_household_id
      and lower(p.first_name) = lower(v_contact_first)
      and lower(p.last_name)  = lower(v_contact_last)
    order by p.created_at
    limit 1;

    -- A contact who is not attending still gets a row: they are a real member
    -- of the household, they are who staff will ring, and they are eligible to
    -- be someone's linked caregiver. No date of birth is invented for them.
    if v_contact_person_id is null then
      v_contact_person_id := gen_random_uuid();
      insert into public.people (id, household_id, first_name, last_name)
      values (v_contact_person_id, v_household_id, v_contact_first, v_contact_last);
    end if;

    update public.households
       set primary_contact_person_id = v_contact_person_id
     where id = v_household_id
       and primary_contact_person_id is distinct from v_contact_person_id;
  end if;

  v_signer_name := nullif(trim(payload#>>'{agreements,signerName}'), '');
  v_signer_role := coalesce(nullif(payload#>>'{agreements,signerRole}', ''), 'account_holder');

  if v_signer_name is not null then
    for v_agreement_key in
      select value#>>'{}' from jsonb_array_elements(coalesce(payload#>'{agreements,keys}', '[]'::jsonb))
    loop
      select a.id into v_agreement_id
      from public.agreements a
      where a.key = v_agreement_key and a.active
      order by a.version desc
      limit 1;

      continue when v_agreement_id is null;

      insert into public.agreement_signatures
        (agreement_id, household_id, registration_id, status, signer_name, signer_role)
      select v_agreement_id, v_household_id, v_registration_id, 'signed_here', v_signer_name, v_signer_role
      where not exists (
        select 1 from public.agreement_signatures s
        where s.agreement_id = v_agreement_id
          and s.household_id = v_household_id
          and s.registration_id = v_registration_id);

      v_signed := v_signed + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'registrationId', v_registration_id, 'saved', v_saved, 'signed', v_signed);
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 9. Backfill, then drop the columns
-- ---------------------------------------------------------------------------
-- Keep the totals so the post-check can prove nothing was lost.
-- A plain temp table: psql applies the file statement by statement, so an
-- ON COMMIT DROP table would be gone before the post-check reads it.
create temp table _pm_before as
select count(*)                   as n,
       coalesce(sum(fee_cents), 0)            as fee,
       coalesce(sum(scholarship_cents), 0)    as scholarship,
       coalesce(sum(discount_cents), 0)       as discount,
       coalesce(sum(early_discount_cents), 0) as early,
       coalesce(sum(family_discount_cents), 0) as family,
       count(discount_reason)     as reasons
  from public.registration_participants;

insert into public.participant_money
  (participant_id, fee_cents, scholarship_cents, discount_cents, discount_reason,
   early_discount_cents, family_discount_cents, updated_at)
select rp.id, rp.fee_cents, rp.scholarship_cents, rp.discount_cents, rp.discount_reason,
       rp.early_discount_cents, rp.family_discount_cents, coalesce(rp.updated_at, now())
  from public.registration_participants rp
on conflict (participant_id) do nothing;

alter table public.registration_participants
  drop column if exists fee_cents,
  drop column if exists scholarship_cents,
  drop column if exists discount_cents,
  drop column if exists discount_reason,
  drop column if exists early_discount_cents,
  drop column if exists family_discount_cents;

-- ---------------------------------------------------------------------------
-- 10. The views come back with the same columns
-- ---------------------------------------------------------------------------
-- registration_balances (0001, 0038, 0053, 0080, 0081): invoker, so it runs
-- with the caller's rights. discount_cents means ALL discounts (0080);
-- early_discount_cents and family_discount_cents are named at the end.
--
-- 0114: the money comes from participant_money, which a staffer without
-- Payments read cannot see. Such a staffer gets NO ROW for a registration
-- with live participants (the pages show "--"), never a row of zeros that
-- reads as "paid $0" (0111 item 11). A registration with no live participant
-- has nothing to hide and keeps its zero row for anyone who can see it.
-- registration_paid_cents() remains the deposit question for any staff member.
create view public.registration_balances
with (security_invoker = on)
as
select r.id as registration_id,
       r.household_id,
       r.event_id,
       coalesce(f.fee_cents, 0::bigint) as fee_cents,
       coalesce(f.discount_cents, 0::bigint) as discount_cents,
       coalesce(f.scholarship_cents, 0::bigint) as scholarship_cents,
       coalesce(c.coupon_cents, 0::bigint) as coupon_cents,
       coalesce(p.paid_cents, 0::bigint) - coalesce(rf.refunded_cents, 0::bigint) as paid_cents,
       coalesce(f.fee_cents, 0::bigint)
         - coalesce(f.discount_cents, 0::bigint)
         - coalesce(f.scholarship_cents, 0::bigint)
         - coalesce(c.coupon_cents, 0::bigint)
         - (coalesce(p.paid_cents, 0::bigint) - coalesce(rf.refunded_cents, 0::bigint))
         as balance_cents,
       coalesce(rf.refunded_cents, 0::bigint) as refunded_cents,
       coalesce(rp.refund_pending_cents, 0::bigint) as refund_pending_cents,
       coalesce(f.early_discount_cents, 0::bigint) as early_discount_cents,
       coalesce(f.family_discount_cents, 0::bigint) as family_discount_cents
  from public.registrations r
  left join (
    select rp2.registration_id,
           sum(pm.fee_cents) as fee_cents,
           sum(pm.discount_cents + pm.early_discount_cents + pm.family_discount_cents) as discount_cents,
           sum(pm.scholarship_cents) as scholarship_cents,
           sum(pm.early_discount_cents) as early_discount_cents,
           sum(pm.family_discount_cents) as family_discount_cents
      from public.registration_participants rp2
      join public.participant_money pm on pm.participant_id = rp2.id
     where rp2.status <> 'cancelled'
     group by rp2.registration_id
  ) f on f.registration_id = r.id
  left join (
    select cr.registration_id, sum(cr.applied_cents) as coupon_cents
      from public.coupon_redemptions cr
     group by cr.registration_id
  ) c on c.registration_id = r.id
  left join (
    select pm.registration_id, sum(pm.amount_cents) as paid_cents
      from public.payments pm
     where pm.status = any (array['succeeded', 'processing'])
     group by pm.registration_id
  ) p on p.registration_id = r.id
  left join (
    select pr.registration_id, sum(pr.amount_cents) as refunded_cents
      from public.payment_refunds pr
     where pr.status = 'succeeded'
     group by pr.registration_id
  ) rf on rf.registration_id = r.id
  left join (
    select pr.registration_id, sum(pr.amount_cents) as refund_pending_cents
      from public.payment_refunds pr
     where pr.status = 'pending'
     group by pr.registration_id
  ) rp on rp.registration_id = r.id
 where f.registration_id is not null
    or not exists (select 1 from public.registration_participants rp3
                    where rp3.registration_id = r.id and rp3.status <> 'cancelled');

grant select on public.registration_balances to authenticated, service_role;

-- registration_payment_routes (0080), unchanged: how each registration is
-- being paid -- the "finished registering" test.
--   plan          a plan that got past its deposit (active, paused, failed or completed)
--   paid_in_full  nothing owed and something was paid
--   nothing_owed  nothing owed and nothing paid (e.g. a zero-fee volunteer)
--   scholarship   a scholarship requested or granted for someone on it
--   none          NOT FINISHED -- the family still has to choose
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
       and s.status in ('requested', 'granted')
     limit 1
  ) sch on true;

grant select on public.registration_payment_routes to authenticated, service_role;

-- registration_review (0081, 0096, 0098, 0102, 0103, 0109, 0112): the three
-- classes staff review registrations in, plus the flags. DEFINER on purpose
-- with its own row filter -- it must read money and flags across households,
-- and as an invoker view a reviewer without Payments read would see every
-- family as "neither" (0103). Rows only for Payments read; the harness checks
-- a family sees none (CLAUDE.md, traps). 0109: "deposit received" means the
-- whole deposit. 0112: a requested row counts what was asked for (NULL =
-- everything owed), a granted row what was granted, anything else nothing.
create view public.registration_review as
with live as (
  select rp.registration_id, rp.id, rp.person_id, rp.camp_role, pm.fee_cents,
         greatest(0, pm.fee_cents - pm.discount_cents - pm.early_discount_cents - pm.family_discount_cents) as owes
    from public.registration_participants rp
    join public.participant_money pm on pm.participant_id = rp.id
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
         sum(case
               when s_1.id is null then 0
               when s_1.status = 'requested' then least(l.owes, coalesce(s_1.requested_cents, l.owes))
               when s_1.status = 'granted'   then least(l.owes, coalesce(s_1.granted_cents, 0))
               else 0
             end) as requested
    from live l
    left join public.scholarships s_1 on s_1.registration_participant_id = l.id
         and s_1.status = any (array['requested', 'granted'])
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
         when r.deposit_waived_at is not null
           or (coalesce(e.deposit_cents, 0) * coalesce(h.fee_people, 0) > 0
               and coalesce(c.cents, 0) >= coalesce(e.deposit_cents, 0) * coalesce(h.fee_people, 0))
           or (coalesce(e.deposit_cents, 0) * coalesce(h.fee_people, 0) = 0
               and coalesce(c.cents, 0) > 0) then 'deposit_paid'
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
  left join creed_no cn on cn.registration_id = r.id
 where public.has_grant('payments', 'read');

grant select on public.registration_review to authenticated, service_role;

-- The audit trail, from here on.
drop trigger if exists participant_money_money_log on public.participant_money;
create trigger participant_money_money_log
  after insert or update or delete on public.participant_money
  for each row execute function public.log_money_change();

-- ---------------------------------------------------------------------------
-- 11. Post-checks: the move took
-- ---------------------------------------------------------------------------
do $$
declare
  b record;
  a record;
  f text;
begin
  -- The six columns are gone.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'registration_participants'
                and column_name in ('fee_cents', 'scholarship_cents', 'discount_cents', 'discount_reason',
                                    'early_discount_cents', 'family_discount_cents')) then
    raise exception '0114: a money column is still on registration_participants';
  end if;

  -- Row for row, cent for cent.
  select * into b from _pm_before;
  select count(*) as n,
         coalesce(sum(fee_cents), 0) as fee, coalesce(sum(scholarship_cents), 0) as scholarship,
         coalesce(sum(discount_cents), 0) as discount, coalesce(sum(early_discount_cents), 0) as early,
         coalesce(sum(family_discount_cents), 0) as family, count(discount_reason) as reasons
    into a from public.participant_money;
  if a.n <> b.n or a.n <> (select count(*) from public.registration_participants)
     or a.fee <> b.fee or a.scholarship <> b.scholarship or a.discount <> b.discount
     or a.early <> b.early or a.family <> b.family or a.reasons <> b.reasons then
    raise exception '0114: the backfill does not match (before % rows / % cents, after % rows / % cents)',
      b.n, b.fee, a.n, a.fee;
  end if;

  -- Every restated function reads the new table; the old guard reads no money.
  foreach f in array array[
    'public.guard_participant_money()', 'public.early_discount_candidates(uuid)',
    'public.recalc_early_registration_discount(uuid)', 'public.recalc_family_discount(uuid)',
    'public.recalc_multi_week_discount(uuid)', 'public.waive_deposit(uuid, text)',
    'public.submit_family_registration(jsonb)', 'public.set_participant_adjustments(uuid, integer, integer, text)',
    'public.fill_participant_money()', 'public.log_money_change()'] loop
    if position('participant_money' in pg_get_functiondef(f::regprocedure)) = 0 then
      raise exception '0114: % was not rewritten', f;
    end if;
  end loop;
  if pg_get_functiondef('public.guard_participant_money()'::regprocedure) ~ '(fee|scholarship|discount)_cents' then
    raise exception '0114: guard_participant_money still names a money column';
  end if;
  if position('fee_cents, furthest_step' in pg_get_functiondef('public.submit_family_registration(jsonb)'::regprocedure)) > 0
     or position('v_fee,' in pg_get_functiondef('public.submit_family_registration(jsonb)'::regprocedure)) > 0 then
    raise exception '0114: submit_family_registration still writes fee_cents';
  end if;
  if to_regprocedure('public.guard_participant_money_cap()') is not null then
    raise exception '0114: guard_participant_money_cap still exists';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.registration_participants'::regclass
       and tgname in ('registration_participants_money_insert', 'registration_participants_money_option')) <> 2 then
    raise exception '0114: the fee triggers are missing';
  end if;
  if position('participant_money' in pg_get_viewdef('public.registration_balances'::regclass)) = 0
     or position('participant_money' in pg_get_viewdef('public.registration_review'::regclass)) = 0
     or position('payments' in pg_get_viewdef('public.registration_review'::regclass)) = 0 then
    raise exception '0114: a view was not rewritten';
  end if;
  drop table _pm_before;
end $$;
