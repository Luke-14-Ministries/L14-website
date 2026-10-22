-- =====================================================================
-- Luke 14 Ministries — row-level security test harness
--
-- Not part of the migration. Run against a scratch database to prove
-- the policies do what the comments claim. Every check either passes
-- silently or raises.
--
-- Personas:
--   familyA      — an ordinary account holder
--   familyB      — a different family, used to prove isolation
--   registrar    — staff, registrations and money, NO sensitive access
--   coordinator  — staff, buddies and activities, NO sensitive access
--   familyCoord  — staff WITH the standing sensitive grant
--   doctor       — camp doctor, event-scoped medical access only
--   (anon)       — not logged in
-- =====================================================================

\set ON_ERROR_STOP on

-- Every persona signs in with two-factor (aal2) unless a test says otherwise:
-- since 0106 staff, leader and doctor access needs a strong session.
create or replace function pg_temp.as_user(u uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', '{"aal":"aal2"}', true);
end;
$$;

-- A password-only session (aal1), optionally with a session id.
create or replace function pg_temp.as_user_aal1(u uuid, sid text default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('aal', 'aal1', 'session_id', sid)::text, true);
end;
$$;

-- expect(label, actual, expected)
create or replace function pg_temp.expect(lbl text, actual bigint, expected bigint)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — got %, expected %', lbl, actual, expected;
  end if;
end;
$$;

-- expect_denied(label, sql) — the statement must fail
create or replace function pg_temp.expect_denied(lbl text, stmt text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    return;   -- denial is the pass
  end;
  raise exception 'FAIL: % — statement was ALLOWED and should not have been', lbl;
end;
$$;

-- expect_allowed(label, sql)
create or replace function pg_temp.expect_allowed(lbl text, stmt text)
returns void language plpgsql as $$
begin
  execute stmt;
exception when others then
  raise exception 'FAIL: % — statement was DENIED: %', lbl, sqlerrm;
end;
$$;

-- expect_no_effect(label, sql)
--
-- A row hidden by a USING clause is not an error — the statement runs
-- and touches nothing. That is a different failure mode from a WITH
-- CHECK denial, which raises. Both are real protections and both need
-- testing, but only one of them throws.
create or replace function pg_temp.expect_no_effect(lbl text, stmt text)
returns void language plpgsql as $$
declare n integer;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: % — statement affected % row(s), expected 0', lbl, n;
  end if;
exception
  when raise_exception then raise;
  when others then return;   -- an outright denial is also a pass
end;
$$;


-- ---------------------------------------------------------------------
-- Seed, as the table owner (bypasses RLS)
-- ---------------------------------------------------------------------

do $$
declare
  uA uuid := 'aaaa0000-0000-4000-8000-000000000001';
  uB uuid := 'bbbb0000-0000-4000-8000-000000000002';
  uR uuid := 'cccc0000-0000-4000-8000-000000000003';
  uC uuid := 'dddd0000-0000-4000-8000-000000000004';
  uF uuid := 'eeee0000-0000-4000-8000-000000000005';
  uD uuid := 'ffff0000-0000-4000-8000-000000000006';
  hA uuid; hB uuid;
  pA uuid; pB uuid; pVol uuid;
  ev uuid; optCamper uuid; optVol uuid;
  regA uuid; regB uuid;
  rpA uuid; rpB uuid; rpVol uuid;
  act uuid; agr uuid;
begin
  insert into auth.users (id, email) values
    (uA,'a@example.test'), (uB,'b@example.test'), (uR,'r@example.test'),
    (uC,'c@example.test'), (uF,'f@example.test'), (uD,'d@example.test');
  -- profiles are created by the trigger

  insert into public.staff (profile_id, role, can_view_sensitive) values
    (uR, 'registrar',   false),
    (uC, 'coordinator', false),
    (uF, 'registrar',   true);

  -- Since 0101 the policies read staff_grants, not the role. These are the
  -- rows 0100's backfill writes for each role (it ran before this seed), so
  -- the personas mean what their names say.
  insert into public.staff_grants (profile_id, area, level) values
    (uR, 'registration', 'write'), (uR, 'payments', 'write'), (uR, 'background_checks', 'read'),
    (uR, 'activities', 'read'), (uR, 'rooming', 'read'), (uR, 'buddies', 'read'), (uR, 'programs', 'read'),
    (uC, 'registration', 'read'), (uC, 'background_checks', 'read'),
    (uC, 'activities', 'write'), (uC, 'rooming', 'write'), (uC, 'buddies', 'write'), (uC, 'programs', 'write'),
    (uF, 'registration', 'write'), (uF, 'payments', 'write'), (uF, 'background_checks', 'read'),
    (uF, 'activities', 'read'), (uF, 'rooming', 'read'), (uF, 'buddies', 'read'), (uF, 'programs', 'read'),
    (uF, 'sensitive', 'write');

  insert into public.households (id, display_name) values
    (gen_random_uuid(), 'Family A') returning id into hA;
  insert into public.households (id, display_name) values
    (gen_random_uuid(), 'Family B') returning id into hB;

  insert into public.household_members (household_id, profile_id, role)
    values (hA, uA, 'owner'), (hB, uB, 'owner');

  insert into public.people (household_id, first_name, last_name)
    values (hA, 'Alex', 'AAA') returning id into pA;
  insert into public.people (household_id, first_name, last_name)
    values (hB, 'Bella', 'BBB') returning id into pB;
  insert into public.people (household_id, first_name, last_name)
    values (hA, 'Vic', 'AAA') returning id into pVol;

  insert into public.person_support (person_id, disabilities, has_seizures)
    values (pA, 'sample text', true);
  insert into public.person_support (person_id, disabilities)
    values (pB, 'other family');

  insert into public.events (id, name, event_type, starts_on, ends_on, published)
    values (gen_random_uuid(), 'Test Week', 'camp_week',
            current_date, current_date + 4, true) returning id into ev;

  insert into public.event_options (event_id, name, participant_role, fee_cents, published)
    values (ev, 'Camper', 'camper', 49500, true) returning id into optCamper;
  insert into public.event_options (event_id, name, participant_role, fee_cents, published)
    values (ev, 'Volunteer', 'volunteer', 0, true) returning id into optVol;

  insert into public.registrations (household_id, event_id) values (hA, ev) returning id into regA;
  insert into public.registrations (household_id, event_id) values (hB, ev) returning id into regB;

  -- 0114: the fee lives on participant_money, filled by trigger from the option.
  insert into public.registration_participants (registration_id, person_id, event_option_id)
    values (regA, pA, optCamper) returning id into rpA;
  insert into public.registration_participants (registration_id, person_id, event_option_id)
    values (regB, pB, optCamper) returning id into rpB;
  insert into public.registration_participants (registration_id, person_id, event_option_id)
    values (regA, pVol, optVol) returning id into rpVol;

  insert into public.registration_notes (registration_id, body)
    values (regA, 'staff only comment');

  insert into public.activities (id, event_id, name, booking_mode, provider_url)
    values (gen_random_uuid(), ev, 'Rafting', 'signup', 'https://example.test/group')
    returning id into act;

  insert into public.agreements (id, key, version, title, delivery, external_url)
    values (gen_random_uuid(), 'rafting_waiver', 1, 'Rafting waiver',
            'external_link', 'https://example.test/waiver')
    returning id into agr;

  -- The waiver is a condition of the ACTIVITY, not the event (0001: exactly
  -- one of event_id / activity_id). 0117 copies such rows with the event.
  insert into public.agreement_requirements (agreement_id, event_id, activity_id, applies_to, is_required)
    values (agr, null, act, 'participant', true);

  insert into public.coupons (code, percent_off, max_redemptions)
    values ('SECRET25', 25, 1);

  insert into public.buddy_assignments (event_id, buddy_participant_id, camper_participant_id)
    values (ev, rpVol, rpA);

  insert into public.message_log (to_email, template_key) values ('a@example.test', 'welcome');

  -- camp doctor: in-date grant for this event only
  insert into public.event_medical_access (profile_id, event_id, starts_on, ends_on)
    values (uD, ev, current_date - 1, current_date + 7);

  -- stash ids for the checks below
  create temp table t (k text primary key, v uuid);
  insert into t values
    ('uA',uA),('uB',uB),('uR',uR),('uC',uC),('uF',uF),('uD',uD),
    ('hA',hA),('hB',hB),('pA',pA),('pB',pB),
    ('ev',ev),('regA',regA),('rpA',rpA),('rpB',rpB),('rpVol',rpVol),
    ('act',act),('agr',agr);
end;
$$;


-- ---------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------

do $$
declare
  uA uuid; uB uuid; uR uuid; uC uuid; uF uuid; uD uuid;
  hA uuid; hB uuid; pA uuid; pB uuid; ev uuid; regA uuid;
  rpA uuid; rpB uuid; agr uuid; pNew uuid; optGen uuid;
  act uuid; evCopy uuid;
  horses uuid; horsesAgr uuid; regB uuid; logId uuid;
  planId uuid; planLogId uuid;
  n bigint; m bigint;
  oldStatus text;
begin
  select v into uA from t where k='uA';   select v into uB from t where k='uB';
  select v into uR from t where k='uR';   select v into uC from t where k='uC';
  select v into uF from t where k='uF';   select v into uD from t where k='uD';
  select v into hA from t where k='hA';   select v into pA from t where k='pA';
  select v into hB from t where k='hB';
  select v into pB from t where k='pB';   select v into ev from t where k='ev';
  select v into regA from t where k='regA';
  select v into rpA from t where k='rpA'; select v into rpB from t where k='rpB';
  select v into agr from t where k='agr';   select v into act from t where k='act';

  set local role authenticated;

  ---- family isolation -------------------------------------------------
  perform pg_temp.as_user(uA);
  select count(*) into n from public.households;
  perform pg_temp.expect('A sees only own household', n, 1);
  select count(*) into n from public.people;
  perform pg_temp.expect('A sees only own people', n, 2);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('A sees only own support records', n, 1);
  select count(*) into n from public.registrations;
  perform pg_temp.expect('A sees only own registration', n, 1);
  select count(*) into n from public.registration_participants;
  perform pg_temp.expect('A sees only own participants', n, 2);
  select count(*) into n from public.registration_balances;
  perform pg_temp.expect('balances view respects RLS', n, 1);

  perform pg_temp.as_user(uB);
  select count(*) into n from public.people where id = pA;
  perform pg_temp.expect('B cannot see A''s person', n, 0);
  select count(*) into n from public.person_support where person_id = pA;
  perform pg_temp.expect('B cannot see A''s support record', n, 0);

  ---- staff-only tables are invisible to families ----------------------
  perform pg_temp.as_user(uA);
  select count(*) into n from public.registration_notes;
  perform pg_temp.expect('family cannot read staff notes', n, 0);
  select count(*) into n from public.coupons;
  perform pg_temp.expect('family cannot read coupons', n, 0);
  select count(*) into n from public.message_log;
  perform pg_temp.expect('family cannot read message log', n, 0);
  -- volunteer_clearances was a compatibility view, dropped in 0092; the
  -- table behind it is person_clearances.
  select count(*) into n from public.person_clearances;
  perform pg_temp.expect('family cannot read clearances', n, 0);

  ---- the sensitive tier ----------------------------------------------
  perform pg_temp.as_user(uR);
  select count(*) into n from public.people;
  perform pg_temp.expect('registrar sees all people', n, 3);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('registrar WITHOUT sensitive grant sees no support records', n, 0);

  perform pg_temp.as_user(uC);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('coordinator sees no support records', n, 0);

  perform pg_temp.as_user(uF);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('sensitive-grant staff sees all support records', n, 2);

  ---- the camp doctor --------------------------------------------------
  perform pg_temp.as_user(uD);
  select count(*) into n from public.person_support where person_id = pA;
  perform pg_temp.expect('doctor sees support for a camper at their event', n, 1);
  select count(*) into n from public.person_support where person_id = pB;
  perform pg_temp.expect('doctor also sees B (also at this event)', n, 1);

  ---- family write limits ----------------------------------------------
  perform pg_temp.as_user(uA);
  -- 0113: a family's new participant is never born confirmed
  -- a general (unpinned) option, as the real camp weeks have
  set local role postgres;
  insert into public.event_options (event_id, name, fee_cents, published) values (ev, 'General', 10000, true) returning id into optGen;
  set local role authenticated;
  perform pg_temp.as_user(uA);
  insert into public.people (household_id, first_name, last_name) values (hA, 'Newest', 'AAA') returning id into pNew;
  insert into public.registration_participants (registration_id, person_id, event_option_id, camp_role, status, confirmed_at)
    values (regA, pNew, optGen, 'camper', 'confirmed', now());
  select count(*) into n from public.registration_participants
   where registration_id = regA and person_id = pNew and status = 'submitted' and confirmed_at is null and submitted_at is not null;
  perform pg_temp.expect('a family-inserted "confirmed" row is stored as submitted', n, 1);
  -- 0114: the money row is created by the definer trigger, fee from the option.
  select count(*) into n from public.participant_money pm
    join public.registration_participants rp on rp.id = pm.participant_id
   where rp.person_id = pNew and pm.fee_cents = 10000 and pm.scholarship_cents = 0 and pm.discount_cents = 0;
  perform pg_temp.expect('a family-inserted participant gets its money row with the option''s fee (0114)', n, 1);
  set local role postgres;
  delete from public.registration_participants where person_id = pNew;
  delete from public.people where id = pNew;
  delete from public.event_options where id = optGen;
  set local role authenticated;
  -- 0113: the review stamp on a support row is staff's
  perform pg_temp.as_user(uA);
  update public.person_support set reviewed_at = now(), reviewed_by = uR where person_id = pA;
  select count(*) into n from public.person_support where person_id = pA and reviewed_at is not null;
  perform pg_temp.expect('a family cannot stamp its own support row as reviewed', n, 0);
  perform pg_temp.expect_allowed('family may submit own participant',
    format('update public.registration_participants set status=''submitted'' where id=%L', rpA));
  perform pg_temp.expect_denied('family may NOT confirm own participant',
    format('update public.registration_participants set status=''confirmed'' where id=%L', rpA));
  perform pg_temp.expect_no_effect('family may NOT touch another family''s participant',
    format('update public.registration_participants set status=''cancelled'' where id=%L', rpB));
  perform pg_temp.expect_denied('family may NOT record a payment',
    format('insert into public.payments (registration_id, amount_cents, method) values (%L, 1000, ''check'')', regA));
  perform pg_temp.expect_denied('family may NOT write a staff note',
    format('insert into public.registration_notes (registration_id, body) values (%L, ''sneaky'')', regA));
  perform pg_temp.expect_denied('family may NOT assert external confirmation',
    format('insert into public.agreement_signatures (agreement_id, person_id, status) values (%L, %L, ''confirmed_external'')', agr, pA));
  perform pg_temp.expect_allowed('family MAY self-report a waiver',
    format('insert into public.agreement_signatures (agreement_id, person_id, status) values (%L, %L, ''self_reported'')', agr, pA));

  ---- staff write limits -----------------------------------------------
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_allowed('registrar may record a cheque',
    format('insert into public.payments (registration_id, amount_cents, method) values (%L, 5000, ''check'')', regA));
  perform pg_temp.expect_denied('registrar may NOT hand-write a card payment',
    format('insert into public.payments (registration_id, amount_cents, method) values (%L, 5000, ''card'')', regA));
  perform pg_temp.expect_denied('registrar may NOT move buddies',
    format('insert into public.buddy_assignments (event_id, buddy_participant_id, camper_participant_id) values (%L, %L, %L)', ev, rpB, rpA));

  perform pg_temp.as_user(uC);
  perform pg_temp.expect_allowed('coordinator MAY move buddies',
    format('insert into public.buddy_assignments (event_id, buddy_participant_id, camper_participant_id) values (%L, %L, %L)', ev, rpB, rpA));
  -- Program placement is coordination too (0090); the function raises for
  -- anyone else, and a direct write to program_id is still the registrar's
  -- policy -- a coordinator cannot reach the column except through it.
  perform pg_temp.expect_allowed('coordinator MAY place somebody in a program (0090)',
    format('select public.place_in_program(array[%L]::uuid[], (select id from public.programs where active order by sort_order limit 1))', rpA));
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_denied('registrar may NOT place into a program (0090)',
    format('select public.place_in_program(array[%L]::uuid[], null)', rpA));
  perform pg_temp.as_user(uA);
  perform pg_temp.expect_denied('family may NOT place into a program (0090)',
    format('select public.place_in_program(array[%L]::uuid[], null)', rpA));

  ---- the grants are the access (0100 / 0101) ---------------------------
  -- Since 0101 every staff policy asks has_grant(area, level). These checks
  -- prove the grant, not the role label, decides -- including at runtime.
  perform pg_temp.as_user(uC);
  select count(*) into n from public.payments;
  perform pg_temp.expect('coordinator (no payments grant) sees no payments', n, 0);
  perform pg_temp.expect_denied('coordinator may NOT record a cheque',
    format('insert into public.payments (registration_id, amount_cents, method) values (%L, 5000, ''check'')', regA));
  perform pg_temp.expect_no_effect('coordinator may NOT edit an activity definition (setup write)',
    'update public.activities set name = name');

  perform pg_temp.as_user(uR);
  select count(*) into n from public.payments;
  perform pg_temp.expect('registrar (payments write) sees the cheque', n, 1);
  select count(*) into n from public.person_clearances;
  perform pg_temp.expect('registrar (background checks READ) cannot read the clearance table', n, 0);
  perform pg_temp.expect_no_effect('registrar (no sensitive) may NOT edit a support record',
    'update public.person_support set other_concerns = ''x''');

  perform pg_temp.as_user(uF);
  perform pg_temp.expect_allowed('sensitive WRITE may edit a support record',
    format('update public.person_support set other_concerns = other_concerns where person_id = %L', pA));

  -- Grant one area at runtime: exactly that area opens.
  set local role postgres;
  insert into public.staff_grants (profile_id, area, level) values (uC, 'payments', 'read');
  set local role authenticated;
  perform pg_temp.as_user(uC);
  select count(*) into n from public.payments;
  perform pg_temp.expect('coordinator given payments READ now sees the cheque', n, 1);
  perform pg_temp.expect_denied('payments READ still may NOT record a cheque',
    format('insert into public.payments (registration_id, amount_cents, method) values (%L, 5000, ''check'')', regA));
  set local role postgres;
  delete from public.staff_grants where profile_id = uC and area = 'payments';

  -- A deactivated staff row holds nothing, whatever grants it has.
  update public.staff set active = false where profile_id = uR;
  set local role authenticated;
  perform pg_temp.as_user(uR);
  select count(*) into n from public.payments;
  perform pg_temp.expect('a deactivated registrar sees no payments', n, 0);
  select count(*) into n from public.people;
  perform pg_temp.expect('a deactivated registrar sees no people', n, 0);
  set local role postgres;
  update public.staff set active = true where profile_id = uR;
  set local role authenticated;

  -- Deciding a scholarship needs Payments AND Registration write (0102):
  -- Finance (payments W, registration R) records money but does not decide.
  set local role postgres;
  insert into public.staff_grants (profile_id, area, level) values (uC, 'payments', 'write');
  set local role authenticated;
  perform pg_temp.as_user(uC);
  perform pg_temp.expect_denied('Finance-shaped grants may NOT grant a scholarship (0102)',
    format('insert into public.scholarships (registration_participant_id, granted_cents, status) values (%L, 5000, ''granted'')', rpA));
  -- 0114: the only way to a scholarship amount is set_participant_adjustments().
  perform pg_temp.expect_denied('Finance-shaped grants may NOT set a scholarship amount (0102/0114)',
    format('select public.set_participant_adjustments(%L, 5000, 0)', rpA));
  set local role postgres;
  delete from public.staff_grants where profile_id = uC and area = 'payments';
  set local role authenticated;
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_allowed('payments W + registration W may grant a scholarship (0102)',
    format('insert into public.scholarships (registration_participant_id, granted_cents, status) values (%L, 5000, ''granted'')', rpA));

  -- registration_review runs with its owner's rights; its row filter (0102)
  -- is the only thing between a family and every registration's flags.
  perform pg_temp.as_user(uA);
  select count(*) into n from public.registration_review;
  perform pg_temp.expect('family sees no registration_review rows (0102)', n, 0);
  perform pg_temp.as_user(uR);
  select count(*) into n from public.registration_review;
  perform pg_temp.expect('registrar sees both registrations in registration_review', n, (select count(*) from public.registrations));

  -- Publishing buddies is the Buddies area's act, through a definer function
  -- (0103); the stamp lives on events, whose policy needs Setup write.
  perform pg_temp.as_user(uC);
  perform pg_temp.expect_allowed('Buddies write may publish buddy assignments (0103)',
    format('select public.set_event_publication(%L, ''buddies'', true)', ev));
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_denied('Buddies read may NOT publish buddy assignments (0103)',
    format('select public.set_event_publication(%L, ''buddies'', false)', ev));
  select count(*) into n from public.registration_review;
  perform pg_temp.expect('payments-read registrar still sees registration_review (0103)', n, (select count(*) from public.registrations));
  perform pg_temp.as_user(uC);
  select count(*) into n from public.registration_review;
  perform pg_temp.expect('no payments grant, no registration_review rows (0103)', n, 0);
  perform pg_temp.expect_allowed('Buddies write may unpublish again (0103)',
    format('select public.set_event_publication(%L, ''buddies'', false)', ev));

  -- Household membership (0105, audit F1): nobody joins someone else's household.
  perform pg_temp.as_user(uA);
  perform pg_temp.expect_denied('family may NOT join another household (0105)',
    format('insert into public.household_members (household_id, profile_id, role) values (%L, %L, ''owner'')', hB, uA));
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_denied('staff may NOT add themselves to a household (0105)',
    format('insert into public.household_members (household_id, profile_id, role) values (%L, %L, ''owner'')', hB, uR));
  -- Staff decisions are pinned on a family's insert (0105, F3).
  set local role postgres;
  delete from public.scholarships where registration_participant_id = rpA;
  set local role authenticated;
  perform pg_temp.as_user(uA);
  perform pg_temp.expect_allowed('family may request a scholarship (0105)',
    format('insert into public.scholarships (registration_participant_id, requested_cents, granted_cents, status, staff_note) values (%L, 1000, 49500, ''granted'', ''forged'')', rpA));
  set local role postgres;
  select count(*) into n from public.scholarships
   where registration_participant_id = rpA and requested_cents = 1000 and status = 'requested' and granted_cents = 0 and staff_note is null;
  set local role authenticated;
  perform pg_temp.expect('a family''s forged scholarship decision is stored as a plain request (0105)', n, 1);
  -- Check-in is a staff fact (0105, F5).
  perform pg_temp.expect_denied('family may NOT check its own camper in (0105)',
    format('update public.registration_participants set checked_in_at = now() where id = %L', rpA));

  -- Two-factor in the database (0106, audit H1): a password-only staff session
  -- is nobody; a session registered from a remembered browser counts.
  perform pg_temp.as_user_aal1(uR);
  select count(*) into n from public.people;
  perform pg_temp.expect('registrar on a password-only session sees no people (0106)', n, 0);
  select count(*) into n from public.payments;
  perform pg_temp.expect('registrar on a password-only session sees no payments (0106)', n, 0);
  perform pg_temp.as_user_aal1(uF);
  select count(*) into n from public.person_support;
  perform pg_temp.expect('sensitive staff on a password-only session see no support records (0106)', n, 0);
  set local role postgres;
  insert into public.mfa_trusted_sessions (session_id, profile_id, expires_at)
    values ('11111111-1111-4111-8111-111111111111', uR, now() + interval '1 day');
  set local role authenticated;
  perform pg_temp.as_user_aal1(uR, '11111111-1111-4111-8111-111111111111');
  select count(*) into n from public.people;
  perform pg_temp.expect('a registered remembered-browser session counts (0106)', n, 3);
  perform pg_temp.as_user_aal1(uR, '22222222-2222-4222-8222-222222222222');
  select count(*) into n from public.people;
  perform pg_temp.expect('an unregistered session id does not (0106)', n, 0);
  -- The family's own records do not depend on two-factor.
  perform pg_temp.as_user_aal1(uA);
  select count(*) into n from public.people where household_id = hA;
  perform pg_temp.expect('a family on a password-only session still sees its own people (0106)', n, 2);

  -- The two role functions are gone (0101).
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname in ('is_registrar', 'is_coordinator');
  perform pg_temp.expect('is_registrar() and is_coordinator() no longer exist', n, 0);

  ---- buddy visibility -------------------------------------------------
  perform pg_temp.as_user(uA);
  select count(*) into n from public.buddy_assignments;
  perform pg_temp.expect('family sees no buddies before publication', n, 0);

  set local role postgres;
  update public.events set buddy_assignments_published_at = now() where id = ev;
  set local role authenticated;

  perform pg_temp.as_user(uA);
  select count(*) into n from public.buddy_assignments;
  perform pg_temp.expect('family sees own buddies after publication', n, 2);
  perform pg_temp.as_user(uB);
  select count(*) into n from public.buddy_assignments;
  perform pg_temp.expect('B sees only assignments involving B', n, 1);

  ---- linking a login to a household is the administrator's (0113) -----
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_denied('registration write cannot attach a login to another household',
    format('insert into public.household_members (household_id, profile_id, role) values (%L, %L, ''adult'')', hB, uD));
  ---- confirming a signature is registration write (0113) ----------------
  perform pg_temp.as_user(uC);
  update public.agreement_signatures set status = 'confirmed_external' where person_id = pA;
  get diagnostics n = row_count;
  perform pg_temp.expect('a coordinator cannot confirm signatures', n, 0);

  ---- a populated household is never self-claimed (0110) ---------------
  set local role postgres;
  delete from public.household_members where household_id = hB;   -- B now has people but no login
  set local role authenticated;
  perform pg_temp.as_user(uD);
  perform pg_temp.expect_denied('a stranger cannot claim a household that has people',
    format('insert into public.household_members (household_id, profile_id, role) values (%L, %L, ''owner'')', hB, uD));
  set local role postgres;
  insert into public.household_members (household_id, profile_id, role) values (hB, uB, 'owner');
  set local role authenticated;

  ---- the event's medical contact (0109) ------------------------------
  set local role postgres;
  insert into public.event_medical_contacts (event_id, name, phone) values (ev, 'Nurse Test', '555-0100');
  set local role authenticated;
  perform pg_temp.as_user(uA);
  select count(*) into n from public.event_medical_contacts where event_id = ev;
  perform pg_temp.expect('a registered family sees the medical contact', n, 1);
  perform pg_temp.as_user(uR);
  select count(*) into n from public.event_medical_contacts where event_id = ev;
  perform pg_temp.expect('staff see the medical contact', n, 1);
  perform pg_temp.as_user(uD);
  select count(*) into n from public.event_medical_contacts where event_id = ev;
  perform pg_temp.expect('someone not at the event does not see the medical contact', n, 0);
  set local role postgres;
  select status into oldStatus from public.registration_participants where id = rpB;
  update public.registration_participants set status = 'cancelled' where id = rpB;
  set local role authenticated;
  perform pg_temp.as_user(uB);
  select count(*) into n from public.event_medical_contacts where event_id = ev;
  perform pg_temp.expect('a family whose people are all cancelled does not see it', n, 0);
  set local role postgres;
  update public.registration_participants set status = oldStatus where id = rpB;
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'events' and column_name like 'medical_contact%';
  perform pg_temp.expect('the medical contact is no longer on events', n, 0);
  set local role authenticated;

  ---- participant_money (0114) ----------------------------------------
  -- What a person owes is readable by the family it belongs to and by
  -- Payments read; written only by owner-run code.
  set local role postgres;
  select count(*) into n from public.registration_participants;   -- as postgres: every row
  set local role authenticated;
  perform pg_temp.as_user(uA);
  select count(*) into m from public.participant_money;
  perform pg_temp.expect('family sees its own participant_money rows', m, 2);
  select count(*) into m from public.participant_money where participant_id = rpB;
  perform pg_temp.expect('family sees none of another family''s money', m, 0);
  perform pg_temp.expect_denied('family may NOT insert participant_money',
    format('insert into public.participant_money (participant_id, fee_cents) values (%L, 1)', rpA));
  perform pg_temp.expect_denied('family may NOT update participant_money',
    format('update public.participant_money set fee_cents = 0 where participant_id = %L', rpA));
  perform pg_temp.expect_denied('family may NOT delete participant_money',
    format('delete from public.participant_money where participant_id = %L', rpA));
  perform pg_temp.as_user(uC);
  select count(*) into m from public.participant_money;
  perform pg_temp.expect('coordinator (no Payments) sees no participant_money', m, 0);
  select count(*) into m from public.registration_balances;
  perform pg_temp.expect('coordinator (no Payments) gets no registration_balances rows', m, 0);
  perform pg_temp.expect_denied('coordinator may NOT decide a scholarship (0114)',
    format('select public.set_participant_adjustments(%L, 100, 0)', rpA));
  perform pg_temp.as_user(uR);
  select count(*) into m from public.participant_money;
  perform pg_temp.expect('registrar (Payments read) sees every participant_money row', m, n);
  select count(*) into m from public.registration_balances;
  perform pg_temp.expect('registrar sees every registration in registration_balances', m, (select count(*) from public.registrations));
  perform pg_temp.expect_denied('scholarship plus discount may NOT exceed the fee (0114)',
    format('select public.set_participant_adjustments(%L, 49000, 1000)', rpA));
  begin
    perform public.set_participant_adjustments(rpA, 49000, 1000);
    raise exception 'FAIL: the cap did not fire';
  exception when raise_exception then
    if sqlerrm <> 'Scholarship plus discount cannot exceed the fee for this person.' then
      raise exception 'FAIL: the cap''s message was: %', sqlerrm;
    end if;
  end;
  perform pg_temp.expect_denied('a negative amount is refused (0114)',
    format('select public.set_participant_adjustments(%L, -1, 0)', rpA));
  perform pg_temp.expect_allowed('payments W + registration W may set a scholarship and discount (0114)',
    format('select public.set_participant_adjustments(%L, 5000, 1000, null)', rpA));
  select count(*) into m from public.participant_money
   where participant_id = rpA and scholarship_cents = 5000 and discount_cents = 1000 and discount_reason is null;
  perform pg_temp.expect('the decision landed on participant_money', m, 1);
  select coalesce(sum(scholarship_cents), 0) into m from public.registration_balances where registration_id = regA;
  perform pg_temp.expect('registration_balances carries the scholarship', m, 5000);
  -- A rule-applied discount keeps its reason when the app passes it back on
  -- a scholarship decision; a hand change sends null and the reason goes.
  set local role postgres;
  update public.participant_money set discount_reason = 'Both weeks (50% off the later week)' where participant_id = rpA;
  set local role authenticated;
  perform pg_temp.as_user(uR);
  perform public.set_participant_adjustments(rpA, 6000, 1000, 'Both weeks (50% off the later week)');
  select count(*) into m from public.participant_money
   where participant_id = rpA and scholarship_cents = 6000 and discount_cents = 1000
     and discount_reason = 'Both weeks (50% off the later week)';
  perform pg_temp.expect('a rule-applied discount keeps its reason through a scholarship decision (0114)', m, 1);
  perform public.set_participant_adjustments(rpA, 6000, 2000, null);
  select count(*) into m from public.participant_money
   where participant_id = rpA and discount_cents = 2000 and discount_reason is null;
  perform pg_temp.expect('a hand-changed discount is marked hand-set (0114)', m, 1);
  set local role postgres;
  -- Three decisions through the function, plus this harness's own edit of
  -- the reason above: every write to the table is logged, whoever made it.
  select count(*) into m from public.money_change_log
   where table_name = 'participant_money' and row_id = rpA and op = 'UPDATE';
  perform pg_temp.expect('money_change_log recorded every change to the row', m, 4);
  update public.participant_money set scholarship_cents = 0, discount_cents = 0 where participant_id = rpA;
  select count(*) into m from information_schema.columns
   where table_schema = 'public' and table_name = 'registration_participants'
     and column_name in ('fee_cents', 'scholarship_cents', 'discount_cents', 'discount_reason',
                         'early_discount_cents', 'family_discount_cents');
  perform pg_temp.expect('the money columns are gone from registration_participants (0114)', m, 0);
  -- Grant Payments read at runtime: exactly that opens the money.
  insert into public.staff_grants (profile_id, area, level) values (uC, 'payments', 'read');
  set local role authenticated;
  perform pg_temp.as_user(uC);
  select count(*) into m from public.participant_money;
  perform pg_temp.expect('coordinator given Payments READ sees every participant_money row', m, n);
  set local role postgres;
  delete from public.staff_grants where profile_id = uC and area = 'payments';
  set local role authenticated;

  ---- returned-payment fees (0123) ---------------------------------------
  -- A failed BANK payment adds the fee the family was shown (a snapshot),
  -- once per PaymentIntent; a card decline adds nothing. The family sees
  -- its own fees, nobody else's; Payments read sees them; nobody signed in
  -- writes the table except through the two staff functions.
  set local role postgres;
  select id into regB from public.registrations where household_id = hB and event_id = ev;
  update public.events set returned_payment_fee_cents = 900 where id = ev;   -- the CURRENT value: never charged
  insert into public.payments (registration_id, amount_cents, method, status, stripe_payment_intent_id)
    values (regA, 10000, 'bank_transfer', 'failed', 'pi_fee_bank_A'),
           (regA, 10000, 'card', 'failed', 'pi_fee_card_A');
  select balance_cents into n from public.registration_balances where registration_id = regA;
  set local role service_role;
  perform set_config('request.jwt.claim.sub', '', true);
  select fee_cents into m from public.record_returned_payment_fee(regA, 'pi_fee_bank_A', null, 400, false);
  perform pg_temp.expect('a bank try that never reached the bank (not returned) adds no fee (0123)', m, 0);
  select fee_cents, case when added then 1 else 0 end into m, oldStatus
    from public.record_returned_payment_fee(regA, 'pi_fee_bank_A', null, 400, true);
  perform pg_temp.expect('a returned bank checkout adds the disclosed fee, not the event''s current one (0123)', m, 400);
  perform pg_temp.expect('... and says it added it', oldStatus::bigint, 1);
  select fee_cents, case when added then 1 else 0 end into m, oldStatus
    from public.record_returned_payment_fee(regA, 'pi_fee_bank_A', null, 400, true);
  perform pg_temp.expect('the same failure again (a Stripe retry) reports the fee on file (0123)', m, 400);
  perform pg_temp.expect('... without adding a second', oldStatus::bigint, 0);
  select fee_cents into m from public.record_returned_payment_fee(regA, 'pi_fee_card_A', null, 400, true);
  perform pg_temp.expect('a card decline adds no fee (0123)', m, 0);
  select fee_cents into m from public.record_returned_payment_fee(regA, 'pi_no_such_payment', null, 400, true);
  perform pg_temp.expect('no failed payment on file, no fee (0123)', m, 0);
  set local role postgres;
  select count(*) into m from public.registration_fees where registration_id = regA;
  perform pg_temp.expect('one fee row for one failed bank payment (0123)', m, 1);
  select balance_cents into m from public.registration_balances where registration_id = regA;
  perform pg_temp.expect('the unwaived fee is owed in registration_balances (0123)', m, n + 400);
  select fees_cents into m from public.registration_balances where registration_id = regA;
  perform pg_temp.expect('registration_balances.fees_cents carries it (0123)', m, 400);
  -- A plan charge uses the PLAN's snapshot; $0 at agreement means never.
  insert into public.payment_plans (registration_id, schedule, status, activated_at, returned_payment_fee_cents)
    values (regB, 'monthly', 'active', now(), 250) returning id into planId;
  insert into public.payment_installments (payment_plan_id, due_on, amount_cents)
    values (planId, current_date, 10000) returning id into logId;
  insert into public.payments (registration_id, installment_id, amount_cents, method, status, stripe_payment_intent_id)
    values (regB, logId, 10000, 'bank_transfer', 'failed', 'pi_fee_inst_B');
  set local role service_role;
  select fee_cents into m from public.record_returned_payment_fee(regB, 'pi_fee_inst_B', logId, 9999, true);
  perform pg_temp.expect('a plan charge adds the plan''s snapshot, not the caller''s figure (0123)', m, 250);
  -- The next try of the SAME installment (a new PaymentIntent) fails too:
  -- one returned debit, one fee, even if the caller calls it returned.
  set local role postgres;
  insert into public.payments (registration_id, installment_id, amount_cents, method, status, stripe_payment_intent_id)
    values (regB, logId, 10000, 'bank_transfer', 'failed', 'pi_fee_inst_B2');
  set local role service_role;
  select fee_cents into m from public.record_returned_payment_fee(regB, 'pi_fee_inst_B2', logId, 9999, true);
  perform pg_temp.expect('a second failed try of the same installment adds no second fee (0123)', m, 0);
  set local role postgres;
  select count(*) into m from public.registration_fees where payment_installment_id = logId;
  perform pg_temp.expect('... one fee row for the installment (0123)', m, 1);
  -- A plan agreed at $0 never adds one, on any installment.
  update public.payment_plans set returned_payment_fee_cents = 0 where id = planId;
  insert into public.payment_installments (payment_plan_id, due_on, amount_cents)
    values (planId, current_date + 30, 10000);
  insert into public.payments (registration_id, installment_id, amount_cents, method, status, stripe_payment_intent_id)
    select regB, i.id, 10000, 'bank_transfer', 'failed', 'pi_fee_inst_B3'
      from public.payment_installments i where i.payment_plan_id = planId and i.id <> logId;
  set local role service_role;
  select fee_cents into m from public.record_returned_payment_fee(regB, 'pi_fee_inst_B3',
    (select i.id from public.payment_installments i where i.payment_plan_id = planId and i.id <> logId), 9999, true);
  perform pg_temp.expect('a plan agreed at $0 never adds a fee (0123)', m, 0);
  set local role authenticated;
  -- Who sees them.
  perform pg_temp.as_user(uA);
  select count(*) into m from public.registration_fees;
  perform pg_temp.expect('a family sees its own fee (0123)', m, 1);
  select fees_cents into m from public.registration_balances where registration_id = regA;
  perform pg_temp.expect('a family sees the fee in its own balance (0123)', m, 400);
  perform pg_temp.as_user(uB);
  select count(*) into m from public.registration_fees where registration_id = regA;
  perform pg_temp.expect('another family does not see it (0123)', m, 0);
  perform pg_temp.as_user(uC);
  select count(*) into m from public.registration_fees;
  perform pg_temp.expect('staff without Payments read see no fees (0123)', m, 0);
  perform pg_temp.expect_denied('staff without Payments write may NOT add a fee (0123)',
    format('select public.add_registration_fee(%L, 500, ''test'')', regA));
  perform pg_temp.as_user(uR);
  select count(*) into m from public.registration_fees;
  perform pg_temp.expect('Payments read sees every fee (0123)', m, 2);
  -- Nobody signed in writes the table, or records the automatic fee.
  perform pg_temp.as_user(uA);
  perform pg_temp.expect_denied('a family may NOT insert a fee row (0123)',
    format('insert into public.registration_fees (registration_id, kind, amount_cents) values (%L, ''manual'', 1)', regA));
  perform pg_temp.expect_denied('a family may NOT waive its own fee by update (0123)',
    'update public.registration_fees set waived_at = now(), waived_reason = ''x'' where true');
  perform pg_temp.expect_denied('a family may NOT delete a fee (0123)',
    'delete from public.registration_fees where true');
  perform pg_temp.expect_denied('a family may NOT record an automatic fee (0123)',
    format('select * from public.record_returned_payment_fee(%L, ''pi_fee_bank_A'', null, 1, true)', regA));
  perform pg_temp.expect_denied('a family may NOT waive through the function (0123)',
    format('select public.waive_registration_fee(id, ''please'') from public.registration_fees where registration_id = %L', regA));
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_denied('Payments write may NOT update a fee row directly (0123)',
    'update public.registration_fees set amount_cents = 1 where true');
  perform pg_temp.expect_denied('Payments write may NOT change a plan''s agreed fee (0123)',
    format('update public.payment_plans set returned_payment_fee_cents = 5000 where id = %L', planId));
  -- Staff: add by hand (reason required), waive (reason required, once).
  perform pg_temp.expect_denied('a manual fee needs a reason (0123)',
    format('select public.add_registration_fee(%L, 500, ''  '')', regA));
  perform pg_temp.expect_denied('a manual fee must be more than $0 (0123)',
    format('select public.add_registration_fee(%L, 0, ''test'')', regA));
  perform public.add_registration_fee(regA, 1500, 'Returned check');
  select fees_cents into m from public.registration_balances where registration_id = regA;
  perform pg_temp.expect('a manual fee counts in the balance (0123)', m, 1900);
  -- Waiving is a decision (Payments AND Registration write, 0102); adding is
  -- Payments write. The coordinator, given Payments write with Registration
  -- read only, may add but not waive.
  set local role postgres;
  insert into public.staff_grants (profile_id, area, level) values (uC, 'payments', 'write');
  set local role authenticated;
  perform pg_temp.as_user(uC);
  perform pg_temp.expect_denied('Payments write without Registration write may NOT waive a fee (0123)',
    'select public.waive_registration_fee(id, ''kindness'') from public.registration_fees where stripe_payment_intent_id = ''pi_fee_bank_A''');
  perform pg_temp.expect_allowed('Payments write alone may add a fee (0123)',
    format('select public.add_registration_fee(%L, 100, ''Postage'')', regB));
  set local role postgres;
  delete from public.staff_grants where profile_id = uC and area = 'payments';
  set local role authenticated;
  perform pg_temp.as_user(uR);
  perform pg_temp.expect_denied('a waiver needs a reason (0123)',
    format('select public.waive_registration_fee(id, '''') from public.registration_fees where stripe_payment_intent_id = ''pi_fee_bank_A'''));
  perform public.waive_registration_fee((select id from public.registration_fees where stripe_payment_intent_id = 'pi_fee_bank_A'), 'Bank error, not the family');
  select fees_cents into m from public.registration_balances where registration_id = regA;
  perform pg_temp.expect('a waived fee drops out of the balance (0123)', m, 1500);
  perform pg_temp.expect_denied('a fee is waived once (0123)',
    'select public.waive_registration_fee(id, ''again'') from public.registration_fees where stripe_payment_intent_id = ''pi_fee_bank_A''');
  perform pg_temp.as_user(uA);
  select count(*) into m from public.registration_fees where waived_at is not null;
  perform pg_temp.expect('the family still sees the waived fee, marked waived (0123)', m, 1);
  set local role postgres;
  select count(*) into m from public.money_change_log where table_name = 'registration_fees';
  perform pg_temp.expect('every fee write is in money_change_log: 4 inserts and a waiver (0123)', m, 5);
  select count(*) into m from public.money_change_log
   where table_name = 'registration_fees' and op = 'INSERT' and changed_by is null;
  perform pg_temp.expect('the automatic fees are logged as a server-side writer, no person (0123)', m, 2);
  select count(*) into m from public.money_change_log
   where table_name = 'registration_fees' and changed_by = uR;
  perform pg_temp.expect('the manual fee and the waiver are logged with who did them (0123)', m, 2);
  -- Leave the seed as it was for the checks below.
  set local session_replication_role = replica;
  delete from public.registration_fees where registration_id in (regA, regB);
  delete from public.payments where stripe_payment_intent_id like 'pi_fee_%';
  delete from public.payment_installments where payment_plan_id = planId;
  delete from public.payment_plans where id = planId;
  set local session_replication_role = origin;
  update public.events set returned_payment_fee_cents = 0 where id = ev;
  set local role authenticated;

  ---- copying an event carries its activity waivers (0117) --------------
  -- 0083 said it copied them and never did: an activity-scoped requirement
  -- has no event_id, and the copy was filtered on event_id. The harness's
  -- Rafting carries one; a copy made with Setup write must give the new
  -- Rafting its own row, pointed at the same (current) agreement, scoped to
  -- the activity and not the event -- and leave the source's row alone.
  set local role postgres;
  insert into public.staff_grants (profile_id, area, level) values (uR, 'setup', 'write');
  set local role authenticated;
  perform pg_temp.as_user(uR);

  ---- an activity's times fall within its event (0119) ------------------
  -- Week 1's only Salon sitting was saved four days before the week (22 Oct
  -- bot run). Test Week runs current_date .. current_date + 4 and has no
  -- volunteer arrival day; Rafting is a sign-up activity. The copy below
  -- then proves admin_create_event() carries the slots across inside the new
  -- event's days.
  insert into public.activity_slots (activity_id, slot_date, start_time, end_time, capacity)
    values (act, current_date + 2, '14:00', '15:00', 4);
  select count(*) into m from public.activity_slots where activity_id = act;
  perform pg_temp.expect('a slot during its event is accepted (0119)', m, 1);
  begin
    insert into public.activity_slots (activity_id, slot_date, start_time, end_time)
      values (act, current_date - 4, '14:00', '15:00');
    raise exception 'FAIL: a slot dated before its event was ALLOWED (0119)';
  exception when check_violation then
    if sqlerrm not like 'A time for Rafting must fall during Test Week: % to %.' then
      raise exception 'FAIL: the before-the-event refusal said "%" (0119)', sqlerrm;
    end if;
  end;
  perform pg_temp.expect_denied('a slot dated after its event is refused (0119)',
    format('insert into public.activity_slots (activity_id, slot_date, start_time, end_time) values (%L, current_date + 5, ''14:00'', ''15:00'')', act));
  perform pg_temp.expect_denied('a slot cannot be moved before its event (0119)',
    format('update public.activity_slots set slot_date = current_date - 1 where activity_id = %L', act));
  -- The volunteers' arrival day opens the range that one day early.
  set local role postgres;
  update public.events set volunteer_arrives_on = current_date - 1 where id = ev;
  set local role authenticated;
  perform pg_temp.as_user(uR);
  insert into public.activity_slots (activity_id, slot_date, start_time, end_time)
    values (act, current_date - 1, '19:00', '20:00');
  select count(*) into m from public.activity_slots where activity_id = act;
  perform pg_temp.expect('a slot on the volunteers'' arrival day is accepted (0119)', m, 2);
  perform pg_temp.expect_denied('a slot the day before the volunteers arrive is refused (0119)',
    format('insert into public.activity_slots (activity_id, slot_date, start_time, end_time) values (%L, current_date - 2, ''14:00'', ''15:00'')', act));

  select public.admin_create_event('Test Week (copy)', 'camp_week', current_date + 365,
                                   current_date + 369, 49500, 5000, null, null, ev)
    into evCopy;
  select count(*) into m
    from public.activity_slots s
    join public.activities a on a.id = s.activity_id
    join public.events e on e.id = a.event_id
   where e.id = evCopy
     and s.slot_date between e.volunteer_arrives_on and e.ends_on;
  perform pg_temp.expect('a copied event''s slots land inside the copy''s days (0119)', m, 2);
  select count(*) into m
    from public.agreement_requirements r
    join public.activities a on a.id = r.activity_id
   where a.event_id = evCopy and a.name = 'Rafting'
     and r.agreement_id = agr and r.event_id is null
     and r.applies_to = 'participant' and r.is_required;
  perform pg_temp.expect('a copied event''s activity carries the waiver requirement (0117)', m, 1);
  select count(*) into m from public.agreement_requirements r
    join public.activities a on a.id = r.activity_id where a.event_id = evCopy;
  perform pg_temp.expect('the copy carries exactly one activity requirement', m, 1);
  select count(*) into m from public.agreement_requirements where activity_id = act;
  perform pg_temp.expect('the source activity keeps its own requirement row', m, 1);
  set local role postgres;
  delete from public.events where id = evCopy;
  delete from public.activity_slots where activity_id = act;
  update public.events set volunteer_arrives_on = null where id = ev;
  delete from public.staff_grants where profile_id = uR and area = 'setup';
  set local role authenticated;

  ---- waivers outstanding on existing signups (0120) --------------------
  -- An activity people signed up for BEFORE it had a waiver: attaching one
  -- must put each existing signup on activity_waivers_outstanding, a family
  -- must see only its own rows (security invoker, through the tables' RLS),
  -- and signing (or, for a provider, uploading) must take the row off.
  set local role postgres;
  select registration_id into regB from public.registration_participants where id = rpB;
  insert into public.activities (id, event_id, name, booking_mode)
    values (gen_random_uuid(), ev, 'Horses (0120)', 'signup') returning id into horses;
  insert into public.activity_signups (registration_participant_id, activity_id, status)
    values (rpA, horses, 'signed_up'), (rpB, horses, 'signed_up');
  set local role authenticated;
  perform pg_temp.as_user(uR);
  select count(*) into n from public.activity_waivers_outstanding where activity_id = horses;
  perform pg_temp.expect('no waiver on the activity, nothing outstanding (0120)', n, 0);

  set local role postgres;
  insert into public.agreements (id, key, version, title, delivery, active, body)
    values (gen_random_uuid(), 'horses_0120', 1, 'Horses waiver', 'internal_document', true,
            'Horses are large animals.') returning id into horsesAgr;
  insert into public.agreement_requirements (agreement_id, event_id, activity_id, applies_to, is_required)
    values (horsesAgr, null, horses, 'participant', true);
  set local role authenticated;

  perform pg_temp.as_user(uR);
  select count(*) into n from public.activity_waivers_outstanding
   where activity_id = horses and kind = 'ours' and agreement_id = horsesAgr;
  perform pg_temp.expect('attaching a waiver puts BOTH existing signups on the view, for staff (0120)', n, 2);
  perform pg_temp.as_user(uA);
  select count(*) into n from public.activity_waivers_outstanding where activity_id = horses;
  perform pg_temp.expect('family A sees its own signup needing the new waiver (0120)', n, 1);
  select count(*) into n from public.activity_waivers_outstanding where household_id <> hA;
  perform pg_temp.expect('family A sees no other family''s outstanding waivers (0120)', n, 0);
  perform pg_temp.as_user(uB);
  select count(*) into n from public.activity_waivers_outstanding
   where activity_id = horses and household_id = hB and person_id = pB;
  perform pg_temp.expect('family B sees its own row (0120)', n, 1);
  select count(*) into n from public.activity_waivers_outstanding where household_id = hA;
  perform pg_temp.expect('family B sees none of family A''s rows (0120)', n, 0);

  -- Family A signs, as the Activities page does: the row goes, for A and for staff.
  perform pg_temp.as_user(uA);
  insert into public.agreement_signatures (agreement_id, person_id, registration_id, status,
                                           signed_at, signer_name, signer_role)
    values (horsesAgr, pA, regA, 'signed_here', now(), 'Pat AAA', 'parent_guardian');
  select count(*) into n from public.activity_waivers_outstanding where activity_id = horses;
  perform pg_temp.expect('signing takes family A''s row off the view (0120)', n, 0);
  perform pg_temp.as_user(uR);
  select count(*) into n from public.activity_waivers_outstanding where activity_id = horses;
  perform pg_temp.expect('staff then see only the unsigned signup (0120)', n, 1);

  -- A cancelled signup is not asked for anything.
  set local role postgres;
  update public.activity_signups set status = 'cancelled'
   where registration_participant_id = rpB and activity_id = horses;
  set local role authenticated;
  perform pg_temp.as_user(uR);
  select count(*) into n from public.activity_waivers_outstanding where activity_id = horses;
  perform pg_temp.expect('a cancelled signup is not outstanding (0120)', n, 0);

  -- The provider kind: Rafting names an outside provider (provider_url).
  -- A signup with no uploaded confirmation is outstanding until one arrives.
  set local role postgres;
  insert into public.activity_signups (registration_participant_id, activity_id, status)
    values (rpA, act, 'interested');
  set local role authenticated;
  perform pg_temp.as_user(uA);
  select count(*) into n from public.activity_waivers_outstanding
   where activity_id = act and kind = 'provider' and agreement_id is null;
  perform pg_temp.expect('a provider-run signup with no confirmation is outstanding (0120)', n, 1);
  insert into public.activity_waiver_uploads (activity_id, registration_participant_id, storage_path, content_type)
    values (act, rpA, rpA::text || '/' || act::text || '.pdf', 'application/pdf');
  select count(*) into n from public.activity_waivers_outstanding where activity_id = act;
  perform pg_temp.expect('uploading the confirmation takes the provider row off (0120)', n, 0);

  -- The log of staff-sent family emails: Registration write, through the function only.
  perform pg_temp.as_user(uA);
  perform pg_temp.expect_denied('a family cannot write the message log through log_family_email (0120)',
    format('select public.log_family_email(%L, %L, ''a@example.test'', ''family_update'', ''Hi'', ''sent'')', hA, regA));
  perform pg_temp.as_user(uC);
  perform pg_temp.expect_denied('Registration READ cannot log a family email (0120)',
    format('select public.log_family_email(%L, %L, ''a@example.test'', ''family_update'', ''Hi'', ''sent'')', hA, regA));
  perform pg_temp.as_user(uR);
  select public.log_family_email(hA, regA, 'a@example.test', 'waiver_needed',
                                 'Horses now needs a waiver', 'sent') into logId;
  select count(*) into n from public.message_log
   where id = logId and sent_by = uR and template_key = 'waiver_needed' and household_id = hA;
  perform pg_temp.expect('Registration write logs a family email, stamped with the sender (0120)', n, 1);
  perform pg_temp.expect_denied('log_family_email refuses another template (0120)',
    format('select public.log_family_email(%L, null, ''a@example.test'', ''welcome'', ''Hi'', ''sent'')', hA));
  perform pg_temp.expect_denied('log_family_email refuses a registration that is not the household''s (0120)',
    format('select public.log_family_email(%L, %L, ''a@example.test'', ''family_update'', ''Hi'', ''sent'')', hA, regB));
  perform pg_temp.expect_denied('staff still cannot insert into message_log directly (0120)',
    'insert into public.message_log (to_email, template_key) values (''x@example.test'', ''family_update'')');
  perform pg_temp.expect_no_effect('staff cannot delete a logged email (0120)',
    format('delete from public.message_log where id = %L', logId));

  -- Payment-plan emails (0121): the edge functions log every one as
  -- service_role; staff read the row like any other.
  set local role service_role;
  insert into public.message_log (to_email, household_id, registration_id, template_key,
                                  subject, status, provider_message_id)
  values ('registration@example.test', hA, regA, 'plan_stopped_staff',
          '[Payment plans] Plan stopped — Family A — Test', 'sent', 're_test_1')
  returning id into planLogId;
  set local role authenticated;
  perform pg_temp.as_user(uR);
  select count(*) into n from public.message_log
   where id = planLogId and template_key = 'plan_stopped_staff' and provider_message_id = 're_test_1';
  perform pg_temp.expect('service_role logs a plan email, and staff can read it (0121)', n, 1);
  perform pg_temp.as_user(uA);
  select count(*) into n from public.message_log where id = planLogId;
  perform pg_temp.expect('a family cannot read the plan email log (0121)', n, 0);

  -- The Plan stopped tab and card read payment_plans with the staff's own
  -- client: Payments read (0101's payment_plans_select), nothing else.
  set local role postgres;
  insert into public.payment_plans (registration_id, schedule, status, activated_at)
    values (regA, 'monthly', 'failed', now()) returning id into planId;
  set local role authenticated;
  perform pg_temp.as_user(uC);
  select count(*) into n from public.payment_plans where id = planId and status = 'failed';
  perform pg_temp.expect('Registration read without Payments read sees no stopped plan (Plan stopped tab)', n, 0);
  perform pg_temp.as_user(uR);
  select count(*) into n from public.payment_plans where id = planId and status = 'failed';
  perform pg_temp.expect('Payments read sees the stopped plan (Plan stopped tab)', n, 1);

  set local role postgres;
  -- The plan guard (0111) keeps a plan from being deleted; this test row
  -- goes with the triggers off, as the superuser seeding it.
  set local session_replication_role = replica;
  delete from public.payment_plans where id = planId;
  set local session_replication_role = origin;
  delete from public.message_log where id = planLogId;
  delete from public.activity_waiver_uploads where activity_id = act and registration_participant_id = rpA;
  delete from public.activity_signups where activity_id in (act, horses);
  delete from public.agreement_signatures where agreement_id = horsesAgr;
  delete from public.activities where id = horses;
  delete from public.agreements where id = horsesAgr;
  delete from public.message_log where id = logId;
  set local role authenticated;

  ---- anonymous visitors ----------------------------------------------
  -- anon has SELECT granted on the catalogue tables so a public "our
  -- camps" page can render. Everything else must be invisible.
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);

  -- Scoped to the harness's own event: the seed migrations publish real
  -- events too, and anon is meant to see those.
  select count(*) into n from public.events where id = ev;
  perform pg_temp.expect('anon sees the published event', n, 1);
  select count(*) into n from public.event_options where event_id = ev;
  perform pg_temp.expect('anon sees published options', n, 2);
  select count(*) into n from public.activities where event_id = ev;
  perform pg_temp.expect('anon sees active activities', n, 1);

  perform pg_temp.expect_denied('anon cannot read people',
    'select count(*) from public.people');
  perform pg_temp.expect_denied('anon cannot read households',
    'select count(*) from public.households');
  perform pg_temp.expect_denied('anon cannot read support records',
    'select count(*) from public.person_support');
  perform pg_temp.expect_denied('anon cannot read registrations',
    'select count(*) from public.registrations');
  perform pg_temp.expect_denied('anon cannot read coupons',
    'select count(*) from public.coupons');
  perform pg_temp.expect_denied('anon cannot read the medical contact',
    'select count(*) from public.event_medical_contacts');

  set local role postgres;
  update public.events set published = false where id = ev;
  set local role anon;
  select count(*) into n from public.events where id = ev;
  perform pg_temp.expect('anon sees nothing once the event is unpublished', n, 0);

  set local role authenticated;
  raise notice 'ALL CHECKS PASSED';
end;
$$;
