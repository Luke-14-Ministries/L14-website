import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import ActivityPicker from './ActivityPicker';
import WaiverUpload from './WaiverUpload';
import BackBar from '@/components/BackBar';
import BackLink from '@/components/BackLink';
import { agreementText, isCurrentEventRow } from '@/lib/events';

export const metadata = { title: 'Activities — Luke 14 Ministries' };

// Activity choices, one card per event, one card per attending person inside it.
//
// Deliberately its own page rather than another card on the dashboard: a
// family with three people and eleven activities is a lot of screen, and the
// dashboard's job is "what needs my attention", not "everything I might do".
//
// The dashboard links here PER REGISTRATION (?registration=<id>, Script 6
// item 7.1, 26 Oct 2026): pressed from the Week 1 card, the page shows Week 1
// and nothing else, with a link to every event. Lawrence, a volunteer on
// three events, pressed it on Week 1 and read the Retreat's outside-provider
// block -- the Retreat has its own rafting with the same outfitter -- as
// Week 1's, because every event was stacked under one camper-worded intro and
// Week 1 sorted last. Each event is now its own card, in date order, with
// wording for who is on it.
export default async function ActivitiesPage({ searchParams }) {
  const params = await searchParams;
  const wanted = typeof params?.registration === 'string' ? params.registration : '';

  const user = await getCurrentUser();
  if (!user) {
    redirect(
      `/account/?next=${encodeURIComponent(
        wanted ? `/account/activities/?registration=${wanted}` : '/account/activities/'
      )}`
    );
  }

  const supabase = await createClient();

  const { data: memberships, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  if (memberError) throw new Error(`Household: ${memberError.message}`);
  const householdIds = (memberships ?? []).map((m) => m.household_id);

  // Scoped to this household explicitly (CLAUDE.md), never left to RLS: a
  // staff member who is also a family can read every registration.
  const { data: registrations, error: regError } = householdIds.length
    ? await supabase
        .from('registrations')
        .select(
          `id, events ( id, name, starts_on, ends_on, archived_at ),
           registration_participants ( id, status, camp_role, people ( id, first_name, last_name, date_of_birth ) )`
        )
        .in('household_id', householdIds)
    : { data: [], error: null };
  if (regError) throw new Error(`Registrations: ${regError.message}`);

  // One registration, when the link named one of THIS household's. An id
  // that is not theirs (or not an id at all) is never looked up on its own:
  // it simply matches nothing here, and the page shows all their events.
  const scoped = wanted ? (registrations ?? []).find((r) => r.id === wanted) ?? null : null;

  // Otherwise every current event (isCurrentEventRow: to two weeks after it
  // ends, a year ahead, never archived), earliest first.
  const regs = (scoped ? [scoped] : (registrations ?? []).filter((r) => isCurrentEventRow(r.events)))
    .slice()
    .sort(
      (a, b) =>
        String(a.events?.starts_on ?? '9999').localeCompare(String(b.events?.starts_on ?? '9999')) ||
        String(a.events?.name ?? '').localeCompare(String(b.events?.name ?? ''))
    );
  const eventIds = [...new Set(regs.map((r) => r.events?.id).filter(Boolean))];

  // Activities for exactly the events shown. RLS also hides inactive ones
  // and unpublished events, so this cannot show something the ministry has
  // not opened.
  const { data: activityRows, error: activityError } = eventIds.length
    ? await supabase
        .from('activities')
        .select(
          'id, event_id, name, description, booking_mode, capacity, fee_cents, provider_name, provider_url, signup_opens_at, signup_closes_at'
        )
        .in('event_id', eventIds)
        .eq('active', true)
        .order('sort_order')
    : { data: [], error: null };
  if (activityError) throw new Error(`Activities: ${activityError.message}`);

  const participantIds = regs.flatMap((r) =>
    (r.registration_participants ?? []).map((p) => p.id)
  );

  const { data: signupRows, error: signupError } = participantIds.length
    ? await supabase
        .from('activity_signups')
        .select('registration_participant_id, activity_id, slot_id, status, waiver_acknowledged_at')
        .in('registration_participant_id', participantIds)
    : { data: [], error: null };
  if (signupError) throw new Error(`Activity choices: ${signupError.message}`);

  // Proof that an outside provider's form was done (0087, 14 Oct 2026):
  // one upload per person per activity, shown beside the activity and, for
  // volunteers, in their own block in that event's card.
  const { data: waiverRows, error: waiverError } = participantIds.length
    ? await supabase
        .from('activity_waiver_uploads')
        .select('registration_participant_id, activity_id, storage_path, uploaded_at')
        .in('registration_participant_id', participantIds)
    : { data: [], error: null };
  if (waiverError) throw new Error(`Provider confirmations: ${waiverError.message}`);
  const waiverByKey = new Map(
    (waiverRows ?? []).map((w) => [`${w.registration_participant_id}:${w.activity_id}`, w])
  );

  // The ministry's own waiver for one activity (0116, horseback riding): an
  // agreement_requirements row scoped to the ACTIVITY rather than the event.
  // The wizard reads the event-level rows; these are read here, and signed
  // here, per rider. Only an active document the site serves itself can be
  // signed on the site, so anything else (an outside provider's link, a
  // retired version) is left out rather than shown with no way to sign it.
  const activityIds = (activityRows ?? []).map((a) => a.id);
  const { data: reqRows, error: reqError } = activityIds.length
    ? await supabase
        .from('agreement_requirements')
        .select('activity_id, agreements ( id, title, body, version, active, delivery )')
        .in('activity_id', activityIds)
        .eq('is_required', true)
    : { data: [], error: null };
  if (reqError) throw new Error(`Activity agreements: ${reqError.message}`);
  const agreementByActivity = new Map();
  for (const r of reqRows ?? []) {
    const a = r.agreements;
    if (!a?.active || a.delivery !== 'internal_document') continue;
    if (!agreementByActivity.has(r.activity_id)) agreementByActivity.set(r.activity_id, a);
  }
  const agreementIds = [...new Set([...agreementByActivity.values()].map((a) => a.id))];

  // Who has already signed which, on which registration. Scoped to this
  // household's registrations explicitly (CLAUDE.md), not left to RLS. A
  // signature belongs to one registration: the same rider at a second week
  // signs the second week's waiver.
  const registrationIds = regs.map((r) => r.id);
  const { data: sigRows, error: sigError } =
    agreementIds.length && registrationIds.length
      ? await supabase
          .from('agreement_signatures')
          .select('agreement_id, person_id, registration_id, signer_name, signed_at')
          .in('agreement_id', agreementIds)
          .in('registration_id', registrationIds)
          .eq('status', 'signed_here')
          .not('person_id', 'is', null)
      : { data: [], error: null };
  if (sigError) throw new Error(`Activity waiver signatures: ${sigError.message}`);
  const signatureByKey = new Map(
    (sigRows ?? []).map((s) => [
      `${s.registration_id}:${s.person_id}:${s.agreement_id}`,
      { signer_name: s.signer_name, signed_at: s.signed_at },
    ])
  );

  // What is still outstanding on places ALREADY held (0120): a waiver staff
  // attached after the signup, or an outside provider's confirmation not yet
  // uploaded. The view is the one answer; scoped to this household
  // explicitly, not left to RLS (staff who are also a family read every row).
  const { data: owedRows, error: owedError } = householdIds.length
    ? await supabase
        .from('activity_waivers_outstanding')
        .select('registration_participant_id, activity_id, kind')
        .in('household_id', householdIds)
    : { data: [], error: null };
  if (owedError) throw new Error(`Outstanding waivers: ${owedError.message}`);
  const owedByKey = new Map();
  for (const o of owedRows ?? []) {
    const k = `${o.registration_participant_id}:${o.activity_id}`;
    owedByKey.set(k, { ...(owedByKey.get(k) ?? {}), [o.kind]: true });
  }

  // Age at the start of the event, the way the wizard decides who may sign
  // for themselves: a minor at camp is always signed for by a parent or
  // guardian, whatever today's date says.
  const ageAt = (dob, onDate) => {
    if (!dob || !onDate) return null;
    const [by, bm, bd] = String(dob).split('-').map(Number);
    const [y, m, d] = String(onDate).split('-').map(Number);
    if (!by || !y) return null;
    return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
  };

  // How full each activity is. The function returns counts only -- a family
  // cannot read other families' signups, and does not need to.
  const takenByActivity = new Map();
  // Sittings, with counts only -- same rule as the activity availability
  // above: a family sees how many places are left, never who is in them.
  const slotsByActivity = new Map();
  const fmtDay = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y) return iso;
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  };
  const fmtTime = (t) => {
    if (!t) return '';
    const [h, min] = String(t).split(':').map(Number);
    if (Number.isNaN(h)) return t;
    const ampm = h >= 12 ? 'pm' : 'am';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return min ? `${hh}:${String(min).padStart(2, '0')}${ampm}` : `${hh}${ampm}`;
  };

  for (const eventId of eventIds) {
    const [{ data: avail, error: availError }, { data: slotAvail, error: slotError }] = await Promise.all([
      supabase.rpc('activity_availability', { p_event_id: eventId }),
      supabase.rpc('activity_slot_availability', { p_event_id: eventId }),
    ]);
    if (availError) throw new Error(`Activity places: ${availError.message}`);
    if (slotError) throw new Error(`Activity sittings: ${slotError.message}`);
    for (const row of avail ?? []) takenByActivity.set(row.activity_id, row.taken);
    for (const row of slotAvail ?? []) {
      if (!slotsByActivity.has(row.activity_id)) slotsByActivity.set(row.activity_id, []);
      slotsByActivity.get(row.activity_id).push({
        id: row.slot_id,
        capacity: row.capacity,
        taken: row.taken,
        // Formatted once, on the server, so every surface says the time the
        // same way and no client does date maths on a wall-clock value.
        label_text: `${fmtDay(row.slot_date)}, ${fmtTime(row.start_time)}–${fmtTime(
          row.end_time
        )}${row.label ? ` · ${row.label}` : ''}`,
      });
    }
  }

  const chosen = new Map();
  for (const s of signupRows ?? []) {
    chosen.set(`${s.registration_participant_id}:${s.activity_id}`, s);
  }

  const sections = regs
    .map((r) => {
      const activities = (activityRows ?? [])
        .filter((a) => a.event_id === r.events?.id)
        .map((a) => {
          const agr = agreementByActivity.get(a.id) ?? null;
          return {
            ...a,
            taken: takenByActivity.get(a.id) ?? 0,
            placesLeft: a.capacity == null ? null : Math.max(0, a.capacity - (takenByActivity.get(a.id) ?? 0)),
            slots: slotsByActivity.get(a.id) ?? [],
            // The waiver this activity needs, with the event's name filled in
            // the way every agreement is, or null.
            agreement: agr
              ? { id: agr.id, title: agr.title, version: agr.version, body: agreementText(agr.body, r.events) }
              : null,
          };
        });
      // Campers only (Lawrence, 14 Oct 2026). Activities are chosen for the
      // camper; the buddy goes along with them. A volunteer, parent or
      // sibling choosing horseback riding for themselves was never the idea,
      // and the sheets the area leaders carry count places for campers.
      const people = (r.registration_participants ?? [])
        .filter((p) => p.status !== 'cancelled' && p.camp_role === 'camper')
        .map((p) => {
          const age = ageAt(p.people?.date_of_birth, r.events?.starts_on);
          return {
            participantId: p.id,
            name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
            // Whether the rider may sign for themselves. Unknown birth date:
            // offered, and the server has the last word.
            adult: age == null || age >= 18,
            choices: Object.fromEntries(
              activities
                .map((a) => [a.id, chosen.get(`${p.id}:${a.id}`) ?? null])
                .filter(([, v]) => v)
            ),
            waivers: Object.fromEntries(
              activities
                .map((a) => [a.id, waiverByKey.get(`${p.id}:${a.id}`) ?? null])
                .filter(([, v]) => v)
            ),
            // By activity id: { ours?: true, provider?: true } where a place
            // already held still needs its waiver (0120).
            outstanding: Object.fromEntries(
              activities
                .map((a) => [a.id, owedByKey.get(`${p.id}:${a.id}`) ?? null])
                .filter(([, v]) => v)
            ),
            // Signatures already given on this registration, by agreement id.
            signed: Object.fromEntries(
              activities
                .filter((a) => a.agreement)
                .map((a) => [
                  a.agreement.id,
                  signatureByKey.get(`${r.id}:${p.people?.id}:${a.agreement.id}`) ?? null,
                ])
                .filter(([, v]) => v)
            ),
          };
        });
      // Volunteers do not choose activities (they go where their camper
      // goes), but an outside provider wants THEIR form too. So each
      // volunteer gets an upload box per provider-run activity on the event.
      const providerActivities = activities.filter((a) => a.provider_name || a.provider_url);
      const volunteers = (r.registration_participants ?? [])
        .filter((p) => p.status !== 'cancelled' && p.camp_role === 'volunteer')
        .map((p) => ({
          participantId: p.id,
          name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
          waivers: Object.fromEntries(
            providerActivities
              .map((a) => [a.id, waiverByKey.get(`${p.id}:${a.id}`) ?? null])
              .filter(([, v]) => v)
          ),
        }));
      return { registrationId: r.id, event: r.events, activities, people, volunteers, providerActivities };
    })
    // All events: only those with something to do here -- a camper with
    // activities to choose from, or a volunteer with an outside provider's
    // form to upload. The one registration the link named is shown whatever
    // it holds, with a line saying there is nothing here yet, so the button
    // never lands on a page about other events.
    .filter(
      (s) =>
        scoped ||
        (s.activities.length > 0 &&
          (s.people.length > 0 || (s.volunteers.length > 0 && s.providerActivities.length > 0)))
    );

  return (
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-3xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
          <h1 className="text-3xl font-bold">Activities</h1>
          <BackLink />
        </div>
        <p className="text-neutral-600">Choose activities for each person on your registration.</p>
        {scoped && (
          <p className="mt-2 text-sm">
            <Link href="/account/activities/" className="font-semibold text-brand underline">
              See activities for all your events
            </Link>
          </p>
        )}

        {sections.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-600">
            <p>There are no activities to choose from yet.</p>
            <p className="mt-2 text-sm">
              Camp staff open these closer to each event — you&rsquo;ll find them here when
              they do.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {sections.map((s) => (
              <EventSection key={s.registrationId} section={s} />
            ))}
          </div>
        )}
        <BackBar />
      </div>
    </section>
  );
}

// "Thursday, Oct 29 – Sunday, Nov 1, 2026" from two plain dates, read as
// calendar days (they are dates, not moments: no time zone shift).
function eventDates(event) {
  const day = (iso, withYear) => {
    const [y, m, d] = String(iso ?? '').slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  };
  const from = day(event?.starts_on, false);
  const to = day(event?.ends_on, true);
  if (from && to) return `${from} – ${to}`;
  return day(event?.starts_on, true) || to;
}

// The dashed "nothing here" line inside an event card.
function EmptyNote({ children }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-600">
      {children}
    </p>
  );
}

// One event, in a card of its own. The wording follows who is on THIS
// registration: campers get the camper sentences, a registration with only
// volunteers gets the volunteer one (26 Oct 2026 -- a volunteer was reading
// "choose what each camper would like to do" with no camper on the event).
function EventSection({ section: s }) {
  const hasCampers = s.people.length > 0;
  const hasVolunteers = s.volunteers.length > 0;
  const showProviders = hasVolunteers && s.providerActivities.length > 0;
  return (
    // The anchor the dashboard's "waiver needed" card and the staff email link to.
    <div
      id={`reg-${s.registrationId}`}
      className="scroll-mt-6 overflow-hidden rounded-xl border-2 border-brand/30 bg-brand-light/40 shadow-sm"
    >
      <div className="bg-brand px-5 py-4 text-white">
        <h2 className="text-xl font-bold">{s.event?.name}</h2>
        <p className="mt-0.5 text-sm text-white/85">{eventDates(s.event)}</p>
      </div>
      <div className="space-y-6 p-5">
        {hasCampers ? (
          <p className="text-neutral-700">
            Choose what each camper would like to do — their buddy goes along with them.
            Nothing here is binding — tell us what you&rsquo;d like and camp staff will
            confirm the details closer to the time. You can change your mind whenever you
            like.{' '}
            <span className="font-semibold text-neutral-800">
              Put a name down for anything that appeals, even if you are not sure it will
              work.
            </span>{' '}
            Camp has done this before — there is a great deal of support on hand, and staff
            can usually accommodate a wide range of needs. Any questions or concerns, just
            ask.
          </p>
        ) : (
          hasVolunteers && (
            <p className="text-neutral-700">
              As a volunteer you go where your camper goes. Where an outside provider runs an
              activity, they need your own form as well — complete it with them, then upload
              their confirmation here.
            </p>
          )
        )}

        {hasCampers && s.activities.length === 0 && (
          <EmptyNote>
            There are no activities to choose from for this event yet. Camp staff open these
            closer to the time.
          </EmptyNote>
        )}
        {hasCampers &&
          s.activities.length > 0 &&
          s.people.map((p) => (
            <ActivityPicker key={p.participantId} person={p} activities={s.activities} />
          ))}

        {showProviders && <ProviderUploads section={s} withIntro={hasCampers} />}
        {!hasCampers && hasVolunteers && !showProviders && (
          <EmptyNote>
            No activity on this event is run by an outside provider, so there is nothing to
            upload here.
          </EmptyNote>
        )}
        {!hasCampers && !hasVolunteers && (
          <EmptyNote>
            Activities are chosen for campers, and there is no camper on this registration, so
            there is nothing to choose here.
          </EmptyNote>
        )}
      </div>
    </div>
  );
}

// Each volunteer on the registration, an upload box per provider-run
// activity on THIS event only. `withIntro`: where campers share the card the
// explanation lives here; on a volunteer-only card the card's own sentence
// has already said it.
function ProviderUploads({ section: s, withIntro }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5">
      <h3 className="text-lg font-bold">Volunteers and buddies — outside providers</h3>
      {withIntro ? (
        <p className="mt-1 text-sm text-neutral-600">
          A buddy goes wherever their camper goes. Where an activity is run by an outside
          provider, the provider needs the volunteer&rsquo;s own form as well. Complete it
          with them, then upload their confirmation here — this can be done after camp
          starts, once pairings are known.
        </p>
      ) : (
        <p className="mt-1 text-sm text-neutral-600">
          This can be done after the event starts, once pairings are known.
        </p>
      )}
      {/* Lawrence, 26 Oct 2026: a volunteer must not read the form as a
          sign-up. Whether they go is their camper's choice; the form only
          makes them ready in case. */}
      <p className="mt-3 rounded-sm border border-brand/30 bg-brand-light px-3 py-2 text-sm text-brand-dark">
        <span className="font-semibold">This does not sign you up.</span> Whether you go depends
        on the camper you are paired with: if they choose the activity, you go with them.
        Completing the provider&rsquo;s form now simply means you are ready in case they do.
      </p>
      {s.volunteers.map((v) => (
        <div key={v.participantId} className="mt-4">
          <p className="font-semibold">{v.name}</p>
          {s.providerActivities.map((a) => (
            <div key={a.id} className="mt-2">
              <p className="text-sm">
                <span className="font-semibold">{a.name}</span> — run by{' '}
                {a.provider_name || 'an outside provider'}
                {a.provider_url && (
                  <>
                    {' '}
                    <a
                      href={a.provider_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-semibold text-amber-800"
                    >
                      Open their form ↗
                    </a>
                  </>
                )}
              </p>
              <WaiverUpload
                participantId={v.participantId}
                activityId={a.id}
                providerName={a.provider_name}
                existing={v.waivers?.[a.id] ?? null}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
