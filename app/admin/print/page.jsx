import Link from 'next/link';
import AdminPageHeader from '@/components/AdminPageHeader';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow, staffAssigns } from '@/lib/events';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Print Sheets · Staff Admin' };

// Every printable sheet for one event, in one place (23 Nov 2026 review).
//
// The sheets were each a button on their own page (Rosters' "Print view",
// Buddy Assignments' sheets, the Kitchen list on Dietary...), so the week
// before camp meant visiting nine pages to find nine buttons, and nobody knew
// which sheets existed. This page lists them for the chosen event, with who
// each one is for. It reads only the events and the program names; every
// sheet keeps its own gate, and a sheet is listed only when the viewer could
// open it (the same can() the sheet asks), so nobody is shown a link that
// sends them back to the Overview.
//
// Registration read, like Check-In: it sits in the Camp Week section.

// One sheet: a title, who it is for, and its link. Module level (CLAUDE.md).
function SheetRow({ title, forWhom, href, note }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-neutral-600">{forWhom}</p>
        {note && <p className="text-xs text-neutral-500">{note}</p>}
      </div>
      <a href={href} className="btn-outline btn-sm">
        Open sheet
      </a>
    </li>
  );
}

export default async function PrintSheetsPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/print/');
  if (!can(staff, 'read:registration')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: events, error: eventsError }, { data: programs, error: programsError }] = await Promise.all([
    supabase.from('events').select('id, name, event_type, starts_on, ends_on, archived_at').order('starts_on'),
    // Program names only, and only for someone who may print a program.
    can(staff, 'read:programs')
      ? supabase
          .from('programs')
          .select('id, name, sort_order, not_a_program')
          .eq('active', true)
          .order('sort_order')
      : Promise.resolve({ data: [], error: null }),
  ]);
  // CLAUDE.md: never turn a query error into an empty list.
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  if (programsError) throw new Error(`Programs: ${programsError.message}`);

  // Current events, the rule every staff page uses; the sheets are for the
  // events being got ready, and one event at a time because every sheet is.
  const current = (events ?? []).filter((e) => isCurrentEventRow(e));
  const eventId =
    typeof params?.event === 'string' && current.some((e) => e.id === params.event)
      ? params.event
      : current[0]?.id ?? null;
  const event = current.find((e) => e.id === eventId) ?? null;
  const camp = staffAssigns(event);
  const ev = eventId ? `?event=${eventId}` : '';

  // In the order the week comes: the door, the office, then planning, then
  // the kitchen and the nurse.
  const sheets = event
    ? [
        can(staff, 'read:registration') && {
          key: 'arrival',
          title: 'Arrival sheet',
          forWhom: 'For the door: every name, by family, with a box to tick as they arrive.',
          href: `/admin/checkin/print/${ev}`,
          note: 'Red marks for allergies, seizures and rescue medicine, with no details.',
        },
        can(staff, 'read:registration') && {
          key: 'rosters',
          title: 'Rosters',
          forWhom: 'For the office: everyone registered, on one compact list.',
          href: `/admin/rosters/print/${ev}`,
        },
        can(staff, 'read:registration') && {
          key: 'volunteers',
          title: 'Volunteer list',
          forWhom: 'For the volunteer coordinator: who is volunteering, where they want to serve and where each application stands.',
          href: `/admin/volunteers/print/${ev}`,
        },
        camp &&
          can(staff, 'read:buddies') && {
            key: 'buddies',
            title: 'Buddy sheets',
            forWhom: 'For buddies at orientation: one sheet per camper with what their buddy needs to know.',
            href: `/admin/buddies/print/${ev}`,
          },
        can(staff, 'read:rooming') && {
          key: 'rooms',
          title: 'Room list',
          forWhom: 'For the lodge desk: every room and who is in it.',
          href: `/admin/lodging/print/${ev}`,
        },
        can(staff, 'read:activities') && {
          key: 'activities',
          title: 'Activity sheets',
          forWhom: 'For activity leaders: who signed up for each activity, with waivers and health flags.',
          href: `/admin/activities/print/${ev}`,
          note: 'Rafts and other groups print from each activity’s Groups page.',
        },
        can(staff, 'sensitive') && {
          key: 'kitchen',
          title: 'Kitchen list',
          forWhom: 'For the kitchen: dietary needs and allergies counted, with no names.',
          href: `/admin/dietary/print/${ev}`,
        },
        can(staff, 'sensitive') && {
          key: 'medical',
          title: 'Medical sheet',
          forWhom: 'For the nurse: medications, seizure plans and emergency contacts, one block per person.',
          href: `/admin/medical/print/${ev}`,
          note: 'Keep it with the nurse and shred it after camp.',
        },
      ].filter(Boolean)
    : [];

  // Program rosters: one sheet per program, the same sheet a program leader
  // prints from My Program. Camps only (other events have no programs).
  const programSheets =
    event && camp && can(staff, 'read:programs') ? (programs ?? []).filter((p) => !p.not_a_program) : [];

  return (
    <div>
      <AdminPageHeader
        title="Print Sheets"
        intro={
          <>
            Every sheet to print for one event, and who each is for. Choose the event, then open a
            sheet and print it, or save it as a PDF from the print dialog.
          </>
        }
      />

      {current.length > 1 && (
        <EventFilter
          events={current.map((e) => ({
            id: e.id,
            name: e.name,
            startsOn: e.starts_on,
            endsOn: e.ends_on,
            archivedAt: e.archived_at,
          }))}
          selected={eventId}
          basePath="/admin/print"
          className="mb-4 w-full max-w-sm"
        />
      )}

      {!event ? (
        <p className="text-neutral-500">No current events. Sheets are made from an event&rsquo;s registrations.</p>
      ) : (
        <>
          <div className="card mb-6">
            <h3 className="font-bold">{event.name}</h3>
            <ul className="divide-y divide-neutral-100">
              {sheets.map(({ key, ...s }) => (
                <SheetRow key={key} {...s} />
              ))}
            </ul>
          </div>

          {programSheets.length > 0 && (
            <div className="card">
              <h3 className="font-bold">Program rosters</h3>
              <p className="text-sm text-neutral-600">
                For program leaders: the people in each program, with a flag where staff should ask
                about allergies or support. The same sheet leaders print from My Program.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {programSheets.map((p) => (
                  <li key={p.id}>
                    <a
                      href={`/admin/my-program/print/?program=${p.id}&event=${eventId}`}
                      className="inline-block rounded-full border border-brand px-3 py-1 text-sm font-semibold text-brand hover:bg-brand-light"
                    >
                      {p.name}
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-neutral-500">
                Placing people in programs is on{' '}
                <Link href={`/admin/programs/${ev}`} className="text-brand underline">
                  Program Groups
                </Link>
                .
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
