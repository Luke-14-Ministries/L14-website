-- 0139_activity_safety_flags.sql
--
-- The activity sheets' "Health & safety" column (Lawrence, 28 Oct 2026,
-- Testing Script 6 item 17.21). It printed "ask the coordinator" -- which
-- said nothing about what to ask -- and it read person_support directly,
-- which only Sensitive read (or the family, or the camp doctor) may see. An
-- activity leader holding Activities read but not Sensitive got a sheet of
-- dashes: a reassuring blank that was really "you may not see this"
-- (CLAUDE.md: never turn a refused read into an empty answer).
--
-- activity_safety_flags(person_ids): for each person who has an activity
-- signup, the yes/no facts and the allergen NAMES only -- whether the support
-- details were ever saved, allergies (severity, the ticked allergens and the
-- "other" word), seizures, rescue medication, needs a buddy. Never the
-- narrative columns (allergy_detail "what happens", medications, behaviour),
-- the same line 0061 drew for program leaders' rosters. Activities read or
-- Sensitive read; definer because the caller holds no read on person_support,
-- and the function's own WHERE is its row filter (CLAUDE.md: a definer view
-- or function filters its own rows).

create function public.activity_safety_flags(p_person_ids uuid[])
returns table (
  person_id             uuid,
  details_saved         boolean,
  has_allergies         boolean,
  allergy_severity      text,
  allergens             text[],
  allergy_other         text,
  has_seizures          boolean,
  has_rescue_medication boolean,
  buddy_required        boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         s.details_saved_at is not null,
         coalesce(s.has_allergies, false),
         s.allergy_severity,
         s.allergens,
         s.allergy_other,
         coalesce(s.has_seizures, false),
         coalesce(s.has_rescue_medication, false),
         coalesce(s.buddy_required, false)
    from unnest(p_person_ids) as x(id)
    join public.people p on p.id = x.id
    left join public.person_support s on s.person_id = p.id
   where (public.has_grant('activities', 'read') or public.can_view_sensitive())
     and exists (
           select 1
             from public.registration_participants rp
             join public.activity_signups g on g.registration_participant_id = rp.id
            where rp.person_id = p.id
              and rp.status <> 'cancelled');
$$;

comment on function public.activity_safety_flags(uuid[]) is
  'Activities read (or Sensitive read). Yes/no health and safety facts and allergen names for people signed up for activities -- never narrative detail. The activity sheets'' Health & safety column (0139, 28 Oct 2026).';

revoke execute on function public.activity_safety_flags(uuid[]) from public, anon;
grant execute on function public.activity_safety_flags(uuid[]) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.activity_safety_flags(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.activity_safety_flags(uuid[])', 'execute') then
    raise exception '0139: activity_safety_flags grants are wrong';
  end if;
end;
$$;
