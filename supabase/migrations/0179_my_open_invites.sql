-- 0179 -- Household invites: a waiting invite shows to the invited adult when
-- signed in, and accepting asks the family two-factor rule (P05, 23 Nov 2026)
--
-- Findings S2-09, A5-21 (review of 23 Nov 2026):
--
--   1. An invite reached the invited adult only through the emailed link. A
--      relative who signed up on their own, or lost the email, made a second
--      household instead: the split the invite was built to prevent. Now
--      my_open_household_invites() lists the open invites sent to the caller's
--      CONFIRMED sign-in address, and accept_household_invite_for_me() joins by
--      the invite's id. The token adds nothing there: it proves the person
--      could read mail at that address, and a confirmed sign-in already does.
--   2. accept_household_invite() never asked family_session_ok() (0176), so a
--      password alone, on an account with two-factor turned on, could join a
--      household and then see its children. The site's accept route sends that
--      session to the code step first; the database now refuses it as well.
--
-- How: the work after "which invite" moves into one internal function,
-- accept_household_invite_by_id(), so the token path and the dashboard path
-- run the same checks (0174, 0178) and cannot drift apart. It has no
-- signed-in grant; only the two public functions below reach it.

-- =====================================================================
-- 1. The shared accept (internal)
-- =====================================================================
-- Restated from 0178's accept_household_invite() with only the first lines
-- changed: it is handed the invite's id instead of finding it by token, and
-- it asks family_session_ok() after "signed in".
create or replace function public.accept_household_invite_by_id(p_invite_id uuid)
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
  if not public.family_session_ok() then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
  end if;
  -- One accept at a time per login (0178): two at once could both see "no
  -- household yet" and join two households.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select * into v_inv
    from public.household_invites i
   where i.id = p_invite_id
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
-- Internal: reached only through the two functions below.
revoke all on function public.accept_household_invite_by_id(uuid) from public, anon, authenticated;
grant execute on function public.accept_household_invite_by_id(uuid) to service_role;


-- =====================================================================
-- 2. The emailed link (same name and shape as 0178)
-- =====================================================================
create or replace function public.accept_household_invite(p_token text)
returns table (
  household_id uuid,
  joined boolean,
  contact_email text,
  inviter_email text,
  login_name text,
  login_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if p_token is null or length(p_token) < 20 then raise exception 'This invite link is not complete.'; end if;
  select i.id into v_id
    from public.household_invites i
   where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_id is null then raise exception 'This invite link is not valid.'; end if;
  return query select * from public.accept_household_invite_by_id(v_id);
end;
$$;
revoke all on function public.accept_household_invite(text) from public, anon;
grant execute on function public.accept_household_invite(text) to authenticated, service_role;


-- =====================================================================
-- 3. Invites waiting for me, and joining one without the link
-- =====================================================================
-- Only invites sent to the caller's own address, and only once Supabase has
-- confirmed that address (an unconfirmed sign-up proves nothing about the
-- mailbox). Households the caller already belongs to are left out. Names
-- only: the household's and the inviter's, as the emailed link shows.
create or replace function public.my_open_household_invites()
returns table (invite_id uuid, household_name text, inviter_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id,
         h.display_name,
         nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), '')
    from public.household_invites i
    join public.households h on h.id = i.household_id
    join auth.users u on u.id = (select auth.uid())
                     and u.email_confirmed_at is not null
                     and lower(u.email) = i.email
    left join public.profiles pr on pr.id = i.invited_by
   where i.accepted_at is null
     and i.cancelled_at is null
     and i.expires_at > now()
     and not exists (select 1 from public.household_members hm
                      where hm.household_id = i.household_id and hm.profile_id = (select auth.uid()))
     and (select public.family_session_ok())
   order by i.created_at desc;
$$;
revoke all on function public.my_open_household_invites() from public, anon;
grant execute on function public.my_open_household_invites() to authenticated, service_role;

create or replace function public.accept_household_invite_for_me(p_invite_id uuid)
returns table (
  household_id uuid,
  joined boolean,
  contact_email text,
  inviter_email text,
  login_name text,
  login_email text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  -- The same answer for "no such invite" and "not sent to you", so an id
  -- tells a stranger nothing.
  if not exists (
    select 1
      from public.household_invites i
      join auth.users u on u.id = auth.uid()
                       and u.email_confirmed_at is not null
                       and lower(u.email) = i.email
     where i.id = p_invite_id
  ) then
    raise exception 'This invite link is not valid.';
  end if;
  return query select * from public.accept_household_invite_by_id(p_invite_id);
end;
$$;
revoke all on function public.accept_household_invite_for_me(uuid) from public, anon;
grant execute on function public.accept_household_invite_for_me(uuid) to authenticated, service_role;
