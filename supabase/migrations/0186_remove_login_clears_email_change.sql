-- 0186_remove_login_clears_email_change.sql
--
-- 23 Nov 2026 (the completeness pass, P99). When the household owner removes
-- a login (remove_household_login(), 0178), any contact-email change that
-- login had asked for stayed pending in household_email_changes. The
-- confirmation link sent to the new address still worked, so a person who no
-- longer has access to the household could still change its contact email.
--
-- This restates remove_household_login() from 0178 with one added line: the
-- removed login's pending change is deleted before the membership is. A
-- change asked for by someone else (the owner, or staff) is left alone.
-- Grants are restated unchanged.

begin;

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

  -- 0186: the removed login's pending contact-email change goes too, so its
  -- confirmation link stops working.
  delete from public.household_email_changes
   where household_id = p_household_id and requested_by = p_profile_id;
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

commit;
