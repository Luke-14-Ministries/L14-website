-- 0140_buddy_sheet_support.sql
--
-- The buddy sheets' support details (Lawrence, 28 Oct 2026: "update the
-- buddy print route (similar to activities)", after 0139 fixed the activity
-- sheets). The sheet read person_support directly, which only Sensitive read
-- (or the family, or the camp doctor) may see, so a coordinator holding
-- Buddies read but not Sensitive printed "No support details on file" for
-- every camper -- a refused read shown as an empty answer (CLAUDE.md).
--
-- buddy_sheet_support(participant_ids): for each CAMPER in a current pairing
-- (buddy_assignments, not ended), what the sheet prints and nothing more --
-- the five pairing notes (communication, getting around, personal care, what
-- is harder, what helps), allergies (severity, ticked allergens, "other",
-- what happens), seizures and rescue medication with their detail, and
-- whether the details were ever saved. Never medications, diagnoses or
-- behaviour history: those stay with the nurse and the office. The decision
-- to print this much on a buddy's sheet is DECISIONS.md, 14 Oct 2026; this
-- function lets the person printing it read what the sheet already carries.
--
-- Buddies read or Sensitive read; definer because the caller holds no read
-- on person_support, and the function's own WHERE is its row filter
-- (CLAUDE.md: a definer view or function filters its own rows).

create function public.buddy_sheet_support(p_participant_ids uuid[])
returns table (
  participant_id           uuid,
  details_saved            boolean,
  communication            text,
  mobility                 text,
  personal_care            text,
  behaviour_triggers       text,
  redirection_strategies   text,
  has_allergies            boolean,
  allergy_severity         text,
  allergens                text[],
  allergy_other            text,
  allergy_detail           text,
  has_seizures             boolean,
  seizure_detail           text,
  has_rescue_medication    boolean,
  rescue_medication_detail text
)
language sql
stable
security definer
set search_path = ''
as $$
  select rp.id,
         s.details_saved_at is not null,
         s.communication,
         s.mobility,
         s.personal_care,
         s.behaviour_triggers,
         s.redirection_strategies,
         coalesce(s.has_allergies, false),
         s.allergy_severity,
         s.allergens,
         s.allergy_other,
         s.allergy_detail,
         coalesce(s.has_seizures, false),
         s.seizure_detail,
         coalesce(s.has_rescue_medication, false),
         s.rescue_medication_detail
    from unnest(p_participant_ids) as x(id)
    join public.registration_participants rp on rp.id = x.id
    left join public.person_support s on s.person_id = rp.person_id
   where (public.has_grant('buddies', 'read') or public.can_view_sensitive())
     and rp.status <> 'cancelled'
     and exists (
           select 1
             from public.buddy_assignments a
            where a.camper_participant_id = rp.id
              and a.ended_at is null);
$$;

comment on function public.buddy_sheet_support(uuid[]) is
  'Buddies read (or Sensitive read). What the buddy sheet prints about a camper in a current pairing: the five pairing notes and the allergy, seizure and rescue-medication facts. Never medications, diagnoses or behaviour history (0140, 28 Oct 2026).';

revoke execute on function public.buddy_sheet_support(uuid[]) from public, anon;
grant execute on function public.buddy_sheet_support(uuid[]) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.buddy_sheet_support(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.buddy_sheet_support(uuid[])', 'execute') then
    raise exception '0140: buddy_sheet_support grants are wrong';
  end if;
end;
$$;
