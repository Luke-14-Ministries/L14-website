-- 0160 -- After a family scholarship request is declined or withdrawn, the
-- family may ask per person again (0159's guard refused it: each person's row
-- still pointed at the closed family request, and the guard refused any
-- family edit of a linked row).
--
-- 0159's guard restated in full (CLAUDE.md: restate, do not patch). The one
-- change: a linked row is closed to the family only while its family request
-- is still waiting or decided; once that request is declined or withdrawn the
-- family may edit the row, and may clear the link (set it to null) as they do.
-- Setting a link is still never theirs.

create or replace function public.guard_scholarship_family_link()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_reg uuid;
  v_old_link uuid := case when tg_op = 'UPDATE' then old.family_request_id end;
begin
  if current_user not in ('authenticated', 'anon') or public.can_decide_scholarships() then
    return new;
  end if;
  if v_old_link is not null and exists (
       select 1 from public.family_scholarship_requests f
        where f.id = v_old_link and f.status in ('requested', 'granted')) then
    raise exception 'This is part of your family''s scholarship request. Change or withdraw the family request instead.'
      using errcode = '42501';
  end if;
  if new.family_request_id is not null and new.family_request_id is distinct from v_old_link then
    raise exception 'A family scholarship share is set by the family request, not directly.'
      using errcode = '42501';
  end if;
  select rp.registration_id into v_reg
    from public.registration_participants rp where rp.id = new.registration_participant_id;
  if exists (select 1 from public.family_scholarship_requests f
              where f.registration_id = v_reg and f.status in ('requested', 'granted')) then
    raise exception 'Your family already has a family scholarship request for this registration. Change that instead.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
begin
  if position('v_old_link' in pg_get_functiondef('public.guard_scholarship_family_link()'::regprocedure)) = 0 then
    raise exception '0160: guard not restated';
  end if;
end $$;
