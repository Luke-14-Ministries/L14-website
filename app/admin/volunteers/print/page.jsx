import { redirect } from 'next/navigation';
import { clearancePill, isMinor } from '@/lib/format';
import { todayInMorristown } from '@/lib/events';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import BackLink from '@/components/BackLink';

export const metadata = { title: 'Volunteer List — Staff Admin' };

// The volunteer list on paper (Ellen, 14 Oct 2026): who is volunteering at
// which event, where they want to serve, whether they are new, and where the
// application stands. Contact details are the household's. Background-check
// state appears only for staff holding that grant, as on the page itself.
// No faith statements, no skills text, no medical anything: this is a list
// for the volunteer coordinator's clipboard, not an application file.

const STATUS = {
  applied: 'Awaiting review',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export default async function VolunteerPrintPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/volunteers/print/');
  if (!can(staff, 'read:registration')) redirect('/admin');
  const maySeeChecks = can(staff, 'background_checks');

  const supabase = await createClient();
  const eventFilter = typeof params?.event === 'string' ? params.event : '';

  const [{ data: regs, error: regsError }, { data: events, error: eventsError }] = await Promise.all([
    supabase
      .from('registrations')
      .select(
        `id, event_id,
         households ( display_name, email, phone ),
         registration_participants ( id, camp_role, status,
           people ( id, first_name, last_name, email, phone, date_of_birth ) )`
      ),
    supabase.from('events').select('id, name, starts_on, ends_on').order('starts_on', { ascending: false }),
  ]);
  // CLAUDE.md: never turn a query error into an empty list -- the printed
  // sheet would read as "no volunteers" or "no check on file".
  if (regsError) throw new Error(`Registrations: ${regsError.message}`);
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);

  const vols = [];
  for (const r of regs ?? []) {
    if (eventFilter && r.event_id !== eventFilter) continue;
    for (const p of r.registration_participants ?? []) {
      if (p.camp_role !== 'volunteer' || p.status === 'cancelled') continue;
      vols.push({ participantId: p.id, eventId: r.event_id, status: p.status, person: p.people, household: r.households });
    }
  }
  const partIds = vols.map((v) => v.participantId);
  const personIds = [...new Set(vols.map((v) => v.person?.id).filter(Boolean))];
  const [{ data: apps, error: appsError }, { data: clearances, error: clearancesError }] = await Promise.all([
    partIds.length
      ? supabase
          .from('volunteer_applications')
          .select('registration_participant_id, first_time_volunteering, preferred_areas, status, creed_affirmed')
          .in('registration_participant_id', partIds)
      : Promise.resolve({ data: [] }),
    // The three facts any staff member may know (clearance_status, 0091).
    personIds.length
      ? supabase.from('clearance_status').select('person_id, on_file, expires_on, is_current, verdict').in('person_id', personIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (appsError) throw new Error(`Volunteer applications: ${appsError.message}`);
  if (clearancesError) throw new Error(`Background checks: ${clearancesError.message}`);
  const appByPart = new Map((apps ?? []).map((a) => [a.registration_participant_id, a]));
  const today = todayInMorristown();
  const clearanceByPerson = new Map((clearances ?? []).map((c) => [c.person_id, c]));
  // The same words as the Volunteers page (VolunteerManager): under 18 is
  // "not screened", not a missing check; no row is "No background check on
  // file" (Script 5: this list never set `minor` and said "none on file").
  const checkWord = (person) => {
    const c = clearanceByPerson.get(person?.id) ?? null;
    return clearancePill(isMinor(person?.date_of_birth) ? { ...(c ?? {}), minor: true } : c, today).text;
  };

  const groups = (events ?? [])
    .filter((ev) => !eventFilter || ev.id === eventFilter)
    .map((ev) => ({
      event: ev,
      rows: vols
        .filter((v) => v.eventId === ev.id)
        .sort((a, b) => `${a.person?.last_name} ${a.person?.first_name}`.localeCompare(`${b.person?.last_name} ${b.person?.first_name}`)),
    }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 print-sheet print:text-[11px]">
      <div className="mb-2 flex items-start justify-between print:hidden">
        <h1 className="text-xl font-bold">Volunteer List</h1>
        {/* The way back on the title's line, Print under it (27 Oct 2026). */}
        <span className="flex flex-col items-end gap-2">
          <BackLink href={`/admin/volunteers/${eventFilter ? `?event=${eventFilter}` : ''}`} label="Back to Volunteers" />
          <PrintButton />
        </span>
      </div>
      <p className="mb-6 text-sm text-neutral-500 print:hidden">
        Who is volunteering at each event, where they would like to serve, and where their
        application stands. The household&rsquo;s contact details; nothing from the application
        text and nothing medical.
      </p>
      {groups.length === 0 && <p className="text-sm text-neutral-500">No volunteers to list.</p>}
      {groups.map((g) => (
        <div key={g.event.id} className="mb-8 break-after-page last:break-after-auto">
          <h2 className="text-lg font-bold border-b-2 border-neutral-800 pb-1 mb-2">
            {g.event.name}
            <span className="ml-2 text-sm font-normal text-neutral-600">
              {g.event.starts_on} – {g.event.ends_on} · {g.rows.length} {g.rows.length === 1 ? 'volunteer' : 'volunteers'}
            </span>
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-400 text-left">
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Household · contact</th>
                <th className="py-1 pr-2">Serve where</th>
                <th className="py-1 pr-2">New?</th>
                <th className="py-1 pr-2">Application</th>
                <th className="py-1 pr-2">Creed</th>
                {maySeeChecks && <th className="py-1 pr-2">Check</th>}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((v) => {
                const a = appByPart.get(v.participantId);
                return (
                  <tr key={v.participantId} className="border-b border-neutral-200 align-top">
                    <td className="py-1 pr-2 font-medium whitespace-nowrap">
                      {v.person?.first_name} {v.person?.last_name}
                    </td>
                    <td className="py-1 pr-2 text-neutral-700">
                      {v.household?.display_name}
                      <div className="text-xs text-neutral-500">
                        {v.person?.email ?? v.household?.email ?? ''}
                        {(v.person?.phone ?? v.household?.phone) ? ` · ${v.person?.phone ?? v.household?.phone}` : ''}
                      </div>
                    </td>
                    <td className="py-1 pr-2">{a?.preferred_areas ?? '—'}</td>
                    <td className="py-1 pr-2">{a ? (a.first_time_volunteering ? 'yes' : 'no') : '—'}</td>
                    <td className="py-1 pr-2">{a ? STATUS[a.status] ?? a.status : 'No application yet'}</td>
                    <td className="py-1 pr-2">{a ? (a.creed_affirmed ? 'affirmed' : 'NOT affirmed') : '—'}</td>
                    {maySeeChecks && <td className="py-1 pr-2">{checkWord(v.person)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <p className="mt-4 text-xs text-neutral-500">Printed {today} · Luke 14 Ministries.</p>
    </div>
  );
}
