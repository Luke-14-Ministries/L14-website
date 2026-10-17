import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { allergyPill, statusPill } from '@/lib/format';
import { allergySummary } from '@/lib/support';
import { REVIEW_CLASS, REVIEW_FLAG } from '@/lib/plans';

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

export default async function PersonPage({ params }) {
  const { personId } = await params;

  const staff = await getStaff();
  if (!staff) await bounceNonStaff(`/admin/people/${personId}/`);
  if (!can(staff, 'staff')) redirect('/admin');

  const sensitive = can(staff, 'sensitive');
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
            .select('registration_participant_id, status, creed_affirmed, reviewed_at, updated_at')
            .in('registration_participant_id', participantIds)
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
  const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : '');

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
  const { data: support } = sensitive
    ? await supabase
        .from('person_support')
        .select(
          'has_allergies, allergy_severity, allergens, allergy_other, allergy_detail, dietary_needs, has_seizures, has_rescue_medication, buddy_required, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship'
        )
        .eq('person_id', personId)
        .maybeSingle()
    : { data: null };

  const displayName = [person.first_name, person.last_name].filter(Boolean).join(' ');
  const soonest = (parts ?? [])
    .map((p) => p.registrations?.events?.starts_on)
    .filter(Boolean)
    .sort()[0];

  return (
    <div>
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

      <p className="mt-3 text-sm">
        <Link href="/admin/rosters/" className="text-brand underline">
          &larr; Back to rosters
        </Link>
      </p>

      {!sensitive && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
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
                <div key={p.id} className="mb-3 last:mb-0 rounded border border-neutral-200 p-3">
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
                            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cls.cls}`}
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
                  {c.recorded_as ? ` · ${c.recorded_as}` : ''}
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
                Fuller medical notes stay on the Medical &amp; Support page — this is the summary,
                not a second medical record.
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
    </div>
  );
}
