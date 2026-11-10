-- 0159 -- A family can ask for one scholarship for the whole registration
-- (Lawrence, 10 Nov 2026: "if the lawrence laplue family request a 50% or
-- $1500 scholarship, should be a way to apply it across the family").
--
-- Decided with Lawrence the same day:
--   * One request per registration, so per week; it never spans both weeks.
--   * The family asks for a percentage, a dollar amount, or help without a
--     figure. Staff award DOLLARS: the page shows what the percentage comes
--     to, and the award stays put if fees or discounts move later.
--   * The award is split across the people by each person's fee, never more
--     than a person owes (fee less every discount). The total can never be
--     more than the whole family owes, so a scholarship never eats an
--     automatic discount.
--   * Someone removed after the award: the total stays, and their share is
--     spread over the others (up to what each owes). Someone added after the
--     award: no share. Either way the request is flagged for staff.
--   * Every decision needs a note (Lawrence, 4 Nov 2026).
--   * A registration has a family request OR per-person requests, never both
--     (staff can still change one person's amount by hand on the
--     registration page).
--
-- HOW IT FITS. The family's request lives here, one row per registration.
-- Each person's share is ALSO written to that person's row in
-- public.scholarships (requested, and once decided, granted), marked with
-- family_request_id. Everything that already reads scholarships -- the review
-- class, the deposit rule (registration_review, registration_deposit_in,
-- fullScholarshipRequested), statements, exports, participant_money -- keeps
-- working with no change. A percentage of 100 is stored on each person as a
-- request with no figure, which those readers already treat as "everything
-- this person owes", so it stays a full request when discounts move.
--
-- Writes go only through the functions below; the table has no signed-in
-- write policy. A trigger keeps families from editing a share directly or
-- adding a per-person request beside a family one.

-- ---------------------------------------------------------------------------
-- 1. The family's request
-- ---------------------------------------------------------------------------
create table public.family_scholarship_requests (
  id                  uuid primary key default gen_random_uuid(),
  registration_id     uuid not null unique references public.registrations (id) on delete cascade,
  ask_kind            text not null check (ask_kind in ('percent', 'amount', 'unsure')),
  ask_percent         integer check (ask_percent between 1 and 100),
  ask_cents           integer check (ask_cents > 0),
  family_statement    text,
  status              text not null default 'requested'
                        check (status in ('requested', 'granted', 'declined', 'withdrawn')),
  granted_cents       integer not null default 0 check (granted_cents >= 0),
  staff_note          text,
  reviewed_by         uuid references public.profiles (id) on delete set null,
  reviewed_at         timestamptz,
  -- Set when someone is added or removed after the award; cleared by the
  -- next decision.
  needs_review_since  timestamptz,
  needs_review_reason text,
  requested_by        uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((ask_kind = 'percent') = (ask_percent is not null)),
  check ((ask_kind = 'amount') = (ask_cents is not null))
);

create trigger family_scholarship_requests_updated_at
  before update on public.family_scholarship_requests
  for each row execute function public.set_updated_at();

comment on table public.family_scholarship_requests is
  'A family''s one scholarship request for a whole registration (0159, Lawrence 10 Nov 2026). Each person''s share is also on their public.scholarships row (family_request_id). Written only by family_request_scholarship(), family_withdraw_scholarship(), decide_family_scholarship() and the re-spread trigger.';

alter table public.family_scholarship_requests enable row level security;

-- Read like public.scholarships: the household it belongs to, and staff.
create policy family_scholarship_requests_select on public.family_scholarship_requests
  for select to authenticated
  using (
    public.is_staff()
    or registration_id in (select r.id from public.registrations r
                            where r.household_id in (select public.my_household_ids()))
  );
-- No insert, update or delete policy: the functions below are the only door.
grant select on public.family_scholarship_requests to authenticated;
grant select on public.family_scholarship_requests to service_role;

alter table public.scholarships
  add column family_request_id uuid
    references public.family_scholarship_requests (id) on delete set null;
create index scholarships_family_request_idx on public.scholarships (family_request_id);
comment on column public.scholarships.family_request_id is
  'Set when this person''s request or award is their share of a family request (0159). Written only by the family-request functions.';

-- The money audit trail covers the family row too (0111's logger).
drop trigger if exists family_scholarship_requests_money_log on public.family_scholarship_requests;
create trigger family_scholarship_requests_money_log
  after insert or update or delete on public.family_scholarship_requests
  for each row execute function public.log_money_change();

-- ---------------------------------------------------------------------------
-- 2. Families cannot edit a share, or ask per person beside a family request
-- ---------------------------------------------------------------------------
-- INVOKER on purpose (CLAUDE.md: inside a definer function current_user is
-- the owner, so the family-request functions below pass through).
create or replace function public.guard_scholarship_family_link()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_reg uuid;
begin
  if current_user not in ('authenticated', 'anon') or public.can_decide_scholarships() then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.family_request_id is not null then
    raise exception 'This is part of your family''s scholarship request. Change or withdraw the family request instead.'
      using errcode = '42501';
  end if;
  if new.family_request_id is not null then
    raise exception 'A family scholarship share is set by the family request, not directly.'
      using errcode = '42501';
  end if;
  select rp.registration_id into v_reg
    from public.registration_participants rp where rp.id = new.registration_participant_id;
  if exists (select 1 from public.family_scholarship_requests f
              where f.registration_id = v_reg and f.status in ('requested', 'granted')) then
    raise exception 'Your family already has a family scholarship request for this registration. Change that instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists scholarships_family_link_guard on public.scholarships;
create trigger scholarships_family_link_guard before insert or update on public.scholarships
  for each row execute function public.guard_scholarship_family_link();

-- ---------------------------------------------------------------------------
-- 3. The split: by weight (each fee), never more than each cap (what each owes)
-- ---------------------------------------------------------------------------
-- Water-filling: share out by weight; anyone whose share would pass their cap
-- gets the cap and drops out, and the rest is shared again. Whole cents, the
-- leftover cents going to the largest remainders (then list order), so the
-- shares always add up to the total. A total above the caps' sum gives every
-- cap.
create or replace function public.split_by_weight(p_total integer, p_weights integer[], p_caps integer[])
returns integer[] language plpgsql immutable set search_path = ''
as $$
declare
  n          int := coalesce(array_length(p_weights, 1), 0);
  v_result   int[] := array_fill(0, array[greatest(n, 1)]);
  v_active   boolean[] := array_fill(false, array[greatest(n, 1)]);
  v_left     bigint;
  v_w        bigint;
  v_capped   boolean;
  v_ideal    numeric;
  v_frac     numeric[] := array_fill(0::numeric, array[greatest(n, 1)]);
  v_given    bigint;
  v_best     int;
  i          int;
begin
  if n = 0 then return '{}'::int[]; end if;
  for i in 1..n loop
    v_active[i] := coalesce(p_weights[i], 0) > 0 and coalesce(p_caps[i], 0) > 0;
  end loop;
  v_left := greatest(0, coalesce(p_total, 0));

  loop
    v_w := 0;
    for i in 1..n loop
      if v_active[i] then v_w := v_w + p_weights[i]; end if;
    end loop;
    exit when v_w = 0 or v_left = 0;

    v_capped := false;
    for i in 1..n loop
      if v_active[i] and v_left::numeric * p_weights[i] / v_w >= p_caps[i] then
        v_result[i] := p_caps[i];
        v_active[i] := false;
        v_capped := true;
      end if;
    end loop;
    if v_capped then
      v_left := greatest(0, coalesce(p_total, 0));
      for i in 1..n loop
        if not v_active[i] then v_left := v_left - v_result[i]; end if;
      end loop;
      v_left := greatest(0, v_left);
      continue;
    end if;

    -- Nobody passes a cap: floor each share, then hand out the cents left.
    v_given := 0;
    for i in 1..n loop
      if v_active[i] then
        v_ideal := v_left::numeric * p_weights[i] / v_w;
        v_result[i] := floor(v_ideal)::int;
        v_frac[i] := v_ideal - floor(v_ideal);
        v_given := v_given + v_result[i];
      end if;
    end loop;
    while v_given < v_left loop
      v_best := null;
      for i in 1..n loop
        if v_active[i] and v_result[i] < p_caps[i]
           and (v_best is null or v_frac[i] > v_frac[v_best]) then
          v_best := i;
        end if;
      end loop;
      exit when v_best is null;
      v_result[v_best] := v_result[v_best] + 1;
      v_frac[v_best] := -1;
      v_given := v_given + 1;
    end loop;
    exit;
  end loop;
  return v_result;
end;
$$;
revoke all on function public.split_by_weight(integer, integer[], integer[]) from public, anon;
grant execute on function public.split_by_weight(integer, integer[], integer[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A family asks (or changes what they asked)
-- ---------------------------------------------------------------------------
create or replace function public.family_request_scholarship(
  p_registration_id uuid,
  p_kind            text,
  p_percent         integer default null,
  p_cents           integer default null,
  p_statement       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_req       public.family_scholarship_requests%rowtype;
  v_ids       uuid[];
  v_fees      int[];
  v_owes      int[];
  v_shares    int[];
  i           int;
begin
  select r.household_id into v_household from public.registrations r where r.id = p_registration_id;
  if v_household is null then
    raise exception 'That registration was not found.';
  end if;
  if not (v_household in (select public.my_household_ids()) or public.can_decide_scholarships()) then
    raise exception 'Only the family on this registration can ask for its scholarship.'
      using errcode = '42501';
  end if;

  if p_kind not in ('percent', 'amount', 'unsure') then
    raise exception 'Choose a percentage, an amount, or not sure.' using errcode = '23514';
  end if;
  if p_kind = 'percent' and (p_percent is null or p_percent < 1 or p_percent > 100) then
    raise exception 'Enter a percentage from 1 to 100.' using errcode = '23514';
  end if;
  if p_kind = 'amount' and (p_cents is null or p_cents < 1 or p_cents > 1000000) then
    raise exception 'Enter an amount in dollars.' using errcode = '23514';
  end if;

  select * into v_req from public.family_scholarship_requests
   where registration_id = p_registration_id for update;
  if found and v_req.status = 'granted' then
    raise exception 'Camp staff have already decided your family''s scholarship, so it can no longer be changed here. Please contact the office if something needs to be different.';
  end if;

  if exists (
    select 1 from public.scholarships s
      join public.registration_participants rp on rp.id = s.registration_participant_id
     where rp.registration_id = p_registration_id
       and rp.status <> 'cancelled'
       and s.family_request_id is null
       and (s.status = 'granted' or s.granted_cents > 0)
  ) then
    raise exception 'Camp staff have already awarded a scholarship to someone on this registration. Please contact the office to ask for more.';
  end if;

  if found then
    update public.family_scholarship_requests
       set ask_kind = p_kind,
           ask_percent = case when p_kind = 'percent' then p_percent end,
           ask_cents = case when p_kind = 'amount' then p_cents end,
           family_statement = nullif(btrim(coalesce(p_statement, '')), ''),
           status = 'requested',
           granted_cents = 0,
           requested_by = auth.uid()
     where id = v_req.id
    returning * into v_req;
  else
    insert into public.family_scholarship_requests
      (registration_id, ask_kind, ask_percent, ask_cents, family_statement, requested_by)
    values (p_registration_id, p_kind,
            case when p_kind = 'percent' then p_percent end,
            case when p_kind = 'amount' then p_cents end,
            nullif(btrim(coalesce(p_statement, '')), ''),
            auth.uid())
    returning * into v_req;
  end if;

  -- Each person who owes something: their share of what was asked.
  select array_agg(rp.id order by rp.created_at, rp.id),
         array_agg(pm.fee_cents order by rp.created_at, rp.id),
         array_agg(greatest(0, pm.fee_cents - pm.discount_cents - pm.early_discount_cents
                               - pm.family_discount_cents) order by rp.created_at, rp.id)
    into v_ids, v_fees, v_owes
    from public.registration_participants rp
    join public.participant_money pm on pm.participant_id = rp.id
   where rp.registration_id = p_registration_id
     and rp.status <> 'cancelled'
     and pm.fee_cents > 0
     and greatest(0, pm.fee_cents - pm.discount_cents - pm.early_discount_cents
                     - pm.family_discount_cents) > 0;

  if v_ids is null then
    raise exception 'Nobody on this registration has anything left to pay.';
  end if;

  if p_kind = 'amount' then
    v_shares := public.split_by_weight(p_cents, v_fees, v_owes);
  end if;

  -- Anyone covered before but not now (removed, or nothing left to pay)
  -- leaves the request.
  update public.scholarships
     set status = 'withdrawn', family_request_id = null
   where family_request_id = v_req.id
     and status = 'requested'
     and not (registration_participant_id = any (v_ids));

  for i in 1..array_length(v_ids, 1) loop
    insert into public.scholarships
      (registration_participant_id, requested_cents, status, family_request_id, family_statement)
    values (
      v_ids[i],
      case p_kind
        when 'percent' then case when p_percent = 100 then null
                                 else round(v_owes[i] * p_percent / 100.0)::int end
        when 'amount' then v_shares[i]
        else 0
      end,
      'requested', v_req.id, null)
    on conflict (registration_participant_id) do update
      set requested_cents = excluded.requested_cents,
          status = 'requested',
          family_request_id = excluded.family_request_id,
          family_statement = null;
  end loop;

  return v_req.id;
end;
$$;
revoke all on function public.family_request_scholarship(uuid, text, integer, integer, text) from public, anon;
grant execute on function public.family_request_scholarship(uuid, text, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A family withdraws it (only while it waits on staff)
-- ---------------------------------------------------------------------------
create or replace function public.family_withdraw_scholarship(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_req       public.family_scholarship_requests%rowtype;
begin
  select r.household_id into v_household from public.registrations r where r.id = p_registration_id;
  if v_household is null
     or not (v_household in (select public.my_household_ids()) or public.can_decide_scholarships()) then
    raise exception 'Only the family on this registration can withdraw its scholarship request.'
      using errcode = '42501';
  end if;
  select * into v_req from public.family_scholarship_requests
   where registration_id = p_registration_id for update;
  if not found or v_req.status <> 'requested' then
    raise exception 'There is no waiting family request to withdraw.';
  end if;
  update public.family_scholarship_requests set status = 'withdrawn' where id = v_req.id;
  update public.scholarships set status = 'withdrawn'
   where family_request_id = v_req.id and status = 'requested';
end;
$$;
revoke all on function public.family_withdraw_scholarship(uuid) from public, anon;
grant execute on function public.family_withdraw_scholarship(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Staff decide: award dollars (split by fee) or decline
-- ---------------------------------------------------------------------------
-- Returns what was applied in total. p_granted_cents of 0 or less declines.
-- May be run again on a decided request (to change the amount, or after the
-- request was flagged); each run is the new decision.
create or replace function public.decide_family_scholarship(
  p_registration_id uuid,
  p_granted_cents   integer,
  p_note            text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req     public.family_scholarship_requests%rowtype;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_ids     uuid[];
  v_fees    int[];
  v_owes    int[];
  v_shares  int[];
  v_room    bigint;
  v_m       record;
  i         int;
begin
  if not public.can_decide_scholarships() then
    raise exception 'Scholarship decisions need both Payments write and Registration write.'
      using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'Add a short reason. Every scholarship decision needs one.' using errcode = '23514';
  end if;
  select * into v_req from public.family_scholarship_requests
   where registration_id = p_registration_id for update;
  if not found then
    raise exception 'This registration has no family scholarship request.';
  end if;
  if v_req.status = 'withdrawn' then
    raise exception 'The family withdrew this request.';
  end if;

  -- Decline: every share comes off, the decision is recorded on each person.
  if coalesce(p_granted_cents, 0) <= 0 then
    for v_m in
      select s.registration_participant_id as pid, pm.discount_cents, pm.discount_reason
        from public.scholarships s
        join public.participant_money pm on pm.participant_id = s.registration_participant_id
       where s.family_request_id = v_req.id
    loop
      perform public.set_participant_adjustments(v_m.pid, 0, v_m.discount_cents, v_m.discount_reason);
    end loop;
    update public.scholarships
       set status = 'declined', granted_cents = 0, staff_note = v_note,
           reviewed_by = auth.uid(), reviewed_at = now()
     where family_request_id = v_req.id;
    update public.family_scholarship_requests
       set status = 'declined', granted_cents = 0, staff_note = v_note,
           reviewed_by = auth.uid(), reviewed_at = now(),
           needs_review_since = null, needs_review_reason = null
     where id = v_req.id;
    return 0;
  end if;

  -- Award. Shares are worked out on each person's scholarship-free balance,
  -- so clear the old shares first (a re-decision), then split.
  for v_m in
    select s.registration_participant_id as pid, pm.discount_cents, pm.discount_reason
      from public.scholarships s
      join public.participant_money pm on pm.participant_id = s.registration_participant_id
     where s.family_request_id = v_req.id and pm.scholarship_cents > 0
  loop
    perform public.set_participant_adjustments(v_m.pid, 0, v_m.discount_cents, v_m.discount_reason);
  end loop;

  select array_agg(rp.id order by rp.created_at, rp.id),
         array_agg(pm.fee_cents order by rp.created_at, rp.id),
         array_agg(greatest(0, pm.fee_cents - pm.discount_cents - pm.early_discount_cents
                               - pm.family_discount_cents) order by rp.created_at, rp.id)
    into v_ids, v_fees, v_owes
    from public.registration_participants rp
    join public.participant_money pm on pm.participant_id = rp.id
   where rp.registration_id = p_registration_id
     and rp.status <> 'cancelled'
     and pm.fee_cents > 0
     and greatest(0, pm.fee_cents - pm.discount_cents - pm.early_discount_cents
                     - pm.family_discount_cents) > 0;

  if v_ids is null then
    raise exception 'Nobody on this registration has anything left to pay.';
  end if;
  select sum(x) into v_room from unnest(v_owes) x;
  if p_granted_cents > v_room then
    raise exception 'That is more than this family owes. The most you can award is $%.',
      to_char(v_room / 100.0, 'FM999999990.00')
      using errcode = '23514';
  end if;

  v_shares := public.split_by_weight(p_granted_cents, v_fees, v_owes);

  -- People on the request who are not in the split now (removed, or nothing
  -- left to pay) come off it.
  update public.scholarships
     set status = 'withdrawn', granted_cents = 0, family_request_id = null
   where family_request_id = v_req.id
     and not (registration_participant_id = any (v_ids));

  for i in 1..array_length(v_ids, 1) loop
    select pm.discount_cents, pm.discount_reason into v_m
      from public.participant_money pm where pm.participant_id = v_ids[i];
    perform public.set_participant_adjustments(v_ids[i], v_shares[i], v_m.discount_cents, v_m.discount_reason);
    insert into public.scholarships
      (registration_participant_id, requested_cents, granted_cents, status, family_request_id,
       staff_note, reviewed_by, reviewed_at)
    values (v_ids[i], 0, v_shares[i], 'granted', v_req.id, v_note, auth.uid(), now())
    on conflict (registration_participant_id) do update
      set granted_cents = excluded.granted_cents,
          status = 'granted',
          family_request_id = excluded.family_request_id,
          staff_note = excluded.staff_note,
          reviewed_by = excluded.reviewed_by,
          reviewed_at = excluded.reviewed_at;
  end loop;

  update public.family_scholarship_requests
     set status = 'granted', granted_cents = p_granted_cents, staff_note = v_note,
         reviewed_by = auth.uid(), reviewed_at = now(),
         needs_review_since = null, needs_review_reason = null
   where id = v_req.id;

  return p_granted_cents;
end;
$$;
revoke all on function public.decide_family_scholarship(uuid, integer, text) from public, anon;
grant execute on function public.decide_family_scholarship(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Someone added or removed after the award
-- ---------------------------------------------------------------------------
-- Removed (cancelled, or the row deleted): the award total stays and is split
-- again over the others still on it, up to what each owes; the removed
-- person's share comes off. Added (or back from cancelled): no share. Both
-- flag the request for staff. Runs as the owner: whoever removes a person
-- (Registration write) may not hold Payments write, and the money has to
-- follow the people regardless.
create or replace function public.family_scholarship_people_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg      uuid := coalesce(new.registration_id, old.registration_id);
  v_req      public.family_scholarship_requests%rowtype;
  v_name     text;
  v_removed  boolean;
  v_ids      uuid[];
  v_fees     int[];
  v_owes     int[];
  v_shares   int[];
  v_applied  bigint;
  v_reason   text;
  i          int;
begin
  select * into v_req from public.family_scholarship_requests
   where registration_id = v_reg and status = 'granted' for update;
  if not found then return null; end if;

  select btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) into v_name
    from public.people p where p.id = coalesce(new.person_id, old.person_id);
  v_name := coalesce(nullif(v_name, ''), 'Someone');

  v_removed := tg_op = 'DELETE'
            or (tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled');

  if not v_removed then
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status = 'cancelled' and new.status <> 'cancelled') then
      update public.family_scholarship_requests
         set needs_review_since = coalesce(needs_review_since, now()),
             needs_review_reason = concat_ws(' ', needs_review_reason,
               v_name || ' was added after the family scholarship was decided and has no share of it.')
       where id = v_req.id;
    end if;
    return null;
  end if;

  -- The removed person's share comes off them.
  if tg_op = 'UPDATE' then
    update public.participant_money set scholarship_cents = 0, updated_at = now()
     where participant_id = new.id and scholarship_cents > 0;
    update public.scholarships set status = 'withdrawn', granted_cents = 0
     where registration_participant_id = new.id and family_request_id = v_req.id;
  end if;

  perform public.recalc_family_discount(v_reg);

  -- Everyone still covered, on their balance before the scholarship.
  select array_agg(rp.id order by rp.created_at, rp.id),
         array_agg(pm.fee_cents order by rp.created_at, rp.id),
         array_agg(greatest(0, pm.fee_cents - pm.discount_cents - pm.early_discount_cents
                               - pm.family_discount_cents) order by rp.created_at, rp.id)
    into v_ids, v_fees, v_owes
    from public.scholarships s
    join public.registration_participants rp on rp.id = s.registration_participant_id
    join public.participant_money pm on pm.participant_id = rp.id
   where s.family_request_id = v_req.id
     and s.status = 'granted'
     and rp.status <> 'cancelled'
     and (tg_op <> 'DELETE' or rp.id <> old.id);

  v_applied := 0;
  if v_ids is not null then
    -- The cap is fee less the hand-set discount and the automatic discounts
    -- as they stand now. (The automatic ones were already capped around the
    -- old share; recalculating them below settles them around the new one.)
    v_shares := public.split_by_weight(v_req.granted_cents, v_fees, v_owes);
    for i in 1..array_length(v_ids, 1) loop
      update public.participant_money set scholarship_cents = v_shares[i], updated_at = now()
       where participant_id = v_ids[i];
      update public.scholarships set granted_cents = v_shares[i]
       where registration_participant_id = v_ids[i];
      v_applied := v_applied + v_shares[i];
    end loop;
  end if;
  perform public.recalc_family_discount(v_reg);
  perform public.recalc_early_registration_discount(v_reg);

  v_reason := v_name || ' was removed after the family scholarship was decided; their share was spread over the others.';
  if v_applied < v_req.granted_cents then
    v_reason := v_reason || ' $' || to_char((v_req.granted_cents - v_applied) / 100.0, 'FM999999990.00')
             || ' of the award no longer fits what the others owe.';
  end if;
  update public.family_scholarship_requests
     set needs_review_since = coalesce(needs_review_since, now()),
         needs_review_reason = concat_ws(' ', needs_review_reason, v_reason)
   where id = v_req.id;
  return null;
end;
$$;
revoke all on function public.family_scholarship_people_changed() from public, anon, authenticated;

drop trigger if exists registration_participants_family_scholarship on public.registration_participants;
create trigger registration_participants_family_scholarship
  after insert or update of status or delete on public.registration_participants
  for each row execute function public.family_scholarship_people_changed();

-- Post-check: the objects exist and the table has no write policy.
do $$
begin
  if to_regprocedure('public.decide_family_scholarship(uuid, integer, text)') is null
     or to_regprocedure('public.family_request_scholarship(uuid, text, integer, integer, text)') is null then
    raise exception '0159: functions missing';
  end if;
  if exists (select 1 from pg_policies where tablename = 'family_scholarship_requests' and cmd <> 'SELECT') then
    raise exception '0159: family_scholarship_requests has a write policy';
  end if;
  if public.split_by_weight(150000, array[52000, 52000, 26000], array[52000, 52000, 26000]) <> array[52000, 52000, 26000]
     or public.split_by_weight(100, array[1, 1, 1], array[100, 100, 100]) <> array[34, 33, 33]
     or public.split_by_weight(1000, array[100, 100], array[100, 5000]) <> array[100, 900] then
    raise exception '0159: split_by_weight gives wrong shares';
  end if;
end $$;
