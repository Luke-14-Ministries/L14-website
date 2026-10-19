import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow, staffAssigns } from '@/lib/events';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Medical & Support — Staff Admin' };

// The nurse/support-team view: medications, seizure and rescue-med details, and
// emergency contacts, per event. Gated by the sensitive permission; the
// can_view_person_support RLS is the real gate -- support rows simply do not
// come back for staff without it.
export default async function MedicalPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/medical/');
  if (!can(staff, 'sensitive')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: events }, { data: regs }] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, event_type, starts_on, ends_on, archived_at, event_medical_contacts ( name, phone )')
      .order('starts_on'),
    supabase
      .from('registrations')
      .select(
        `id, event_id,
         households ( display_name, phone ),
         registration_participants ( camp_role, status,
           people ( first_name, last_name,
             person_support ( medications, has_seizures, has_rescue_medication,
               seizure_detail, rescue_medication_detail, buddy_required,
               emergency_contact_name, emergency_contact_phone, emergency_contact_relationship ) ) )`
      ),
  ]);

  // No buddy pill for a retreat: buddies are paired on arrival (2 Oct 2026).
  const assignsBuddies = new Set((events ?? []).filter(staffAssigns).map((e) => e.id));
  const byEvent = new Map();
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (p.status === 'cancelled') continue;
      const s = p.people?.person_support;
      if (!s) continue;
      const hasMedical =
        s.medications || s.has_seizures || s.has_rescue_medication ||
        s.rescue_medication_detail || s.seizure_detail;
      if (!hasMedical && !s.emergency_contact_name) continue;
      if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []);
      byEvent.get(r.event_id).push({
        name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
        sortName: `${p.people?.last_name ?? ''} ${p.people?.first_name ?? ''}`,
        household: r.households?.display_name ?? '',
        phone: r.households?.phone ?? '',
        medications: s.medications,
        seizures: s.has_seizures,
        seizureDetail: s.seizure_detail,
        rescue: s.has_rescue_medication,
        rescueDetail: s.rescue_medication_detail,
        buddy: s.buddy_required && assignsBuddies.has(r.event_id),
        ecName: s.emergency_contact_name,
        ecPhone: s.emergency_contact_phone,
        ecRel: s.emergency_contact_relationship,
      });
    }
  }


  // The page defaults to every CURRENT event at once (a nurse plans a week,
  // not a day); one event by its pill, and anything past by the shared
  // filter's search box (16 Oct 2026 -- this page had its own pill row and a
  // "show past" toggle before). Same rule as every other staff page.
  const eventFilter = typeof params?.event === 'string' ? params.event : '';
  const q = typeof params?.q === 'string' ? params.q.trim().toLowerCase() : '';
  const visibleEvents = (events ?? []).map(withMedicalContact).filter((ev) => {
    if (eventFilter) return ev.id === eventFilter;
    return isCurrentEventRow(ev);
  });
  const matchesQ = (row) =>
    !q || row.name.toLowerCase().includes(q) || (row.household ?? '').toLowerCase().includes(q);

  const Flag = ({ children, tone = 'red' }) => (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
        tone === 'red' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {children}
    </span>
  );

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Medical &amp; Support</h2>
      <p className="text-sm text-neutral-500 mb-6">
        Medications, seizure and rescue-medication details, and emergency contacts, per event.
        This is the most sensitive page in the system — it is a separate permission, and printouts
        deserve the same care as the screen.
      </p>


      {/* The one event filter every staff page uses (16 Oct 2026). "All
          current events" because the nurse plans a week, not a day. */}
      <EventFilter
        events={(events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
          archivedAt: e.archived_at,
        }))}
        selected={eventFilter || null}
        basePath="/admin/medical"
        extraParams={{ q }}
        allowAll
      />
      <form method="get" action="/admin/medical" className="mb-6 flex flex-wrap items-center gap-2">
        {eventFilter && <input type="hidden" name="event" value={eventFilter} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Find a person or household…"
          className="w-64 rounded border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="btn-outline !py-1.5 text-sm">Search</button>
        {q && (
          <a href="/admin/medical" className="text-sm text-brand underline">
            Clear
          </a>
        )}
      </form>

      {visibleEvents.map((ev) => {
        const rows = (byEvent.get(ev.id) ?? []).filter(matchesQ).sort((a, b) => a.sortName.localeCompare(b.sortName));
        return (
          <div key={ev.id} className="mb-10">
            <h3 className="text-lg font-bold mb-1">
              {ev.name} <span className="text-sm font-normal text-neutral-500">· {rows.length} {rows.length === 1 ? 'person' : 'people'}</span>
            </h3>
            <p className="text-sm mb-3">
              <span aria-hidden>⚕️ </span>
              {ev.medical_contact_name ? (
                <>
                  <span className="font-semibold">Medical contact:</span> {ev.medical_contact_name}
                  {ev.medical_contact_phone ? (
                    <span className="font-semibold"> · {ev.medical_contact_phone}</span>
                  ) : null}
                </>
              ) : (
                <span className="text-neutral-500">
                  No medical contact set for this event — an administrator can add one on the{' '}
                  {/* A link, not a mention (Lawrence, 15 Oct 2026): it lands on
                      Check-In with this event already selected. */}
                  <Link href={`/admin/checkin?event=${ev.id}`} className="text-brand underline">
                    Check-In page
                  </Link>
                  .
                </span>
              )}
            </p>
            {rows.length === 0 ? (
              <p className="text-neutral-500 text-sm">No medical or support details recorded.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-neutral-500">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Person</th>
                      <th className="px-4 py-2 font-semibold">Medications</th>
                      <th className="px-4 py-2 font-semibold">Seizures / rescue med</th>
                      <th className="px-4 py-2 font-semibold">Emergency contact</th>
                      <th className="px-4 py-2 font-semibold">Household / phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-neutral-100 align-top">
                        <td className="px-4 py-2 font-medium">
                          {r.name}
                          {/* flex-wrap + gap instead of margins: three
                              pills in a narrow cell were overlapping into an
                              unreadable clump (testing screenshot, 24 Aug). */}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.seizures && <Flag>seizures</Flag>}
                            {r.rescue && <Flag>rescue med</Flag>}
                            {r.buddy && <Flag tone="amber">no buddy assigned</Flag>}
                          </div>
                        </td>
                        <td className="px-4 py-2 whitespace-pre-wrap">{r.medications || '—'}</td>
                        {/* Seizure plan and rescue medication are shown as
                            SEPARATE lines. They answer different questions --
                            "what do I do right now" versus "what is kept where"
                            -- and until 0031 the family form had nowhere to put
                            the first, so it was landing in the second. */}
                        <td className="px-4 py-2 whitespace-pre-wrap">
                          {r.seizures && (
                            <span className="block">
                              <span className="font-semibold">Seizures. </span>
                              {r.seizureDetail || 'No plan recorded.'}
                            </span>
                          )}
                          {(r.rescue || r.rescueDetail) && (
                            <span className="block mt-1">
                              <span className="font-semibold">Rescue med. </span>
                              {r.rescueDetail || 'No detail recorded.'}
                            </span>
                          )}
                          {!r.seizures && !r.rescue && !r.rescueDetail ? '—' : ''}
                        </td>
                        <td className="px-4 py-2">
                          {r.ecName ? (
                            <>
                              {r.ecName}
                              {r.ecRel ? ` (${r.ecRel})` : ''}
                              {r.ecPhone ? <div className="text-neutral-600">{r.ecPhone}</div> : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-2 text-neutral-600">
                          {r.household}
                          {r.phone ? ` · ${r.phone}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The medical contact lives in its own table since 0109 (readable only by
// staff, leaders and households registered for the event). Flattened back to
// the two names the page has always used.
function withMedicalContact(ev) {
  const mc = Array.isArray(ev.event_medical_contacts) ? ev.event_medical_contacts[0] : ev.event_medical_contacts;
  return { ...ev, medical_contact_name: mc?.name ?? null, medical_contact_phone: mc?.phone ?? null };
}
