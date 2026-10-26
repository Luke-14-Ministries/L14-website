-- 0128_participant_status_reason.sql
--
-- Who changed a person's status, when, and -- for the waitlist -- why
-- (Lawrence, 26 Oct 2026). On a test registration a camper was granted a
-- larger scholarship and then waitlisted; the Review card afterwards said
-- "nobody waiting" and "No review needed yet", and nothing on the page said
-- the family had been waitlisted, by whom or why: "not obvious they were
-- waitlisted or why". Until now nothing recorded any of it -- confirmed_at
-- and submitted_at are lifecycle markers, and the waitlist had none.
--
-- 1. registration_participants gains
--      status_changed_at  when the status last changed (or the row was made);
--      status_changed_by  whose request changed it (auth.uid(); null for a
--                         server-side caller such as a webhook);
--      waitlist_reason    why staff waitlisted this person, 1-500 characters,
--                         only while the status is 'waitlisted'.
--    The family reads every column of its own participant rows (RLS is per
--    row, CLAUDE.md), so THE FAMILY CAN SEE THE REASON. That is accepted:
--    their dashboard shows it, and the staff form says so before it is
--    written. Grants are unchanged -- 0001 granted the table, and new
--    columns inherit a table grant.
--
-- 2. stamp_participant_status(), a BEFORE INSERT OR UPDATE trigger, INVOKER
--    on purpose (CLAUDE.md: a definer trigger sees its owner as
--    current_user; same shape as 0126's guard_awaiting_family()):
--      * the stamps belong to the trigger. Whenever the status changes they
--        become now() and auth.uid(), whatever the statement said. While the
--        status stays put, a signed-in caller (authenticated / anon) -- staff
--        included -- cannot move them: they keep their old values. Only a
--        server-side caller (current_user is a definer function's owner, or
--        service_role, or the SQL editor) may write them directly, for a
--        repair or a backfill.
--      * on INSERT a signed-in caller without Registration write (a family)
--        gets no stamps and no reason; staff and server-side inserts are
--        stamped, since creating the row set its status.
--      * waitlist_reason: a signed-in caller without Registration write
--        cannot set or change it (refused on UPDATE, nulled on INSERT); a
--        blank reason is stored as null; and it is cleared whenever the
--        status is anything but 'waitlisted' -- moving a person off the
--        waitlist (approve, a hold, a cancellation) drops the old reason.
--    Named registration_participants_zz_status_stamp so it fires LAST of the
--    BEFORE triggers on the table (they fire in name order): after
--    registration_participants_guard_money (0114, which refuses a family's
--    status moves) and registration_participants_zy_family_status (0113,
--    which resets a family's new row to draft/submitted), so it stamps the
--    status that will actually be stored.
--
-- 3. log_family_change() (0013/0097) is NOT redefined: on this table it
--    tracks only what a family edits (camp_role, tshirt_size,
--    first_time_attending). A status is staff's decision, and these columns
--    are now its record.
--
-- Not applied to the production project; the lead applies. The app reads the
-- new columns, so this runs before the deploy that uses them.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
alter table public.registration_participants
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references public.profiles(id) on delete set null,
  add column waitlist_reason   text;

alter table public.registration_participants
  add constraint registration_participants_waitlist_reason_length
    check (waitlist_reason is null or char_length(waitlist_reason) between 1 and 500),
  add constraint registration_participants_waitlist_reason_only_waitlisted
    check (waitlist_reason is null or status = 'waitlisted');

comment on column public.registration_participants.status_changed_at is
  'When the status last changed (or the row was created by staff or the server). Set only by the stamp_participant_status() trigger (0128). Null on rows from before 0128 and on a family''s own new rows.';
comment on column public.registration_participants.status_changed_by is
  'The profile whose request last changed the status (auth.uid()); null for a server-side caller. Set only by the stamp_participant_status() trigger (0128).';
comment on column public.registration_participants.waitlist_reason is
  'Why staff waitlisted this person (Registration write; 1-500 characters). The FAMILY READS IT on their dashboard. Cleared whenever the status is not waitlisted (0128).';

-- ---------------------------------------------------------------------------
-- 2. The trigger
-- ---------------------------------------------------------------------------
create or replace function public.stamp_participant_status()
-- Runs with the CALLER's rights on purpose: inside a definer function
-- current_user is the owner, and the "is this a signed-in caller?" test must
-- step aside for the definer functions that move a status (they check the
-- caller themselves) -- and must NOT step aside for a family's own request.
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_signed_in boolean := current_user in ('authenticated', 'anon');
  v_registrar boolean := false;
begin
  if v_signed_in then
    v_registrar := public.has_grant('registration', 'write');
  end if;

  -- The reason: Registration write, or a server-side caller.
  if v_signed_in and not v_registrar then
    if tg_op = 'INSERT' then
      new.waitlist_reason := null;
    elsif new.waitlist_reason is distinct from old.waitlist_reason then
      raise exception 'Only staff with Registration write can record why someone is waitlisted.'
        using errcode = '42501';
    end if;
  end if;
  if new.waitlist_reason is not null and btrim(new.waitlist_reason) = '' then
    new.waitlist_reason := null;
  end if;
  -- Only a waitlisted person has a waitlist reason.
  if new.status is distinct from 'waitlisted' then
    new.waitlist_reason := null;
  end if;

  -- The stamps belong to this trigger.
  if tg_op = 'INSERT' then
    if v_signed_in and not v_registrar then
      new.status_changed_at := null;
      new.status_changed_by := null;
    elsif v_signed_in then
      new.status_changed_at := now();
      new.status_changed_by := (select auth.uid());
    else
      new.status_changed_at := coalesce(new.status_changed_at, now());
      new.status_changed_by := coalesce(new.status_changed_by, (select auth.uid()));
    end if;
  elsif new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := (select auth.uid());
  elsif v_signed_in then
    new.status_changed_at := old.status_changed_at;
    new.status_changed_by := old.status_changed_by;
  end if;
  return new;
end;
$$;

comment on function public.stamp_participant_status() is
  'BEFORE trigger on registration_participants (0128): stamps status_changed_at/_by whenever the status changes, keeps them otherwise for signed-in callers, keeps waitlist_reason to Registration write and to waitlisted rows. Invoker on purpose.';

drop trigger if exists registration_participants_zz_status_stamp on public.registration_participants;
create trigger registration_participants_zz_status_stamp
  before insert or update on public.registration_participants
  for each row execute function public.stamp_participant_status();

-- ---------------------------------------------------------------------------
-- 3. Post-checks
-- ---------------------------------------------------------------------------
do $$
declare
  v_last text;
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'registration_participants'
         and column_name in ('status_changed_at', 'status_changed_by', 'waitlist_reason')) <> 3 then
    raise exception '0128: the status columns are missing';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.stamp_participant_status()'::regprocedure) then
    raise exception '0128: stamp_participant_status must run with the caller''s rights';
  end if;
  if position('waitlist_reason' in pg_get_functiondef('public.stamp_participant_status()'::regprocedure)) = 0
     or position('has_grant(''registration'', ''write'')' in
                 pg_get_functiondef('public.stamp_participant_status()'::regprocedure)) = 0 then
    raise exception '0128: stamp_participant_status was not written as intended';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.registration_participants'::regclass
                    and tgname = 'registration_participants_zz_status_stamp' and tgenabled <> 'D') then
    raise exception '0128: the status stamp trigger is missing';
  end if;
  -- It must fire after every other BEFORE row trigger on the table, so it
  -- stamps the status that is actually stored.
  select t.tgname into v_last
    from pg_trigger t
   where t.tgrelid = 'public.registration_participants'::regclass
     and not t.tgisinternal
     and (t.tgtype & 2) <> 0    -- BEFORE
     and (t.tgtype & 1) <> 0    -- FOR EACH ROW
   order by t.tgname desc
   limit 1;
  if v_last is distinct from 'registration_participants_zz_status_stamp' then
    raise exception '0128: % fires after the status stamp trigger', v_last;
  end if;
  -- Grants unchanged: staff write the reason through the table grant.
  if not has_column_privilege('authenticated', 'public.registration_participants', 'waitlist_reason', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.registration_participants', 'waitlist_reason', 'SELECT') then
    raise exception '0128: authenticated cannot reach waitlist_reason through the table grant';
  end if;
end;
$$;
