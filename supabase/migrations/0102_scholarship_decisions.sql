-- 0102_scholarship_decisions.sql
--
-- Two fixes found by the 18 Oct 2026 review, in one migration:
--   1. scholarship decisions need Registration write as well as Payments write;
--   2. registration_review gets the row filter it never had (see the end).
--
-- Deciding a scholarship is a family act, not a finance act (Access-Model
-- Plan question 13, Lawrence 15 Oct 2026): Registration & coordination
-- writes scholarship requests and decisions; Finance records payments and
-- refunds and only READS scholarships. 0101 mapped every scholarship write to
-- payments write, which the Finance preset holds -- so Finance could grant a
-- scholarship. Found by the document review of 18 Oct 2026.
--
-- The fix needs no eleventh area: the people who decide scholarships are the
-- ones who hold BOTH Payments write and Registration write (Registration &
-- coordination, Administrator); Finance holds Registration read. One helper,
-- used everywhere a scholarship or a hand-set discount is decided:
--   * the scholarships table's staff insert/update;
--   * waive_deposit(), which grants the per-person deposit as a scholarship;
--   * guard_participant_money(), for scholarship_cents / discount_cents /
--     discount_reason on registration_participants (the recalc functions run
--     as definer and are untouched by it).

create or replace function public.can_decide_scholarships()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.has_grant('payments', 'write') and public.has_grant('registration', 'write'); $$;
grant execute on function public.can_decide_scholarships() to authenticated;

alter policy scholarships_insert on public.scholarships
  with check (public.can_decide_scholarships()
              or registration_participant_id in (select public.my_participant_ids()));

alter policy scholarships_update on public.scholarships
  using ((registration_participant_id in (select public.my_participant_ids()))
         or public.can_decide_scholarships())
  with check (public.can_decide_scholarships()
              or ((registration_participant_id in (select public.my_participant_ids()))
                  and status = any (array['requested', 'withdrawn'])
                  and granted_cents = 0));

-- waive_deposit(): the same function, its first check tightened.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.waive_deposit(uuid, text)'::regprocedure);
  if position('public.has_grant(''payments'', ''write'')' in def) = 0 then
    raise exception '0102: waive_deposit no longer has the expected check';
  end if;
  def := replace(def,
    'if not public.has_grant(''payments'', ''write'') then',
    'if not public.can_decide_scholarships() then');
  def := replace(def,
    'Waiving a deposit needs registrar or administrator access.',
    'Waiving a deposit is a scholarship decision: it needs Payments and Registration write.');
  execute def;
  if position('can_decide_scholarships' in pg_get_functiondef('public.waive_deposit(uuid, text)'::regprocedure)) = 0 then
    raise exception '0102: waive_deposit was not rewritten';
  end if;
end;
$$;

-- guard_participant_money(): restated in full (0080's text, as 0101 left it), with one
-- change -- staff with Payments write still pass, except that a scholarship or a
-- hand-set discount also needs Registration write.
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
  if public.has_grant('payments', 'write') then
    if tg_op = 'UPDATE'
       and (new.scholarship_cents is distinct from old.scholarship_cents
            or new.discount_cents is distinct from old.discount_cents
            or new.discount_reason is distinct from old.discount_reason)
       and not public.can_decide_scholarships() then
      raise exception 'Scholarships and discounts are decided by Registration & coordination.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    select eo.fee_cents, eo.participant_role, eo.event_id into v_opt
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
    new.fee_cents             := coalesce(v_opt.fee_cents, 0);
    new.discount_cents        := 0;
    new.discount_reason       := null;
    new.scholarship_cents     := 0;
    new.early_discount_cents  := 0;
    new.family_discount_cents := 0;
    new.created_at            := now();
    return new;
  end if;

  if new.fee_cents             is distinct from old.fee_cents
  or new.discount_cents        is distinct from old.discount_cents
  or new.discount_reason       is distinct from old.discount_reason
  or new.scholarship_cents     is distinct from old.scholarship_cents
  or new.early_discount_cents  is distinct from old.early_discount_cents
  or new.family_discount_cents is distinct from old.family_discount_cents
  or new.event_option_id       is distinct from old.event_option_id
  or new.registration_id       is distinct from old.registration_id
  or new.person_id             is distinct from old.person_id
  or new.created_at            is distinct from old.created_at then
    raise exception 'Fees, discounts and registration dates are set by the ministry, not from a family account.'
      using errcode = '42501';
  end if;

  if new.camp_role is distinct from old.camp_role
     and exists (select 1 from public.event_options eo
                  where eo.id = old.event_option_id and eo.participant_role is not null) then
    raise exception 'That place is for a set role and cannot be changed from a family account.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status in ('submitted', 'cancelled'))
     and not (old.status = 'confirmed' and new.status = 'submitted') then
    raise exception 'Places are cancelled by the ministry. Please use "Request a cancellation".'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- ---- 2. registration_review: a row filter ------------------------------------------
-- Proven 18 Oct 2026: as bot-family-a (one registration of its own) the view
-- returned all 25 rows, including other families' amounts paid and flags.
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
left join creed_no cn on cn.registration_id = r.id
-- 0102: the row filter this view never had. It runs with its owner's rights
-- (it must: reviewers read money and flags across households), so without a
-- filter any signed-in family could read every registration's row. Staff
-- pages only; Registration read is held by every staff preset that uses it.
where public.has_grant('registration', 'read');
