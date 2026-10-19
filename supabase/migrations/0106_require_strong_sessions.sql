-- 0106_require_strong_sessions.sql
--
-- The switch (security audit H1, 18 Oct 2026; design in 0104). Staff,
-- program-leader and camp-doctor access now needs a STRONG session: one that
-- entered a two-factor code (aal2), or one registered from a remembered
-- browser through mark_session_trusted() (7 days for these roles). A password
-- alone, used against the API, is just a signed-in person with no household.
--
-- Applied after the site that registers remembered browsers was deployed
-- (commit 8a4da2f), so nobody who was legitimately signed in is locked out.
-- Families are unaffected: their own-household rules never read these.

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.session_is_strong() and exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.session_is_strong() and exists (
    select 1 from public.staff s
    where s.profile_id = (select auth.uid()) and s.active and s.role = 'admin'
  );
$$;

create or replace function public.has_grant(p_area text, p_level text default 'read')
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.session_is_strong() and exists (
    select 1
    from public.staff s
    join public.staff_grants g on g.profile_id = s.profile_id
    where s.profile_id = (select auth.uid())
      and s.active
      and g.area = p_area
      and (p_level = 'read' or g.level = 'write')
  );
$$;

create or replace function public.leads_program(p_program_id uuid, p_event_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.session_is_strong() and exists (
    select 1 from public.program_leaders pl
    where pl.profile_id = auth.uid()
      and pl.program_id = p_program_id
      and pl.event_id   = p_event_id
      and pl.active
  );
$$;

-- The doctor's dated access, and a family's own records, in one place; only
-- the doctor's branch needs a strong session.
create or replace function public.can_view_person_support(p_person_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
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
        and current_date between a.starts_on and a.ends_on
    ));
$$;

-- The programs list policy reads program_leaders directly for leaders.
alter policy programs_read on public.programs
  using (public.is_staff()
         or (public.session_is_strong()
             and exists (select 1 from public.program_leaders pl
                          where pl.profile_id = auth.uid() and pl.active)));

-- Expired remembered-browser rows and sessions serve no one.
delete from public.mfa_trusted_sessions where expires_at < now();
delete from public.mfa_trusted_devices where expires_at < now();
