-- 0129_creed_discussed.sql
--
-- "Talked with Larry about the Apostles' Creed" (Lawrence, 26 Oct 2026):
-- "Can fold the declined photo and creed, but need an explicit flag noting
-- they've talked to Larry on the creed". A volunteer who did not affirm the
-- Creed raises registration_review's 'creed_not_affirmed' flag (0081, last
-- restated in 0114). The flag is a fact about the volunteer's application and
-- stays; what was missing is staff's record that the conversation happened.
--
-- 1. registrations gains
--      creed_discussed_at    when staff recorded it (the database's clock);
--      creed_discussed_by    who recorded it (auth.uid()); on delete set null;
--      creed_discussed_note  what was said, optional, 1-500 characters.
--    One acknowledgement per registration -- the flag is per registration too.
--    The family reads every column of its own registration row (RLS is per
--    row, CLAUDE.md), so THE FAMILY'S ACCOUNT CAN READ THE NOTE. No family
--    page shows it, and the staff form says to keep it factual. Grants are
--    unchanged: new columns inherit 0001's table grant.
--
-- 2. Two SECURITY DEFINER functions are the only writers, and they stamp
--    who and when themselves:
--      mark_creed_discussed(p_registration_id, p_note)  -> timestamptz
--      clear_creed_discussed(p_registration_id)         -> void
--    Each checks has_grant('registration', 'write') of the caller (the
--    JWT's auth.uid(), so a definer function still sees the real caller).
--    Why functions rather than a stamping trigger on a plain UPDATE: the who
--    and when cannot then be forged by any client, the app has one call to
--    make, and it is the shape review_waiver_upload() (0124) already has.
--
-- 3. guard_creed_discussed(), a BEFORE INSERT OR UPDATE trigger, INVOKER on
--    purpose (CLAUDE.md: a definer trigger sees its owner as current_user;
--    same shape as 0126's guard_awaiting_family()):
--      * a statement run by a definer function (current_user is its owner),
--        service_role or the SQL editor passes -- the functions check the
--        caller themselves;
--      * a signed-in caller (authenticated / anon) may not change the three
--        columns directly at all -- staff with Registration write included,
--        so the stamps are always the database's;
--      * a signed-in INSERT (a family's new registration) is born with none
--        of them.
--
-- 4. registration_review is NOT changed: the flag still comes from it. The
--    pages read the new columns from registrations (Registration read) and
--    draw a discussed flag calmly.
--
-- Not applied to the production project; the lead applies. The app reads the
-- new columns, so this runs before the deploy that uses them.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
alter table public.registrations
  add column creed_discussed_at   timestamptz,
  add column creed_discussed_by   uuid references public.profiles(id) on delete set null,
  add column creed_discussed_note text;

alter table public.registrations
  add constraint registrations_creed_discussed_note_length
    check (creed_discussed_note is null or char_length(creed_discussed_note) between 1 and 500),
  -- A note or a name only with the date it belongs to.
  add constraint registrations_creed_discussed_complete
    check (creed_discussed_at is not null or (creed_discussed_by is null and creed_discussed_note is null));

comment on column public.registrations.creed_discussed_at is
  'When staff recorded talking with Larry about the Apostles'' Creed (0129). Set only by mark_creed_discussed(); cleared by clear_creed_discussed().';
comment on column public.registrations.creed_discussed_by is
  'Who recorded the Creed conversation (auth.uid() of the Registration-write caller of mark_creed_discussed(), 0129).';
comment on column public.registrations.creed_discussed_note is
  'Optional note on the Creed conversation, 1-500 characters (0129). The family''s own account can read it.';

-- ---------------------------------------------------------------------------
-- 2. The writers
-- ---------------------------------------------------------------------------
create or replace function public.mark_creed_discussed(p_registration_id uuid, p_note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_at   timestamptz;
begin
  if not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can record the Creed conversation.'
      using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Keep the note to 500 characters.' using errcode = '22001';
  end if;

  update public.registrations
     set creed_discussed_at   = now(),
         creed_discussed_by   = (select auth.uid()),
         creed_discussed_note = v_note
   where id = p_registration_id
  returning creed_discussed_at into v_at;

  if v_at is null then
    raise exception 'Registration not found.' using errcode = 'P0002';
  end if;
  return v_at;
end;
$$;

comment on function public.mark_creed_discussed(uuid, text) is
  'Records that staff talked with Larry about the Apostles'' Creed on this registration (0129): stamps now() and auth.uid(), keeps the optional note. Registration write.';

create or replace function public.clear_creed_discussed(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found uuid;
begin
  if not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can undo the Creed conversation record.'
      using errcode = '42501';
  end if;

  update public.registrations
     set creed_discussed_at   = null,
         creed_discussed_by   = null,
         creed_discussed_note = null
   where id = p_registration_id
  returning id into v_found;

  if v_found is null then
    raise exception 'Registration not found.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.clear_creed_discussed(uuid) is
  'Undoes mark_creed_discussed() on this registration (0129). Registration write.';

revoke all on function public.mark_creed_discussed(uuid, text) from public, anon;
revoke all on function public.clear_creed_discussed(uuid) from public, anon;
grant execute on function public.mark_creed_discussed(uuid, text) to authenticated, service_role;
grant execute on function public.clear_creed_discussed(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The guard
-- ---------------------------------------------------------------------------
create or replace function public.guard_creed_discussed()
-- Runs with the CALLER's rights on purpose: inside a definer function
-- current_user is the owner, and the "is this a signed-in caller?" test must
-- step aside for mark_creed_discussed() / clear_creed_discussed(), which
-- check the caller themselves.
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.creed_discussed_at   := null;
    new.creed_discussed_by   := null;
    new.creed_discussed_note := null;
    return new;
  end if;

  if new.creed_discussed_at   is distinct from old.creed_discussed_at
     or new.creed_discussed_by   is distinct from old.creed_discussed_by
     or new.creed_discussed_note is distinct from old.creed_discussed_note then
    raise exception 'The Creed conversation is recorded only through mark_creed_discussed() and cleared through clear_creed_discussed().'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_creed_discussed() is
  'BEFORE trigger on registrations (0129): no signed-in caller writes creed_discussed_* directly; a signed-in insert is born without them. Invoker on purpose.';

drop trigger if exists registrations_guard_creed_discussed on public.registrations;
create trigger registrations_guard_creed_discussed
  before insert or update on public.registrations
  for each row execute function public.guard_creed_discussed();

-- ---------------------------------------------------------------------------
-- 4. Post-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'registrations'
         and column_name in ('creed_discussed_at', 'creed_discussed_by', 'creed_discussed_note')) <> 3 then
    raise exception '0129: the creed_discussed columns are missing';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.guard_creed_discussed()'::regprocedure) then
    raise exception '0129: guard_creed_discussed must run with the caller''s rights';
  end if;
  if position('creed_discussed_note' in pg_get_functiondef('public.guard_creed_discussed()'::regprocedure)) = 0 then
    raise exception '0129: guard_creed_discussed was not written as intended';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.registrations'::regclass
                    and tgname = 'registrations_guard_creed_discussed' and tgenabled <> 'D') then
    raise exception '0129: the creed guard trigger is missing';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.mark_creed_discussed(uuid, text)'::regprocedure)
     or position('has_grant(''registration'', ''write'')' in
                 pg_get_functiondef('public.mark_creed_discussed(uuid, text)'::regprocedure)) = 0
     or position('auth.uid()' in
                 pg_get_functiondef('public.mark_creed_discussed(uuid, text)'::regprocedure)) = 0 then
    raise exception '0129: mark_creed_discussed is not the Registration-write definer function that stamps the caller';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.clear_creed_discussed(uuid)'::regprocedure)
     or position('has_grant(''registration'', ''write'')' in
                 pg_get_functiondef('public.clear_creed_discussed(uuid)'::regprocedure)) = 0 then
    raise exception '0129: clear_creed_discussed is not the Registration-write definer function';
  end if;
  if not has_function_privilege('authenticated', 'public.mark_creed_discussed(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.mark_creed_discussed(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.clear_creed_discussed(uuid)', 'execute')
     or has_function_privilege('anon', 'public.clear_creed_discussed(uuid)', 'execute') then
    raise exception '0129: function grants are wrong';
  end if;
  -- Staff read the columns through the table grant.
  if not has_column_privilege('authenticated', 'public.registrations', 'creed_discussed_at', 'SELECT') then
    raise exception '0129: authenticated cannot read creed_discussed_at through the table grant';
  end if;
end;
$$;
