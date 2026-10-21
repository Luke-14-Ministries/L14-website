-- 0113_sweep_findings.sql
--
-- The privilege sweep of 20/21 Oct 2026: every table, policy, grant and
-- function enumerated, then an empirical matrix of what ten personas could
-- actually read, write and delete, compared with 0101's mapping table.
-- The boundary held; these are the cells where reality differed.
--
--  1. A family could INSERT a participant row already 'confirmed' (or
--     'waitlisted') on its own registration. 0105's guard reset the money,
--     check-in and confirmed_at on insert but not the status, and the UPDATE
--     path was guarded. Now a family's new row is 'draft' or 'submitted',
--     with submitted_at set here, never 'confirmed'. A family also cannot
--     back-date submitted_at.
--  2. Registration write could attach ANY login to ANY household directly
--     (0105 let it). Linking a login to a household is the administrator's,
--     through admin_link_login_to_household() (0024), which refuses populated
--     households and is logged. The policy now says so.
--  3. Any staff member could confirm agreement signatures (is_staff(), a
--     policy 0101 never touched). Registration write.
--  4. A family could stamp its own support row as reviewed by staff.
--  5. message_log was ALL for staff, though nothing in the site writes it as
--     a staff member (the edge functions write it). Read only.
--  6. pay_in_full_amount() ran as owner for every staff member, so a staffer
--     without Payments read could learn a family's real balance through it.
--     Payments read, or your own registration.
--  7. Six definer helpers were callable by anonymous visitors (count and
--     boolean oracles by id). Nothing public uses them.
--  8. Four policies called auth.uid()/auth.jwt() per row (advisor): wrapped
--     in (select ...) so they run once per query.

-- ---------------------------------------------------------------------------
-- 1. A family's participant rows: status and submitted_at
-- ---------------------------------------------------------------------------
create or replace function public.guard_participant_family_status()
-- Invoker on purpose (CLAUDE.md: a definer trigger sees its owner).
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.has_grant('registration', 'write') then return new; end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted') then new.status := 'submitted'; end if;
    new.confirmed_at := null;
    new.submitted_at := case when new.status = 'submitted' then now() else null end;
  else
    -- submitted_at moves only to "now": set on submitting, never back-dated.
    if new.submitted_at is distinct from old.submitted_at
       and (new.submitted_at is null
            or new.submitted_at < now() - interval '5 minutes'
            or new.submitted_at > now() + interval '5 minutes') then
      new.submitted_at := old.submitted_at;
    end if;
  end if;
  return new;
end;
$$;
-- Named to run after registration_participants_guard_money (name order).
drop trigger if exists registration_participants_zy_family_status on public.registration_participants;
create trigger registration_participants_zy_family_status before insert or update on public.registration_participants
  for each row execute function public.guard_participant_family_status();

-- ---------------------------------------------------------------------------
-- 2. Attaching a login to a household is the administrator's
-- ---------------------------------------------------------------------------
drop policy if exists household_members_insert on public.household_members;
create policy household_members_insert on public.household_members
  for insert to authenticated
  with check (
    (profile_id = (select auth.uid()) and role = 'owner' and public.household_is_unclaimed(household_id))
    or (public.is_admin() and profile_id <> (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 3. Confirming a signature is Registration write
-- ---------------------------------------------------------------------------
drop policy if exists agreement_signatures_update on public.agreement_signatures;
create policy agreement_signatures_update on public.agreement_signatures
  for update to authenticated
  using (public.has_grant('registration', 'write'))
  with check (public.has_grant('registration', 'write'));

-- ---------------------------------------------------------------------------
-- 4. The review stamp on a support row is staff's
-- ---------------------------------------------------------------------------
create or replace function public.guard_support_review_stamp()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.has_grant('sensitive', 'write') or public.has_grant('registration', 'write') then return new; end if;
  if tg_op = 'INSERT' then
    new.reviewed_at := null;
    new.reviewed_by := null;
  else
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
  end if;
  return new;
end;
$$;
drop trigger if exists person_support_review_stamp on public.person_support;
create trigger person_support_review_stamp before insert or update on public.person_support
  for each row execute function public.guard_support_review_stamp();

-- ---------------------------------------------------------------------------
-- 5. message_log: staff read; the edge functions write
-- ---------------------------------------------------------------------------
drop policy if exists message_log_staff on public.message_log;
create policy message_log_staff on public.message_log
  for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.message_log from authenticated;

-- ---------------------------------------------------------------------------
-- 6. pay_in_full_amount(): Payments read, or your own registration
-- ---------------------------------------------------------------------------
create or replace function public.pay_in_full_amount(p_registration_id uuid)
returns integer language plpgsql stable security definer set search_path = 'public'
as $$
declare
  v_balance bigint;
  v_early   bigint;
  v_pot     bigint;
begin
  if auth.uid() is not null
     and not public.has_grant('payments', 'read')
     and p_registration_id not in (select public.my_registration_ids()) then
    return null;
  end if;
  select b.balance_cents, b.early_discount_cents into v_balance, v_early
    from public.registration_balances b where b.registration_id = p_registration_id;
  select coalesce(sum(amount_cents), 0) into v_pot
    from public.early_discount_candidates(p_registration_id);
  return greatest(0, coalesce(v_balance, 0) + coalesce(v_early, 0) - v_pot)::int;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Nothing public calls these
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['activity_availability(uuid)', 'activity_slot_availability(uuid)',
                           'buddies_published(uuid)', 'lodging_published(uuid)',
                           'lodging_published_for(uuid)', 'participant_checked_in(uuid)'] loop
    begin
      execute format('revoke execute on function public.%s from anon, public', f);
    exception when undefined_function then
      raise notice '0113: % not present, skipped', f;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Once per query, not once per row
-- ---------------------------------------------------------------------------
alter policy mfa_trusted_insert on public.mfa_trusted_devices
  with check (profile_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
alter policy programs_read on public.programs
  using (public.is_staff()
         or (public.session_is_strong()
             and exists (select 1 from public.program_leaders pl
                          where pl.profile_id = (select auth.uid()) and pl.active)));
alter policy program_leaders_read on public.program_leaders
  using (profile_id = (select auth.uid()) or public.is_staff());
alter policy data_deletion_requests_insert on public.data_deletion_requests
  with check (household_id in (select public.my_household_ids())
              and requested_by = (select auth.uid())
              and status = 'requested' and handled_by is null and handled_at is null and staff_note is null);
