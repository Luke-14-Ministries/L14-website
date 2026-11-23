-- 0174 -- A family invites another adult to share its household (W75, 23 Nov 2026)
--
-- Lawrence, 23 Nov 2026 (the Harding family: an adult camper registered
-- himself, and a relative's own sign-ups never confirmed): a second login on
-- one household should not need staff. Until now only an administrator could
-- do it (admin_link_login_to_household(), 0024).
--
-- How it works:
--   * Anyone signed in to a household invites an adult by email, optionally
--     naming which person in the household they are. The site emails a link;
--     only the SHA-256 hash of its token is stored.
--   * The invite is accepted by a signed-in login WHOSE OWN EMAIL IS THE ONE
--     INVITED. A forwarded or stolen link is useless to anyone else, and the
--     invitee's address was confirmed by Supabase at sign-up.
--   * A login that already belongs to a household is refused: two households
--     with their own records are a merge, which stays with staff (0151).
--   * Accepting adds the login as an 'adult' member (household_members' two
--     roles are owner and adult) and, if a person was named and nobody has
--     claimed them yet, links that person to the login.
--   * Invites last 7 days; at most 5 open per household, one a minute.

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254),
  person_id uuid references public.people (id) on delete set null,
  token_hash text not null unique,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz
);
create index if not exists household_invites_household on public.household_invites (household_id);

alter table public.household_invites enable row level security;

-- The household sees its own invites; staff who read registrations see all.
-- Never the token hash (column grants).
create policy household_invites_select on public.household_invites
  for select to authenticated
  using (household_id in (select public.my_household_ids()) or public.has_grant('registration', 'read'));

revoke all on public.household_invites from public, anon, authenticated;
grant select (id, household_id, email, person_id, invited_by, created_at, expires_at, accepted_at, accepted_by, cancelled_at)
  on public.household_invites to authenticated;


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
  if (select count(*) from public.household_invites i
       where i.household_id = p_household_id and i.accepted_at is null
         and i.cancelled_at is null and i.expires_at > now()) >= 5 then
    raise exception 'This household already has 5 invites waiting. Cancel one first.';
  end if;
  if exists (select 1 from public.household_invites i
              where i.household_id = p_household_id and i.created_at > now() - interval '1 minute') then
    raise exception 'We just sent an invite. Please wait a minute before sending another.';
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
grant execute on function public.create_household_invite(uuid, text, uuid, text) to authenticated;


create or replace function public.cancel_household_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select i.household_id into v_household from public.household_invites i where i.id = p_invite_id;
  if v_household is null then raise exception 'That invite no longer exists.'; end if;
  if not exists (
    select 1 from public.household_members hm
     where hm.household_id = v_household and hm.profile_id = auth.uid()
  ) and not public.has_grant('registration', 'write') then
    raise exception 'That is not your household.';
  end if;
  update public.household_invites
     set cancelled_at = now()
   where id = p_invite_id and accepted_at is null and cancelled_at is null;
end;
$$;

revoke all on function public.cancel_household_invite(uuid) from public, anon;
grant execute on function public.cancel_household_invite(uuid) to authenticated;


-- What the invite page may show to whoever holds the link: the household's
-- name, who sent it, the address it was sent to, and whether it still works.
create or replace function public.household_invite_preview(p_token text)
returns table (household_name text, invited_by_name text, email text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select h.display_name,
         nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
         i.email,
         case
           when i.accepted_at is not null then 'accepted'
           when i.cancelled_at is not null then 'cancelled'
           when i.expires_at < now() then 'expired'
           else 'open'
         end
    from public.household_invites i
    join public.households h on h.id = i.household_id
    left join public.profiles pr on pr.id = i.invited_by
   where p_token is not null and length(p_token) >= 20
     and i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

revoke all on function public.household_invite_preview(text) from public;
grant execute on function public.household_invite_preview(text) to anon, authenticated;


create or replace function public.accept_household_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_login text := lower(nullif(trim((select auth.jwt()) ->> 'email'), ''));
  v_inv public.household_invites;
begin
  if v_uid is null then raise exception 'Please sign in first.'; end if;
  if p_token is null or length(p_token) < 20 then raise exception 'This invite link is not complete.'; end if;
  select * into v_inv
    from public.household_invites i
   where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found then raise exception 'This invite link is not valid.'; end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = v_uid then return v_inv.household_id; end if;
    raise exception 'This invite has already been used.';
  end if;
  if v_inv.cancelled_at is not null then raise exception 'This invite was cancelled. Ask for a new one.'; end if;
  if v_inv.expires_at < now() then raise exception 'This invite has expired. Ask for a new one.'; end if;
  if v_login is distinct from v_inv.email then
    raise exception 'This invite was sent to a different email address. Sign in with that address to accept it.';
  end if;
  if exists (select 1 from public.household_members hm where hm.profile_id = v_uid) then
    if exists (select 1 from public.household_members hm
                where hm.profile_id = v_uid and hm.household_id = v_inv.household_id) then
      update public.household_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
      return v_inv.household_id;
    end if;
    raise exception 'Your login already has a household on the site. Email registration@luke14ministries.net and staff will join the two.';
  end if;

  insert into public.household_members (household_id, profile_id, role)
  values (v_inv.household_id, v_uid, 'adult');

  if v_inv.person_id is not null then
    update public.people
       set profile_id = v_uid
     where id = v_inv.person_id
       and household_id = v_inv.household_id
       and profile_id is null;
  end if;

  update public.household_invites set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.household_id;
end;
$$;

revoke all on function public.accept_household_invite(text) from public, anon;
grant execute on function public.accept_household_invite(text) to authenticated;


-- Who else signs in to my household: names only, for the Manage Household card.
create or replace function public.my_household_logins(p_household_id uuid)
returns table (profile_id uuid, name text, role text, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select hm.profile_id,
         nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
         hm.role,
         hm.profile_id = auth.uid()
    from public.household_members hm
    left join public.profiles pr on pr.id = hm.profile_id
   where hm.household_id = p_household_id
     and exists (select 1 from public.household_members me
                  where me.household_id = p_household_id and me.profile_id = auth.uid())
   order by hm.role desc, 2;
$$;

revoke all on function public.my_household_logins(uuid) from public, anon;
grant execute on function public.my_household_logins(uuid) to authenticated;
