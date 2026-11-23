-- 0176_sign_in_strength.sql
--
-- Security review, 23 Nov 2026 (findings S4-03, S1-02, S1-14, S4-17, S1-24,
-- S4-18, S2-02, S4-02). Five gaps in how a sign-in proves itself:
--
--   1. A remembered browser's expiry was chosen by the browser. The login
--      form inserted its own mfa_trusted_devices row (0009) with whatever
--      expires_at it liked, so a script on an aal2 session could remember a
--      browser for ten years. The row is now written only by
--      remember_this_browser(), which sets both dates itself: 7 days for
--      staff, program leaders and the camp doctor, 30 for everyone else.
--   2. The yearly staff password clock could be reset without a new password.
--      profiles.password_changed_at was stamped by an RPC any login could call
--      (and written directly, since every profiles column was open to its
--      owner). It is now stamped by a trigger on auth.users when the password
--      itself changes, and the column is no longer the user's to write.
--   3. A remembered session outlived a promotion. Someone remembered as a
--      family for 30 days, then made staff, kept a strong session past the
--      7-day staff limit until it expired. Becoming staff, a leader or the
--      doctor now forgets old remembered browsers and every trusted session,
--      and mark_session_trusted() drops a session that fails the 7-day test.
--   4. Expired rows were never cleared after 0106's one-off delete. The daily
--      reminders run now calls forget_expired_trusted_browsers().
--   5. A family's two-factor lived only in the website. A family that turned
--      it on and then had its password phished was still readable through the
--      database's API with the password alone. family_session_ok() asks: a
--      strong session, or no verified two-factor device at all. The household
--      helpers and the family RPCs that check membership themselves now ask
--      it. Families who never enrolled are unaffected (live, 23 Nov 2026: the
--      6 enrolled logins are all staff; 5 of them also have a household).
--
-- accept_household_invite() and create_my_household() are left alone: they
-- are the way into a household, not into one's records.

-- =====================================================================
-- Who counts as "elevated" for the 7-day limit. One function, so the
-- remembering and the honouring cannot drift apart. Called only by the
-- definer functions below (it says whether ANY login is staff, so it is not
-- granted to logins).
-- =====================================================================
create or replace function public.login_is_elevated(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.profile_id = p_uid and s.active)
      or exists (select 1 from public.program_leaders pl where pl.profile_id = p_uid and pl.active)
      or exists (select 1 from public.event_medical_access a
                  where a.profile_id = p_uid and current_date <= a.ends_on);
$$;
revoke all on function public.login_is_elevated(uuid) from public, anon, authenticated;
grant execute on function public.login_is_elevated(uuid) to service_role;

-- =====================================================================
-- 1. Remembering a browser: the database sets the dates
-- =====================================================================
create or replace function public.remember_this_browser(p_token_hash text, p_user_agent text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_days  integer;
  v_until timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- A code entered on this session, not a remembered browser vouching for
  -- another one.
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad token' using errcode = '22023';
  end if;
  v_days := case when public.login_is_elevated(v_uid) then public.trusted_browser_days() else 30 end;
  insert into public.mfa_trusted_devices (profile_id, token_hash, user_agent, created_at, expires_at)
  values (v_uid, p_token_hash, left(p_user_agent, 250), now(), now() + make_interval(days => v_days))
  returning expires_at into v_until;
  return v_until;
end;
$$;
revoke all on function public.remember_this_browser(text, text) from public, anon;
grant execute on function public.remember_this_browser(text, text) to authenticated, service_role;

-- Nobody writes a device row directly any more: the insert went through
-- remember_this_browser() above, and last_used_at is set by
-- mark_session_trusted(). Select (Security's count) and delete ("Forget all
-- trusted browsers") stay.
revoke insert, update on public.mfa_trusted_devices from authenticated;
drop policy if exists mfa_trusted_insert on public.mfa_trusted_devices;
drop policy if exists mfa_trusted_update on public.mfa_trusted_devices;

-- Rows the old form wrote: no later than 30 days after they were made, and
-- made no later than now.
update public.mfa_trusted_devices
   set created_at = least(created_at, now()),
       expires_at = least(expires_at, least(created_at, now()) + interval '30 days')
 where created_at > now()
    or expires_at > least(created_at, now()) + interval '30 days';
update public.mfa_trusted_sessions t
   set expires_at = d.expires_at
  from public.mfa_trusted_devices d
 where d.id = t.device_id and t.expires_at > d.expires_at;
alter table public.mfa_trusted_devices
  drop constraint if exists mfa_trusted_devices_30_days;
alter table public.mfa_trusted_devices
  add constraint mfa_trusted_devices_30_days check (expires_at <= created_at + interval '30 days');

-- =====================================================================
-- 3. Honouring a remembered browser (0104, restated)
-- =====================================================================
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
  v_until timestamptz;
begin
  if v_uid is null or v_sid is null or coalesce(p_token, '') = '' then
    return false;
  end if;
  -- The caller's own expired rows serve no one (0176).
  delete from public.mfa_trusted_sessions where profile_id = v_uid and expires_at <= now();
  delete from public.mfa_trusted_devices  where profile_id = v_uid and expires_at <= now();

  select d.id, d.expires_at, d.created_at into v_dev
    from public.mfa_trusted_devices d
   where d.profile_id = v_uid
     and d.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and d.expires_at > now();
  if not found then
    return false;
  end if;
  v_until := v_dev.expires_at;
  if public.login_is_elevated(v_uid) then
    v_until := least(v_until, v_dev.created_at + make_interval(days => public.trusted_browser_days()));
    if v_until <= now() then
      -- Remembered more than 7 days ago: ask for the code, and stop this
      -- session counting as strong now rather than when its old date runs
      -- out (0176; it may have been registered before they were staff).
      delete from public.mfa_trusted_sessions where session_id = v_sid and profile_id = v_uid;
      return false;
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
revoke all on function public.mark_session_trusted(text) from public, anon;
grant execute on function public.mark_session_trusted(text) to authenticated, service_role;

-- Becoming staff, a program leader or the camp doctor: browsers remembered
-- more than 7 days ago are forgotten, and every trusted session goes, so the
-- next page asks for the code or re-registers under the 7-day limit (the
-- middleware calls mark_session_trusted() again with the browser's cookie).
create or replace function public.forget_browsers_on_elevation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name in ('staff', 'program_leaders') then
    if not coalesce(new.active, false) then return null; end if;
    if tg_op = 'UPDATE' and coalesce(old.active, false) and old.profile_id = new.profile_id then
      return null;   -- already elevated; nothing new
    end if;
  elsif tg_table_name = 'event_medical_access' then
    if new.ends_on < current_date then return null; end if;
  end if;
  delete from public.mfa_trusted_sessions where profile_id = new.profile_id;
  delete from public.mfa_trusted_devices
   where profile_id = new.profile_id
     and created_at <= now() - make_interval(days => public.trusted_browser_days());
  return null;
end;
$$;

drop trigger if exists staff_forget_browsers on public.staff;
create trigger staff_forget_browsers
  after insert or update of active, profile_id on public.staff
  for each row execute function public.forget_browsers_on_elevation();
drop trigger if exists program_leaders_forget_browsers on public.program_leaders;
create trigger program_leaders_forget_browsers
  after insert or update of active, profile_id on public.program_leaders
  for each row execute function public.forget_browsers_on_elevation();
drop trigger if exists event_medical_access_forget_browsers on public.event_medical_access;
create trigger event_medical_access_forget_browsers
  after insert or update of ends_on, profile_id on public.event_medical_access
  for each row execute function public.forget_browsers_on_elevation();

-- =====================================================================
-- 4. The daily tidy-up (lib/reminders/run.js), for every login
-- =====================================================================
create or replace function public.forget_expired_trusted_browsers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sessions integer;
  v_devices integer;
begin
  delete from public.mfa_trusted_sessions where expires_at <= now();
  get diagnostics v_sessions = row_count;
  delete from public.mfa_trusted_devices where expires_at <= now();
  get diagnostics v_devices = row_count;
  return v_sessions + v_devices;
end;
$$;
revoke all on function public.forget_expired_trusted_browsers() from public, anon, authenticated;
grant execute on function public.forget_expired_trusted_browsers() to service_role;

delete from public.mfa_trusted_sessions where expires_at <= now();
delete from public.mfa_trusted_devices where expires_at <= now();

-- =====================================================================
-- 2. The yearly password stamp comes from the password itself
-- =====================================================================
-- Owned by postgres like handle_new_user(); Supabase's auth service makes
-- the change. A failure here must never stop a password change or a sign-in,
-- so it is caught and logged: a missed stamp asks staff for a new password a
-- year early at worst.
create or replace function public.stamp_password_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    update public.profiles set password_changed_at = now() where id = new.id;
  exception when others then
    raise warning 'stamp_password_from_auth: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists on_auth_password_changed on auth.users;
create trigger on_auth_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (new.encrypted_password is distinct from old.encrypted_password)
  execute function public.stamp_password_from_auth();

-- Kept so a page still open from before this change does not error when it
-- calls it; it no longer changes anything.
create or replace function public.stamp_password_changed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;
comment on function public.stamp_password_changed() is
  'No-op since 0176: on_auth_password_changed stamps profiles.password_changed_at when the password itself changes.';
comment on column public.profiles.password_changed_at is
  'When this login last changed its password (0104). Staff are sent to change it after 365 days. Stamped by the on_auth_password_changed trigger on auth.users (0176); not writable by the login.';

-- The columns a login may change on its own profile: the ones My Contact
-- Info and the newsletter tick write (app/account/contact/actions.js).
-- Never password_changed_at, created_at, updated_at or id.
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, phone, phone_work, sms_opt_in, email_news)
  on public.profiles to authenticated;

-- =====================================================================
-- 5. A family's two-factor, in the database
-- =====================================================================
create or replace function public.family_session_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.session_is_strong()
      or not exists (select 1 from auth.mfa_factors f
                      where f.user_id = (select auth.uid())
                        and f.status = 'verified');
$$;
comment on function public.family_session_ok() is
  'True for a code-verified or remembered-browser session, or a login with no verified two-factor device (0176). The household helpers ask it.';
revoke all on function public.family_session_ok() from public, anon;
grant execute on function public.family_session_ok() to authenticated, service_role;

create or replace function public.my_household_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select hm.household_id
  from public.household_members hm
  where hm.profile_id = (select auth.uid())
    and (select public.family_session_ok());
$$;

create or replace function public.my_registration_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.registrations r
  where r.household_id in (select public.my_household_ids());
$$;

create or replace function public.my_participant_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select rp.id
  from public.registration_participants rp
  join public.registrations r on r.id = rp.registration_id
  where r.household_id in (select public.my_household_ids());
$$;
-- my_visible_lodging_ids() goes through my_participant_ids(), and
-- family_request_scholarship() / family_withdraw_scholarship() through
-- my_household_ids(), so they follow without being restated.

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
     and p_household_id in (select public.my_household_ids())
   order by hm.role desc, 2;
$$;

-- ---- The family RPCs that check membership themselves (restated in full
-- ---- from 0174, 0171, 0126 and 0135; only the family_session_ok() step is new)

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
grant execute on function public.create_household_invite(uuid, text, uuid, text) to authenticated, service_role;

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
  if not public.family_session_ok() then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
  end if;
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
grant execute on function public.cancel_household_invite(uuid) to authenticated, service_role;

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

create or replace function public.cancel_household_email_change(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.family_session_ok() then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.household_members hm
     where hm.household_id = p_household_id and hm.profile_id = auth.uid()
  ) and not public.has_grant('registration', 'write') then
    raise exception 'That is not your household.';
  end if;
  delete from public.household_email_changes where household_id = p_household_id;
end;
$$;
revoke all on function public.cancel_household_email_change(uuid) from public, anon;
grant execute on function public.cancel_household_email_change(uuid) to authenticated, service_role;

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
  if not public.family_session_ok() then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
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
revoke all on function public.family_reply_to_staff(uuid, text) from public, anon;
grant execute on function public.family_reply_to_staff(uuid, text) to authenticated, service_role;

create or replace function public.family_cancel_payment_plan(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_plan   uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Please sign in to change your payment plan.' using errcode = '42501';
  end if;
  if not public.family_session_ok() then
    raise exception 'Enter your two-factor code first.' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.registrations r
      join public.household_members hm on hm.household_id = r.household_id
     where r.id = p_registration_id
       and hm.profile_id = v_uid
  ) then
    raise exception 'That registration is not on your account.' using errcode = '42501';
  end if;

  select id, status into v_plan, v_status
    from public.payment_plans
   where registration_id = p_registration_id
   for update;
  if v_plan is null then
    raise exception 'This registration has no payment plan.' using errcode = '22023';
  end if;
  if v_status not in ('active', 'paused', 'failed') then
    raise exception 'This payment plan has already ended.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_installments
              where payment_plan_id = v_plan and status = 'processing') then
    raise exception 'A payment from this plan is still clearing the bank. Please try again once it has settled.'
      using errcode = '22023';
  end if;

  update public.payment_plans
     set status       = 'cancelled',
         cancelled_at = clock_timestamp(),
         cancelled_by = v_uid
   where id = v_plan;

  update public.payment_installments
     set status = 'cancelled'
   where payment_plan_id = v_plan
     and status in ('scheduled', 'failed');
end;
$$;
revoke all on function public.family_cancel_payment_plan(uuid) from public, anon;
grant execute on function public.family_cancel_payment_plan(uuid) to authenticated, service_role;
