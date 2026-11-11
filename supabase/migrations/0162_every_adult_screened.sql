-- 0162 -- Every adult is screened; "Not permitted" holds approval (11 Nov 2026)
--
-- Lawrence, relayed 11 Nov 2026, extending 0161: "everyone 18+ registered
-- needs to be covered by one of the background check options".
--
--   * Volunteers: unchanged -- the full Checkr check and the 0152 gate.
--   * Every other role (camper, parent/guardian, sibling, caregiver,
--     childcare, support team, and any later non-volunteer role): a current,
--     clear sex-offender registry search, or a current full check.
--   * Under 18 on the event's FIRST DAY: not screened (one age rule, the
--     Review card's; the server used to ask "18 today", which refused
--     someone who turns 18 before camp).
--
-- What this migration adds:
--
--   1. record_registry_search() -- the one way a registry search is
--      recorded, with the rules in the database: the background-checks write
--      grant, a non-cancelled place at an upcoming event where the person is
--      18 or older on its first day, no volunteer place at an upcoming event,
--      and never over a full check that is on file and current. The page
--      used to write person_clearances directly and checked the rules itself.
--   2. "Not permitted" holds approval. A person whose check or registry
--      search is marked not_permitted cannot be confirmed, from any button
--      (a guard on the place, like 0152). follow_up and a missing search stay
--      warnings, never a hold.
--   3. A Checkr order never erases "Not permitted". 0161's
--      registry_search_not_carried() cleared the verdict when a registry row
--      became a Checkr order; it now refuses any new order for someone marked
--      not_permitted (and still clears a clear registry search's facts).
--
-- No notice goes to the family about a registry search: it is a search of a
-- public registry (Lawrence's call; DECISIONS 11 Nov 2026).

-- ---------------------------------------------------------------------------
-- 1. Recording a registry search
-- ---------------------------------------------------------------------------
create or replace function public.record_registry_search(
  p_person_id uuid,
  p_date      date,
  p_result    text,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_dob   date;
  v_any   boolean;
  v_vol   boolean;
  v_adult boolean;
  v_full  boolean;
begin
  if not public.has_grant('background_checks', 'write') then
    raise exception 'Recording a registry search needs the background checks grant.' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Give the date you searched the registry.' using errcode = '23514';
  end if;
  if p_date > v_today then
    raise exception 'The search date can''t be in the future.' using errcode = '23514';
  end if;
  if p_result is null or p_result not in ('ok', 'follow_up', 'not_permitted') then
    raise exception 'Choose what the search found.' using errcode = '23514';
  end if;
  if p_result <> 'ok' and v_note is null then
    raise exception 'Add a note saying what was found, so whoever follows up knows.' using errcode = '23514';
  end if;

  select p.date_of_birth into v_dob from public.people p where p.id = p_person_id;

  -- Their places at upcoming, unarchived events.
  select count(*) > 0,
         coalesce(bool_or(rp.camp_role in ('volunteer', 'volunteer_child')), false),
         -- 18 or older on the event's first day; an unknown birth date is
         -- treated as an adult, as the volunteer gate does.
         coalesce(bool_or(rp.camp_role not in ('volunteer', 'volunteer_child')
                          and (v_dob is null or v_dob <= (e.starts_on - interval '18 years')::date)), false)
    into v_any, v_vol, v_adult
    from public.registration_participants rp
    join public.registrations r on r.id = rp.registration_id
    join public.events e on e.id = r.event_id
   where rp.person_id = p_person_id
     and rp.status <> 'cancelled'
     and e.ends_on >= v_today
     and e.archived_at is null;

  if not v_any then
    raise exception 'They have no place at an upcoming event.' using errcode = '23514';
  end if;
  if v_vol then
    raise exception 'They volunteer at an upcoming event, so they need the full background check, not a registry search.'
      using errcode = '23514';
  end if;
  if not v_adult then
    raise exception 'They are under 18 on the first day of camp, so they are not screened.' using errcode = '23514';
  end if;

  select c.provider is distinct from 'registry_search'
         and c.background_check_on_file
         and (c.expires_on is null or c.expires_on >= v_today)
    into v_full
    from public.person_clearances c where c.person_id = p_person_id;
  if coalesce(v_full, false) then
    raise exception 'A full background check is on file and current; it already covers them.' using errcode = '23514';
  end if;

  insert into public.person_clearances
    (person_id, provider, screening_reason, background_check_on_file, background_check_date,
     expires_on, verdict, verdict_note, recorded_by)
  values (p_person_id, 'registry_search', 'adult_participant', true, p_date,
          null, p_result, v_note, auth.uid())
  on conflict (person_id) do update
    set provider                 = excluded.provider,
        screening_reason         = excluded.screening_reason,
        background_check_on_file = true,
        background_check_date    = excluded.background_check_date,
        -- Null, so the review-stamp trigger works it out from the date (0158).
        expires_on               = null,
        verdict                  = excluded.verdict,
        verdict_note             = excluded.verdict_note,
        recorded_by              = excluded.recorded_by;
end;
$$;

revoke all on function public.record_registry_search(uuid, date, text, text) from public, anon;
grant execute on function public.record_registry_search(uuid, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. "Not permitted" holds approval, for every role
-- ---------------------------------------------------------------------------
-- Definer: the staff member approving may not read person_clearances. Yes or
-- no only. Not permitted does not expire: it stands until staff change it.
create or replace function public.person_not_permitted(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.person_clearances c
     where c.person_id = p_person_id and c.verdict = 'not_permitted'
  );
$$;

revoke all on function public.person_not_permitted(uuid) from public, anon;
grant execute on function public.person_not_permitted(uuid) to authenticated;

-- Invoker, like 0152's guards (CLAUDE.md: a definer trigger cannot tell who
-- is calling). It fires on the change TO confirmed only.
create or replace function public.guard_not_permitted_place()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.status = 'confirmed'
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed')
     and public.person_not_permitted(new.person_id) then
    select coalesce(nullif(btrim(coalesce(p.preferred_name, p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'This person')
      into v_name from public.people p where p.id = new.person_id;
    raise exception '% can''t be approved: their background check or registry search is marked Not permitted to attend.',
      coalesce(v_name, 'This person')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists registration_participants_not_permitted on public.registration_participants;
create trigger registration_participants_not_permitted
  before insert or update of status on public.registration_participants
  for each row execute function public.guard_not_permitted_place();

-- ---------------------------------------------------------------------------
-- 3. A Checkr order never erases "Not permitted"
-- ---------------------------------------------------------------------------
-- 0161's function restated in full. markBatchOrdered() upserts provider,
-- checkr_status and the order stamps (ordered_at). A NEW order -- a switch to
-- Checkr, or a fresh ordered_at -- for someone marked not_permitted is
-- refused. A clear registry search switched to a Checkr order still sheds its
-- facts, as in 0161, so it cannot read as a passed Checkr check.
create or replace function public.registry_search_not_carried()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.provider = 'checkr'
     and old.verdict = 'not_permitted'
     and (old.provider is distinct from 'checkr' or new.ordered_at is distinct from old.ordered_at) then
    select coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'This person')
      into v_name from public.people p where p.id = new.person_id;
    raise exception '% is marked Not permitted to attend, so a Checkr order isn''t sent for them.', coalesce(v_name, 'This person')
      using errcode = 'P0001';
  end if;
  if old.provider = 'registry_search' and new.provider = 'checkr' then
    new.background_check_on_file := false;
    new.background_check_date := null;
    new.expires_on := null;
    new.verdict := null;
    new.verdict_note := null;
  end if;
  return new;
end;
$$;

-- Now also on ordered_at, so a re-order of someone already with Checkr is
-- caught. Name unchanged: it fires before person_clearances_review_stamp.
drop trigger if exists person_clearances_registry_not_carried on public.person_clearances;
create trigger person_clearances_registry_not_carried
  before update of provider, ordered_at on public.person_clearances
  for each row execute function public.registry_search_not_carried();

comment on view public.clearance_status is
  'For any staff member: whether a person''s background check is on file, current, what the ministry decided (ok / follow_up / not_permitted), and how it was checked (provider: checkr / manual = a full check; registry_search = a sex-offender registry search, which covers every adult who is not a volunteer and never clears a volunteer, 0161/0162). Definer view over person_clearances; its WHERE is the row filter. Nothing from the report itself.';

-- Self-checks.
do $$
begin
  if to_regprocedure('public.record_registry_search(uuid, date, text, text)') is null then
    raise exception '0162: record_registry_search missing';
  end if;
  if position('ordered_at' in pg_get_functiondef('public.registry_search_not_carried()'::regprocedure)) = 0 then
    raise exception '0162: registry_search_not_carried not restated';
  end if;
end $$;
