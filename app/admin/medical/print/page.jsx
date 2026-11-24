import { redirect } from 'next/navigation';
import { formatPhone } from '@/lib/format';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow, todayInMorristown, eventDateRange, formatDay } from '@/lib/events';
import PrintSheetHeader from '@/components/PrintSheetHeader';

export const metadata = { title: 'Medical Sheet · Staff Admin' };

// The nurse's paper copy of Medical & Support for ONE event (23 Nov 2026
// review): one block per person with something on file, so the nurse has
// medications, seizure plans, rescue medicine and emergency contacts when
// the screen is not to hand.
//
// This puts the site's most sensitive details on paper, so (Lawrence to
// decide whether it stays; flagged in the 23 Nov review):
//   * the Sensitive grant, the same as the screen; person_support's RLS
//     returns nothing to anyone else;
//   * one event at a time, never "all events";
//   * every page footer names who printed it and when, and says to shred it
//     after camp.
// It carries exactly what the Medical & Support table shows, nothing more.

// One person's block. Module level (CLAUDE.md: never a component inside one).
function PersonBlock({ r }) {
  return (
    <section className="break-inside-avoid border-b border-neutral-300 py-2">
      <h2 className="text-base font-bold">
        {r.name}
        <span className="font-normal text-neutral-600">
          {' '}
          · {r.household}
          {r.phone ? ` · ${r.phone}` : ''}
        </span>
      </h2>
      <dl className="mt-1 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-sm">
        {r.medAllergy && (
          <>
            <dt className="font-semibold text-red-800 print:text-black">Allergic to</dt>
            <dd className="font-semibold">{r.medAllergy}</dd>
          </>
        )}
        <dt className="font-semibold">Medications</dt>
        <dd className="whitespace-pre-wrap">{r.medications || '—'}</dd>
        {r.seizures && (
          <>
            <dt className="font-semibold">Seizures</dt>
            <dd className="whitespace-pre-wrap">{r.seizureDetail || 'No plan recorded.'}</dd>
          </>
        )}
        {(r.rescue || r.rescueDetail) && (
          <>
            <dt className="font-semibold">Rescue medicine</dt>
            <dd className="whitespace-pre-wrap">{r.rescueDetail || 'No detail recorded.'}</dd>
          </>
        )}
        <dt className="font-semibold">Emergency contact</dt>
        <dd>
          {r.ecName ? (
            <>
              {r.ecName}
              {r.ecRel ? ` (${r.ecRel})` : ''}
              {r.ecPhone ? ` · ${r.ecPhone}` : ''}
            </>
          ) : (
            '—'
          )}
        </dd>
      </dl>
    </section>
  );
}

export default async function MedicalSheetPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/medical/print/');
  if (!can(staff, 'sensitive')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: events, error: eventsError }, { data: me, error: meError }] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, starts_on, ends_on, archived_at, event_medical_contacts ( name, phone )')
      .order('starts_on'),
    supabase.from('profiles').select('first_name, last_name').eq('id', staff.userId).maybeSingle(),
  ]);
  // CLAUDE.md: never turn a query error into an empty list -- here it would
  // read as "nobody has medical notes".
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  if (meError) throw new Error(`Your name: ${meError.message}`);

  // One event: the one asked for, else the first current one. "All" and the
  // other scopes are refused on purpose: a sheet of every event is the
  // medical file of the whole ministry.
  const current = (events ?? []).filter((e) => isCurrentEventRow(e));
  const eventId =
    typeof params?.event === 'string' && (events ?? []).some((e) => e.id === params.event)
      ? params.event
      : current[0]?.id ?? null;
  const event = (events ?? []).find((e) => e.id === eventId) ?? null;
  const mc = event
    ? Array.isArray(event.event_medical_contacts)
      ? event.event_medical_contacts[0]
      : event.event_medical_contacts
    : null;

  let rows = [];
  if (eventId) {
    const { data: regs, error: regsError } = await supabase
      .from('registrations')
      .select(
        `id, households ( display_name, phone ),
         registration_participants ( camp_role, status,
           people ( first_name, last_name,
             person_support ( medications, has_seizures, has_rescue_medication,
               has_allergies, allergens, allergy_medications,
               seizure_detail, rescue_medication_detail,
               emergency_contact_name, emergency_contact_phone, emergency_contact_relationship ) ) )`
      )
      .eq('event_id', eventId);
    if (regsError) throw new Error(`Registrations and support details: ${regsError.message}`);

    // The same people and the same rules as the Medical & Support page.
    for (const r of regs ?? []) {
      for (const p of r.registration_participants ?? []) {
        if (p.status === 'cancelled') continue;
        const s = p.people?.person_support;
        if (!s) continue;
        const medAllergy =
          s.has_allergies && Array.isArray(s.allergens) && s.allergens.includes('medications')
            ? (s.allergy_medications ?? '').trim() || 'medications not named'
            : '';
        const hasMedical =
          s.medications || s.has_seizures || s.has_rescue_medication ||
          s.rescue_medication_detail || s.seizure_detail || medAllergy;
        if (!hasMedical && !s.emergency_contact_name) continue;
        rows.push({
          name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
          sortName: `${p.people?.last_name ?? ''} ${p.people?.first_name ?? ''}`,
          household: r.households?.display_name ?? '',
          phone: formatPhone(r.households?.phone ?? ''),
          medications: s.medications,
          medAllergy,
          seizures: s.has_seizures,
          seizureDetail: s.seizure_detail,
          rescue: s.has_rescue_medication,
          rescueDetail: s.rescue_medication_detail,
          ecName: s.emergency_contact_name,
          ecPhone: s.emergency_contact_phone ? formatPhone(s.emergency_contact_phone) : s.emergency_contact_phone,
          ecRel: s.emergency_contact_relationship,
        });
      }
    }
    rows.sort((a, b) => a.sortName.localeCompare(b.sortName));
  }
  const printedBy = [me?.first_name, me?.last_name].filter(Boolean).join(' ') || staff.email;
  const dates = eventDateRange(event?.starts_on, event?.ends_on);
  const footer = `Printed ${formatDay(todayInMorristown())} by ${printedBy}. Shred after camp.`;

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print-sheet print:text-[12px]">
      <PrintSheetHeader
        title="Medical sheet"
        back={{ href: `/admin/medical/${eventId ? `?event=${eventId}` : ''}`, label: 'Back to Medical & Support' }}
        printLabel="Print / Save as PDF"
        intro="This sheet has every medical detail for the event. Keep it with the nurse, and shred it after camp."
      />

      {!event ? (
        <p className="text-neutral-500">No current events to print a medical sheet for.</p>
      ) : (
        <>
          <div className="border-b-2 border-neutral-800 pb-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Medical sheet · confidential</p>
            <h2 className="text-2xl font-bold">{event.name}</h2>
            <p className="text-sm text-neutral-600">
              {dates ? `${dates} · ` : ''}
              {rows.length} {rows.length === 1 ? 'person' : 'people'} with details on file
            </p>
            <p className="text-sm">
              <span className="font-semibold">Medical contact:</span>{' '}
              {mc?.name ? `${mc.name}${mc.phone ? ` · ${formatPhone(mc.phone)}` : ''}` : 'none set'}
            </p>
          </div>

          {rows.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">No medical or support details recorded for this event.</p>
          ) : (
            <div className="mt-2">
              {rows.map((r, i) => (
                <PersonBlock key={i} r={r} />
              ))}
            </div>
          )}

          {/* The footer on every printed page: a fixed element repeats on each
              page in print, and on screen it sits at the end. */}
          <p className="mt-6 border-t border-neutral-300 pt-2 text-xs text-neutral-600 print:hidden">{footer}</p>
          <p className="hidden print:block print:fixed print:bottom-0 print:left-0 print:right-0 print:bg-white print:px-[16mm] print:pb-[6mm] print:text-[10px] print:text-neutral-700">
            {footer}
          </p>
        </>
      )}
    </div>
  );
}
