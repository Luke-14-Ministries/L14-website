-- 0161 -- Adult campers are screened by a registry search (10 Nov 2026)
--
-- Lawrence, 10 Nov 2026: campers 18 or older need a background check too, and
-- for campers a search of the public sex-offender registry (NSOPW) is enough.
-- That is the route 0056 laid the groundwork for and left undecided:
-- provider = 'registry_search', screening_reason = 'adult_participant'. A staff
-- member searches nsopw.gov by hand and records the date and the result. No
-- SSN, no Checkr, no consumer report, so the FCRA permissible-purpose question
-- 0056 raised never arises.
--
-- For a camper it is a FLAG on the Review card, never a block on approval
-- (Lawrence, 10 Nov 2026). That lives in the site; nothing here holds a camper.
--
-- What this migration does is keep the two routes apart. person_clearances is
-- ONE row per person, and until now every reader asked only "on file, current,
-- OK?". A registry search is not a full background check, so:
--
--   1. volunteer_clearance_ok() -- the volunteer approval gate (0152) -- no
--      longer accepts a registry search. A camper who later volunteers needs
--      the Checkr check like anyone else.
--   2. clearance_status gains `provider` (appended, so CREATE OR REPLACE keeps
--      every existing column), so every staff page can tell the two apart.
--   3. A registry row switched to a Checkr order sheds the registry's facts.
--      markBatchOrdered() upserts provider = 'checkr' and the invitation
--      columns only; without this, the registry search's "on file, dated,
--      OK" would carry over and read as a passed Checkr check before Checkr
--      had said anything.
--
-- Expiry: a registry search expires like any check, after
-- clearance_interval_months() (12 = annual), so it is repeated each year.

-- 1. The volunteer gate. Restated in full from 0152; the only change is the
--    provider line.
create or replace function public.volunteer_clearance_ok(p_person_id uuid, p_on date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      (select p.date_of_birth is not null
              and p.date_of_birth > (coalesce(p_on, current_date) - interval '18 years')::date
         from public.people p where p.id = p_person_id),
      false)
    or exists (
      select 1 from public.person_clearances c
       where c.person_id = p_person_id
         and c.background_check_on_file
         and (c.expires_on is null or c.expires_on >= current_date)
         and c.verdict = 'ok'
         and c.provider is distinct from 'registry_search'
    );
$$;

revoke all on function public.volunteer_clearance_ok(uuid, date) from public, anon;
grant execute on function public.volunteer_clearance_ok(uuid, date) to authenticated;

-- 2. What every staff member may know, now with how it was checked.
--    Restated from 0091; `provider` is appended. Still definer, still its own
--    row filter (program_roster's pattern, DECISIONS 30 Aug).
create or replace view public.clearance_status as
select c.person_id,
       c.background_check_on_file                                    as on_file,
       c.background_check_date                                       as check_date,
       c.expires_on,
       (c.background_check_on_file
        and (c.expires_on is null or c.expires_on >= current_date))  as is_current,
       c.verdict,
       c.provider
  from public.person_clearances c
 where public.is_staff();

grant select on public.clearance_status to authenticated;

comment on view public.clearance_status is
  'For any staff member: whether a person''s background check is on file, current, what the ministry decided (ok / follow_up / not_permitted), and how it was checked (provider: checkr / manual = a full check; registry_search = an adult camper''s sex-offender registry search, which does not clear a volunteer, 0161). Definer view over person_clearances; its WHERE is the row filter. Nothing from the report itself.';

-- 3. A registry search never carries into a Checkr order.
create or replace function public.registry_search_not_carried()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

-- Named to fire before person_clearances_review_stamp (BEFORE triggers run in
-- name order), so the stamp sees the cleared verdict and records who and when.
drop trigger if exists person_clearances_registry_not_carried on public.person_clearances;
create trigger person_clearances_registry_not_carried
  before update of provider on public.person_clearances
  for each row execute function public.registry_search_not_carried();

comment on column public.person_clearances.provider is
  'checkr = FCRA consumer report via the hosted invitation, used for volunteers. registry_search = a staff member searched the free public NSOPW for an adult camper (0161); NOT a consumer report and NOT a full check, so it never clears a volunteer. manual = a full check recorded from paper.';

-- Self-check: the gate refuses a registry search.
do $$
begin
  if position('registry_search' in pg_get_functiondef('public.volunteer_clearance_ok(uuid, date)'::regprocedure)) = 0 then
    raise exception '0161: volunteer_clearance_ok() should refuse a registry search';
  end if;
end;
$$;
