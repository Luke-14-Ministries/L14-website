-- 0164_allergy_medications.sql
--
-- Which medications (alpha feedback, 12 Nov 2026). A family ticked the
-- "Medications" allergen and set it to Severe, and nothing asked WHICH
-- medications. "Other" already had allergy_other; medications gets the same:
--
--   allergy_medications  which medications, in the family's words. Asked
--                        (and required, lib/support.js supportProblems) once
--                        Medications is ticked; cleared when the tick comes
--                        off or allergies go to "no" (supportPatch).
--
-- Printed beside the word wherever allergen words appear ("Medications:
-- penicillin", allergenWords()). It is an allergen NAME, like the "other"
-- word, so the two definer functions that hand allergen names to staff
-- without Sensitive read carry it too: activity_safety_flags() (0139) and
-- buddy_sheet_support() (0140). Their return type changes, so each is dropped
-- and created again whole, with the same grants and the same grant check.
--
-- log_family_change() is restated (the CLAUDE.md rule for a new
-- person_support column): 0097's text, which matches the live function
-- apart from comments (checked 12 Nov 2026), with allergy_medications in the
-- tracked set and in the safety set that is logged even when staff edit.

alter table public.person_support
  add column if not exists allergy_medications text;

comment on column public.person_support.allergy_medications is
  'Which medications, when the "medications" allergen is ticked (0164). Free text, shown beside the word ("Medications: penicillin").';

-- ---------------------------------------------------------------------------
-- log_family_change()
-- ---------------------------------------------------------------------------
create or replace function public.log_family_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
  v_person uuid;
  v_tracked text[];
  v_identity text[] := array['first_name', 'last_name', 'date_of_birth'];
  -- Logged no matter who edits them. See the header of 0068.
  v_safety text[] := array['has_seizures','seizure_detail',
    'has_rescue_medication','rescue_medication_detail',
    'has_allergies','allergens','allergy_other','allergy_medications','allergy_detail','allergy_severity','medications'];
  v_is_staff boolean;
  v_old jsonb;
  v_new jsonb;
  v_insert boolean := (tg_op = 'INSERT');
  k text;
begin
  if v_uid is null then return new; end if;

  v_is_staff := exists (
    select 1 from public.staff s where s.profile_id = v_uid and s.active
  );

  -- Staff edits are skipped -- EXCEPT identity fields on people (0046) and the
  -- safety fields on person_support (0068).
  if v_is_staff and tg_table_name not in ('people', 'person_support') then
    return new;
  end if;

  if tg_table_name = 'people' then
    v_tracked := array['first_name','last_name','preferred_name','date_of_birth','gender','phone','email'];
    v_household := new.household_id;
    v_person := new.id;
    if v_is_staff then
      v_tracked := v_identity;
    end if;
  elsif tg_table_name = 'households' then
    v_tracked := array['display_name','phone','email','address_line1','address_line2','city','state','postal_code','home_church','how_did_you_hear','how_did_you_hear_from'];
    v_household := new.id;
    v_person := null;
  elsif tg_table_name = 'person_support' then
    v_tracked := array['disabilities','medications','daily_living_supports','mobility','personal_care',
      'communication','allergens','allergy_other','allergy_medications','allergy_detail','dietary_needs','rescue_medication_detail','seizure_detail','behaviour_triggers',
      'redirection_strategies','sleep_notes','other_concerns','has_allergies','allergy_severity','has_seizures',
      'rooming_preferences','likes_dislikes',
      'has_rescue_medication','has_sleep_disturbance','has_caregiver','buddy_required',
      'emergency_contact_name','emergency_contact_phone','emergency_contact_relationship'];
    v_person := new.person_id;
    select p.household_id into v_household from public.people p where p.id = new.person_id;
    -- A staff member editing support details: narrow to the safety set, so
    -- correcting a dietary note stays out of the queue but changing a seizure
    -- description never does.
    if v_is_staff then
      v_tracked := v_safety;
    end if;
  elsif tg_table_name = 'registration_participants' then
    v_tracked := array['camp_role','tshirt_size','first_time_attending'];
    v_person := new.person_id;
    select r.household_id into v_household from public.registrations r where r.id = new.registration_id;
  else
    return new;
  end if;

  -- On INSERT there is no OLD row: compare against an empty object, and log
  -- only what the family actually filled in.
  v_old := coalesce(to_jsonb(old), '{}'::jsonb);
  v_new := to_jsonb(new);
  foreach k in array v_tracked loop
    if v_insert and ((v_new ->> k) is null or (v_new ->> k) = '' or (v_new ->> k) = 'false' or (v_new ->> k) = '[]') then
      continue;
    end if;
    if (v_old ->> k) is distinct from (v_new ->> k) then
      insert into public.family_change_log
        (household_id, person_id, actor_profile_id, source_table, field, old_value, new_value)
      values (v_household, v_person, v_uid, tg_table_name, k, v_old ->> k, v_new ->> k);
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- activity_safety_flags() (0139), with allergy_medications
-- ---------------------------------------------------------------------------
drop function public.activity_safety_flags(uuid[]);

create function public.activity_safety_flags(p_person_ids uuid[])
returns table (
  person_id             uuid,
  details_saved         boolean,
  has_allergies         boolean,
  allergy_severity      text,
  allergens             text[],
  allergy_other         text,
  allergy_medications   text,
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
         s.allergy_medications,
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
  'Activities read (or Sensitive read). Yes/no health and safety facts and allergen names for people signed up for activities -- never narrative detail. The activity sheets'' Health & safety column (0139, 28 Oct 2026; allergy_medications 0164).';

revoke execute on function public.activity_safety_flags(uuid[]) from public, anon;
grant execute on function public.activity_safety_flags(uuid[]) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.activity_safety_flags(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.activity_safety_flags(uuid[])', 'execute') then
    raise exception '0164: activity_safety_flags grants are wrong';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- buddy_sheet_support() (0140), with allergy_medications
-- ---------------------------------------------------------------------------
drop function public.buddy_sheet_support(uuid[]);

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
  allergy_medications      text,
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
         s.allergy_medications,
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
  'Buddies read (or Sensitive read). What the buddy sheet prints about a camper in a current pairing: the five pairing notes and the allergy, seizure and rescue-medication facts. Never medications, diagnoses or behaviour history (0140, 28 Oct 2026; allergy_medications 0164).';

revoke execute on function public.buddy_sheet_support(uuid[]) from public, anon;
grant execute on function public.buddy_sheet_support(uuid[]) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.buddy_sheet_support(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.buddy_sheet_support(uuid[])', 'execute') then
    raise exception '0164: buddy_sheet_support grants are wrong';
  end if;
end;
$$;

-- The trigger took: a restated function is checked, never assumed.
do $$
begin
  if position('allergy_medications' in pg_get_functiondef('public.log_family_change()'::regprocedure)) = 0 then
    raise exception '0164: log_family_change() does not track allergy_medications';
  end if;
end;
$$;
