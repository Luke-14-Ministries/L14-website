-- 0126_family_replies.sql
--
-- Families answer camp staff IN THE APP (Lawrence, 26 Oct 2026, Testing
-- Script 6 items 2.8/2.9).
--
-- Until now "Ask the family for more information..." (0089) wrote the
-- question twice -- as registrations.awaiting_family_reason and as a note in
-- registration_family_messages (0019) -- and the family's dashboard told them
-- to update the registration or write to registration@. Nothing on the site
-- let them answer, and nothing put the registration back in front of staff
-- until a registrar pressed "The family has answered -- back to staff".
-- Lawrence chose ONE way to answer: in the app. No email goes to the
-- registration inbox on a reply; staff are told by the app (a blue "Family
-- replied" flag, the Awaiting Review "Family replied" tab and the nav badge).
--
-- 1. registration_family_messages becomes the conversation on a registration,
--    rather than a second table beside it: the staff notes already live
--    there, the family already reads them, and one thread is what both sides
--    should read. A new author_kind column ('staff' | 'family'; every
--    existing row is a staff note, so the default is 'staff'); the body is
--    1-4000 characters.
--    RLS: the registration's own household reads its rows
--    (my_registration_ids()); staff with Registration READ read all (was
--    is_staff()). NOBODY signed in inserts directly any more -- every write
--    goes through one of the two definer functions below. Staff with
--    Registration write may still remove a STAFF note; a family's words are
--    the record and stay.
--
-- 2. registrations gains:
--      family_replied_at    when the family last wrote (set only by
--                           family_reply_to_staff());
--      family_reply_seen_at when staff last read it ("Mark as read", or by
--                           writing back -- see staff_message_to_family());
--      family_reply_unread  generated: replied and not seen since. A stored
--                           generated column so the review queue and the nav
--                           badge can filter on it (PostgREST cannot compare
--                           two columns), and so nobody can write it.
--    "Mark as read" stamps family_reply_seen_at rather than clearing
--    family_replied_at: the family's dashboard keeps saying when their reply
--    was sent.
--
-- 3. family_reply_to_staff(registration, body): definer. The caller must be a
--    member of the registration's household -- checked here against
--    household_members, not left to RLS (staff RLS is broad). Inserts the
--    family's message, clears awaiting_family_since/_reason (the same two
--    columns staff's "The family has answered -- back to staff" clears, in
--    reviewRegistration('answered')), and stamps family_replied_at. Refuses
--    an empty body. Allowed whether or not staff asked: a family may write at
--    any time, and then it simply sets family_replied_at.
--
-- 4. staff_message_to_family(registration, body): definer, Registration
--    write. The one staff write to the thread -- the "Notes to the family"
--    box and "Ask the family..." both call it. Writing back to the family is
--    a staff action, so an unread reply counts as read from then on.
--
-- 5. guard_awaiting_family() restated as an INVOKER trigger (CLAUDE.md: a
--    definer trigger sees its owner as current_user). As 0089/0101 wrote it,
--    it asked has_grant('registration','write') of the CALLER -- which also
--    refused family_reply_to_staff(), whose caller is a family. Now:
--      * a statement run by a definer function (current_user is its owner)
--        passes -- the functions check the caller themselves;
--      * a signed-in caller (authenticated / anon) still cannot move
--        awaiting_family_* without Registration write, cannot set
--        family_replied_at at all, and cannot set family_reply_seen_at
--        without Registration write; a family's new registration is born
--        with none of them.
--
-- Not applied to the production project; the lead applies.

-- ---------------------------------------------------------------------------
-- 1. The conversation table
-- ---------------------------------------------------------------------------
alter table public.registration_family_messages
  add column author_kind text not null default 'staff'
    check (author_kind in ('family', 'staff'));

alter table public.registration_family_messages
  add constraint registration_family_messages_body_length
    check (char_length(body) between 1 and 4000 and btrim(body) <> '');

comment on table public.registration_family_messages is
  'The conversation on a registration (0019; family replies since 0126): staff notes to the family and the family''s replies, one thread both sides read. Written only through staff_message_to_family() and family_reply_to_staff().';
comment on column public.registration_family_messages.author_kind is
  'staff = a note from camp staff (every row before 0126); family = a reply written by the household through family_reply_to_staff().';

create index if not exists registration_family_messages_thread_idx
  on public.registration_family_messages (registration_id, created_at);

drop policy if exists registration_family_messages_select on public.registration_family_messages;
create policy registration_family_messages_select
  on public.registration_family_messages
  for select to authenticated
  using (
    registration_id in (select public.my_registration_ids())
    or public.has_grant('registration', 'read')
  );

-- No signed-in INSERT: the two functions below are the only writers.
drop policy if exists registration_family_messages_write on public.registration_family_messages;

drop policy if exists registration_family_messages_delete on public.registration_family_messages;
create policy registration_family_messages_delete
  on public.registration_family_messages
  for delete to authenticated
  using (author_kind = 'staff' and public.has_grant('registration', 'write'));

revoke all on public.registration_family_messages from public, anon, authenticated;
grant select, delete on public.registration_family_messages to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The reply columns on registrations
-- ---------------------------------------------------------------------------
alter table public.registrations
  add column family_replied_at    timestamptz,
  add column family_reply_seen_at timestamptz,
  add column family_reply_unread  boolean generated always as (
    family_replied_at is not null
    and (family_reply_seen_at is null or family_reply_seen_at < family_replied_at)
  ) stored;

comment on column public.registrations.family_replied_at is
  'When the family last wrote to camp staff in the app. Set only by family_reply_to_staff() (0126).';
comment on column public.registrations.family_reply_seen_at is
  'When staff last read the family''s reply ("Mark as read", or by writing back through staff_message_to_family()). Registration write (0126).';
comment on column public.registrations.family_reply_unread is
  'Generated: the family replied and staff have not read it since. The "Family replied" flag, tab and nav count (0126).';

-- ---------------------------------------------------------------------------
-- 3. The family's reply
-- ---------------------------------------------------------------------------
create or replace function public.family_reply_to_staff(p_registration_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_now  timestamptz := clock_timestamp();
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in to reply.' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'Write your reply first.' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'That reply is too long -- please keep it under 4000 characters.' using errcode = '22023';
  end if;
  -- Membership, checked here: the caller must belong to the household that
  -- owns this registration. Not RLS -- a staff member's RLS reaches every
  -- registration, and a reply is the family's own act.
  if not exists (
    select 1
      from public.registrations r
      join public.household_members hm on hm.household_id = r.household_id
     where r.id = p_registration_id
       and hm.profile_id = v_uid
  ) then
    raise exception 'That registration is not on your account.' using errcode = '42501';
  end if;

  insert into public.registration_family_messages (registration_id, body, created_by, author_kind, created_at)
  values (p_registration_id, v_body, v_uid, 'family', v_now)
  returning id into v_id;

  -- Back to staff: the same two columns "The family has answered -- back to
  -- staff" clears (reviewRegistration 'answered'), and the reply stamp.
  update public.registrations
     set awaiting_family_since  = null,
         awaiting_family_reason = null,
         family_replied_at      = v_now
   where id = p_registration_id;

  return v_id;
end;
$$;

comment on function public.family_reply_to_staff(uuid, text) is
  'A member of the registration''s household writes to camp staff (1-4000 characters). Adds the family message to the thread, clears waiting-on-the-family and stamps family_replied_at. Allowed whether or not staff asked. 0126, 26 Oct 2026.';

revoke execute on function public.family_reply_to_staff(uuid, text) from public, anon;
grant execute on function public.family_reply_to_staff(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Staff's note to the family
-- ---------------------------------------------------------------------------
create or replace function public.staff_message_to_family(p_registration_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_now  timestamptz := clock_timestamp();
  v_id   uuid;
begin
  -- has_grant() reads auth.uid() from the request, not current_user, so it
  -- answers for the caller inside a definer function.
  if not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can write to a family.' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'Write the note first.' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'That note is too long -- please keep it under 4000 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.registrations r where r.id = p_registration_id) then
    raise exception 'That registration no longer exists.';
  end if;

  insert into public.registration_family_messages (registration_id, body, created_by, author_kind, created_at)
  values (p_registration_id, v_body, (select auth.uid()), 'staff', v_now)
  returning id into v_id;

  -- Writing back is a staff action: an unread reply has been read.
  update public.registrations
     set family_reply_seen_at = v_now
   where id = p_registration_id
     and family_reply_unread;

  return v_id;
end;
$$;

comment on function public.staff_message_to_family(uuid, text) is
  'Registration write. Adds a staff note to the registration''s thread (the "Notes to the family" box and "Ask the family..."); an unread family reply counts as read from then on. 0126, 26 Oct 2026.';

revoke execute on function public.staff_message_to_family(uuid, text) from public, anon;
grant execute on function public.staff_message_to_family(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The guard, restated as an invoker trigger
-- ---------------------------------------------------------------------------
create or replace function public.guard_awaiting_family()
-- Runs with the CALLER's rights on purpose: inside a definer function
-- current_user is the owner, and the "is this a signed-in caller?" test must
-- step aside for family_reply_to_staff() and staff_message_to_family(),
-- which check the caller themselves.
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.has_grant('registration', 'write') then
      new.awaiting_family_since  := null;
      new.awaiting_family_reason := null;
      new.family_reply_seen_at   := null;
    end if;
    new.family_replied_at := null;
    return new;
  end if;

  if (new.awaiting_family_since  is distinct from old.awaiting_family_since
      or new.awaiting_family_reason is distinct from old.awaiting_family_reason)
     and not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can change whether a registration is waiting on the family; a family answers through family_reply_to_staff().'
      using errcode = '42501';
  end if;
  if new.family_replied_at is distinct from old.family_replied_at then
    raise exception 'family_replied_at is set only by family_reply_to_staff().' using errcode = '42501';
  end if;
  if new.family_reply_seen_at is distinct from old.family_reply_seen_at
     and not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can mark a family''s reply as read.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists registrations_guard_awaiting_family on public.registrations;
create trigger registrations_guard_awaiting_family
  before insert or update on public.registrations
  for each row execute function public.guard_awaiting_family();

-- ---------------------------------------------------------------------------
-- 6. Post-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if (select prosecdef from pg_proc where oid = 'public.guard_awaiting_family()'::regprocedure) then
    raise exception '0126: guard_awaiting_family must run with the caller''s rights';
  end if;
  if position('family_replied_at' in pg_get_functiondef('public.guard_awaiting_family()'::regprocedure)) = 0 then
    raise exception '0126: guard_awaiting_family was not rewritten';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.registrations'::regclass
                    and tgname = 'registrations_guard_awaiting_family' and tgenabled <> 'D') then
    raise exception '0126: the awaiting-family guard trigger is missing';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.family_reply_to_staff(uuid, text)'::regprocedure)
     or position('household_members' in
                 pg_get_functiondef('public.family_reply_to_staff(uuid, text)'::regprocedure)) = 0 then
    raise exception '0126: family_reply_to_staff is not the household-checked definer function';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.staff_message_to_family(uuid, text)'::regprocedure)
     or position('has_grant(''registration'', ''write'')' in
                 pg_get_functiondef('public.staff_message_to_family(uuid, text)'::regprocedure)) = 0 then
    raise exception '0126: staff_message_to_family is not the Registration-write definer function';
  end if;
  if not has_function_privilege('authenticated', 'public.family_reply_to_staff(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.family_reply_to_staff(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.staff_message_to_family(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.staff_message_to_family(uuid, text)', 'execute') then
    raise exception '0126: function grants are wrong';
  end if;
  if has_table_privilege('authenticated', 'public.registration_family_messages', 'insert')
     or has_table_privilege('authenticated', 'public.registration_family_messages', 'update')
     or not has_table_privilege('authenticated', 'public.registration_family_messages', 'select')
     or not has_table_privilege('authenticated', 'public.registration_family_messages', 'delete')
     or has_table_privilege('anon', 'public.registration_family_messages', 'select') then
    raise exception '0126: registration_family_messages grants are wrong';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'registration_family_messages'
                and cmd = 'INSERT') then
    raise exception '0126: a signed-in INSERT policy is still on registration_family_messages';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'registrations'
         and column_name in ('family_replied_at', 'family_reply_seen_at', 'family_reply_unread')) <> 3 then
    raise exception '0126: the reply columns are missing';
  end if;
end;
$$;
