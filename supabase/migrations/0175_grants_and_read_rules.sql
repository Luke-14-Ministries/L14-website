-- 0175 -- Function grants and read rules tightened (security review, 23 Nov 2026)
--
-- The review of 23 Nov 2026 (findings S1-01, S1-03, S1-10 to S1-13, S1-15,
-- S1-19 to S1-21, S1-26, S3-18, S3-19) found nothing open to the public, but
-- several doors wider than they need to be. None of this changes what a
-- family or a properly granted staff member sees.
--
--   1. Seventeen policies were written without a TO clause, so they applied
--      to every role, the signed-out visitor included. anon has no grant on
--      those tables, so nothing leaked, but one of them is on storage.objects,
--      which anon CAN query, and it calls has_grant(). They now name
--      authenticated.
--   2. Postgres gives EXECUTE on every new function to PUBLIC. A signed-out
--      visitor could call 26 functions in public (staff lookups, the
--      registration submit, check-in), each guarded inside, but none meant
--      for them. EXECUTE now comes from explicit grants only: authenticated
--      keeps exactly what it could run before, service_role everything, and
--      anon only the three the signed-out pages use (see section 2).
--      From now on a new function needs its own
--        grant execute on function ... to authenticated, service_role;
--      (authenticated only if families or staff call it). CLAUDE.md says so.
--   3. PostgreSQL 17's MAINTAIN privilege (VACUUM, REINDEX, REFRESH) is kept
--      from anon and authenticated.
--   4. Staff over-reads closed: statements of need, the stored email log and
--      a family's paid total now need Registration read or Payments read, not
--      just any staff login; staff notes are signed by their author and never
--      edited; the camp doctor's dated access covers people with a live place
--      (submitted, confirmed or waitlisted), not drafts or cancellations; a
--      family can no longer delete its own medical and support record.
--   5. A login that already has a household cannot make a second one.
--   6. Stored file paths and the three staff-typed links are checked by the
--      database too, not only by the page that writes them. Counted on the
--      live database first (23 Nov 2026): 0 of 38 photo rows, 0 waiver uploads
--      and 0 links fail, so every check is validated.

-- ---------------------------------------------------------------------------
-- 1. Policies that applied to every role now apply to signed-in users only
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname in ('public', 'storage')
       and roles = '{public}'
  loop
    execute format('alter policy %I on %I.%I to authenticated',
                   r.policyname, r.schemaname, r.tablename);
    n := n + 1;
  end loop;
  raise notice '0175: % policies moved from PUBLIC to authenticated', n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. EXECUTE from explicit grants only
-- ---------------------------------------------------------------------------
-- Before revoking, give authenticated an explicit grant on every function it
-- can run today (many reach it only through PUBLIC: is_staff(), has_grant(),
-- the storage helpers). Trigger and event-trigger functions are left out:
-- Postgres does not check EXECUTE when a trigger fires. Functions authenticated
-- cannot run today (early_discount_candidates(), record_returned_payment_fee(),
-- refresh_household_names() and the like) stay that way -- a blanket grant
-- would have opened them.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
       and pg_get_userbyid(p.proowner) = current_user
       and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to authenticated', r.fn);
  end loop;
end;
$$;

grant execute on all functions in schema public to service_role;
revoke execute on all functions in schema public from public, anon;

-- What a signed-out visitor needs, and nothing else. Checked on the local
-- copy 23 Nov 2026: the only tables anon may read are events, event_options,
-- activities and seasons; their policies call is_staff() and nothing else
-- (is_staff() is a definer, so what it calls inside needs no grant). The two
-- token pages are reached from an email, possibly signed out:
--   /auth/confirm-contact/done  -> confirm_household_email_change(text)
--   /auth/household-invite      -> household_invite_preview(text)
grant execute on function public.is_staff() to anon;
grant execute on function public.confirm_household_email_change(text) to anon;
grant execute on function public.household_invite_preview(text) to anon;

-- New functions owned by postgres stop reaching PUBLIC by default.
-- authenticated must be granted by the migration that makes the function.
--
-- service_role keeps getting EXECUTE on new public functions by default.
-- The local Supabase copy already had that default, but live did not (live's
-- postgres defaults for functions in public were postgres alone, read 23 Nov
-- 2026): until now live's service_role reached new functions only through
-- PUBLIC. Without this line, a function added by a later migration would be
-- refused to the crons, webhooks and reminders on live while every local
-- check passed. It makes live match local. Migrations still grant
-- service_role by name as well (CLAUDE.md), so neither copy depends on it.
alter default privileges for role postgres in schema public grant execute on functions to service_role;
alter default privileges for role postgres revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- 3. MAINTAIN (PostgreSQL 17 and later; the local test server is 16)
-- ---------------------------------------------------------------------------
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4a. person_support: a family edits its record but never deletes it
-- ---------------------------------------------------------------------------
-- The FOR ALL policy let a family DELETE its own medical and support row,
-- which would also take the staff review stamp with it. The site never
-- deletes one; staff with Sensitive write still can.
drop policy if exists person_support_write on public.person_support;
drop policy if exists person_support_insert on public.person_support;
drop policy if exists person_support_update on public.person_support;
drop policy if exists person_support_delete on public.person_support;

create policy person_support_insert on public.person_support
  for insert to authenticated
  with check (
    exists (select 1 from public.people p
             where p.id = person_support.person_id
               and p.household_id in (select public.my_household_ids()))
    or public.has_grant('sensitive', 'write')
  );

create policy person_support_update on public.person_support
  for update to authenticated
  using (
    exists (select 1 from public.people p
             where p.id = person_support.person_id
               and p.household_id in (select public.my_household_ids()))
    or public.has_grant('sensitive', 'write')
  )
  with check (
    exists (select 1 from public.people p
             where p.id = person_support.person_id
               and p.household_id in (select public.my_household_ids()))
    or public.has_grant('sensitive', 'write')
  );

create policy person_support_delete on public.person_support
  for delete to authenticated
  using (public.has_grant('sensitive', 'write'));

-- ---------------------------------------------------------------------------
-- 4b. What a family has paid: Registration read or Payments read
-- ---------------------------------------------------------------------------
-- Was any staff login. Registration read stays in so a reviewer without
-- Payments read still sees the true paid amount when confirming (the 0111
-- fix the Review page relies on). Same body as 0133 otherwise.
create or replace function public.registration_paid_cents(p_registration_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select case when public.has_grant('registration', 'read')
                or public.has_grant('payments', 'read')
                or p_registration_id in (select public.my_registration_ids()) then
    (select coalesce(sum(p.amount_cents), 0) from public.payments p
      where p.registration_id = p_registration_id and p.status in ('succeeded', 'refunded'))
    - (select coalesce(sum(r.amount_cents), 0) from public.payment_refunds r
        where r.registration_id = p_registration_id and r.status = 'succeeded')
  end;
$function$;
revoke all on function public.registration_paid_cents(uuid) from public, anon;
grant execute on function public.registration_paid_cents(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4c. Statements of need and the email log: Registration or Payments read
-- ---------------------------------------------------------------------------
-- A family's statement of need (0159) and the full text of every email sent
-- to a family (0134) were readable by any staff login, an activities leader
-- included. Families keep their own scholarship requests; they never read
-- message_log.
drop policy if exists family_scholarship_requests_select on public.family_scholarship_requests;
create policy family_scholarship_requests_select on public.family_scholarship_requests
  for select to authenticated
  using (
    public.has_grant('payments', 'read')
    or public.has_grant('registration', 'read')
    or registration_id in (
      select r.id from public.registrations r
       where r.household_id in (select public.my_household_ids()))
  );

drop policy if exists message_log_staff on public.message_log;
create policy message_log_staff on public.message_log
  for select to authenticated
  using (public.has_grant('payments', 'read') or public.has_grant('registration', 'read'));

-- ---------------------------------------------------------------------------
-- 4d. Staff notes are signed by their author and never rewritten
-- ---------------------------------------------------------------------------
alter table public.registration_notes alter column author_id set default auth.uid();

drop policy if exists registration_notes_insert on public.registration_notes;
create policy registration_notes_insert on public.registration_notes
  for insert to authenticated
  with check (public.is_staff() and author_id = (select auth.uid()));

revoke update, delete on public.registration_notes from authenticated;

-- ---------------------------------------------------------------------------
-- 4e. The camp doctor: people with a live place only
-- ---------------------------------------------------------------------------
-- The dated grant reached anyone with ANY row at the event, a half-finished
-- draft or a cancelled place included. Statuses checked against
-- registration_participants' CHECK (draft, submitted, waitlisted, confirmed,
-- cancelled).
create or replace function public.can_view_person_support(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    public.can_view_sensitive()
    or exists (
      select 1 from public.people p
      where p.id = p_person_id
        and p.household_id in (select public.my_household_ids())
    )
    or (public.session_is_strong() and exists (
      select 1
      from public.event_medical_access a
      join public.registrations r on r.event_id = a.event_id
      join public.registration_participants rp on rp.registration_id = r.id
      where a.profile_id = (select auth.uid())
        and rp.person_id = p_person_id
        and rp.status in ('submitted', 'confirmed', 'waitlisted')
        and current_date between a.starts_on and a.ends_on
    ));
$function$;
revoke all on function public.can_view_person_support(uuid) from public, anon;
grant execute on function public.can_view_person_support(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. One household per login
-- ---------------------------------------------------------------------------
-- households_insert was WITH CHECK (true): any login could make empty
-- households without end. A first-time family (create_my_household(),
-- submit_family_registration()) has no membership when it inserts, so it is
-- unaffected; staff with Registration write may still create one.
create or replace function public.i_have_no_household()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
     and not exists (select 1 from public.household_members m
                      where m.profile_id = (select auth.uid()));
$function$;
revoke all on function public.i_have_no_household() from public, anon;
grant execute on function public.i_have_no_household() to authenticated, service_role;

drop policy if exists households_insert on public.households;
create policy households_insert on public.households
  for insert to authenticated
  with check (public.i_have_no_household() or public.has_grant('registration', 'write'));

drop policy if exists household_members_insert on public.household_members;
create policy household_members_insert on public.household_members
  for insert to authenticated
  with check (
    (profile_id = (select auth.uid()) and role = 'owner'
       and public.household_is_unclaimed(household_id)
       and public.i_have_no_household())
    or (public.is_admin() and profile_id <> (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 6. Stored paths and staff-typed links
-- ---------------------------------------------------------------------------
-- A file row points at a file in the person's (or participant's) own folder,
-- which is what the storage policies check. Validated: 0 rows fail on live.
alter table public.person_photos
  drop constraint if exists person_photos_path_in_own_folder;
alter table public.person_photos
  add constraint person_photos_path_in_own_folder
  check (storage_path like person_id::text || '/%') not valid;
alter table public.person_photos validate constraint person_photos_path_in_own_folder;

alter table public.activity_waiver_uploads
  drop constraint if exists activity_waiver_uploads_path_in_own_folder;
alter table public.activity_waiver_uploads
  add constraint activity_waiver_uploads_path_in_own_folder
  check (storage_path like registration_participant_id::text || '/%') not valid;
alter table public.activity_waiver_uploads validate constraint activity_waiver_uploads_path_in_own_folder;

-- Links staff type that families click: a web address, nothing else
-- (no javascript: or data: links), and not absurdly long.
alter table public.activities drop constraint if exists activities_provider_url_web;
alter table public.activities
  add constraint activities_provider_url_web
  check (provider_url is null or (provider_url ~* '^https?://' and length(provider_url) <= 2000)) not valid;
alter table public.activities validate constraint activities_provider_url_web;

alter table public.lodgings drop constraint if exists lodgings_schematic_url_web;
alter table public.lodgings
  add constraint lodgings_schematic_url_web
  check (schematic_url is null or (schematic_url ~* '^https?://' and length(schematic_url) <= 2000)) not valid;
alter table public.lodgings validate constraint lodgings_schematic_url_web;

alter table public.events drop constraint if exists events_campus_map_url_web;
alter table public.events
  add constraint events_campus_map_url_web
  check (campus_map_url is null or (campus_map_url ~* '^https?://' and length(campus_map_url) <= 2000)) not valid;
alter table public.events validate constraint events_campus_map_url_web;
