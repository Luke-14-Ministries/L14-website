-- 0091: the background-check VERDICT, who gave it, and a log (Lawrence, 15 Oct 2026).
--
-- How a background check reaches this site today (read with
-- app/admin/volunteers/screening/): a staff member with the Background-checks
-- grant orders a batch in Checkr's own dashboard, later imports Checkr's CSV,
-- and the importer records the report facts. Only a finished report with a
-- "clear" assessment sets background_check_on_file; a "consider" is left for a
-- person to decide. That person decided it by ticking "Paperwork on file" on
-- the volunteer's record -- and nothing recorded who ticked it, when, or what
-- they concluded. Three things, then:
--
--   1. A VERDICT on the record, in the ministry's three words, set by whoever
--      holds the grant (the administrator role today): ok, follow_up,
--      not_permitted. Who and when are stamped by trigger, never by the app.
--   2. The check DATE is required once paperwork is on file, and the expiry
--      follows from it by policy -- one function, clearance_interval_months(),
--      36 months as the importer has assumed since 0057. The board's choice of
--      interval (DO-THIS-NEXT W21) changes that one number.
--   3. An append-only LOG of every change to the fact, the dates, the verdict
--      and Checkr's status, the way staff_access_log (0058) records grant
--      changes. Readable with the grant; written only by trigger.
--
-- And a view, clearance_status, that gives EVERY staff member the three facts
-- a coordinator needs -- on file, current, verdict -- without the verdict
-- words from Checkr, the report ids or the adjudication. The Buddy board and
-- the Volunteers list showed every volunteer as "no check on file" to anyone
-- without the grant, because the table itself is behind it (found 15 Oct).

-- --- 1. The verdict, and the stamps -----------------------------------------

alter table public.person_clearances
  add column if not exists verdict             text,
  add column if not exists verdict_by          uuid references public.profiles(id) on delete set null,
  add column if not exists verdict_at          timestamptz,
  add column if not exists verdict_note        text,
  add column if not exists paperwork_marked_by uuid references public.profiles(id) on delete set null,
  add column if not exists paperwork_marked_at timestamptz;

alter table public.person_clearances
  drop constraint if exists person_clearances_verdict_check;
alter table public.person_clearances
  add constraint person_clearances_verdict_check
  check (verdict is null or verdict in ('ok', 'follow_up', 'not_permitted'));

comment on column public.person_clearances.verdict is
  'The ministry''s decision on the check: ok (may serve), follow_up (a conversation first), not_permitted. Null = not decided. Set only by a holder of the Background-checks grant; verdict_by/verdict_at are stamped by trigger.';
comment on column public.person_clearances.paperwork_marked_by is
  'Who last ticked (or unticked) "paperwork on file", stamped by trigger.';

-- --- 2. The expiry policy, in one place ---------------------------------------

create or replace function public.clearance_interval_months()
returns integer
language sql
immutable
as $$ select 36 $$;

comment on function public.clearance_interval_months() is
  'How long a background check stays current. 36 months (triennial) until the board decides otherwise (DO-THIS-NEXT W21); the importer and the manual record both derive expires_on from it.';

create or replace function public.clearance_review_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.background_check_on_file and new.background_check_date is null then
    raise exception 'A background check marked on file needs its check date.';
  end if;
  -- The expiry follows the date by policy. Recomputed whenever the date
  -- changes or nothing has been set; a date cleared leaves the expiry alone.
  if new.background_check_date is not null
     and (tg_op = 'INSERT'
          or new.background_check_date is distinct from old.background_check_date
          or new.expires_on is null) then
    new.expires_on := new.background_check_date
                      + make_interval(months => public.clearance_interval_months());
  end if;
  if (tg_op = 'INSERT' and new.background_check_on_file)
     or (tg_op = 'UPDATE' and new.background_check_on_file is distinct from old.background_check_on_file) then
    new.paperwork_marked_by := auth.uid();
    new.paperwork_marked_at := now();
  end if;
  if (tg_op = 'INSERT' and new.verdict is not null)
     or (tg_op = 'UPDATE' and new.verdict is distinct from old.verdict) then
    new.verdict_by := auth.uid();
    new.verdict_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists person_clearances_review_stamp on public.person_clearances;
create trigger person_clearances_review_stamp
  before insert or update on public.person_clearances
  for each row execute function public.clearance_review_stamp();

-- --- 3. The log ----------------------------------------------------------------

create table if not exists public.clearance_review_log (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people(id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index if not exists clearance_review_log_person_idx
  on public.clearance_review_log (person_id, changed_at desc);

alter table public.clearance_review_log enable row level security;

-- Read with the grant; no insert, update or delete policy for anyone -- the
-- trigger below writes as definer, and nobody edits history.
drop policy if exists clearance_review_log_read on public.clearance_review_log;
create policy clearance_review_log_read on public.clearance_review_log
  for select to authenticated
  using (public.can_view_background_checks());

grant select on public.clearance_review_log to authenticated;

comment on table public.clearance_review_log is
  'Every change to a background-check record that matters: on file, the dates, the verdict and its note, Checkr''s status and adjudication. Append-only by trigger. Readable with the Background-checks grant.';

create or replace function public.log_clearance_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  o jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n jsonb := to_jsonb(new);
begin
  foreach f in array array['background_check_on_file', 'background_check_date', 'expires_on',
                           'verdict', 'verdict_note', 'checkr_status', 'adjudication'] loop
    if (o ->> f) is distinct from (n ->> f) then
      insert into public.clearance_review_log (person_id, field, old_value, new_value, changed_by)
      values (new.person_id, f, o ->> f, n ->> f, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists person_clearances_logged on public.person_clearances;
create trigger person_clearances_logged
  after insert or update on public.person_clearances
  for each row execute function public.log_clearance_change();

-- --- 4. What every staff member may know ---------------------------------------
--
-- SECURITY DEFINER by design, like program_roster (0061, DECISIONS 30 Aug):
-- the table underneath is readable only with the grant, and this view's own
-- WHERE is the row filter. Three facts and a date; nothing Checkr said.

create or replace view public.clearance_status as
select c.person_id,
       c.background_check_on_file                                    as on_file,
       c.background_check_date                                       as check_date,
       c.expires_on,
       (c.background_check_on_file
        and (c.expires_on is null or c.expires_on >= current_date))  as is_current,
       c.verdict
  from public.person_clearances c
 where public.is_staff();

grant select on public.clearance_status to authenticated;

comment on view public.clearance_status is
  'For any staff member: whether a person''s background check is on file, current, and what the ministry decided (ok / follow_up / not_permitted). Definer view over person_clearances; its WHERE is the row filter. Nothing from the report itself.';
