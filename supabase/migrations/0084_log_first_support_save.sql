-- 0084: a family's FIRST save of support details is logged, like every later one.
--
-- Found by the automated round on Testing Script 4 (14 Oct 2026): Ada
-- BOTFAMILY-A entered Quill's allergy for the first time -- allergies = yes,
-- "peanuts (BOT TEST)", mild -- and Recent Changes showed nothing. The
-- person_support trigger (0013) fires AFTER UPDATE only, so a brand-new row,
-- which is exactly when a family first tells us about a seizure or an
-- anaphylactic allergy, never reached family_change_log. 0051 said safety
-- changes are "always logged"; this makes that true for the first save too.
--
-- On INSERT there is no OLD row, so the function logs each tracked field that
-- is actually filled in (not null, not empty, not false). That keeps the first
-- save from spraying thirty "null -> false" rows into the queue while still
-- recording every fact the family stated. Everything else in the function is
-- unchanged from 0068.

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
    'has_allergies','allergy_detail','allergy_severity','medications'];
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
      'communication','allergy_detail','dietary_needs','rescue_medication_detail','seizure_detail','behaviour_triggers',
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
    if v_insert and ((v_new ->> k) is null or (v_new ->> k) = '' or (v_new ->> k) = 'false') then
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

-- The trigger itself: insert as well as update, for person_support only. The
-- other three tables keep their update-only triggers -- a new person or a new
-- registration row is a registration event, already visible to staff as such.
drop trigger if exists person_support_family_log on public.person_support;
create trigger person_support_family_log
  after insert or update on public.person_support
  for each row execute function public.log_family_change();
