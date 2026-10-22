import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { allergyPill, statusPill } from '@/lib/format';
import { allergySummary, allergenWords } from '@/lib/support';
import { REVIEW_CLASS, REVIEW_FLAG } from '@/lib/plans';
import { dayInMorristown } from '@/lib/events';
import { signedPhotoUrls } from '@/lib/photos';

export const metadata = { title: 'Person — Staff Admin' };

// E05: one screen per person, for STAFF.
//
// Ellen's real point, and the response called it "the biggest single
// improvement left in her notes". Room, buddy, program, allergies and
// emergency contact are five facts that live on five pages, and the person who
// needs them -- somebody holding a clipboard at check-in, or ringing a parent
// -- needs all five at once about ONE person. Her E23 is this page, not a
// separate ask; E31 (where the rest of this family is sleeping) is a section
// on it; and E04's "make the buddy's name a link" finally has somewhere to
// point.
//
// STAFF ONLY. Whether any of this is ever shown to families is a separate
// decision and deliberately not built (open question 5 on the reviewer
// response).
//
// SECTIONS APPEAR PER GRANT, and the page says when something is hidden.
// A registrar sees who this is, where they sleep and who their buddy is; the
// medical and emergency sections need `sensitive`. The alternative -- requiring
// `sensitive` for the whole page -- turns it into a 403 for the registrar it
// was built for, and a page that refuses you once is a page you stop opening.
// Saying "there is more here, and you cannot see it" is honest and tells
// somebody what to go and ask for.

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent / guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

// Age AT the event, not today. A birthday between now and camp is exactly when
// the two answers differ, and the one that matters is the one at camp.
function ageAt(dob, onDate) {
  if (!dob) return null;
  const d = new Date(dob);
  const at = onDate ? new Date(onDate) : new Date();
  if (Number.isNaN(d.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function Section({ title, children, note }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="font-semibold text-brand-dark">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-neutral-500">{note}</p>}
      <div className="mt-3 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-neutral-100 py-1.5 last:border-0">
      <span className="w-40 shrink-0 text-neutral-500">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// ---- Form answers (Website Feedback list, row 15; Ellen) -----------------------
// Everything the family wrote on the support-details form, in one place.
// Diagnosis, communication, getting around, personal care, a hard day, sleep
// and rooming were on no staff page before this (22 Oct 2026).
//
// THE LABELS ARE THE FAMILY'S QUESTIONS, word for word, grouped as the form
// groups them (components/SupportDetailsFields.jsx). When a question there is
// reworded, reword it here: staff saying "you told us X" should be quoting
// the question the family actually read.
//
// Colour, as everywhere in the admin (Check-In's comment, 24 Aug): RED is a
// medical alert -- allergies, seizures, rescue medication, with the shared
// allergyPill for severity. AMBER is operational -- trouble sleeping away from
// home, a caregiver coming. Grey italic "Not answered" is a blank, never "No".
//
// The yes/no columns are NOT NULL with a default of false, so on a row the
// family never saved through the form (details_saved_at is null) a false is
// the default, not an answer: it reads "Not answered". A true always shows.

const isBlank = (v) => v == null || String(v).trim() === '';

function NotAnswered() {
  return <span className="italic text-neutral-400">Not answered</span>;
}

function Answer({ q, children }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 border-b border-neutral-100 py-2 last:border-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <dt className="text-neutral-500">{q}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}

function AnswerText({ value, alert = false }) {
  if (isBlank(value)) return <NotAnswered />;
  return alert ? (
    <span className="block border-l-2 border-red-300 pl-2 text-red-900">{value}</span>
  ) : (
    value
  );
}

function AnswerYesNo({ value, saved, tone }) {
  if (value === true) {
    const cls =
      tone === 'red'
        ? 'bg-red-100 text-red-800'
        : tone === 'amber'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-neutral-100 text-neutral-800';
    return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>Yes</span>;
  }
  if (value === false && saved) return 'No';
  return <NotAnswered />;
}

function AnswerGroup({ title, hint, children }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="border-b border-neutral-200 pb-1 font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
      <dl>{children}</dl>
    </div>
  );
}

function FormAnswers({ sensitive, support, name }) {
  // Without the grant: one line -- never an error, and never an empty form
  // that reads as "the family answered nothing".
  if (!sensitive) {
    return (
      <div id="form-answers" className="mt-4">
        <Section title="Form answers">
          <p className="text-neutral-500">Form answers need the Sensitive grant.</p>
        </Section>
      </div>
    );
  }
  if (!support) {
    return (
      <div id="form-answers" className="mt-4">
        <Section title="Form answers">
          <p className="text-amber-700">
            No form answers on file — nobody has filled in the support details for {name} yet.
          </p>
        </Section>
      </div>
    );
  }

  const s = support;
  const saved = Boolean(s.details_saved_at);
  const codes = Array.isArray(s.allergens) ? s.allergens : [];
  const words = allergenWords(s);
  const pill = allergyPill(s.has_allergies, s.allergy_severity);
  // A row from before the tick list (0097) has its list in allergy_detail;
  // allergenWords already shows it as "Other: ...", so it is not repeated as
  // the reaction.
  const legacyAllergyText = s.has_allergies && codes.length === 0 && !isBlank(s.allergy_detail);
  // The form asks the detail only behind a "yes"; a detail left behind by an
  // older save is shown rather than hidden.
  const showDetail = (flag, detail) => flag === true || !isBlank(detail);

  return (
    <div id="form-answers" className="mt-4">
      <Section
        title="Form answers"
        note={
          saved
            ? `What the family wrote, under the form's own questions. Last saved ${dayInMorristown(s.details_saved_at)}.`
            : 'What is on file. The family has never saved the form, so a yes/no left at its default reads "Not answered".'
        }
      >
        <AnswerGroup
          title={`About ${name}`}
          hint="Asked of campers. Anyone else is asked these only if they already had answers here."
        >
          <Answer q="Disability or diagnosis, in your own words">
            <AnswerText value={s.disabilities} />
          </Answer>
          <Answer q={`How does ${name} communicate best?`}>
            <AnswerText value={s.communication} />
          </Answer>
          <Answer q="Getting around">
            <AnswerText value={s.mobility} />
          </Answer>
          <Answer q="Personal care">
            <AnswerText value={s.personal_care} />
          </Answer>
          <Answer q="Anything else about daily routine">
            <AnswerText value={s.daily_living_supports} />
          </Answer>
        </AnswerGroup>

        <AnswerGroup title="Health">
          <Answer q={`Does ${name} have any allergies?`}>
            <AnswerYesNo value={s.has_allergies} saved={saved} tone="red" />
          </Answer>
          {s.has_allergies && (
            <>
              <Answer q="Which ones? Tick all that apply.">
                {words.length ? (
                  <span className="font-semibold text-red-800">{words.join(', ')}</span>
                ) : (
                  <NotAnswered />
                )}
              </Answer>
              <Answer q="How serious is it?">
                {pill && (
                  <span
                    title={pill.title}
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pill.cls}`}
                  >
                    {pill.text}
                  </span>
                )}
              </Answer>
              <Answer q="What happens, and what should we do?">
                {legacyAllergyText ? (
                  <span className="text-neutral-500">
                    Given before the tick list, as one answer — shown under &ldquo;Which ones&rdquo;.
                  </span>
                ) : (
                  <AnswerText value={s.allergy_detail} alert />
                )}
              </Answer>
            </>
          )}
          <Answer q={`Does ${name} have seizures?`}>
            <AnswerYesNo value={s.has_seizures} saved={saved} tone="red" />
          </Answer>
          {showDetail(s.has_seizures, s.seizure_detail) && (
            <Answer q="What do they look like, and what should we do?">
              <AnswerText value={s.seizure_detail} alert />
            </Answer>
          )}
          <Answer q={`Does ${name} carry any rescue or emergency medication?`}>
            <AnswerYesNo value={s.has_rescue_medication} saved={saved} tone="red" />
          </Answer>
          {showDetail(s.has_rescue_medication, s.rescue_medication_detail) && (
            <Answer q="What, where is it kept, and when is it used?">
              <AnswerText value={s.rescue_medication_detail} alert />
            </Answer>
          )}
          <Answer q="Regular medications">
            <AnswerText value={s.medications} />
          </Answer>
          <Answer q="Dietary needs">
            <AnswerText value={s.dietary_needs} />
          </Answer>
        </AnswerGroup>

        <AnswerGroup title="A hard day">
          <Answer q={`What tends to set ${name} off, or make things harder?`}>
            <AnswerText value={s.behaviour_triggers} />
          </Answer>
          <Answer q="What helps them settle?">
            <AnswerText value={s.redirection_strategies} />
          </Answer>
          <Answer q={`What does ${name} enjoy, and what do they avoid?`}>
            <AnswerText value={s.likes_dislikes} />
          </Answer>
          <Answer q={`Does ${name} have trouble sleeping away from home?`}>
            <AnswerYesNo value={s.has_sleep_disturbance} saved={saved} tone="amber" />
          </Answer>
          {showDetail(s.has_sleep_disturbance, s.sleep_notes) && (
            <Answer q="What should the night staff know?">
              <AnswerText value={s.sleep_notes} />
            </Answer>
          )}
        </AnswerGroup>

        <AnswerGroup title="Support at camp">
          <Answer q={`Anything about who ${name} shares a room with, or the room itself?`}>
            <AnswerText value={s.rooming_preferences} />
          </Answer>
          <Answer q={`Will a caregiver be attending with ${name}?`}>
            <AnswerYesNo value={s.has_caregiver} saved={saved} tone="amber" />
          </Answer>
        </AnswerGroup>

        <AnswerGroup title="Emergency contact">
          <Answer q="Name">
            <AnswerText value={s.emergency_contact_name} />
          </Answer>
          <Answer q="Phone">
            {isBlank(s.emergency_contact_phone) ? (
              <NotAnswered />
            ) : (
              <a href={`tel:${s.emergency_contact_phone}`} className="text-brand underline">
                {s.emergency_contact_phone}
              </a>
            )}
          </Answer>
          <Answer q={`Relationship to ${name}`}>
            <AnswerText value={s.emergency_contact_relationship} />
          </Answer>
        </AnswerGroup>

        <AnswerGroup title="Anything else?" hint="Anything that doesn't fit neatly above.">
          <Answer q="Anything else?">
            <AnswerText value={s.other_concerns} />
          </Answer>
        </AnswerGroup>
      </Section>
    </div>
  );
}

// The volunteer application's answers, per event, under the application's own
// questions (app/register/volunteer/VolunteerApplication.jsx). NOT behind the
// Sensitive grant: volunteer_applications' select policy is is_staff() (0001;
// 0101 changed its write rules, not its read), and the Volunteers page already
// shows these answers to every staff member who opens it. Gating them here
// would hide on one page what another page shows.
function VolunteerAnswers({ parts, appByPart, adultName, dob }) {
  const withApp = parts.filter((p) => appByPart.has(p.id));
  if (withApp.length === 0) return null;
  return (
    <div className="mt-4">
      <Section
        title="Volunteer application answers"
        note="What they wrote on the volunteer application, per event. Reviewed on the Volunteers page."
      >
        {withApp.map((p) => {
          const a = appByPart.get(p.id);
          const age = ageAt(dob, p.registrations?.events?.starts_on);
          const minor = age != null && age < 18;
          return (
            <AnswerGroup
              key={p.id}
              title={`${p.registrations?.events?.name ?? 'Event'} — ${a.status}${
                a.updated_at ? `, last saved ${dayInMorristown(a.updated_at)}` : ''
              }`}
            >
              <Answer q="Where would you like to serve?">
                <AnswerText value={a.preferred_areas} />
              </Answer>
              <Answer q="Is this your first time volunteering with us?">
                {a.first_time_volunteering == null ? (
                  <NotAnswered />
                ) : a.first_time_volunteering ? (
                  'Yes — first time'
                ) : (
                  'No — returning'
                )}
              </Answer>
              <Answer q="Home church">
                <AnswerText value={a.church_attendance} />
              </Answer>
              <Answer q="A little about your faith">
                <AnswerText value={a.faith_statement} />
              </Answer>
              <Answer q="Skills you'd bring (music, lifeguard, nursing, crafts…)">
                <AnswerText value={a.relevant_skills} />
              </Answer>
              <Answer q="Experience with people with disabilities">
                <AnswerText value={a.disability_experience} />
                {a.first_time_disability_ministry && (
                  <p className="mt-1 text-sm">First time serving in disability ministry</p>
                )}
              </Answer>
              {(minor || a.accompanying_adult_person_id) && (
                <Answer q="Accompanying adult (required for volunteers under 18)">
                  {a.accompanying_adult_person_id ? (
                    <Link
                      href={`/admin/people/${a.accompanying_adult_person_id}/`}
                      className="text-brand underline"
                    >
                      {adultName.get(a.accompanying_adult_person_id) || 'The named adult'}
                    </Link>
                  ) : (
                    <span className="font-semibold text-amber-800">⚑ None named</span>
                  )}
                </Answer>
              )}
              <Answer q="I have read the Apostles' Creed and I affirm it.">
                {a.creed_affirmed === true ? (
                  <span className="text-green-700">Affirmed</span>
                ) : a.creed_affirmed === false ? (
                  <span className="font-semibold text-red-700">⚠ Not affirmed — speak with Larry</span>
                ) : (
                  <NotAnswered />
                )}
              </Answer>
            </AnswerGroup>
          );
        })}
      </Section>
    </div>
  );
}

export default async function PersonPage({ params }) {
  const { personId } = await params;

  const staff = await getStaff();
  if (!staff) await bounceNonStaff(`/admin/people/${personId}/`);
  if (!can(staff, 'staff')) redirect('/admin');

  // read:sensitive is what person_support's select policy asks
  // (can_view_person_support -> can_view_sensitive() = has_grant('sensitive',
  // 'read'), 0101/0106). 'sensitive' is its old alias; the canonical name is
  // used so the page reads the same as the policy.
  const sensitive = can(staff, 'read:sensitive');
  const supabase = await createClient();

  const { data: person } = await supabase
    .from('people')
    .select('id, first_name, last_name, preferred_name, date_of_birth, gender, household_id, phone, email')
    .eq('id', personId)
    .maybeSingle();
  if (!person) notFound();

  // Every registration this person is on. A person can hold several roles
  // across events -- volunteer at one, camper at another -- and this page is
  // the one place that has to show all of them at once rather than picking one.
  const { data: parts } = await supabase
    .from('registration_participants')
    .select(
      `id, camp_role, status, program_id, registration_id,
       registrations ( id, event_id, household_id,
         events ( id, name, starts_on, ends_on ),
         households ( display_name, email, phone ) )`
    )
    .eq('person_id', personId)
    .neq('status', 'cancelled');

  const participantIds = (parts ?? []).map((p) => p.id);

  const [{ data: programs }, { data: lodgingRows }] = await Promise.all([
    supabase.from('programs').select('id, name'),
    participantIds.length
      ? supabase
          .from('lodging_assignments')
          .select('registration_participant_id, lodgings ( id, name, kind, parent_id, accessible )')
          .in('registration_participant_id', participantIds)
      : Promise.resolve({ data: [] }),
  ]);
  const programName = new Map((programs ?? []).map((g) => [g.id, g.name]));

  // Everything else a reviewer asks about a person, by event (14 Oct 2026,
  // Lawrence: "there doesn't seem to be a way to easily get to ALL of the
  // info for a person's registration"). The review class and flags come from
  // the same view the review queue uses; agreements are this person's own
  // signatures plus any household-level one from before 30 Sep; the
  // volunteer application carries the Creed answer; permissions are the
  // latest answer per kind.
  const regIds = [...new Set((parts ?? []).map((p) => p.registration_id).filter(Boolean))];
  const [{ data: reviewRows }, { data: ownSigs }, { data: householdSigs }, { data: apps }, { data: consents }] =
    await Promise.all([
      regIds.length
        ? supabase.from('registration_review').select('registration_id, review_class, flags').in('registration_id', regIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from('agreement_signatures')
        .select('registration_id, status, signed_at, signer_name, signer_role, agreements ( key, title, version )')
        .eq('person_id', personId)
        .order('signed_at', { ascending: true }),
      regIds.length
        ? supabase
            .from('agreement_signatures')
            .select('registration_id, status, signed_at, signer_name, signer_role, agreements ( key, title, version )')
            .is('person_id', null)
            .in('registration_id', regIds)
            .order('signed_at', { ascending: true })
        : Promise.resolve({ data: [] }),
      participantIds.length
        ? supabase
            .from('volunteer_applications')
            .select(
              'registration_participant_id, status, creed_affirmed, reviewed_at, updated_at, preferred_areas, first_time_volunteering, church_attendance, faith_statement, relevant_skills, first_time_disability_ministry, disability_experience, accompanying_adult_person_id'
            )
            .in('registration_participant_id', participantIds)
            .then((res) => {
              // Thrown, not swallowed: this read carries the answers shown
              // under Form answers, and an error read as "no application"
              // would say this volunteer never applied.
              if (res.error) throw new Error(`Volunteer applications: ${res.error.message}`);
              return res;
            })
        : Promise.resolve({ data: [] }),
      supabase
        .from('person_consents')
        .select('kind, granted, recorded_at, recorded_as')
        .eq('person_id', personId)
        .order('recorded_at', { ascending: false }),
    ]);
  const reviewByReg = new Map((reviewRows ?? []).map((r) => [r.registration_id, r]));
  const sigsByReg = new Map();
  for (const sig of [...(ownSigs ?? []), ...(householdSigs ?? [])]) {
    if (!sigsByReg.has(sig.registration_id)) sigsByReg.set(sig.registration_id, []);
    sigsByReg.get(sig.registration_id).push(sig);
  }
  const appByPart = new Map((apps ?? []).map((a) => [a.registration_participant_id, a]));
  const latestConsent = new Map();
  for (const c of consents ?? []) if (!latestConsent.has(c.kind)) latestConsent.set(c.kind, c);
  const CONSENT_LABEL = { media: 'Photos and video', directory: 'Participant directory' };
  const SIGNER_ROLE = {
    self: 'for themselves',
    parent_guardian: 'as parent or guardian',
    legal_guardian: 'as legal guardian',
    authorized_adult: 'with their permission',
    all_registered: 'for everyone on the registration (household signature)',
    parent: 'as a parent',
    guardian: 'as guardian',
    account_holder: 'as the account holder',
  };
  const fmtDate = (iso) => dayInMorristown(iso);

  // Cabin names for rooms, so "Room 3" reads as "Oak Cabin · Room 3". A room
  // points at its cabin; a cabin points at nothing.
  const parentIds = [
    ...new Set((lodgingRows ?? []).map((r) => r.lodgings?.parent_id).filter(Boolean)),
  ];
  const { data: parentRows } = parentIds.length
    ? await supabase.from('lodgings').select('id, name').in('id', parentIds)
    : { data: [] };
  const parentName = new Map((parentRows ?? []).map((r) => [r.id, r.name]));
  const placeFor = (participantId) => {
    const l = (lodgingRows ?? []).find((r) => r.registration_participant_id === participantId)?.lodgings;
    if (!l) return null;
    const cabin = l.parent_id ? parentName.get(l.parent_id) : null;
    return { label: cabin ? `${cabin} · ${l.name}` : l.name, accessible: l.accessible };
  };

  // Buddies. TWO separate lookups, not a nested join: buddy_assignments has two
  // foreign keys to registration_participants, and PostgREST embeds through
  // those are fragile -- a working rule already in CLAUDE.md, learned the hard
  // way. This person may be the camper OR the buddy, and both are worth showing.
  const { data: asCamper } = participantIds.length
    ? await supabase
        .from('buddy_assignments')
        .select('id, buddy_participant_id, event_id')
        .in('camper_participant_id', participantIds)
        .is('ended_at', null)
    : { data: [] };
  const { data: asBuddy } = participantIds.length
    ? await supabase
        .from('buddy_assignments')
        .select('id, camper_participant_id, event_id')
        .in('buddy_participant_id', participantIds)
        .is('ended_at', null)
    : { data: [] };

  const otherPartIds = [
    ...new Set([
      ...(asCamper ?? []).map((b) => b.buddy_participant_id),
      ...(asBuddy ?? []).map((b) => b.camper_participant_id),
    ].filter(Boolean)),
  ];
  const { data: otherParts } = otherPartIds.length
    ? await supabase
        .from('registration_participants')
        .select('id, person_id, people ( id, first_name, last_name )')
        .in('id', otherPartIds)
    : { data: [] };
  const personOfPart = new Map(
    (otherParts ?? []).map((r) => [
      r.id,
      { personId: r.people?.id, name: `${r.people?.first_name ?? ''} ${r.people?.last_name ?? ''}`.trim() },
    ])
  );

  // E31. Where the rest of this household is sleeping, per event. The Lodging
  // page answers "who is in this room"; a parent at check-in asks the opposite
  // question, and a family split across rooms is exactly when it gets asked.
  const { data: household } = person.household_id
    ? await supabase
        .from('households')
        .select('id, display_name, email, phone')
        .eq('id', person.household_id)
        .maybeSingle()
    : { data: null };

  const { data: siblings } = person.household_id
    ? await supabase
        .from('people')
        .select('id, first_name, last_name')
        .eq('household_id', person.household_id)
        .neq('id', personId)
    : { data: [] };

  const siblingIds = (siblings ?? []).map((s) => s.id);
  const { data: sibParts } = siblingIds.length
    ? await supabase
        .from('registration_participants')
        .select('id, person_id, registrations!inner ( event_id )')
        .in('person_id', siblingIds)
        .neq('status', 'cancelled')
    : { data: [] };
  const sibPartIds = (sibParts ?? []).map((r) => r.id);
  const { data: sibLodging } = sibPartIds.length
    ? await supabase
        .from('lodging_assignments')
        .select('registration_participant_id, lodgings ( name, parent_id )')
        .in('registration_participant_id', sibPartIds)
    : { data: [] };
  const sibPlace = new Map(
    (sibLodging ?? []).map((r) => [
      r.registration_participant_id,
      r.lodgings?.parent_id
        ? `${parentName.get(r.lodgings.parent_id) ?? ''} · ${r.lodgings.name}`.replace(/^ · /, '')
        : r.lodgings?.name ?? null,
    ])
  );
  const sibName = new Map((siblings ?? []).map((s) => [s.id, `${s.first_name} ${s.last_name}`.trim()]));

  // Support detail. RLS would hide it anyway (can_view_person_support), but the
  // grant is checked explicitly so the page can SAY it is hidden rather than
  // rendering an empty section that reads as "nothing recorded" -- which on a
  // medical section is the dangerous reading.
  //
  // Every answer column, for Form answers as well as the two summaries. A
  // failed read for someone WITH the grant is thrown: rendered as null it
  // would say "nothing recorded" on a medical record.
  let support = null;
  if (sensitive) {
    const { data, error } = await supabase
      .from('person_support')
      .select(
        `has_allergies, allergy_severity, allergens, allergy_other, allergy_detail, dietary_needs,
         has_seizures, seizure_detail, has_rescue_medication, rescue_medication_detail, medications,
         disabilities, communication, mobility, personal_care, daily_living_supports,
         behaviour_triggers, redirection_strategies, likes_dislikes,
         has_sleep_disturbance, sleep_notes, rooming_preferences, has_caregiver, other_concerns,
         buddy_required, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
         details_saved_at`
      )
      .eq('person_id', personId)
      .maybeSingle();
    if (error) throw new Error(`Support details: ${error.message}`);
    support = data;
  }

  // Names for any accompanying adult a volunteer named (volunteer answers).
  const adultIds = [...new Set((apps ?? []).map((a) => a.accompanying_adult_person_id).filter(Boolean))];
  let adultName = new Map();
  if (adultIds.length) {
    const { data: adults, error: adultsError } = await supabase
      .from('people')
      .select('id, first_name, last_name')
      .in('id', adultIds);
    if (adultsError) throw new Error(`Accompanying adults: ${adultsError.message}`);
    adultName = new Map((adults ?? []).map((a) => [a.id, `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim()]));
  }

  // The face at the top, as on Check-In and the registration page. Sensitive
  // read, like the photos table and bucket (lib/photos.js); without it, or
  // with no photo uploaded, the heading stands alone.
  const photoUrl = (await signedPhotoUrls(supabase, sensitive, [personId])).get(personId) ?? null;

  const displayName = [person.first_name, person.last_name].filter(Boolean).join(' ');
  const soonest = (parts ?? [])
    .map((p) => p.registrations?.events?.starts_on)
    .filter(Boolean)
    .sort()[0];

  return (
    <div>
      <div className="flex items-center gap-4">
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt=""
          className="h-20 w-20 shrink-0 rounded-full object-cover border border-neutral-200"
        />
      )}
      <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Person</p>
      <h1 className="text-2xl font-bold">
        {displayName}
        {person.preferred_name && person.preferred_name !== person.first_name && (
          <span className="ml-2 text-lg font-normal text-neutral-500">
            goes by &ldquo;{person.preferred_name}&rdquo;
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        {household?.display_name ?? 'No household'}
        {' · '}
        {ageAt(person.date_of_birth, soonest) != null
          ? `${ageAt(person.date_of_birth, soonest)} at camp`
          : 'age not recorded'}
        {person.gender ? ` · ${person.gender}` : ''}
      </p>
      </div>
      </div>

      <p className="mt-3 text-sm">
        <Link href="/admin/rosters/" className="text-brand underline">
          &larr; Back to rosters
        </Link>
      </p>

      {!sensitive && (
        <p className="mt-4 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Some of this person&rsquo;s information is hidden.</strong> Allergies,
          medical flags and the emergency contact need the <em>sensitive information</em>{' '}
          permission. An administrator grants it on Staff &amp; Access.
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Section title="At camp" note="Every event this person is registered for.">
          {(parts ?? []).length === 0 ? (
            <p className="text-neutral-500">Not registered for anything.</p>
          ) : (
            (parts ?? []).map((p) => {
              const place = placeFor(p.id);
              return (
                <div key={p.id} className="mb-3 last:mb-0 rounded-sm border border-neutral-200 p-3">
                  {/* The event name IS the link to the registration (31 Aug).
                      It was a fifth row saying "Open the registration", which
                      is a whole line spent on a verb — and it made this card
                      taller than the Buddy card beside it for no gain. */}
                  <p className="font-semibold">
                    <Link
                      href={`/admin/registrations/${p.registration_id}/`}
                      className="text-brand underline"
                    >
                      {p.registrations?.events?.name ?? 'Event'}
                    </Link>
                  </p>
                  <Row label="Role">{ROLE_LABEL[p.camp_role] ?? p.camp_role}</Row>
                  <Row label="Status">
                    {(() => {
                      // The same pill as the roster, from the same function.
                      // A bare lower-case "confirmed" here next to a green pill
                      // three clicks away reads as two different facts.
                      const st = statusPill(p.status);
                      return (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}
                        >
                          {st.text}
                        </span>
                      );
                    })()}
                  </Row>
                  <Row label="Program">
                    {p.program_id ? (
                      programName.get(p.program_id) ?? 'Unknown'
                    ) : (
                      <span className="text-amber-700">Not placed</span>
                    )}
                  </Row>
                  <Row label="Sleeping">
                    {place ? (
                      <>
                        {place.label}
                        {place.accessible && (
                          <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand-dark">
                            accessible
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-700">No place assigned</span>
                    )}
                  </Row>
                  {(() => {
                    const rv = reviewByReg.get(p.registration_id);
                    const cls = rv ? REVIEW_CLASS[rv.review_class] : null;
                    const flags = rv?.flags ?? [];
                    return (
                      <Row label="Review">
                        {cls ? (
                          <span
                            title={cls.hint}
                            className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${cls.cls}`}
                          >
                            {cls.label}
                          </span>
                        ) : (
                          <span className="text-neutral-500">—</span>
                        )}
                        {flags.map((fl) => (
                          <span key={fl} className="ml-2 whitespace-nowrap text-xs font-semibold text-amber-800">
                            ⚑ {REVIEW_FLAG[fl] ?? fl}
                          </span>
                        ))}
                      </Row>
                    );
                  })()}
                  <Row label="Agreements">
                    {(() => {
                      const sigs = sigsByReg.get(p.registration_id) ?? [];
                      if (sigs.length === 0) return <span className="text-amber-700">Not signed</span>;
                      return (
                        <ul className="space-y-0.5">
                          {sigs.map((sg, i) => (
                            <li key={i} className="text-xs">
                              {sg.agreements?.title ?? sg.agreements?.key}
                              {sg.agreements?.version ? ` (v${sg.agreements.version})` : ''} —{' '}
                              {fmtDate(sg.signed_at)} by {sg.signer_name}
                              {sg.signer_role ? `, ${SIGNER_ROLE[sg.signer_role] ?? sg.signer_role}` : ''}
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </Row>
                  {(p.camp_role === 'volunteer' || appByPart.has(p.id)) && (
                    <Row label="Volunteer application">
                      {(() => {
                        const a = appByPart.get(p.id);
                        if (!a) return <span className="text-amber-700">Not started</span>;
                        return (
                          <>
                            <span className="capitalize">{a.status}</span>
                            {a.reviewed_at ? ` · reviewed ${fmtDate(a.reviewed_at)}` : ''}
                            {' · '}
                            {a.creed_affirmed ? (
                              <span className="text-green-700">Creed affirmed</span>
                            ) : (
                              <span className="font-semibold text-red-700">⚠ Creed not affirmed — speak with Larry</span>
                            )}
                          </>
                        );
                      })()}
                    </Row>
                  )}
                </div>
              );
            })
          )}
        </Section>

        <Section title="Permissions" note="The latest answer given for this person; earlier answers are kept.">
          {latestConsent.size === 0 ? (
            <p className="text-neutral-500">Nothing recorded yet.</p>
          ) : (
            [...latestConsent.values()].map((c) => (
              <Row key={c.kind} label={CONSENT_LABEL[c.kind] ?? c.kind}>
                {c.granted ? (
                  <span className="text-green-700">Yes</span>
                ) : (
                  <span className="font-semibold text-amber-800">⚑ Declined</span>
                )}
                <span className="ml-2 text-xs text-neutral-500">
                  {fmtDate(c.recorded_at)}
                  {/* recorded_as holds the signing vocabulary (all_registered,
                      self, guardian) or 'staff'; the registration page says it
                      the same way (Script 5: the raw words were showing). */}
                  {c.recorded_as === 'staff' ? ' · entered by staff' : c.recorded_as ? ' · from the family' : ''}
                </span>
              </Row>
            ))
          )}
        </Section>

        <Section
          title="Buddy"
          note="Both directions — who supports them, and who they support."
        >
          {(asCamper ?? []).length === 0 && (asBuddy ?? []).length === 0 ? (
            <p className="text-neutral-500">No buddy pairing.</p>
          ) : (
            <ul className="space-y-1">
              {(asCamper ?? []).map((b) => {
                const o = personOfPart.get(b.buddy_participant_id);
                return (
                  <li key={b.id}>
                    Supported by{' '}
                    {o?.personId ? (
                      <Link href={`/admin/people/${o.personId}/`} className="text-brand underline">
                        {o.name}
                      </Link>
                    ) : (
                      o?.name ?? 'someone'
                    )}
                  </li>
                );
              })}
              {(asBuddy ?? []).map((b) => {
                const o = personOfPart.get(b.camper_participant_id);
                return (
                  <li key={b.id}>
                    Buddy for{' '}
                    {o?.personId ? (
                      <Link href={`/admin/people/${o.personId}/`} className="text-brand underline">
                        {o.name}
                      </Link>
                    ) : (
                      o?.name ?? 'someone'
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* E31 */}
        <Section
          title="Their family"
          note="Where everyone else in this household is sleeping."
        >
          <Row label="Household">{household?.display_name ?? '—'}</Row>
          <Row label="Contact">
            {[household?.email, household?.phone].filter(Boolean).join(' · ') || '—'}
          </Row>
          {(siblings ?? []).length === 0 ? (
            <p className="mt-2 text-neutral-500">Nobody else in this household.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {(siblings ?? []).map((s) => {
                const theirParts = (sibParts ?? []).filter((r) => r.person_id === s.id);
                const places = [
                  ...new Set(theirParts.map((r) => sibPlace.get(r.id)).filter(Boolean)),
                ];
                return (
                  <li key={s.id} className="flex flex-wrap gap-x-2">
                    <Link href={`/admin/people/${s.id}/`} className="text-brand underline">
                      {sibName.get(s.id)}
                    </Link>
                    <span className="text-neutral-500">
                      {theirParts.length === 0
                        ? 'not registered'
                        : places.length === 0
                          ? 'no place assigned'
                          : places.join(' · ')}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="Allergies, diet and medical"
          note={sensitive ? 'Flags and detail.' : undefined}
        >
          {!sensitive ? (
            <p className="text-neutral-500">
              Hidden — needs the <em>sensitive information</em> permission.
            </p>
          ) : !support ? (
            <p className="text-neutral-500">Nothing recorded.</p>
          ) : (
            <>
              <Row label="Allergies">
                {(() => {
                  const pill = allergyPill(support.has_allergies, support.allergy_severity);
                  return pill ? (
                    <span
                      title={pill.title}
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pill.cls}`}
                    >
                      {pill.text}
                    </span>
                  ) : (
                    <span className="text-neutral-500">None recorded</span>
                  );
                })()}
              </Row>
              {allergySummary(support) && <Row label="Detail">{allergySummary(support)}</Row>}
              <Row label="Dietary needs">{support.dietary_needs || '—'}</Row>
              <Row label="Seizures">{support.has_seizures ? 'Yes' : 'No'}</Row>
              <Row label="Rescue medication">{support.has_rescue_medication ? 'Yes' : 'No'}</Row>
              {/* "Needs a buddy" was here and is gone (31 Aug). The Buddy card
                  already answers it, better: it says WHO, and it stays true
                  after somebody is paired. This row went on saying "Yes" for
                  the rest of the season. */}
              <p className="mt-2 text-xs text-neutral-500">
                The summary. Every answer the family gave, in the form&rsquo;s own questions, is
                under <a href="#form-answers" className="text-brand underline">Form answers</a>{' '}
                below.
              </p>
            </>
          )}
        </Section>

        <Section title="Emergency contact" note="Someone not attending the event.">
          {!sensitive ? (
            <p className="text-neutral-500">
              Hidden — needs the <em>sensitive information</em> permission.
            </p>
          ) : !support?.emergency_contact_name && !support?.emergency_contact_phone ? (
            <p className="text-amber-700">
              None recorded. This is the one thing the family form asks of everyone.
            </p>
          ) : (
            <>
              <Row label="Name">{support.emergency_contact_name || '—'}</Row>
              <Row label="Phone">
                {support.emergency_contact_phone ? (
                  <a href={`tel:${support.emergency_contact_phone}`} className="text-brand underline">
                    {support.emergency_contact_phone}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Relationship">{support.emergency_contact_relationship || '—'}</Row>
            </>
          )}
        </Section>
      </div>

      <FormAnswers
        sensitive={sensitive}
        support={support}
        name={person.preferred_name || person.first_name || 'this person'}
      />

      <VolunteerAnswers
        parts={parts ?? []}
        appByPart={appByPart}
        adultName={adultName}
        dob={person.date_of_birth}
      />
    </div>
  );
}
