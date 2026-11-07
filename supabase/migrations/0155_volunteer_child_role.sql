-- 0155 -- A new role: Volunteer child (under 16) (6 Nov 2026)
--
-- Lawrence, 6 Nov 2026: a child under 16 who serves alongside the volunteers,
-- usually with a volunteering parent -- not a camper. Treated like a volunteer
-- minus the adult parts: on the volunteer lists, lodged with staff, asked the
-- volunteer application, the same fee as everyone. No background check: under
-- 18 at the start of the event is not screened (volunteer_clearance_ok(),
-- 0152), so the approval gate does not hold them.
--
-- The new value is 'volunteer_child'. Everywhere the database singled out
-- 'volunteer' it now reads camp_role in ('volunteer', 'volunteer_child'):
--   * the two role checks (participants, and event options for symmetry);
--   * guard_volunteer_place() and the volunteer_sync trigger (0152): the place
--     and the application stay one decision; the background check gate still
--     exempts anyone under 18, so a volunteer child is never held by it;
--   * NOT the Creed. Lawrence, 6 Nov 2026: a volunteer child is not asked
--     faith, the Creed or where they would like to serve (first time, home
--     church, skills and experience stay). creed_status, registration_review's
--     creed flag and mark_creed_discussed() keep reading 'volunteer' alone, so
--     a child's application never raises "Creed not affirmed".
--   * recalc_multi_week_discount() (0070/0154): "volunteering at both weeks"
--     counts a volunteer child's weeks as volunteer weeks.
--
-- The age checks (16 or older in this role, a Volunteer under 16, a volunteer
-- child with no adult volunteer or parent from the household on the event)
-- are FLAGS on the staff pages, never a block, so they live in the site
-- (roleAgeFlags() in lib/roles.js), not here.
--
-- Every function and view is restated in full from the live definition; the
-- only change in each is the role test.
--
-- Also (Lawrence, same day): adults may now pick Translation among the places
-- they would like to serve, which asks the languages they speak. Stored as the
-- person typed it, beside preferred_areas.

alter table public.volunteer_applications
  add column languages text check (languages is null or char_length(languages) <= 300);
comment on column public.volunteer_applications.languages is
  'Languages the volunteer speaks, asked when they pick Translation (0155). Free text as typed.';

alter table public.registration_participants
  drop constraint registration_participants_camp_role_check;
alter table public.registration_participants
  add constraint registration_participants_camp_role_check
  check (camp_role in ('camper', 'parent_guardian', 'sibling', 'caregiver', 'volunteer',
                       'volunteer_child', 'childcare', 'support_team'));

alter table public.event_options
  drop constraint event_options_participant_role_check;
alter table public.event_options
  add constraint event_options_participant_role_check
  check (participant_role is null or
         participant_role in ('camper', 'parent_guardian', 'sibling', 'caregiver', 'volunteer',
                              'volunteer_child', 'childcare', 'support_team'));

create or replace function public.guard_volunteer_place()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_on date;
begin
  if new.status = 'confirmed' and new.camp_role in ('volunteer', 'volunteer_child')
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed'
          or old.camp_role not in ('volunteer', 'volunteer_child')) then
    select e.starts_on into v_on
      from public.registrations r join public.events e on e.id = r.event_id
     where r.id = new.registration_id;
    if not public.volunteer_clearance_ok(new.person_id, v_on) then
      raise exception '%', coalesce(public.volunteer_not_cleared_message(new.person_id), 'This volunteer cannot be approved yet.')
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger registration_participants_volunteer_sync on public.registration_participants;
create trigger registration_participants_volunteer_sync
  after update of status on public.registration_participants
  for each row
  when (new.status = 'confirmed' and old.status is distinct from 'confirmed'
        and new.camp_role in ('volunteer', 'volunteer_child'))
  execute function public.sync_volunteer_application();

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
        -- 0155: a volunteer child volunteers too.
        count(*) filter (where camp_role in ('volunteer', 'volunteer_child')
                           and (not c_require_confirmed or status = 'confirmed')) as volunteer_rows,
        count(distinct event_id) filter (where camp_role in ('volunteer', 'volunteer_child')
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
