-- 0154 -- The weeks of one camp are paired by name AND year (4 Nov 2026)
--
-- Lawrence, 4 Nov 2026 ("yes, do the name/year fix"): the weeks of one camp
-- were found by the part of the name before " — " alone. Today's names carry
-- the year ("Camp Celebrate 2027 — Week 1"), so nothing is wrong yet; but if
-- the year ever left the names, a volunteer at one year's Week 2 and the next
-- year's Week 1 would read as "both weeks" and be given the discount.
--
-- The pairing is now the name before " — " AND the calendar year the week
-- starts in. recalc_multi_week_discount() is restated in full below with that
-- key; the only change is the `program` column. The site's own pairings (the
-- public camp facts, the register chooser, Setup's later weeks, the Ways to
-- pay note) use campKey() in lib/events.js, the same rule.

create or replace function public.recalc_multi_week_discount(p_person_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_require_vol_both   constant bool := true;
  c_require_confirmed  constant bool := true;
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
        -- 0154: one camp = the name before " — " and the year it starts.
        btrim(split_part(e.name, ' — ', 1)) || '|' || coalesce(extract(year from e.starts_on)::text, '') as program
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
$function$;

do $$
begin
  if position('extract(year from e.starts_on)' in pg_get_functiondef('public.recalc_multi_week_discount'::regproc)) = 0 then
    raise exception '0154: recalc_multi_week_discount was not restated';
  end if;
end;
$$;
