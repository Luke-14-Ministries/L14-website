-- 0096: the balance-due date, the two discounts and a waived deposit all live
-- on the EVENT, as settings (Lawrence and Larry, 16 Oct 2026; build plan
-- items 3, 4 and 5).
--
-- Until now the due date was a rule in two places (balance_due_on() here and
-- balanceDueOn() in lib/events.js: fourteen days before a camp week), the
-- family discount was two constants inside recalc_family_discount() ($50 from
-- the 3rd person), and the both-weeks volunteer discount a constant inside
-- recalc_multi_week_discount() (50%). Larry's 2027 numbers are still being
-- worked out, the family discount is "probably bigger than $50", and the
-- balance is now due JULY 1 for both weeks -- a published date, not an
-- enforced one. None of that should wait on a code change again, so each is a
-- column an administrator edits on Setup, with the same recalc functions
-- reading the column instead of the constant.
--
-- And the deposit: a family submits without it, approval waits on it, and a
-- registrar may WAIVE it -- Larry's "we can grant you a $50 scholarship and
-- that goes towards the deposit". waive_deposit() records the waiver on the
-- registration and grants each fee-bearing person a scholarship of the
-- per-person deposit; registration_review then treats the registration as
-- deposit-received and never flags it short.

-- --- 1. Event settings ---------------------------------------------------------

alter table public.events
  add column if not exists balance_due_on              date,
  add column if not exists family_discount_cents       integer not null default 5000
    check (family_discount_cents >= 0),
  add column if not exists family_discount_from_person integer not null default 3
    check (family_discount_from_person >= 2),
  add column if not exists multi_week_discount_percent integer not null default 50
    check (multi_week_discount_percent between 0 and 100);

comment on column public.events.balance_due_on is
  'The published balance-due date for this event; null = "staff will be in touch". July 1 for the camp weeks (Larry, 16 Oct 2026). Edited on Setup.';
comment on column public.events.family_discount_cents is
  'Per-person discount for the Nth and later fee-bearing person on one registration (N = family_discount_from_person). Read by recalc_family_discount().';
comment on column public.events.multi_week_discount_percent is
  'Percent off the LATER week for a volunteer doing both weeks of this program. Read by recalc_multi_week_discount() from the later event.';

-- The camp weeks on file: July 1 of their year. Other events keep null.
update public.events
   set balance_due_on = make_date(extract(year from starts_on)::int, 7, 1)
 where event_type = 'camp_week' and balance_due_on is null;

-- The due date is the column now. Same signature, same callers.
create or replace function public.balance_due_on(p_event_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select e.balance_due_on from public.events e where e.id = p_event_id;
$$;

-- --- 2. The family discount reads its event ------------------------------------

create or replace function public.recalc_family_discount(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_from_person  int;
  c_amount_cents int;
begin
  if p_registration_id is null then return; end if;

  select e.family_discount_from_person, e.family_discount_cents
    into c_from_person, c_amount_cents
    from public.registrations r
    join public.events e on e.id = r.event_id
   where r.id = p_registration_id;
  if c_from_person is null then return; end if;

  update public.registration_participants
     set family_discount_cents = 0
   where registration_id = p_registration_id
     and family_discount_cents <> 0;

  if c_amount_cents <= 0 then return; end if;

  with people_in_order as (
    select distinct on (rp.person_id)
           rp.id, rp.person_id, rp.created_at,
           greatest(0, rp.fee_cents - rp.discount_cents - rp.scholarship_cents
                       - rp.early_discount_cents) as owes
      from public.registration_participants rp
     where rp.registration_id = p_registration_id
       and rp.status <> 'cancelled'
       and rp.fee_cents > 0
     order by rp.person_id, rp.fee_cents desc, rp.created_at, rp.id
  ),
  ranked as (
    select id, owes, row_number() over (order by created_at, id) as n
      from people_in_order
  )
  update public.registration_participants rp
     set family_discount_cents = least(c_amount_cents, r.owes)
    from ranked r
   where rp.id = r.id
     and r.n >= c_from_person;
end;
$$;

-- --- 3. The both-weeks discount reads the later event ---------------------------

create or replace function public.recalc_multi_week_discount(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_require_vol_both   constant bool := true;
  c_reason             constant text := 'Both weeks';
  r record;
begin
  if p_person_id is null then return; end if;

  update public.registration_participants rp
     set discount_cents = 0,
         discount_reason = null
   where rp.person_id = p_person_id
     and rp.discount_reason like c_reason || '%';

  for r in
    with live as (
      select
        rp.id,
        rp.camp_role,
        rp.fee_cents,
        e.id                                       as event_id,
        e.starts_on,
        e.multi_week_discount_percent              as pct,
        btrim(split_part(e.name, ' — ', 1))        as program
      from public.registration_participants rp
      join public.registrations r2 on r2.id = rp.registration_id
      join public.events e         on e.id  = r2.event_id
      where rp.person_id = p_person_id
        and rp.status <> 'cancelled'
    ),
    grouped as (
      select
        program,
        count(distinct event_id)                                  as weeks,
        count(*) filter (where camp_role = 'volunteer')           as volunteer_rows,
        count(distinct event_id) filter (where camp_role = 'volunteer') as volunteer_weeks
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
      and l.id = (
        select l2.id
        from live l2
        where l2.program = l.program
          and l2.fee_cents > 0
        order by l2.starts_on desc, l2.event_id desc, l2.id desc
        limit 1
      )
  loop
    update public.registration_participants
       set discount_cents  = round(r.fee_cents * r.pct / 100.0),
           discount_reason = c_reason || ' (' || r.pct || '% off the later week)'
     where id = r.id;
  end loop;
end;
$$;

-- Re-run both for everyone on an event, after its settings change (Setup).
create or replace function public.recalc_event_discounts(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  rec record;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can re-run an event''s discounts.';
  end if;
  for rec in select r.id from public.registrations r where r.event_id = p_event_id loop
    perform public.recalc_family_discount(rec.id);
    perform public.recalc_early_registration_discount(rec.id);
    n := n + 1;
  end loop;
  for rec in
    select distinct rp.person_id
      from public.registration_participants rp
      join public.registrations r on r.id = rp.registration_id
     where r.event_id = p_event_id
  loop
    perform public.recalc_multi_week_discount(rec.person_id);
  end loop;
  return n;
end;
$$;
revoke all on function public.recalc_event_discounts(uuid) from public;
grant execute on function public.recalc_event_discounts(uuid) to authenticated;

-- --- 4. A waived deposit ------------------------------------------------------------

alter table public.registrations
  add column if not exists deposit_waived_at     timestamptz,
  add column if not exists deposit_waived_by     uuid references public.profiles(id) on delete set null,
  add column if not exists deposit_waived_reason text;

comment on column public.registrations.deposit_waived_at is
  'Set by waive_deposit(): a registrar decided the deposit is not required of this family. Review treats the registration as deposit-received.';

-- Only a registrar moves these three (the family may update its own row).
create or replace function public.guard_deposit_waiver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.deposit_waived_at     is distinct from old.deposit_waived_at
      or new.deposit_waived_by  is distinct from old.deposit_waived_by
      or new.deposit_waived_reason is distinct from old.deposit_waived_reason)
     and not public.is_registrar() then
    raise exception 'Only a registrar can waive a deposit.';
  end if;
  return new;
end;
$$;

drop trigger if exists registrations_guard_deposit_waiver on public.registrations;
create trigger registrations_guard_deposit_waiver
  before update on public.registrations
  for each row execute function public.guard_deposit_waiver();

-- The waiver itself: the mark, plus a scholarship of the per-person deposit
-- for each fee-bearing person who does not already hold at least that much.
create or replace function public.waive_deposit(p_registration_id uuid, p_reason text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit integer;
  n integer := 0;
  rec record;
  v_note text;
begin
  if not public.is_registrar() then
    raise exception 'Waiving a deposit needs registrar or administrator access.';
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
    select rp.id, rp.fee_cents, rp.scholarship_cents
      from public.registration_participants rp
     where rp.registration_id = p_registration_id
       and rp.status <> 'cancelled'
       and rp.fee_cents > 0
       and rp.scholarship_cents < least(v_deposit, rp.fee_cents)
  loop
    update public.registration_participants
       set scholarship_cents = least(v_deposit, rec.fee_cents)
     where id = rec.id;
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
$$;
revoke all on function public.waive_deposit(uuid, text) from public;
grant execute on function public.waive_deposit(uuid, text) to authenticated;

-- --- 5. Review treats a waived deposit as received ---------------------------------

create or replace view public.registration_review
with (security_invoker = on)
as
with live as (
  select rp.registration_id, rp.id, rp.person_id, rp.camp_role, rp.fee_cents,
         greatest(0, rp.fee_cents - rp.discount_cents - rp.early_discount_cents
                     - rp.family_discount_cents) as owes
    from public.registration_participants rp
   where rp.status <> 'cancelled'
),
heads as (
  select registration_id, count(distinct person_id) filter (where fee_cents > 0) as fee_people
    from live group by registration_id
),
confirmed as (
  select pm.registration_id,
         sum(pm.amount_cents) - coalesce((select sum(pr.amount_cents) from public.payment_refunds pr
                                           where pr.registration_id = pm.registration_id
                                             and pr.status = 'succeeded'), 0) as cents
    from public.payments pm
   where pm.status = 'succeeded'
   group by pm.registration_id
),
sch as (
  select l.registration_id,
         sum(l.owes) as owes,
         sum(case when s.id is null then 0
                  else least(l.owes, coalesce(s.requested_cents, l.owes)) end) as requested
    from live l
    left join public.scholarships s
      on s.registration_participant_id = l.id and s.status in ('requested', 'granted')
   where l.fee_cents > 0
   group by l.registration_id
),
media_no as (
  select l.registration_id, count(distinct l.person_id) as n
    from live l
    join lateral (
      select pc.granted from public.person_consents pc
       where pc.person_id = l.person_id and pc.kind = 'media'
       order by pc.recorded_at desc limit 1
    ) m on true
   where m.granted = false
   group by l.registration_id
),
creed_no as (
  select l.registration_id, count(*) as n
    from live l
    left join public.volunteer_applications va on va.registration_participant_id = l.id
   where l.camp_role = 'volunteer'
     and coalesce(va.creed_affirmed, false) = false
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
         case when r.deposit_waived_at is null
               and coalesce(c.cents, 0) > 0
               and coalesce(c.cents, 0) < coalesce(e.deposit_cents, 0) * coalesce(h.fee_people, 0)
              then 'deposit_short' end,
         case when r.deposit_waived_at is not null then 'deposit_waived' end,
         case when coalesce(mn.n, 0) > 0 then 'media_declined' end,
         case when coalesce(cn.n, 0) > 0 then 'creed_not_affirmed' end
       ], null) as flags
  from public.registrations r
  join public.events e on e.id = r.event_id
  left join heads h on h.registration_id = r.id
  left join confirmed c on c.registration_id = r.id
  left join sch s on s.registration_id = r.id
  left join media_no mn on mn.registration_id = r.id
  left join creed_no cn on cn.registration_id = r.id;

grant select on public.registration_review to authenticated, service_role;
