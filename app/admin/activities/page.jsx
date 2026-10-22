import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow, dayInMorristown } from '@/lib/events';
import { ActivityEditor, AddActivity, ActivityCard, SlotEditor, slotLabel } from './ActivityEditor';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Activities — Staff Admin' };

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

  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, archived_at')
    .order('starts_on');

  // Same archiving convention as the rest of the staff portal: current and
  // upcoming by default, past one click away, nothing hidden in the database.
  // Current-and-upcoming is what the page opens on; EventFilter owns the
  // rest, including reaching past events by search. Same window as the pill
  // row -- literally the same function -- so the event this page OPENS on is
  // always one that has a pill.
  const visibleEvents = (events ?? []).filter(isCurrentEventRow);
  const selected = params?.event || visibleEvents[0]?.id || null;

  const { data: activities } = selected
    ? await supabase
        .from('activities')
        .select(
          'id, name, description, booking_mode, capacity, provider_name, provider_url, active, sort_order'
        )
        .eq('event_id', selected)
        // Inactive last. Staff see activities families cannot (that is the
        // point of the "not open" badge), but interleaving them made the two
        // lists read as disagreeing with each other -- reported 25 Aug as the
        // staff section "not lining up with the wizard". Same set, same order,
        // with the ones families cannot see sitting plainly at the bottom.
        .order('active', { ascending: false })
        .order('sort_order')
    : { data: [] };

  const activityIds = (activities ?? []).map((a) => a.id);

  // Sittings, and how full each is. Ordered by the guard's own index so the
  // day reads in order.
  const { data: slotRows } = activityIds.length
    ? await supabase
        .from('activity_slots')
        .select('id, activity_id, slot_date, start_time, end_time, label, capacity')
        .in('activity_id', activityIds)
        .order('slot_date')
        .order('start_time')
    : { data: [] };

  // Staff RLS on activity_signups is is_staff(), so this reads everyone --
  // which is the point of the page.
  const { data: signups } = activityIds.length
    ? await supabase
        .from('activity_signups')
        .select(
          `activity_id, slot_id, status, waiver_acknowledged_at, added_source,
           registration_participants ( id, camp_role, person_id, registration_id,
             people ( first_name, last_name ),
             registrations ( households ( display_name ) ) )`
        )
        .in('activity_id', activityIds)
    : { data: [] };

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
  // being signed up, so they are listed separately under the provider note.
  const { data: waiverRows } = activityIds.length
    ? await supabase
        .from('activity_waiver_uploads')
        .select(
          `activity_id, registration_participant_id, storage_path, uploaded_at,
           registration_participants ( id, camp_role, people ( first_name, last_name ) )`
        )
        .in('activity_id', activityIds)
    : { data: [] };
  const waiverByKey = new Map();
  for (const w of waiverRows ?? []) {
    const { data: signed } = await supabase.storage
      .from('waiver-confirmations')
      .createSignedUrl(w.storage_path, 600);
    waiverByKey.set(`${w.activity_id}:${w.registration_participant_id}`, {
      url: signed?.signedUrl ?? null,
      uploadedAt: w.uploaded_at,
      name: `${w.registration_participants?.people?.first_name ?? ''} ${w.registration_participants?.people?.last_name ?? ''}`.trim(),
      role: w.registration_participants?.camp_role,
    });
  }

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

      {(activities ?? []).length === 0 ? (
        <p className="text-neutral-500 mb-4">
          Nothing is on offer for this event yet — add the first one below.
        </p>
      ) : (
        <div className="space-y-4">
          {(activities ?? []).map((a) => {
            const people = byActivity.get(a.id) ?? [];
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
              >

                {/* What the family actually reads. Its absence here is what
                    made this page and the family wizard look like two
                    different lists (25 Aug, reported twice): the wizard leads
                    with the description and staff could not see it at all, so
                    the same activity read as two different things. */}
                {a.description && (
                  <p className="mt-1 text-sm text-neutral-600">{a.description}</p>
                )}

                {a.provider_name && (
                  <p className="mt-1 text-sm text-amber-800">
                    Outside provider: {a.provider_name}. Their own waiver is the family&rsquo;s
                    to complete; &ldquo;confirmation&rdquo; below means they uploaded the
                    provider&rsquo;s proof, and opens it. &ldquo;told&rdquo; records only that
                    we said so.
                  </p>
                )}
                {a.provider_name && (() => {
                  // Volunteers and buddies upload without a sign-up row.
                  const signedUpIds = new Set((byActivity.get(a.id) ?? []).map((p) => p.participantId));
                  const extra = [...waiverByKey.entries()]
                    .filter(([k]) => k.startsWith(`${a.id}:`))
                    .map(([k, v]) => ({ participantId: k.split(':')[1], ...v }))
                    .filter((v) => !signedUpIds.has(v.participantId) && v.role !== 'camper')
                    .sort((x, y) => x.name.localeCompare(y.name));
                  if (extra.length === 0) return null;
                  return (
                    <p className="mt-1 text-sm text-neutral-700">
                      <span className="font-semibold">Volunteer confirmations:</span>{' '}
                      {extra.map((v, i) => (
                        <span key={v.participantId}>
                          {i > 0 && ', '}
                          {v.url ? (
                            <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
                              {v.name}
                            </a>
                          ) : (
                            v.name
                          )}
                        </span>
                      ))}
                    </p>
                  );
                })()}

                {people.length === 0 ? (
                  <p className="mt-3 text-sm text-neutral-500">Nobody yet.</p>
                ) : (
                  <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                    {people.map((p, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
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
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              p.acknowledged
                                ? 'bg-neutral-100 text-neutral-600'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                            title={
                              p.acknowledged
                                ? 'Family confirmed they know the provider has their own form'
                                : 'Family has NOT confirmed they know about the provider form'
                            }
                          >
                            {p.acknowledged ? 'told' : 'not told'}
                          </span>
                        )}
                        {a.provider_name && p.status === 'signed_up' && (() => {
                          const w = waiverByKey.get(`${a.id}:${p.participantId}`);
                          return w ? (
                            <a
                              href={w.url ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Provider confirmation uploaded ${dayInMorristown(w.uploadedAt)} — opens the file`}
                              className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 underline"
                            >
                              confirmation ✓
                            </a>
                          ) : (
                            <span
                              title="No provider confirmation uploaded yet"
                              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                            >
                              no confirmation
                            </span>
                          );
                        })()}
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
                  eventStart={visibleEvents.find((e) => e.id === selected)?.starts_on ?? ''}
                  eventEnd={visibleEvents.find((e) => e.id === selected)?.ends_on ?? ''}
                />}

                {canDefine && (
                  <ActivityEditor activity={a} waiver={waiver} waiverChoices={waiverChoices} />
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
