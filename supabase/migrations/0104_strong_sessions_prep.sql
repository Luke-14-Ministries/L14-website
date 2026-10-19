-- 0104_strong_sessions_prep.sql
--
-- Security audit, 18 Oct 2026 (findings H1/H2). Two-factor was enforced only by
-- the website: a staff password alone, used against the database's API, read
-- everything the staff member's grants allowed. The database can check
-- two-factor itself -- every request carries a signed token whose `aal` claim
-- reads 'aal2' once a code has been entered -- and 0105 makes the staff,
-- leader and doctor checks require it.
--
-- "Remember this browser" (0009) lets a login skip the code, so that session is
-- aal1 and the database cannot see the browser's cookie. Lawrence, 18 Oct:
-- keep remembering, but 7 days for staff (30 for families). So the site
-- REGISTERS a remembered browser's session here: the middleware, holding the
-- browser's raw token, calls mark_session_trusted(); the database hashes it,
-- finds the caller's own unexpired device row, and records this session id as
-- trusted. session_is_strong() = aal2, or a trusted, unexpired session.
-- A stolen password has no device token, so its session is never trusted.
--
-- This migration changes nothing anyone uses today; 0105 switches the check on
-- after the site that registers sessions is deployed.

-- ---- trusted sessions ---------------------------------------------------------------
create table if not exists public.mfa_trusted_sessions (
  session_id  uuid primary key,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  device_id   uuid references public.mfa_trusted_devices(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
comment on table public.mfa_trusted_sessions is
  'Sessions from a remembered browser (0104): what session_is_strong() accepts in place of aal2. Written only by mark_session_trusted().';
alter table public.mfa_trusted_sessions enable row level security;
-- No policies: nobody reads or writes it directly; the definer functions do.

-- The days a remembered browser counts for someone with elevated access:
-- active staff, a program leader, or a doctor with a medical-access grant.
create or replace function public.trusted_browser_days()
returns integer language sql immutable set search_path = ''
as $$ select 7 $$;

create or replace function public.mark_session_trusted(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_dev record;
  v_elevated boolean;
  v_until timestamptz;
begin
  if v_uid is null or v_sid is null or coalesce(p_token, '') = '' then
    return false;
  end if;
  select d.id, d.expires_at, d.created_at into v_dev
    from public.mfa_trusted_devices d
   where d.profile_id = v_uid
     and d.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and d.expires_at > now();
  if not found then
    return false;
  end if;
  v_elevated := exists (select 1 from public.staff s where s.profile_id = v_uid and s.active)
             or exists (select 1 from public.program_leaders pl where pl.profile_id = v_uid and pl.active)
             or exists (select 1 from public.event_medical_access a where a.profile_id = v_uid and current_date <= a.ends_on);
  v_until := v_dev.expires_at;
  if v_elevated then
    v_until := least(v_until, v_dev.created_at + make_interval(days => public.trusted_browser_days()));
    if v_until <= now() then
      return false;   -- remembered more than 7 days ago: ask for the code
    end if;
  end if;
  insert into public.mfa_trusted_sessions (session_id, profile_id, device_id, expires_at)
  values (v_sid, v_uid, v_dev.id, v_until)
  on conflict (session_id) do update
    set expires_at = excluded.expires_at, device_id = excluded.device_id
    where public.mfa_trusted_sessions.profile_id = v_uid;
  update public.mfa_trusted_devices set last_used_at = now() where id = v_dev.id;
  return true;
end;
$$;
revoke all on function public.mark_session_trusted(text) from public;
grant execute on function public.mark_session_trusted(text) to authenticated;

create or replace function public.session_is_strong()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or exists (
        select 1 from public.mfa_trusted_sessions t
         where t.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
           and t.profile_id = (select auth.uid())
           and t.expires_at > now()
      );
$$;
grant execute on function public.session_is_strong() to authenticated;

-- ---- remembered-browser rows: only last_used_at is the user's to change -------------
-- 0009 let a signed-in user update their own device rows freely, at aal1. Once
-- a remembered browser counts in the database, rewriting token_hash or
-- expires_at with a password alone would be the bypass.
revoke update on public.mfa_trusted_devices from authenticated;
grant update (last_used_at) on public.mfa_trusted_devices to authenticated;

-- ---- H2: resetting two-factor --------------------------------------------------------
-- Needs a code-verified session (not a remembered browser), never your own
-- account, and is logged. Clears the target's remembered browsers and sessions.
create or replace function public.admin_reset_mfa(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_removed integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may reset two-factor' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Resetting two-factor needs a session that entered a code just now — sign in again with your code.'
      using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot reset your own two-factor. Ask another administrator.' using errcode = '42501';
  end if;

  delete from auth.mfa_factors where user_id = p_user_id;
  get diagnostics v_removed = row_count;
  delete from public.mfa_factor_labels      where profile_id = p_user_id;
  delete from public.mfa_trusted_devices    where profile_id = p_user_id;
  delete from public.mfa_trusted_sessions   where profile_id = p_user_id;

  insert into public.staff_access_log (staff_profile_id, field, old_value, new_value, changed_by, changed_by_self)
  values (p_user_id, 'mfa_reset', v_removed::text || ' factor(s)', 'none', auth.uid(), false);
  return v_removed;
end;
$function$;

-- ---- check-in: 0101 missed it (it named the roles itself) -----------------------------
create or replace function public.set_check_in(p_participant_id uuid, p_checked_in boolean)
returns timestamp with time zone
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_result timestamptz;
begin
  if not public.has_grant('registration', 'write') then
    raise exception 'not permitted';
  end if;
  update public.registration_participants
     set checked_in_at = case when p_checked_in then now() else null end,
         checked_in_by = case when p_checked_in then v_uid else null end
   where id = p_participant_id
   returning checked_in_at into v_result;
  return v_result;
end;
$function$;

-- ---- staff lookup by email: through is_admin(), so it inherits 0105's check -----------
create or replace function public.staff_lookup_by_email(p_email text)
returns table(profile_id uuid, first_name text, last_name text)
language sql
security definer
set search_path to ''
as $function$
  select p.id, p.first_name, p.last_name
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
    and public.is_admin();
$function$;

-- ---- annual password change for staff (Lawrence, 18 Oct) -------------------------------
alter table public.profiles add column if not exists password_changed_at timestamptz;
update public.profiles set password_changed_at = now() where password_changed_at is null;
alter table public.profiles alter column password_changed_at set default now();
comment on column public.profiles.password_changed_at is
  'When this login last set its password (0104). Staff are sent to change it after 365 days. Stamped by stamp_password_changed() after a password change.';

create or replace function public.stamp_password_changed()
returns void language sql security definer set search_path = ''
as $$ update public.profiles set password_changed_at = now() where id = (select auth.uid()); $$;
revoke all on function public.stamp_password_changed() from public;
grant execute on function public.stamp_password_changed() to authenticated;
