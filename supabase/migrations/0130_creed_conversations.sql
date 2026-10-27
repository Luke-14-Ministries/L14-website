-- 0130_creed_conversations.sql
--
-- The Creed conversation belongs to the PEOPLE it was about, not to the
-- registration (Lawrence, 26 Oct 2026, on 0129):
--   1. "creed flag should not be tied to money -- anyone with registration
--      read should see it, and anyone with write should be able to set the
--      flag (talked to larry)";
--   3. "needs to apply to registrants at that time... should re-open if
--      someone is added (or major change, like name)".
-- 0129 kept one stamp per registration, so a volunteer added later was
-- covered by a conversation about somebody else, and the flag itself came
-- only from registration_review, which is money (Payments read, 0103).
--
-- 1. creed_conversations: one row per (registration, person) staff talked
--    with Larry about, with the person's NAME AT THE TIME (name_at). A
--    conversation covers a person only while their name still matches, so
--    a new volunteer, or a renamed one, raises the flag again on its own.
--    Staff-only: SELECT for Registration read; no signed-in writer.
--    (Lawrence was content for the family to read the note -- 0129 put it on
--    their row -- but a table of its own has no reason to show it to them.)
--
-- 2. creed_status: the Creed flag, per active volunteer, WITHOUT money.
--    SECURITY INVOKER: every table under it is readable by all staff
--    (is_staff(), 0101 "broad staff reads") and by the family for its own
--    people, and the conversation columns come back null to anyone who may
--    not read creed_conversations. registration_review keeps its
--    'creed_not_affirmed' flag for compatibility; the pages read this view.
--    "Not affirmed" is registration_review's rule, restated: an active
--    volunteer whose application does not say creed_affirmed.
--
-- 3. mark_creed_discussed(p_registration_id, p_note) keeps its signature and
--    now records a row for every person the flag is raised for at that
--    moment (not affirmed and not already covered under their current name),
--    stamped now() and auth.uid(); refused when there is nobody to record.
--    clear_creed_discussed(p_registration_id) removes the registration's
--    rows. Both Registration write, as in 0129.
--
-- 4. 0129's columns on registrations, and their guard, go. A registration
--    marked under 0129 is carried over for the people its flag was raised
--    for then (that is who the conversation was about).

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table public.creed_conversations (
  registration_id uuid not null references public.registrations(id) on delete cascade,
  person_id       uuid not null references public.people(id) on delete cascade,
  name_at         text not null,
  discussed_at    timestamptz not null default now(),
  discussed_by    uuid references public.profiles(id) on delete set null,
  note            text check (note is null or char_length(note) between 1 and 500),
  primary key (registration_id, person_id)
);

comment on table public.creed_conversations is
  'Staff talked with Larry about the Apostles'' Creed for this person on this registration (0130). Covers the person only while name_at matches their current name. Registration read; written only by mark_creed_discussed() / clear_creed_discussed().';

alter table public.creed_conversations enable row level security;

create policy creed_conversations_select on public.creed_conversations
  for select to authenticated
  using (public.has_grant('registration', 'read'));

-- Reading only, stated both ways: grant SELECT (CLAUDE.md, traps) and revoke
-- anything a project default may have handed out.
revoke all on public.creed_conversations from anon, authenticated;
grant select on public.creed_conversations to authenticated;
grant all on public.creed_conversations to service_role;

-- The name a conversation is checked against: first and last, trimmed.
create or replace function public.creed_name(p_first text, p_last text)
returns text
language sql
immutable
set search_path = ''
as $$ select btrim(concat_ws(' ', btrim(p_first), btrim(p_last))); $$;

grant execute on function public.creed_name(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The flag, without money
-- ---------------------------------------------------------------------------
create view public.creed_status
with (security_invoker = true) as
select rp.registration_id,
       rp.id as participant_id,
       rp.person_id,
       p.first_name,
       p.last_name,
       coalesce(va.creed_affirmed, false) as creed_affirmed,
       cc.name_at       as discussed_name,
       cc.discussed_at,
       cc.discussed_by,
       cc.note          as discussed_note,
       (cc.person_id is not null
        and cc.name_at = public.creed_name(p.first_name, p.last_name)) as discussed_current
  from public.registration_participants rp
  join public.people p on p.id = rp.person_id
  left join public.volunteer_applications va on va.registration_participant_id = rp.id
  left join public.creed_conversations cc
         on cc.registration_id = rp.registration_id and cc.person_id = rp.person_id
 where rp.camp_role = 'volunteer'
   and rp.status <> 'cancelled';

comment on view public.creed_status is
  'Each active volunteer''s Creed answer and whether a Creed conversation covers them under their current name (0130). Invoker; no money.';

grant select on public.creed_status to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The writers (same signatures as 0129)
-- ---------------------------------------------------------------------------
create or replace function public.mark_creed_discussed(p_registration_id uuid, p_note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_at   timestamptz := now();
  v_n    integer;
begin
  if not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can record the Creed conversation.'
      using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'Keep the note to 500 characters.' using errcode = '22001';
  end if;
  if not exists (select 1 from public.registrations where id = p_registration_id) then
    raise exception 'Registration not found.' using errcode = 'P0002';
  end if;

  -- Everyone the flag is raised for right now: an active volunteer who has
  -- not affirmed the Creed and is not covered under their current name.
  insert into public.creed_conversations (registration_id, person_id, name_at, discussed_at, discussed_by, note)
  select rp.registration_id, rp.person_id, public.creed_name(p.first_name, p.last_name),
         v_at, (select auth.uid()), v_note
    from public.registration_participants rp
    join public.people p on p.id = rp.person_id
    left join public.volunteer_applications va on va.registration_participant_id = rp.id
    left join public.creed_conversations cc
           on cc.registration_id = rp.registration_id and cc.person_id = rp.person_id
   where rp.registration_id = p_registration_id
     and rp.camp_role = 'volunteer'
     and rp.status <> 'cancelled'
     and coalesce(va.creed_affirmed, false) = false
     and (cc.person_id is null or cc.name_at <> public.creed_name(p.first_name, p.last_name))
  on conflict (registration_id, person_id) do update
     set name_at      = excluded.name_at,
         discussed_at = excluded.discussed_at,
         discussed_by = excluded.discussed_by,
         note         = excluded.note;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    raise exception 'Nobody on this registration is waiting on the Creed conversation.'
      using errcode = 'P0002';
  end if;
  return v_at;
end;
$$;

comment on function public.mark_creed_discussed(uuid, text) is
  'Records that staff talked with Larry about the Apostles'' Creed for every person on this registration the flag is raised for now (0130): their name at the time, now(), auth.uid(), the optional note. Registration write.';

create or replace function public.clear_creed_discussed(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_grant('registration', 'write') then
    raise exception 'Only staff with Registration write can undo the Creed conversation record.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.registrations where id = p_registration_id) then
    raise exception 'Registration not found.' using errcode = 'P0002';
  end if;
  delete from public.creed_conversations where registration_id = p_registration_id;
end;
$$;

comment on function public.clear_creed_discussed(uuid) is
  'Removes the Creed conversation records on this registration (0130). Registration write.';

revoke all on function public.mark_creed_discussed(uuid, text) from public, anon;
revoke all on function public.clear_creed_discussed(uuid) from public, anon;
grant execute on function public.mark_creed_discussed(uuid, text) to authenticated, service_role;
grant execute on function public.clear_creed_discussed(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Carry 0129's records over, then retire its columns
-- ---------------------------------------------------------------------------
insert into public.creed_conversations (registration_id, person_id, name_at, discussed_at, discussed_by, note)
select r.id, rp.person_id, public.creed_name(p.first_name, p.last_name),
       r.creed_discussed_at, r.creed_discussed_by, r.creed_discussed_note
  from public.registrations r
  join public.registration_participants rp on rp.registration_id = r.id
  join public.people p on p.id = rp.person_id
  left join public.volunteer_applications va on va.registration_participant_id = rp.id
 where r.creed_discussed_at is not null
   and rp.camp_role = 'volunteer'
   and rp.status <> 'cancelled'
   and coalesce(va.creed_affirmed, false) = false
on conflict (registration_id, person_id) do nothing;

drop trigger if exists registrations_guard_creed_discussed on public.registrations;
drop function if exists public.guard_creed_discussed();
alter table public.registrations
  drop column creed_discussed_note,
  drop column creed_discussed_by,
  drop column creed_discussed_at;

-- ---------------------------------------------------------------------------
-- 5. Post-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'registrations'
                and column_name like 'creed_discussed%') then
    raise exception '0130: a creed_discussed column is still on registrations';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.creed_conversations'::regclass) then
    raise exception '0130: creed_conversations has no row-level security';
  end if;
  if has_table_privilege('authenticated', 'public.creed_conversations', 'INSERT')
     or has_table_privilege('authenticated', 'public.creed_conversations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.creed_conversations', 'DELETE')
     or not has_table_privilege('authenticated', 'public.creed_conversations', 'SELECT') then
    raise exception '0130: creed_conversations grants are wrong (read only for authenticated)';
  end if;
  if not exists (select 1 from pg_class c
                  where c.oid = 'public.creed_status'::regclass
                    and 'security_invoker=true' = any (c.reloptions)) then
    raise exception '0130: creed_status must run with the caller''s rights';
  end if;
  if position('participant_money' in pg_get_viewdef('public.creed_status'::regclass)) > 0
     or position('payments' in pg_get_viewdef('public.creed_status'::regclass)) > 0 then
    raise exception '0130: creed_status must not read money';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.mark_creed_discussed(uuid, text)'::regprocedure)
     or position('creed_conversations' in pg_get_functiondef('public.mark_creed_discussed(uuid, text)'::regprocedure)) = 0
     or position('has_grant(''registration'', ''write'')' in pg_get_functiondef('public.mark_creed_discussed(uuid, text)'::regprocedure)) = 0 then
    raise exception '0130: mark_creed_discussed was not rewritten as intended';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.clear_creed_discussed(uuid)'::regprocedure)
     or position('creed_conversations' in pg_get_functiondef('public.clear_creed_discussed(uuid)'::regprocedure)) = 0 then
    raise exception '0130: clear_creed_discussed was not rewritten as intended';
  end if;
  if has_function_privilege('anon', 'public.mark_creed_discussed(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.clear_creed_discussed(uuid)', 'execute') then
    raise exception '0130: anon can run a Creed writer';
  end if;
end;
$$;
