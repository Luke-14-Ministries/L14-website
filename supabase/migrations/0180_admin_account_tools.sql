-- 0180 -- Accounts page tools: guarded, stepped-up and logged (23 Nov 2026)
--
-- Security review of /admin/accounts, 23 Nov 2026 (findings S1-07, S4-01,
-- S4-04, S4-05, S4-24, S1-25, S4-25, S2-13). With real families on the site
-- the Accounts tools could do more damage than anything else in the admin
-- area, and left no trace:
--
--   1. admin_account_log -- one row for every purge, login removal, link and
--      merge: who did it, what, to whom (ids as plain uuids with NO foreign
--      key, so the row outlives what it describes), the email and family
--      name as they were, and the counts. Administrators read it; nobody
--      signed in writes it (only the functions below, as owner).
--   2. admin_purge_household() ("Delete family & all their data") refuses a
--      family with real money on file: a Stripe payment that succeeded, is
--      clearing or was refunded, or a payment plan still active or paused.
--      Those go through Deletion Requests, where a person decides what the
--      ministry must keep. It now deletes a member's LOGIN only when that
--      login is not staff, not a program leader and in no other household;
--      otherwise it only takes them off this household (before, purging a
--      family whose parent was also staff deleted the staff member's login).
--      Returns {logins_deleted, logins_kept} so the page can name who kept
--      their login.
--   3. Purge and remove-login need the administrator's own session to have
--      entered a code just now (aal2), like the two-factor reset already did
--      (0104). A browser remembered for 7 days is enough to read staff pages,
--      not to delete a family. The reset's message is plainer. These refusals
--      carry the plain error code (not 42501), so the staff page shows the
--      sentence itself rather than its generic "your access does not allow".
--   4. admin_merge_households() (0151) failed outright when both households
--      had a pending contact-email change (household_email_changes is one row
--      per household, keyed by household_id), and left the merged household's
--      open invites live on the kept one. The merged household's pending
--      change is now dropped and its open invites cancelled first, and logins
--      that came across join as 'adult' when the kept household already has
--      an owner (two owners meant two people who could remove each other's
--      sign-ins).
--   5. staff_household_logins() -- who can sign in to a household, for staff
--      pages: name, email, role, when they joined and, when they joined by
--      invite, who invited them. Administrators may ask for every household
--      (Accounts); Registration read may ask for one (the registration page).
--
-- Every function here is restated in full, search_path '' and fully
-- qualified (CLAUDE.md: prefer restating to editing in place).

-- =====================================================================
-- 1. The log
-- =====================================================================
create table if not exists public.admin_account_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,                 -- the administrator; plain uuid, no foreign key
  actor_email text,
  action text not null check (action in ('purge_household', 'delete_login', 'link_login', 'merge_households')),
  target_user_id uuid,           -- plain uuids: the row must outlive a deletion
  target_household_id uuid,
  other_household_id uuid,       -- merge: the household kept
  target_email text,             -- snapshots, as they were at the time
  household_name text,
  other_household_name text,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_account_log_created on public.admin_account_log (created_at desc);

alter table public.admin_account_log enable row level security;

create policy admin_account_log_select on public.admin_account_log
  for select to authenticated
  using (public.is_admin());

revoke all on public.admin_account_log from public, anon, authenticated;
grant select on public.admin_account_log to authenticated;
grant select, insert, update, delete on public.admin_account_log to service_role;

comment on table public.admin_account_log is
  'One row per Accounts-page purge, login removal, link and merge (0180). Administrators read; written only by the admin_* functions. Ids are plain uuids on purpose: the row outlives what it names.';

-- The one writer, owner-only (not granted): called from the functions below.
create or replace function public.write_admin_account_log(
  p_action text,
  p_user uuid,
  p_household uuid,
  p_other_household uuid,
  p_email text,
  p_household_name text,
  p_other_household_name text,
  p_counts jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_account_log
    (actor_id, actor_email, action, target_user_id, target_household_id, other_household_id,
     target_email, household_name, other_household_name, counts)
  values
    (auth.uid(), (select lower(u.email) from auth.users u where u.id = auth.uid()), p_action,
     p_user, p_household, p_other_household, p_email, p_household_name, p_other_household_name,
     coalesce(p_counts, '{}'::jsonb));
$$;
revoke all on function public.write_admin_account_log(text, uuid, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;

-- "Has this session entered its code just now?" -- the step-up the Accounts
-- page asks for before a reset, a removal or a purge.
create or replace function public.session_is_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
grant execute on function public.session_is_aal2() to authenticated, service_role;


-- =====================================================================
-- 2. Remove a login (restated from 0022: aal2, logged)
-- =====================================================================
create or replace function public.admin_delete_login(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_households text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may remove a login' using errcode = '42501';
  end if;
  if not public.session_is_aal2() then
    raise exception 'Removing an account needs your own code first. Enter it and try again.';
  end if;
  -- Locking yourself out of the admin area is not a recoverable mistake from
  -- inside the admin area.
  if p_user_id = auth.uid() then
    raise exception 'You cannot remove your own account.';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'That login no longer exists.';
  end if;
  select string_agg(h.display_name, ', ' order by h.display_name) into v_households
    from public.household_members m join public.households h on h.id = m.household_id
   where m.profile_id = p_user_id;

  perform public.write_admin_account_log('delete_login', p_user_id, null, null, v_email, v_households, null,
    jsonb_build_object('was_staff', exists (select 1 from public.staff s where s.profile_id = p_user_id)));

  delete from auth.users where id = p_user_id;
end;
$$;
revoke all on function public.admin_delete_login(uuid) from public, anon;
grant execute on function public.admin_delete_login(uuid) to authenticated, service_role;


-- =====================================================================
-- 3. Purge a household (restated from 0022: money refusal, aal2, kept
--    logins, logged). The return type changes, so drop and create.
-- =====================================================================
drop function if exists public.admin_purge_household(uuid);

create function public.admin_purge_household(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_members uuid[];
  v_delete uuid[] := '{}';
  v_kept text[] := '{}';
  v_regs integer;
  v_people integer;
  m uuid;
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may purge a household' using errcode = '42501';
  end if;
  if not public.session_is_aal2() then
    raise exception 'Deleting a family needs your own code first. Enter it and try again.';
  end if;

  select h.display_name into v_name from public.households h where h.id = p_household_id;
  if not found then
    raise exception 'That household no longer exists.';
  end if;

  select coalesce(array_agg(hm.profile_id), '{}')
    into v_members
    from public.household_members hm
   where hm.household_id = p_household_id;

  if auth.uid() = any (v_members) then
    raise exception 'You cannot delete the household your own account belongs to.';
  end if;

  -- Real money on file: this is a deletion request, not a tidy-up.
  if exists (
       select 1 from public.payments pay
         join public.registrations r on r.id = pay.registration_id
        where r.household_id = p_household_id
          and pay.status in ('succeeded', 'processing', 'refunded'))
     or exists (
       select 1 from public.payment_plans pp
         join public.registrations r on r.id = pp.registration_id
        where r.household_id = p_household_id
          and pp.status in ('active', 'paused')) then
    raise exception 'This family has payments on record. Use Deletion Requests instead.';
  end if;

  -- Which logins go with the family: only one that is nothing else. A staff
  -- member, a program leader or someone in another household keeps their
  -- login and only leaves this household (the cascade below does that).
  foreach m in array v_members loop
    if exists (select 1 from public.staff s where s.profile_id = m)
       or exists (select 1 from public.program_leaders pl where pl.profile_id = m)
       or exists (select 1 from public.household_members o
                   where o.profile_id = m and o.household_id <> p_household_id) then
      select lower(u.email) into v_email from auth.users u where u.id = m;
      v_kept := v_kept || coalesce(v_email, m::text);
    else
      v_delete := v_delete || m;
    end if;
  end loop;

  select count(*) into v_regs from public.registrations r where r.household_id = p_household_id;
  select count(*) into v_people from public.people p where p.household_id = p_household_id;

  perform public.write_admin_account_log('purge_household', null, p_household_id, null,
    (select string_agg(lower(u.email), ', ') from auth.users u where u.id = any (v_members)),
    v_name, null,
    jsonb_build_object('registrations', v_regs, 'people', v_people,
                       'logins_deleted', coalesce(array_length(v_delete, 1), 0),
                       'logins_kept', to_jsonb(v_kept)));

  -- The order is not stylistic (0022): payments and coupon redemptions are
  -- RESTRICT and must go before what they point at. Only payments with no
  -- money received reach here (pending or failed). A check or cash payment
  -- staff recorded counts as received too (Lawrence's review, 23 Nov 2026: a
  -- guess, flagged).
  delete from public.payments
   where registration_id in (select r.id from public.registrations r where r.household_id = p_household_id);
  delete from public.coupon_redemptions
   where coupon_id in (select c.id from public.coupons c where c.household_id = p_household_id);
  -- Cascades participants, notes, family messages, payment plans, and through
  -- participants: scholarships, volunteer applications, activity signups,
  -- buddy assignments.
  delete from public.registrations where household_id = p_household_id;
  delete from public.people where household_id = p_household_id;
  -- Cascades household_members, coupons, family_change_log, invites, pending
  -- contact-email changes, agreement_signatures.
  delete from public.households where id = p_household_id;

  if coalesce(array_length(v_delete, 1), 0) > 0 then
    delete from auth.users where id = any (v_delete);
  end if;

  return jsonb_build_object('logins_deleted', coalesce(array_length(v_delete, 1), 0),
                            'logins_kept', to_jsonb(v_kept));
end;
$$;
revoke all on function public.admin_purge_household(uuid) from public, anon;
grant execute on function public.admin_purge_household(uuid) to authenticated, service_role;


-- =====================================================================
-- 4. Reset two-factor (restated from 0104: the plainer message only)
-- =====================================================================
create or replace function public.admin_reset_mfa(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may reset two-factor' using errcode = '42501';
  end if;
  if not public.session_is_aal2() then
    raise exception 'Resetting two-factor needs your own code first. Enter it and try again.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot reset your own two-factor. Ask another administrator.';
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
$$;
revoke all on function public.admin_reset_mfa(uuid) from public, anon;
grant execute on function public.admin_reset_mfa(uuid) to authenticated, service_role;


-- =====================================================================
-- 5. Link a login to a household (restated from 0024: logged)
-- =====================================================================
create or replace function public.admin_link_login_to_household(
  p_user_id      uuid,
  p_household_id uuid,
  p_person_id    uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_email text;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may link a login to a household' using errcode = '42501';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'That login no longer exists';
  end if;
  select h.display_name into v_name from public.households h where h.id = p_household_id;
  if not found then
    raise exception 'That household no longer exists';
  end if;
  if exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.profile_id = p_user_id
  ) then
    raise exception 'This login is already a member of that household';
  end if;

  -- First member back in becomes the owner; anyone after that joins as an
  -- adult. (household_members.role allows exactly these two values.)
  select case
           when exists (
             select 1 from public.household_members m
             where m.household_id = p_household_id and m.role = 'owner'
           ) then 'adult'
           else 'owner'
         end
    into v_role;

  insert into public.household_members (household_id, profile_id, role)
  values (p_household_id, p_user_id, v_role);

  -- Optionally claim a person record as "this is me": only a person already
  -- in this household, and only one nobody else has claimed.
  if p_person_id is not null then
    update public.people
       set profile_id = p_user_id
     where id = p_person_id
       and household_id = p_household_id
       and profile_id is null;
    if not found then
      raise exception 'That person is not in this household, or is already linked to a login';
    end if;
  end if;

  perform public.write_admin_account_log('link_login', p_user_id, p_household_id, null, v_email, v_name, null,
    jsonb_build_object('role', v_role, 'person_claimed', p_person_id is not null));

  return v_role;
end;
$$;
revoke all on function public.admin_link_login_to_household(uuid, uuid, uuid) from public, anon;
grant execute on function public.admin_link_login_to_household(uuid, uuid, uuid) to authenticated, service_role;


-- =====================================================================
-- 6. Merge households (restated from 0151: pending email change, open
--    invites, roles, logged)
-- =====================================================================
create or replace function public.admin_merge_households(p_keep uuid, p_merge uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep  public.households%rowtype;
  v_merge public.households%rowtype;
  v_clash text;
  r record;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
  v_keep_has_owner boolean;
  v_came uuid[];
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can merge households.' using errcode = '42501';
  end if;
  if p_keep is null or p_merge is null or p_keep = p_merge then
    raise exception 'Choose two different households.';
  end if;
  select * into v_keep from public.households where id = p_keep;
  select * into v_merge from public.households where id = p_merge;
  if v_keep.id is null or v_merge.id is null then
    raise exception 'One of those households no longer exists.';
  end if;

  select string_agg(e.name, ', ' order by e.starts_on) into v_clash
    from public.registrations a
    join public.registrations b on b.event_id = a.event_id and b.household_id = p_merge
    join public.events e on e.id = a.event_id
   where a.household_id = p_keep;
  if v_clash is not null then
    raise exception 'Both households are registered for %. Cancel one of those registrations first, then merge.', v_clash;
  end if;

  -- A login in both: keep its membership in the kept household.
  delete from public.household_members m
   where m.household_id = p_merge
     and exists (select 1 from public.household_members k
                  where k.household_id = p_keep and k.profile_id = m.profile_id);

  v_keep_has_owner := exists (select 1 from public.household_members k
                               where k.household_id = p_keep and k.role = 'owner');
  select coalesce(array_agg(m.profile_id), '{}') into v_came
    from public.household_members m where m.household_id = p_merge;

  -- The merged household's pending contact-email change goes: one row per
  -- household, so moving it would collide with the kept one's, and the kept
  -- household's own address stands. Its open invites are cancelled, so a
  -- link sent for the old household cannot let someone into the kept one.
  delete from public.household_email_changes where household_id = p_merge;
  update public.household_invites i
     set cancelled_at = now()
   where i.household_id = p_merge
     and i.accepted_at is null
     and i.cancelled_at is null;

  for r in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.households'::regclass
       and c.conrelid <> 'public.households'::regclass
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_merge;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_moved := v_moved || jsonb_build_object(r.tbl::text, v_n);
    end if;
  end loop;

  -- One owner: logins that came across are adults when the kept household
  -- already had someone who set it up.
  if v_keep_has_owner and coalesce(array_length(v_came, 1), 0) > 0 then
    update public.household_members m
       set role = 'adult'
     where m.household_id = p_keep
       and m.profile_id = any (v_came)
       and m.role = 'owner';
  end if;

  update public.households k set
    email         = coalesce(k.email, v_merge.email),
    phone         = coalesce(k.phone, v_merge.phone),
    address_line1 = coalesce(k.address_line1, v_merge.address_line1),
    address_line2 = coalesce(k.address_line2, v_merge.address_line2),
    city          = coalesce(k.city, v_merge.city),
    state         = coalesce(k.state, v_merge.state),
    postal_code   = coalesce(k.postal_code, v_merge.postal_code),
    home_church   = coalesce(k.home_church, v_merge.home_church),
    primary_contact_person_id = coalesce(k.primary_contact_person_id, v_merge.primary_contact_person_id)
   where k.id = p_keep;

  delete from public.households where id = p_merge;

  perform public.write_admin_account_log('merge_households', null, p_merge, p_keep, null,
    v_merge.display_name, v_keep.display_name, v_moved);

  return jsonb_build_object('kept', p_keep, 'moved', v_moved);
end;
$$;
revoke all on function public.admin_merge_households(uuid, uuid) from public, anon;
grant execute on function public.admin_merge_households(uuid, uuid) to authenticated, service_role;


-- =====================================================================
-- 7. Who can sign in to a household, for staff pages
-- =====================================================================
-- p_household_id null: every household (administrators, the Accounts page).
-- One household: Registration read (the registration page's family block).
-- joined_by_name / joined_by_invite_at: the invite this login accepted, when
-- they joined that way (0174).
create or replace function public.staff_household_logins(p_household_id uuid default null)
returns table (
  household_id uuid,
  profile_id uuid,
  name text,
  email text,
  role text,
  joined_at timestamptz,
  invited_by_name text,
  invite_accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_household_id is null then
    if not public.is_admin() then
      raise exception 'Only an administrator may list every household''s sign-ins' using errcode = '42501';
    end if;
  elsif not (public.is_admin() or public.has_grant('registration', 'read')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select hm.household_id,
         hm.profile_id,
         nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
         lower(u.email)::text,
         hm.role,
         hm.created_at,
         nullif(trim(coalesce(ib.first_name, '') || ' ' || coalesce(ib.last_name, '')), ''),
         inv.accepted_at
    from public.household_members hm
    left join public.profiles pr on pr.id = hm.profile_id
    left join auth.users u on u.id = hm.profile_id
    left join lateral (
      select i.invited_by, i.accepted_at
        from public.household_invites i
       where i.household_id = hm.household_id and i.accepted_by = hm.profile_id
       order by i.accepted_at desc nulls last
       limit 1
    ) inv on true
    left join public.profiles ib on ib.id = inv.invited_by
   where p_household_id is null or hm.household_id = p_household_id
   order by hm.household_id, hm.role desc, hm.created_at;
end;
$$;
revoke all on function public.staff_household_logins(uuid) from public, anon;
grant execute on function public.staff_household_logins(uuid) to authenticated, service_role;
