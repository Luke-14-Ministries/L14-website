import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow, dayInMorristown } from '@/lib/events';
import { ActivityEditor, AddActivity, ActivityCard, SlotEditor } from './ActivityEditor';
import { slotLabel } from '@/lib/activitySlots';
import EventFilter from '@/components/EventFilter';
import ReviewActions, { WaiverStatusPill, WaiverFileLink } from './WaiverReview';
import { checkAnchor } from '@/lib/waiverAnchors';

export const metadata = { title: 'Activities — Staff Admin' };

// A person's role, short, for the queue and for a volunteer or buddy who
// joins an activity's list through their upload rather than a signup.
const ROLE_WORD = {
  camper: 'camper',
  parent_guardian: 'parent / guardian',
  sibling: 'sibling',
  caregiver: 'caregiver',
  volunteer: 'volunteer',
  childcare: 'childcare',
  support_team: 'support team',
};

const MODE_LABEL = {
  interest: 'Interest only',
  signup: 'Places held',
  appointment: 'By appointment',
};

// Who is doing what, per event -- and, since 25 Aug, what is on offer at all.
//
// This was read-only on the reasoning that staff wanted the numbers, not the
// setup. Testing put that straight: camp changes what it offers, and "ask the
// web admin to activate the zip line" is not a process. Coordinators add,
// edit, turn off and remove activities here now.
export default async function AdminActivitiesPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/activities/');
  if (!can(staff, 'read:activities')) redirect('/admin');
  // Defining activities, times and capacity is Events & camp setup (0101).
  const canDefine = can(staff, 'write:setup');
  // Accepting or rejecting a family's provider confirmation is a decision
  // about their paperwork: Registration write (0124), as the email button.
  const canReview = can(staff, 'write:registration');

  const supabase = await createClient();

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, volunteer_arrives_on, archived_at')
    .order('starts_on');
  // CLAUDE.md: never turn a query error into an empty list.
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);

  // Same archiving convention as the rest of the staff portal: current and
  // upcoming by default, past one click away, nothing hidden in the database.
  // Current-and-upcoming is what the page opens on; EventFilter owns the
  // rest, including reaching past events by search. Same window as the pill
  // row -- literally the same function -- so the event this page OPENS on is
  // always one that has a pill.
  const visibleEvents = (events ?? []).filter(isCurrentEventRow);
  // With no event chosen, open on the first current event that has a provider
  // confirmation waiting to be checked -- the nav badge's work -- else the
  // first current event (26 Oct 2026).
  let selected = params?.event || null;
  if (!selected && visibleEvents.length > 1) {
    const { data: pendingRows, error: pendingError } = await supabase
      .from('activity_waiver_uploads')
      .select('activities ( event_id )')
      .eq('review_status', 'pending');
    if (pendingError) throw new Error(`Confirmations to check: ${pendingError.message}`);
    const withPending = new Set((pendingRows ?? []).map((r) => r.activities?.event_id).filter(Boolean));
    selected = visibleEvents.find((e) => withPending.has(e.id))?.id ?? null;
  }
  selected = selected || visibleEvents[0]?.id || null;

  const { data: activities, error: activitiesError } = selected
    ? await supabase
        .from('activities')
        .select(
          'id, name, description, booking_mode, capacity, provider_name, provider_url, active, sort_order, min_age'
        )
        .eq('event_id', selected)
        // Inactive last. Staff see activities families cannot (that is the
        // point of the "not open" badge), but interleaving them made the two
        // lists read as disagreeing with each other -- reported 25 Aug as the
        // staff section "not lining up with the wizard". Same set, same order,
        // with the ones families cannot see sitting plainly at the bottom.
        .order('active', { ascending: false })
        .order('sort_order')
    : { data: [], error: null };
  if (activitiesError) throw new Error(`Activities: ${activitiesError.message}`);

  const activityIds = (activities ?? []).map((a) => a.id);

  // Sittings, and how full each is. Ordered by the guard's own index so the
  // day reads in order.
  const { data: slotRows, error: slotError } = activityIds.length
    ? await supabase
        .from('activity_slots')
        .select('id, activity_id, slot_date, start_time, end_time, label, capacity')
        .in('activity_id', activityIds)
        .order('slot_date')
        .order('start_time')
    : { data: [], error: null };
  if (slotError) throw new Error(`Activity times: ${slotError.message}`);

  // Staff RLS on activity_signups is is_staff(), so this reads everyone --
  // which is the point of the page.
  const { data: signups, error: signupsError } = activityIds.length
    ? await supabase
        .from('activity_signups')
        .select(
          `activity_id, slot_id, status, waiver_acknowledged_at, added_source,
           registration_participants ( id, camp_role, person_id, registration_id,
             people ( first_name, last_name ),
             registrations ( households ( display_name ) ) )`
        )
        .in('activity_id', activityIds)
    : { data: [], error: null };
  if (signupsError) throw new Error(`Activity sign-ups: ${signupsError.message}`);

  // The ministry's own waiver on an activity (0116, horseback): which
  // activities carry one, and who has signed it on which registration. Staff
  // read every signature row, so "NOT signed" here is a fact, not a guess.
  const { data: reqRows, error: reqError } = activityIds.length
    ? await supabase
        .from('agreement_requirements')
        .select('activity_id, agreements ( id, title, active, delivery )')
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
  // For the editor (Setup write): every activity-scoped requirement on any
  // event, with its waiver and its activity. From one read come the list of
  // waivers already in use (the dropdown: one per key, at its current
  // version), and for each activity here its attached waiver -- whatever
  // version, retired or not, so the editor can say so -- and the other
  // activities on the same key, which a new version does not move.
  const { data: allActRows, error: allActError } = canDefine
    ? await supabase
        .from('agreement_requirements')
        .select(
          `id, activity_id, agreement_id,
           agreements ( id, key, version, title, body, active, delivery ),
           activities ( id, name, events ( name ) )`
        )
        .not('activity_id', 'is', null)
    : { data: [], error: null };
  if (allActError) throw new Error(`Activity waivers: ${allActError.message}`);
  const internalRows = (allActRows ?? []).filter((r) => r.agreements?.delivery === 'internal_document');
  const rowsByKey = new Map();
  for (const r of internalRows) {
    if (!rowsByKey.has(r.agreements.key)) rowsByKey.set(r.agreements.key, []);
    rowsByKey.get(r.agreements.key).push(r);
  }
  const waiverChoices = [...rowsByKey.values()]
    .map((rows) => {
      const live = rows.filter((r) => r.agreements.active);
      const best = (live.length ? live : rows).reduce((x, y) =>
        y.agreements.version > x.agreements.version ? y : x
      );
      const { id, key, version, title } = best.agreements;
      return { id, key, version, title };
    })
    .sort((x, y) => x.title.localeCompare(y.title));
  const attachedByActivity = new Map();
  for (const r of internalRows) {
    if (!attachedByActivity.has(r.activity_id)) attachedByActivity.set(r.activity_id, r);
  }

  const agreementIds = [
    ...new Set([
      ...[...agreementByActivity.values()].map((a) => a.id),
      ...activityIds.map((id) => attachedByActivity.get(id)?.agreement_id).filter(Boolean),
    ]),
  ];
  const { data: sigRows, error: sigError } = agreementIds.length
    ? await supabase
        .from('agreement_signatures')
        .select('agreement_id, person_id, registration_id, signed_at')
        .in('agreement_id', agreementIds)
        .not('person_id', 'is', null)
    : { data: [], error: null };
  if (sigError) throw new Error(`Activity waiver signatures: ${sigError.message}`);
  const signedAtByKey = new Map(
    (sigRows ?? []).map((s) => [`${s.agreement_id}:${s.person_id}:${s.registration_id}`, s.signed_at])
  );

  // Outfitter confirmations (0087): one file per person per activity. Signed
  // URLs are minted here, server-side, for ten minutes -- the bucket is
  // private and staff open the file from this page. Volunteers upload without
  // being signed up; they join the card's people list, marked by role. Each
  // upload carries staff's review (0124): awaiting check, accepted, or
  // rejected with the reason the family reads. The awaiting ones are the
  // queue at the top of the page.
  const { data: waiverRows, error: waiverError } = activityIds.length
    ? await supabase
        .from('activity_waiver_uploads')
        .select(
          `id, activity_id, registration_participant_id, storage_path, uploaded_at,
           review_status, reviewed_by, reviewed_at, review_note,
           registration_participants ( id, camp_role, people ( first_name, last_name ),
             registrations ( households ( display_name ) ) )`
        )
        .in('activity_id', activityIds)
    : { data: [], error: null };
  if (waiverError) throw new Error(`Waiver confirmations: ${waiverError.message}`);
  // Who reviewed: a plain lookup -- the upload has two keys to profiles
  // (uploaded_by, reviewed_by), so an embed would be refused (PGRST201).
  const reviewerIds = [...new Set((waiverRows ?? []).map((w) => w.reviewed_by).filter(Boolean))];
  const { data: reviewerRows, error: reviewerError } = reviewerIds.length
    ? await supabase.from('profiles').select('id, first_name, last_name').in('id', reviewerIds)
    : { data: [], error: null };
  if (reviewerError) throw new Error(`Waiver reviewers: ${reviewerError.message}`);
  const reviewerName = new Map(
    (reviewerRows ?? []).map((r) => [r.id, `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()])
  );
  const waiverByKey = new Map();
  for (const w of waiverRows ?? []) {
    const { data: signed, error: signError } = await supabase.storage
      .from('waiver-confirmations')
      .createSignedUrl(w.storage_path, 600);
    // A file that cannot be linked still shows its review; the pill just
    // does not open it. Logged, never hidden.
    if (signError) console.error(`Waiver confirmation link (${w.storage_path}): ${signError.message}`);
    waiverByKey.set(`${w.activity_id}:${w.registration_participant_id}`, {
      id: w.id,
      url: signed?.signedUrl ?? null,
      uploadedAt: dayInMorristown(w.uploaded_at),
      status: w.review_status,
      note: w.review_note,
      reviewedAt: w.reviewed_at ? dayInMorristown(w.reviewed_at) : null,
      reviewerName: w.reviewed_by ? reviewerName.get(w.reviewed_by) || null : null,
      name: `${w.registration_participants?.people?.first_name ?? ''} ${w.registration_participants?.people?.last_name ?? ''}`.trim(),
      role: w.registration_participants?.camp_role,
      household: w.registration_participants?.registrations?.households?.display_name ?? '',
      activityId: w.activity_id,
      uploadedRaw: w.uploaded_at,
    });
  }
  // The queue (Lawrence, 26 Oct 2026: one place to decide, not Accept and
  // Reject on every card): every confirmation awaiting check on this event,
  // campers and volunteers alike, the longest-waiting first.
  const activityNameById = new Map((activities ?? []).map((a) => [a.id, a.name]));
  const toCheck = [...waiverByKey.values()]
    .filter((w) => w.status === 'pending')
    .sort((x, y) => String(x.uploadedRaw).localeCompare(String(y.uploadedRaw)));

  const takenBySlot = new Map();
  for (const g of signups ?? []) {
    if (g.status === 'cancelled' || !g.slot_id) continue;
    takenBySlot.set(g.slot_id, (takenBySlot.get(g.slot_id) ?? 0) + 1);
  }
  const slotsByActivity = new Map();
  for (const sl of slotRows ?? []) {
    if (!slotsByActivity.has(sl.activity_id)) slotsByActivity.set(sl.activity_id, []);
    slotsByActivity.get(sl.activity_id).push({ ...sl, taken: takenBySlot.get(sl.id) ?? 0 });
  }
  const slotById = new Map((slotRows ?? []).map((sl) => [sl.id, sl]));

  const byActivity = new Map();
  for (const s of signups ?? []) {
    if (s.status === 'cancelled') continue;
    if (!byActivity.has(s.activity_id)) byActivity.set(s.activity_id, []);
    byActivity.get(s.activity_id).push({
      participantId: s.registration_participants?.id,
      personId: s.registration_participants?.person_id,
      registrationId: s.registration_participants?.registration_id,
      slotId: s.slot_id,
      name: `${s.registration_participants?.people?.first_name ?? ''} ${
        s.registration_participants?.people?.last_name ?? ''
      }`.trim(),
      household: s.registration_participants?.registrations?.households?.display_name ?? '',
      status: s.status,
      acknowledged: Boolean(s.waiver_acknowledged_at),
      source: s.added_source,
      // When this person signed the activity's own waiver on this
      // registration, or null; undefined where the activity has none.
      waiverSignedAt: (() => {
        const agr = agreementByActivity.get(s.activity_id);
        if (!agr) return undefined;
        const rp = s.registration_participants;
        return signedAtByKey.get(`${agr.id}:${rp?.person_id}:${rp?.registration_id}`) ?? null;
      })(),
    });
  }
  for (const list of byActivity.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Activities</h2>
        {/* E51. Carries the event filter through, so the sheets you print are
            the ones you are looking at — same rule as the kitchen list. */}
        <a
          href={`/admin/activities/print/${selected ? `?event=${selected}` : ''}`}
          className="btn-outline py-2! text-sm"
        >
          Print activity sheets
        </a>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        What is on offer for each event, and who has chosen it. Numbers here are what to give
        the stable, the boat, and the outfitter.
      </p>

      <EventFilter
        events={(events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          startsOn: e.starts_on,
          endsOn: e.ends_on, archivedAt: e.archived_at
        }))}
        selected={selected}
        basePath="/admin/activities"
      />

      {/* Confirmations to check (26 Oct 2026): the one place staff accept or
          reject a provider confirmation. The cards below only say where each
          person stands; an "awaiting check" pill there links to its row here. */}
      {selected && (
        <section id="to-check" className="mb-5 scroll-mt-6 rounded-lg border border-neutral-200 bg-white p-4">
          <h3 className="font-bold">
            Confirmations to check{' '}
            {toCheck.length > 0 && (
              <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {toCheck.length}
              </span>
            )}
          </h3>
          {toCheck.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-500">
              No confirmations waiting to be checked for this event.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-neutral-600">
                Outside providers&rsquo; forms the families have uploaded proof of, oldest first.
                {canReview
                  ? ' Open the file, then accept it — or reject it with a reason the family reads, and they upload again.'
                  : ' Someone with Registration write accepts or rejects each one.'}
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                      <th className="py-1.5 pr-3 font-semibold">Person</th>
                      <th className="py-1.5 pr-3 font-semibold">Activity</th>
                      <th className="py-1.5 pr-3 font-semibold">Uploaded</th>
                      <th className="py-1.5 pr-3 font-semibold">File</th>
                      {canReview && <th className="py-1.5 font-semibold">Decision</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {toCheck.map((w) => (
                      <tr key={w.id} id={checkAnchor(w.id)} className="scroll-mt-6 border-b border-neutral-100 align-top target:bg-amber-50">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{w.name || 'Unnamed'}</span>
                          <span className="block text-xs text-neutral-500">
                            {[w.household, ROLE_WORD[w.role] ?? w.role].filter(Boolean).join(' · ')}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{activityNameById.get(w.activityId) ?? ''}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{w.uploadedAt}</td>
                        <td className="py-2 pr-3">
                          <WaiverFileLink upload={w} />
                        </td>
                        {canReview && (
                          <td className="py-2">
                            <ReviewActions upload={w} canReview={canReview} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {(activities ?? []).length === 0 ? (
        <p className="text-neutral-500 mb-4">
          Nothing is on offer for this event yet — add the first one below.
        </p>
      ) : (
        <div className="space-y-4">
          {(activities ?? []).map((a) => {
            const people = byActivity.get(a.id) ?? [];
            const hasProvider = Boolean(a.provider_name || a.provider_url);
            // Volunteers and buddies upload a provider's confirmation without
            // a signup of their own; they join this list, marked by role
            // (26 Oct 2026 -- they were a separate row of chips).
            const signedUpIds = new Set(people.map((p) => p.participantId));
            const uploadOnly = hasProvider
              ? [...waiverByKey.entries()]
                  .filter(([k]) => k.startsWith(`${a.id}:`))
                  .map(([k, v]) => ({ participantId: k.split(':')[1], name: v.name || 'Unnamed', household: v.household, role: v.role, uploadOnly: true }))
                  .filter((v) => !signedUpIds.has(v.participantId) && v.role !== 'camper')
                  .sort((x, y) => x.name.localeCompare(y.name))
              : [];
            const listed = [...people, ...uploadOnly];
            // What is outstanding, for the folded card's header.
            const providerStates = hasProvider
              ? listed.map((p) => waiverByKey.get(`${a.id}:${p.participantId}`)?.status ?? 'missing')
              : [];
            const nCheck = providerStates.filter((st) => st === 'pending').length;
            const nMissing = providerStates.filter((st) => st === 'missing' || st === 'rejected').length;
            const nUnsigned = people.filter((p) => p.waiverSignedAt === null).length;
            const summary =
              [
                nCheck ? `${nCheck} to check` : null,
                nMissing ? `${nMissing} missing` : null,
                nUnsigned ? `${nUnsigned} waiver${nUnsigned === 1 ? '' : 's'} not signed` : null,
              ]
                .filter(Boolean)
                .join(' · ') || null;
            const signedUp = people.filter((p) => p.status === 'signed_up').length;
            const interested = people.filter((p) => p.status === 'interested').length;
            const over = a.capacity != null && signedUp > a.capacity;
            // The editor's reading of this activity's own waiver: who signed
            // THIS version on this activity (staff read every signature row),
            // and who else is on the key.
            const attachedRow = canDefine ? attachedByActivity.get(a.id) : null;
            const waiver = attachedRow
              ? (() => {
                  const agr = attachedRow.agreements;
                  const keyRows = rowsByKey.get(agr.key) ?? [];
                  return {
                    agreement: {
                      id: agr.id, key: agr.key, version: agr.version, title: agr.title,
                      body: agr.body, active: agr.active,
                    },
                    signedCount: people.filter((p) =>
                      signedAtByKey.has(`${agr.id}:${p.personId}:${p.registrationId}`)
                    ).length,
                    riderCount: people.length,
                    sharers: keyRows
                      .filter((r) => r.activity_id !== a.id && r.activities)
                      .map((r) => ({
                        name: r.activities.name,
                        eventName: r.activities.events?.name ?? '',
                        // Each sharer's OWN version: a new version moves only
                        // the edited activity, so these differ once revised.
                        version: r.agreements.version,
                      }))
                      .sort((x, y) => `${x.eventName} ${x.name}`.localeCompare(`${y.eventName} ${y.name}`)),
                    nextVersion: Math.max(...keyRows.map((r) => r.agreements.version), agr.version) + 1,
                  };
                })()
              : null;
            return (
              <ActivityCard
                key={a.id}
                name={a.name}
                active={a.active !== false}
                modeLabel={MODE_LABEL[a.booking_mode] ?? a.booking_mode}
                signedUp={signedUp}
                interested={interested}
                capacity={a.capacity}
                over={over}
                summary={summary}
              >

                {/* What the family actually reads. Its absence here is what
                    made this page and the family wizard look like two
                    different lists (25 Aug, reported twice): the wizard leads
                    with the description and staff could not see it at all, so
                    the same activity read as two different things. */}
                {a.description && (
                  <p className="mt-1 text-sm text-neutral-600">{a.description}</p>
                )}
                {/* 0125: the groups board (rafts, boats) for this activity. */}
                <a href={`/admin/activities/groups/?activity=${a.id}`} className="mt-1 inline-block text-sm font-semibold text-brand underline">
                  {/\braft/i.test(a.name) ? 'Rafts →' : 'Groups →'}
                </a>

                {hasProvider && (
                  <div className="mt-1 text-sm text-neutral-700">
                    <p>
                      <span className="font-semibold">Outside provider: {a.provider_name || 'named by link only'}</span>
                      {' '}— families upload the provider&rsquo;s confirmation; staff check each one in{' '}
                      <a href="#to-check" className="text-brand underline">Confirmations to check</a> above.
                    </p>
                    <details className="mt-0.5 text-xs text-neutral-500">
                      <summary className="cursor-pointer">How this works</summary>
                      <p className="mt-1">
                        The provider&rsquo;s own waiver is the family&rsquo;s to complete with them; they
                        upload proof here. Each upload is <em>awaiting check</em> until someone with
                        Registration write accepts it, or rejects it with a reason &mdash; the family
                        reads the reason and uploads again. Volunteers and buddies upload too, ready in
                        case their camper goes. &ldquo;told&rdquo; records only that the family ticked
                        that they know the provider has a form of its own.
                      </p>
                    </details>
                  </div>
                )}

                {listed.length === 0 ? (
                  <p className="mt-3 text-sm text-neutral-500">Nobody yet.</p>
                ) : (
                  <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                    {listed.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{p.name}</span>
                        {/* Which boat. Without it this list answers "how many"
                            and not "who is on the 2 o'clock", which is the
                            question the day is actually run from. */}
                        {p.slotId && slotById.get(p.slotId) && (
                          <span className="rounded-sm bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold text-neutral-700">
                            {slotLabel(slotById.get(p.slotId))}
                          </span>
                        )}
                        <span className="text-neutral-500">{p.household}</span>
                        {p.uploadOnly && (
                          <span
                            className="text-xs text-neutral-500"
                            title="Not signed up: goes if their camper does, and uploaded the provider's form ahead"
                          >
                            {ROLE_WORD[p.role] ?? p.role} · buddy
                          </span>
                        )}
                        {p.status === 'interested' && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                            interested
                          </span>
                        )}
                        {/* The activity's own waiver (0116): signed on the
                            site, per rider, or not -- a signup added by staff
                            can exist without one. */}
                        {p.waiverSignedAt !== undefined && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              p.waiverSignedAt
                                ? 'bg-neutral-100 text-neutral-600'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                            title={
                              p.waiverSignedAt
                                ? `${agreementByActivity.get(a.id)?.title ?? 'Waiver'} signed on the site`
                                : `${agreementByActivity.get(a.id)?.title ?? 'Waiver'} has not been signed on the site`
                            }
                          >
                            {p.waiverSignedAt
                              ? `Waiver signed ${dayInMorristown(p.waiverSignedAt)}`
                              : 'Waiver NOT signed'}
                          </span>
                        )}
                        {a.provider_name && p.status === 'signed_up' && (
                          <span
                            className={`text-xs ${p.acknowledged ? 'text-neutral-400' : 'text-amber-700'}`}
                            title={
                              p.acknowledged
                                ? 'Family confirmed they know the provider has their own form'
                                : 'Family has NOT confirmed they know about the provider form'
                            }
                          >
                            {p.acknowledged ? 'told' : 'not told'}
                          </span>
                        )}
                        {/* Every active place on a provider-run activity, interested
                            ones too and a provider named only by its link --
                            exactly the places activity_waivers_outstanding
                            (0120) counts as owing a confirmation. */}
                        {hasProvider && (
                          <WaiverStatusPill upload={waiverByKey.get(`${a.id}:${p.participantId}`) ?? null} />
                        )}
                        {p.source === 'staff' && (
                          <span className="text-xs text-neutral-400">added by staff</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canDefine && <SlotEditor
                  activity={a}
                  slots={slotsByActivity.get(a.id) ?? []}
                  event={(events ?? []).find((e) => e.id === selected) ?? null}
                />}

                {canDefine && (
                  <ActivityEditor
                    activity={a}
                    eventId={selected}
                    canEmail={can(staff, 'write:registration')}
                    waiver={waiver}
                    waiverChoices={waiverChoices}
                  />
                )}
              </ActivityCard>
            );
          })}
        </div>
      )}

      {selected && canDefine && (
        <div className="mt-6">
          <AddActivity
            eventId={selected}
            eventName={visibleEvents.find((e) => e.id === selected)?.name}
            waiverChoices={waiverChoices}
          />
        </div>
      )}
    </div>
  );
}
