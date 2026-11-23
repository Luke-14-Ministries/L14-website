-- 0178 -- Household logins and the contact email: daily limits, removing a
-- login, notices, housekeeping (security review, 23 Nov 2026)
--
-- Findings S1-05, S4-08, S1-06, S2-07, S3-01, S4-10, S2-08, S4-11, S1-22,
-- S1-23, S4-09, S2-03, S4-27, S2-21. What 0171 and 0174 left open:
--
--   1. Mail to an address a family types had only a one-a-minute limit, so a
--      signed-in script could send an invite or a confirmation link to a
--      stranger about 1,400 times a day from our domain. Now: 10 invites per
--      household (or per login) a day, cancelled ones counted, and 5
--      contact-email links per household a day, counted in a new append-only
--      table that cancelling does not clear.
--   2. An invite could name a child as "who they are". A child's record then
--      carried an adult's login. Now the named person must be 18 or over (or
--      have no date of birth on file).
--   3. accept_household_invite(): two accepts at once from one login could
--      both pass the "no household yet" test. It now takes a lock on the login
--      first. A new login now shows on Recent Changes (family_change_log).
--   4. An invited relative who had already made an account, and so had an
--      empty household of their own, was refused and sent to staff. When that
--      household is PROVABLY empty it is now removed and the login joins.
--      Anything that refers to it (a registration, a signature, a coupon, a
--      deletion request, a pending email change, an open invite, a second
--      person, a second login) keeps the refusal: that is a staff merge (0151).
--   5. Nobody but staff could take a login off a household. Now the person who
--      set the household up, or staff with Registration write, can
--      (remove_household_login()). The owner cannot be removed this way.
--   6. household_invite_preview() showed the household and inviter names to
--      anyone holding an old link. Names now only while the invite is open.
--   7. The site wrote message_log with the service-role key for four family
--      emails. log_own_household_email() lets the family's own sign-in write
--      its own household's rows (fixed list of templates, capped lengths,
--      stamped with who), so lib/householdInvite.js, lib/contactEmail.js and
--      the wizard no longer need that key. The signed-out confirm-contact page
--      logs its one notice through log_contact_change_notice(), which works
--      only with the link's own token, once, within an hour.
--   8. confirm_household_email_change() now also returns the household and the
--      address it replaced, so the site can tell the old address (to the
--      server route only; never put in a URL).
--   9. Old invites and expired contact-email links were kept for ever. The
--      daily reminders run now calls forget_old_household_links().

-- =====================================================================
-- 1. Contact-email link requests, one row per link sent (append-only)
-- =====================================================================
-- Kept apart from household_email_changes, which holds only the one pending
-- change and is cleared by Cancel: counting there let Cancel reset the limit.
-- No signed-in grant at all: only the functions below touch it (like
-- mfa_trusted_sessions). The token's hash lets the signed-out confirm page log
-- its notice once; previous_email is the address the confirm replaced.
create table if not exists public.household_email_change_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  new_email text not null,
  token_hash text not null,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  previous_email text,
  notice_logged_at timestamptz
);
create index if not exists household_email_change_requests_household
  on public.household_email_change_requests (household_id, requested_at desc);
create index if not exists household_email_change_requests_token
  on public.household_email_change_requests (token_hash);

alter table public.household_email_change_requests enable row level security;
revoke all on public.household_email_change_requests from public, anon, authenticated;
grant select, insert, update, delete on public.household_email_change_requests to service_role;

comment on table public.household_email_change_requests is
  'One row per contact-email confirmation link sent (0178). Counts the 5-a-day limit; Cancel does not clear it. No signed-in grant: reached only through request_/confirm_household_email_change() and log_contact_change_notice().';


-- =====================================================================
-- 2. Inviting: daily limit, adults only (restated in full from 0176)
-- =====================================================================
create or replace function public.create_household_invite(
  p_household_id uuid,
  p_email text,
  p_person_id uuid,
  p_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(nullif(trim(p_email), ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.family_session_ok() then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.household_members hm
     where hm.household_id = p_household_id and hm.profile_id = v_uid
  ) then
    raise exception 'That is not your household.';
  end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'That email address doesn''t look right. Please check it.';
  end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'bad token'; end if;
  if v_email = lower(nullif(trim((select auth.jwt()) ->> 'email'), '')) then
    raise exception 'That is your own email address. Invite the other adult''s address.';
  end if;
  if p_person_id is not null and not exists (
    select 1 from public.people p
     where p.id = p_person_id and p.household_id = p_household_id and p.profile_id is null
  ) then
    raise exception 'That person is not in your household, or already has a login.';
  end if;
  -- A login belongs to an adult (0178). No date of birth on file is allowed:
  -- many adults in a household never registered for anything.
  if p_person_id is not null and exists (
    select 1 from public.people p
     where p.id = p_person_id and p.date_of_birth is not null
       and p.date_of_birth > (current_date - interval '18 years')::date
  ) then
    raise exception 'Choose an adult. A sign-in is for someone 18 or older.';
  end if;
  if (select count(*) from public.household_invites i
       where i.household_id = p_household_id and i.accepted_at is null
         and i.cancelled_at is null and i.expires_at > now()) >= 5 then
    raise exception 'This household already has 5 invites waiting. Cancel one first.';
  end if;
  if exists (select 1 from public.household_invites i
              where i.household_id = p_household_id and i.created_at > now() - interval '1 minute') then
    raise exception 'We just sent an invite. Please wait a minute before sending another.';
  end if;
  -- The daily limit (0178): cancelled invites count, so cancel-and-resend
  -- cannot get round it. Per household and per login.
  if (select count(*) from public.household_invites i
       where (i.household_id = p_household_id or i.invited_by = v_uid)
         and i.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'That is enough invites for today. Please try again tomorrow.';
  end if;

  -- A new invite to the same address replaces any still waiting.
  update public.household_invites
     set cancelled_at = now()
   where household_id = p_household_id and email = v_email
     and accepted_at is null and cancelled_at is null;

  insert into public.household_invites (household_id, email, person_id, token_hash, invited_by)
  values (p_household_id, v_email, p_person_id, p_token_hash, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_household_invite(uuid, text, uuid, text) from public, anon;
grant execute on function public.create_household_invite(uuid, text, uuid, text) to authenticated, service_role;


-- =====================================================================
-- 3. The invite page: names only while the invite is open
-- =====================================================================
create or replace function public.household_invite_preview(p_token text)
returns table (household_name text, invited_by_name text, email text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  with i as (
    select i.*,
           case
             when i.accepted_at is not null then 'accepted'
             when i.cancelled_at is not null then 'cancelled'
             when i.expires_at < now() then 'expired'
             else 'open'
           end as st
      from public.household_invites i
     where p_token is not null and length(p_token) >= 20
       and i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  )
  select case when i.st = 'open' then h.display_name end,
         case when i.st = 'open'
              then nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), '') end,
         case when i.st = 'open' then i.email end,
         i.st
    from i
    join public.households h on h.id = i.household_id
    left join public.profiles pr on pr.id = i.invited_by;
$$;
revoke all on function public.household_invite_preview(text) from public;
grant execute on function public.household_invite_preview(text) to anon, authenticated, service_role;


-- =====================================================================
-- 4. Accepting: a lock, the empty-household fold-in, a change-log line
-- =====================================================================

-- Is this household nothing but the login's own sign-up? True only when the
-- login is its only member, it holds at most one person and that person is
-- the login's own, it has no open invite, and NOTHING else in the database
-- refers to it or to that person, apart from the email log, the change log,
-- the reminders' record and the household's own pointer to its contact. The
-- last part reads the foreign keys themselves, so a table added later is
-- counted without anyone remembering to add it here.
create or replace function public.household_is_empty_signup(p_household_id uuid, p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
  r record;
  n bigint;
begin
  if exists (select 1 from public.household_members hm
              where hm.household_id = p_household_id and hm.profile_id <> p_uid) then
    return false;
  end if;
  if (select count(*) from public.people p where p.household_id = p_household_id) > 1 then return false; end if;
  select p.id into v_person from public.people p where p.household_id = p_household_id;
  if v_person is not null and not exists (
    select 1 from public.people p where p.id = v_person and p.profile_id = p_uid
  ) then
    return false;
  end if;
  if exists (select 1 from public.household_invites i
              where i.household_id = p_household_id and i.accepted_at is null
                and i.cancelled_at is null and i.expires_at > now()) then
    return false;
  end if;

  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col, c.confrelid::regclass::text as target
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid in ('public.households'::regclass, 'public.people'::regclass)
       and array_length(c.conkey, 1) = 1
  loop
    continue when r.tbl in ('public.message_log', 'public.family_change_log', 'public.reminder_sends');
    continue when r.target = 'public.households'
              and r.tbl in ('public.household_members', 'public.people', 'public.household_invites');
    continue when r.target = 'public.people' and r.tbl in ('public.households', 'public.household_invites');
    if r.target = 'public.households' then
      execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_household_id;
    elsif v_person is not null then
      execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using v_person;
    else
      n := 0;
    end if;
    if n > 0 then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.household_is_empty_signup(uuid, uuid) from public, anon, authenticated;
grant execute on function public.household_is_empty_signup(uuid, uuid) to service_role;

-- The return type grows (the site emails a notice after a join), so the
-- function is dropped and made again rather than replaced.
drop function if exists public.accept_household_invite(text);

create function public.accept_household_invite(p_token text)
returns table (
  household_id uuid,
  joined boolean,         -- true only the first time this login joins
  contact_email text,     -- the household's contact address, for the notice
  inviter_email text,     -- the inviter's sign-in email, for the notice
  login_name text,
  login_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_login text := lower(nullif(trim((select auth.jwt()) ->> 'email'), ''));
  v_inv public.household_invites;
  v_own uuid;
  v_name text;
  v_linked uuid;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  if p_token is null or length(p_token) < 20 then raise exception 'This invite link is not complete.'; end if;
  -- One accept at a time per login (0178): two at once could both see "no
  -- household yet" and join two households.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select * into v_inv
    from public.household_invites i
   where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found then raise exception 'This invite link is not valid.'; end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = v_uid then
      return query select v_inv.household_id, false, null::text, null::text, null::text, null::text;
      return;
    end if;
    raise exception 'This invite has already been used.';
  end if;
  if v_inv.cancelled_at is not null then raise exception 'This invite was cancelled. Ask for a new one.'; end if;
  if v_inv.expires_at < now() then raise exception 'This invite has expired. Ask for a new one.'; end if;
  if v_login is distinct from v_inv.email then
    raise exception 'This invite was sent to a different email address. Sign in with that address to accept it.';
  end if;

  if exists (select 1 from public.household_members hm
              where hm.profile_id = v_uid and hm.household_id = v_inv.household_id) then
    update public.household_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
    return query select v_inv.household_id, false, null::text, null::text, null::text, null::text;
    return;
  end if;

  if exists (select 1 from public.household_members hm where hm.profile_id = v_uid) then
    -- Their own household, if it is only their sign-up, goes; anything more
    -- stays a staff merge.
    if (select count(*) from public.household_members hm where hm.profile_id = v_uid) = 1 then
      select hm.household_id into v_own from public.household_members hm where hm.profile_id = v_uid;
    end if;
    if v_own is null or not public.household_is_empty_signup(v_own, v_uid) then
      raise exception 'Your login already has a household on the site. Email registration@luke14ministries.net and staff will join the two.';
    end if;
    delete from public.households h where h.id = v_own;
  end if;

  insert into public.household_members (household_id, profile_id, role)
  values (v_inv.household_id, v_uid, 'adult');

  if v_inv.person_id is not null then
    update public.people p
       set profile_id = v_uid
     where p.id = v_inv.person_id
       and p.household_id = v_inv.household_id
       and p.profile_id is null
    returning p.id into v_linked;
  end if;

  update public.household_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  select nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), '')
    into v_name from public.profiles pr where pr.id = v_uid;

  -- A new login on a household shows on Recent Changes (0178).
  insert into public.family_change_log
    (household_id, person_id, actor_profile_id, source_table, field, old_value, new_value)
  values (v_inv.household_id, v_linked, v_uid, 'household_members', 'login', null,
          left(coalesce(v_name, 'A family member') || ' (' || v_login || ')', 500));

  return query
    select v_inv.household_id,
           true,
           (select lower(nullif(trim(h.email), '')) from public.households h where h.id = v_inv.household_id),
           (select lower(nullif(trim(u.email), '')) from auth.users u where u.id = v_inv.invited_by),
           v_name,
           v_login;
end;
$$;
revoke all on function public.accept_household_invite(text) from public, anon;
grant execute on function public.accept_household_invite(text) to authenticated, service_role;


-- =====================================================================
-- 5. Removing a login from a household
-- =====================================================================
-- The person who set the household up (role owner) or staff with
-- Registration write. Never the owner, never yourself (leaving is a staff
-- job for now, so nobody strands a household with no sign-in).
create or replace function public.remove_household_login(p_household_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_email text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.has_grant('registration', 'write') then
    if not public.family_session_ok() then
      raise exception 'Enter your two-factor code first.' using errcode = '42501';
    end if;
    if not exists (select 1 from public.household_members hm
                    where hm.household_id = p_household_id and hm.profile_id = v_uid and hm.role = 'owner') then
      raise exception 'Only the person who set up the household can remove a sign-in.' using errcode = '42501';
    end if;
  end if;
  if p_profile_id = v_uid then
    raise exception 'You can''t remove your own sign-in here. Email registration@luke14ministries.net.';
  end if;
  select hm.role into v_role from public.household_members hm
   where hm.household_id = p_household_id and hm.profile_id = p_profile_id;
  if v_role is null then raise exception 'That sign-in is not on this household.'; end if;
  if v_role = 'owner' then
    raise exception 'The person who set up the household can''t be removed here. Email registration@luke14ministries.net.';
  end if;

  select nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), '')
    into v_name from public.profiles pr where pr.id = p_profile_id;
  select lower(u.email) into v_email from auth.users u where u.id = p_profile_id;

  delete from public.household_members hm
   where hm.household_id = p_household_id and hm.profile_id = p_profile_id;
  update public.people p set profile_id = null
   where p.household_id = p_household_id and p.profile_id = p_profile_id;
  update public.household_invites i set cancelled_at = now()
   where i.household_id = p_household_id and i.invited_by = p_profile_id
     and i.accepted_at is null and i.cancelled_at is null;

  insert into public.family_change_log
    (household_id, person_id, actor_profile_id, source_table, field, old_value, new_value)
  values (p_household_id, null, v_uid, 'household_members', 'login',
          left(coalesce(v_name, 'A family member') || coalesce(' (' || v_email || ')', ''), 500),
          'Removed');
end;
$$;
revoke all on function public.remove_household_login(uuid, uuid) from public, anon;
grant execute on function public.remove_household_login(uuid, uuid) to authenticated, service_role;


-- =====================================================================
-- 6. Contact email: daily limit, and confirm says what it replaced
-- =====================================================================
create or replace function public.request_household_email_change(
  p_household_id uuid,
  p_email text,
  p_token_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(nullif(trim(p_email), ''));
  v_login text := lower(nullif(trim((select auth.jwt()) ->> 'email'), ''));
  v_current text;
  v_last timestamptz;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.family_session_ok() then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.household_members hm
     where hm.household_id = p_household_id and hm.profile_id = v_uid
  ) then
    raise exception 'That is not your household.';
  end if;
  if v_email is null or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'That email address doesn''t look right. Please check it.';
  end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'bad token';
  end if;

  select lower(nullif(trim(h.email), '')) into v_current
    from public.households h where h.id = p_household_id;

  if v_email = v_current then
    delete from public.household_email_changes where household_id = p_household_id;
    return 'unchanged';
  end if;

  if v_email = v_login then
    update public.households set email = v_email where id = p_household_id;
    delete from public.household_email_changes where household_id = p_household_id;
    return 'applied';
  end if;

  -- One link a minute is plenty, and stops the button being used to send
  -- mail to a stranger over and over.
  select c.requested_at into v_last
    from public.household_email_changes c where c.household_id = p_household_id;
  if v_last is not null and v_last > now() - interval '1 minute' then
    raise exception 'We just sent a link. Please wait a minute before asking for another.';
  end if;
  -- And five a day (0178), counted where Cancel cannot clear it.
  if (select count(*) from public.household_email_change_requests r
       where r.household_id = p_household_id and r.requested_at > now() - interval '24 hours') >= 5 then
    raise exception 'That is enough confirmation links for today. Please try again tomorrow, or write to registration@luke14ministries.net.';
  end if;

  insert into public.household_email_change_requests (household_id, new_email, token_hash, requested_by)
  values (p_household_id, v_email, p_token_hash, v_uid);

  insert into public.household_email_changes (household_id, new_email, token_hash, requested_by)
  values (p_household_id, v_email, p_token_hash, v_uid)
  on conflict (household_id) do update
    set new_email = excluded.new_email,
        token_hash = excluded.token_hash,
        requested_by = excluded.requested_by,
        requested_at = now(),
        expires_at = now() + interval '3 days';
  return 'pending';
end;
$$;
revoke all on function public.request_household_email_change(uuid, text, text) from public, anon;
grant execute on function public.request_household_email_change(uuid, text, text) to authenticated, service_role;

-- The return type grows, so drop and make again (grants restated below;
-- anon keeps it, as 0175 recorded).
drop function if exists public.confirm_household_email_change(text);

create function public.confirm_household_email_change(p_token text)
returns table (new_email text, household_id uuid, previous_email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.household_email_changes;
  v_hash text;
  v_prev text;
begin
  if p_token is null or length(p_token) < 20 then return; end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select * into v_row
    from public.household_email_changes c
   where c.token_hash = v_hash
   for update;
  if not found then return; end if;
  if v_row.expires_at < now() then
    delete from public.household_email_changes c where c.household_id = v_row.household_id;
    return;
  end if;
  select lower(nullif(trim(h.email), '')) into v_prev
    from public.households h where h.id = v_row.household_id for update;
  update public.households h set email = v_row.new_email where h.id = v_row.household_id;
  delete from public.household_email_changes c where c.household_id = v_row.household_id;
  update public.household_email_change_requests r
     set confirmed_at = now(), previous_email = v_prev
   where r.token_hash = v_hash and r.household_id = v_row.household_id and r.confirmed_at is null;
  return query select v_row.new_email, v_row.household_id, v_prev;
end;
$$;
revoke all on function public.confirm_household_email_change(text) from public;
grant execute on function public.confirm_household_email_change(text) to anon, authenticated, service_role;


-- =====================================================================
-- 7. Families log their own household's emails
-- =====================================================================
-- The family-side twin of log_family_email() (0120/0134): the caller must be
-- in the household, a registration (if given) must be that household's, and
-- only the family emails the site sends from a family's own action may be
-- written. sent_by is the caller. website_feedback is the "Send us feedback"
-- note to info@ (household may be empty: a new login has none yet), at most
-- 5 an hour per login, which is also how that limit is counted.
create or replace function public.log_own_household_email(
  p_household_id        uuid,
  p_registration_id     uuid,
  p_to_email            text,
  p_template_key        text,
  p_subject             text,
  p_status              text,
  p_error               text default null,
  p_provider_message_id text default null,
  p_body_text           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_household uuid := p_household_id;
  v_to text := left(btrim(coalesce(p_to_email, '')), 254);
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.family_session_ok() then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
  end if;
  if p_template_key is null or p_template_key not in (
       'registration_confirmation', 'registration_updated', 'household_invite',
       'contact_email_confirm', 'website_feedback', 'household_login_added', 'contact_email_changed') then
    raise exception 'That email kind cannot be logged here.';
  end if;
  if p_status is null or p_status not in ('sent', 'failed') then
    raise exception 'Status must be sent or failed.';
  end if;
  if p_registration_id is not null then
    select r.household_id into v_household from public.registrations r where r.id = p_registration_id;
    if v_household is null then raise exception 'That registration does not exist.'; end if;
    if p_household_id is not null and p_household_id <> v_household then
      raise exception 'That registration is not this household''s.';
    end if;
  end if;
  if v_household is null and p_template_key <> 'website_feedback' then
    raise exception 'Say which household this email was for.';
  end if;
  if v_household is not null and not exists (
    select 1 from public.household_members hm where hm.household_id = v_household and hm.profile_id = v_uid
  ) then
    raise exception 'That is not your household.';
  end if;
  if p_template_key = 'website_feedback' then
    v_to := 'info@luke14ministries.net';
    if public.my_feedback_notes_this_hour() >= 5 then
      raise exception 'Thank you, we have your notes. Please email info@luke14ministries.net for anything more.';
    end if;
  end if;
  if v_to = '' then raise exception 'Say who the email went to.'; end if;

  insert into public.message_log (to_email, household_id, registration_id, template_key,
                                  subject, status, error, sent_by, provider_message_id, body_text)
  values (v_to, v_household, p_registration_id, p_template_key,
          left(p_subject, 300), p_status, left(p_error, 1000), v_uid,
          left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
          left(nullif(btrim(coalesce(p_body_text, '')), ''), 20000))
  returning id into v_id;
  return v_id;
end;
$$;

-- How many feedback notes this login sent in the last hour. Asked before
-- sending (the note goes first, the log after it), and inside the log.
create or replace function public.my_feedback_notes_this_hour()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.message_log m
   where m.sent_by = (select auth.uid())
     and m.template_key = 'website_feedback'
     and m.sent_at > now() - interval '1 hour';
$$;
revoke all on function public.my_feedback_notes_this_hour() from public, anon;
grant execute on function public.my_feedback_notes_this_hour() to authenticated, service_role;

comment on function public.log_own_household_email(uuid, uuid, text, text, text, text, text, text, text) is
  'A family login records an email the site sent for its own household (fixed list of family templates), stamped with the sender (0178). website_feedback: 5 an hour per login.';
revoke all on function public.log_own_household_email(uuid, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.log_own_household_email(uuid, uuid, text, text, text, text, text, text, text) to authenticated, service_role;

-- The signed-out confirm page's one notice to the replaced address. Works
-- only with the link's own token, within an hour of confirming, once, and
-- writes a fixed row: the address and subject come from the database, not
-- the caller.
create or replace function public.log_contact_change_notice(
  p_token text,
  p_status text,
  p_provider_message_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.household_email_change_requests;
begin
  if p_token is null or length(p_token) < 20 or p_status not in ('sent', 'failed') then return false; end if;
  select * into v_req
    from public.household_email_change_requests r
   where r.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and r.confirmed_at > now() - interval '1 hour'
     and r.notice_logged_at is null
     and r.previous_email is not null
   for update;
  if not found then return false; end if;
  insert into public.message_log (to_email, household_id, template_key, subject, status, error,
                                  provider_message_id, body_text)
  values (v_req.previous_email, v_req.household_id, 'contact_email_changed',
          'Your Luke 14 Ministries contact email was changed', p_status, left(p_error, 1000),
          left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200),
          'Notice to the previous contact email that camp email now goes to ' || v_req.new_email || '.');
  update public.household_email_change_requests r set notice_logged_at = now() where r.id = v_req.id;
  return true;
end;
$$;
revoke all on function public.log_contact_change_notice(text, text, text, text) from public;
grant execute on function public.log_contact_change_notice(text, text, text, text) to anon, authenticated, service_role;


-- =====================================================================
-- 8. Housekeeping, from the daily reminders run (service role only)
-- =====================================================================
create or replace function public.forget_old_household_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invites int;
  v_changes int;
  v_requests int;
begin
  delete from public.household_invites i
   where coalesce(i.accepted_at, i.cancelled_at, i.expires_at) < now() - interval '30 days';
  get diagnostics v_invites = row_count;
  delete from public.household_email_changes c where c.expires_at < now() - interval '1 day';
  get diagnostics v_changes = row_count;
  delete from public.household_email_change_requests r where r.requested_at < now() - interval '30 days';
  get diagnostics v_requests = row_count;
  return jsonb_build_object('invites', v_invites, 'email_changes', v_changes, 'email_change_requests', v_requests);
end;
$$;
revoke all on function public.forget_old_household_links() from public, anon, authenticated;
grant execute on function public.forget_old_household_links() to service_role;
