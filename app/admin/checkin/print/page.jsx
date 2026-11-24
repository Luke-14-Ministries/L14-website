import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow, todayInMorristown } from '@/lib/events';
import { PROGRAM_ROLE_LABEL } from '@/lib/programs';
import PrintButton from '@/components/PrintButton';
import BackLink from '@/components/BackLink';

export const metadata = { title: 'Arrival Sheet · Staff Admin' };

// The door's paper copy of Check-In (23 Nov 2026 review): every name for one
// event, grouped by family, with a box to tick as they arrive. For when the
// phone at the door has no signal, or a second table needs a list.
//
// WHAT IT CARRIES, AND WHY NOT MORE. Names, role and a red mark for
// allergies, seizures or rescue medicine, the same three quick flags as
// Check-In, with no details: paper at a door gets left on the table. The
// marks come from person_support, which RLS returns only to staff with
// Sensitive read, so for anyone else the sheet simply has no marks and says
// so. No phone numbers, no money, no photos.
//
// Registration read, the same as Check-In.

// One person's line. Module level (CLAUDE.md: never a component inside one).
function PersonLine({ p }) {
  return (
    <li className="flex items-baseline gap-3 py-0.5">
      <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 translate-y-0.5 border border-neutral-800" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{p.name}</span>
        <span className="text-neutral-500"> · {p.role}</span>
        {/* After the role, wrapping under it in a narrow column, so the
            name and role stay on one line. */}
        {p.flags.map((f) => (
          <span key={f} className="ml-2 whitespace-nowrap text-xs font-semibold text-red-700 print:text-black">
            ⚑ {f}
          </span>
        ))}
      </span>
    </li>
  );
}

export default async function ArrivalSheetPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/checkin/print/');
  if (!can(staff, 'read:registration')) redirect('/admin');
  const seesFlags = can(staff, 'read:sensitive');

  const supabase = await createClient();
  const [{ data: events, error: eventsError }, { data: me, error: meError }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on, archived_at').order('starts_on'),
    supabase.from('profiles').select('first_name, last_name').eq('id', staff.userId).maybeSingle(),
  ]);
  // CLAUDE.md: never turn a query error into an empty list -- at the door it
  // would read as "nobody registered".
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  if (meError) throw new Error(`Your name: ${meError.message}`);

  // The same events and default as Check-In: current ones, the first by
  // default; an archived or past event only by its id.
  const current = (events ?? []).filter((e) => isCurrentEventRow(e));
  const eventId =
    typeof params?.event === 'string' && (events ?? []).some((e) => e.id === params.event)
      ? params.event
      : current[0]?.id ?? null;
  const event = (events ?? []).find((e) => e.id === eventId) ?? null;

  let families = [];
  if (eventId) {
    const { data: regs, error: regsError } = await supabase
      .from('registrations')
      .select(
        `id, households ( display_name ),
         registration_participants ( id, camp_role, status,
           people ( first_name, last_name, preferred_name,
             person_support ( has_allergies, has_seizures, has_rescue_medication ) ) )`
      )
      .eq('event_id', eventId);
    if (regsError) throw new Error(`Registrations: ${regsError.message}`);

    families = (regs ?? [])
      .map((r) => {
        const people = (r.registration_participants ?? [])
          // The people Check-In lists: not cancelled, not an unfinished draft.
          .filter((p) => p.status !== 'cancelled' && p.status !== 'draft')
          .map((p) => {
            const s = p.people?.person_support ?? null;
            const flags = [];
            if (s?.has_allergies) flags.push('allergies');
            if (s?.has_seizures) flags.push('seizures');
            if (s?.has_rescue_medication) flags.push('rescue med');
            const first = p.people?.preferred_name || p.people?.first_name || '';
            return {
              id: p.id,
              name: `${first} ${p.people?.last_name ?? ''}`.trim() || 'Name missing',
              sortName: `${p.people?.last_name ?? ''} ${first}`,
              role: PROGRAM_ROLE_LABEL[p.camp_role] ?? p.camp_role ?? '',
              flags,
            };
          })
          .sort((a, b) => a.sortName.localeCompare(b.sortName));
        return { id: r.id, family: r.households?.display_name ?? 'Household', people };
      })
      .filter((f) => f.people.length > 0)
      .sort((a, b) => a.family.localeCompare(b.family));
  }
  const total = families.reduce((n, f) => n + f.people.length, 0);
  const printedBy = [me?.first_name, me?.last_name].filter(Boolean).join(' ') || staff.email;
  const dates = [event?.starts_on, event?.ends_on].filter(Boolean).join(' – ');

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print-sheet print:text-[12px]">
      {/* The way back top right, Print under it, as on every print sheet (27 Oct 2026). */}
      <div className="mb-2 flex flex-col items-end gap-2 print:hidden">
        <BackLink href={`/admin/checkin/${eventId ? `?event=${eventId}` : ''}`} label="Back to Check-In" />
        <PrintButton label="Print / Save as PDF" />
      </div>
      {!seesFlags && (
        <p className="mb-4 text-sm text-neutral-500 print:hidden">
          The red marks for allergies, seizures and rescue medicine show only for staff with
          Sensitive access, so this copy has none.
        </p>
      )}

      {!event ? (
        <p className="text-neutral-500">No current events to print an arrival sheet for.</p>
      ) : (
        <>
          <div className="border-b-2 border-neutral-800 pb-2">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Arrival sheet</p>
            <h1 className="text-2xl font-bold">{event.name}</h1>
            <p className="text-sm text-neutral-600">
              {dates ? `${dates} · ` : ''}
              {total} {total === 1 ? 'person' : 'people'} in {families.length}{' '}
              {families.length === 1 ? 'family' : 'families'}
            </p>
          </div>
          {seesFlags && (
            <p className="mt-2 text-xs text-neutral-600">
              ⚑ marks someone with allergies, seizures or rescue medicine. The details are with the
              nurse.
            </p>
          )}

          {families.length === 0 ? (
            <p className="mt-4 text-sm text-neutral-500">Nobody is registered for this event yet.</p>
          ) : (
            <div className="mt-4 columns-1 gap-8 sm:columns-2 print:columns-2">
              {families.map((f) => (
                <section key={f.id} className="mb-3 break-inside-avoid">
                  <h2 className="border-b border-neutral-300 text-sm font-bold">{f.family}</h2>
                  <ul className="text-sm">
                    {f.people.map((p) => (
                      <PersonLine key={p.id} p={p} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <p className="mt-6 border-t border-neutral-300 pt-2 text-xs text-neutral-500">
            Printed {todayInMorristown()} by {printedBy} · Luke 14 Ministries.
          </p>
        </>
      )}
    </div>
  );
}
