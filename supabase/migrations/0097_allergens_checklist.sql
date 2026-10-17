-- 0097_allergens_checklist.sql
--
-- Allergens as a tick list (Larry, call of 16 Oct 2026, 3:02 pm; build plan
-- item 2). Until now "what are they?" was one free-text box, so the kitchen
-- list tallied "peanuts", "peanut", "Peanuts (BOT TEST)" and "nuts" as four
-- different things, and the buddy sheet, the Dietary page and the change log
-- each printed whatever the family happened to type.
--
-- Two columns:
--   allergens      the ticked list, from a fixed vocabulary (the eight US
--                  major food allergens plus sesame, latex, insect stings,
--                  medications, synthetic food dyes, and "other");
--   allergy_other  what "other" is, in the family's words.
-- allergy_detail stays: it is now "what happens" (the reaction and what to
-- do), not the list. allergy_severity is unchanged -- one severity per
-- person, as before (0064).
--
-- Existing rows are NOT backfilled. A row with has_allergies and an empty
-- list is a family that answered the old form; every reader shows its
-- allergy_detail as "Other: ..." until the family (or staff) saves again,
-- when the tick list becomes the record. Guessing codes out of free text
-- would put words in a family's mouth on a list a kitchen cooks from.
--
-- Adding a column to person_support is not finished until
-- log_family_change() is redefined (the 0064 trap, CLAUDE.md): both new
-- columns are tracked, and both are in the safety set that is logged even
-- when staff make the change.

alter table public.person_support
  add column if not exists allergens text[] not null default '{}'::text[],
  add column if not exists allergy_other text;

alter table public.person_support
  drop constraint if exists person_support_allergens_known;
alter table public.person_support
  add constraint person_support_allergens_known
  check (allergens <@ array[
    'milk','egg','peanut','tree_nuts','soy','wheat','fish','shellfish',
    'sesame','latex','insect_stings','medications','food_dyes','other'
  ]::text[]);

comment on column public.person_support.allergens is
  'Ticked allergens, from the fixed list in lib/support.js (ALLERGENS). Empty on rows saved before 0097: those show allergy_detail as "Other" until re-saved.';
comment on column public.person_support.allergy_other is
  'What "other" is, when it is ticked. Free text, shown beside the ticked words.';
comment on column public.person_support.allergy_detail is
  'Since 0097: what happens and what to do (the reaction), not the list of allergens. On rows saved before 0097 it still holds the list.';

-- log_family_change(): 0084's text with the two new columns in the tracked
-- and safety sets, and one more "nothing filled in" shape skipped on INSERT:
-- an empty array arrives as '[]'.
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
    'has_allergies','allergens','allergy_other','allergy_detail','allergy_severity','medications'];
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
      'communication','allergens','allergy_other','allergy_detail','dietary_needs','rescue_medication_detail','seizure_detail','behaviour_triggers',
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
