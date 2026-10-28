import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';
import BackLink from '@/components/BackLink';
import StatusMark from '@/components/StatusMark';
import { STATUS_LABEL } from '@/lib/format';

export const metadata = { title: 'Print Rosters — Staff Admin' };

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

// A compact, ink-friendly roster for printing. Uses the browser's own print
// dialog; the admin chrome is left out on purpose.
export default async function PrintRostersPage({ searchParams }) {
  const params = await searchParams;
  const fEvent = typeof params?.event === 'string' ? params.event : '';
  const fRole = typeof params?.role === 'string' ? params.role : '';
  const fStatus = typeof params?.status === 'string' ? params.status : '';

  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/rosters/print/');
  if (!can(staff, 'read:registration')) redirect('/admin');

  const supabase = await createClient();
  const [
    { data: events, error: eventsError },
    { data: regs, error: regsError },
    { data: consents, error: consentsError },
  ] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on').order('starts_on'),
    supabase
      .from('registrations')
      .select(
        `id, event_id,
         households ( display_name, phone ),
         registration_participants ( camp_role, status, tshirt_size,
           people ( id, first_name, last_name ) )`
      ),
    supabase.from('person_current_consents').select('person_id, kind, granted'),
  ]);
  // CLAUDE.md: never turn a query error into an empty list -- a failed read
  // here would show a printed roster with nobody on it.
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  if (regsError) throw new Error(`Registrations: ${regsError.message}`);
  if (consentsError) throw new Error(`Consents: ${consentsError.message}`);

  const consentOf = new Map();
  for (const c of consents ?? []) consentOf.set(`${c.person_id}:${c.kind}`, c.granted);

  const byEvent = new Map();
  for (const r of regs ?? []) {
    if (fEvent && r.event_id !== fEvent) continue;
    for (const p of r.registration_participants ?? []) {
      if (p.status === 'cancelled') continue;
      if (fRole && p.camp_role !== fRole) continue;
      if (fStatus && p.status !== fStatus) continue;
      if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []);
      byEvent.get(r.event_id).push({
        person: `${p.people?.last_name ?? ''}, ${p.people?.first_name ?? ''}`,
        role: ROLE_LABEL[p.camp_role] ?? p.camp_role,
        status: p.status,
        household: r.households?.display_name ?? '',
        phone: r.households?.phone ?? '',
        tshirt: p.tshirt_size ?? '',
        // This is the copy that ends up in a pocket at camp. The photo
        // preference has to be ON it, or the person carrying it cannot honour
        // something the family was told we would honour.
        noPhoto: p.people?.id ? consentOf.get(`${p.people.id}:media`) === false : false,
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8 print-sheet bg-white print:text-[12px]">
      <div className="flex items-start justify-between mb-6 print:hidden">
        <h1 className="text-xl font-bold">Rosters — print view</h1>
        {/* The way back on the title's line, Print under it (27 Oct 2026). */}
        <span className="flex flex-col items-end gap-2">
          <BackLink href={`/admin/rosters/${fEvent ? `?event=${fEvent}` : ''}`} label="Back to Rosters" />
          <PrintButton />
        </span>
      </div>

      {(events ?? []).map((ev) => {
        const rows = (byEvent.get(ev.id) ?? []).sort((a, b) => a.person.localeCompare(b.person));
        if (rows.length === 0) return null;
        return (
          <div key={ev.id} className="mb-8 break-inside-avoid">
            <h2 className="text-lg font-bold border-b-2 border-neutral-800 pb-1 mb-2">
              {ev.name}{' '}
              <span className="font-normal text-sm">
                ({ev.starts_on} – {ev.ends_on}) · {rows.length} {rows.length === 1 ? 'person' : 'people'}
              </span>
            </h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b border-neutral-400">
                  <th className="py-1 pr-3">Name</th>
                  <th className="py-1 pr-3">Role</th>
                  <th className="py-1 pr-3">Shirt</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Household</th>
                  <th className="py-1">Phone</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-neutral-200">
                    <td className="py-1 pr-3 font-medium">
                      {r.person}
                      {r.noPhoto && (
                        <span
                          className="ml-1 rounded-sm border border-neutral-800 px-1 text-[10px] leading-5 font-bold uppercase"
                          title="Family asked us not to feature them in published photos"
                        >
                          no photo
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-3">{r.role}</td>
                    <td className="py-1 pr-3">{r.tshirt}</td>
                    {/* The shared words, capitalised, and a tick for the one
                        state that means "coming" (Lawrence, 28 Oct 2026:
                        glanceable status cells). The others stay words --
                        submitted, waitlisted and draft are not a yes or a no. */}
                    <td className="py-1 pr-3">
                      {r.status === 'confirmed' ? (
                        <StatusMark state="yes" label={STATUS_LABEL.confirmed} />
                      ) : (
                        STATUS_LABEL[r.status] ?? r.status
                      )}
                    </td>
                    <td className="py-1 pr-3">{r.household}</td>
                    <td className="py-1">{r.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <p className="text-xs text-neutral-400 mt-8">
        Printed {new Date().toLocaleDateString('en-US')} · Luke 14 Ministries — internal use only.
      </p>
    </div>
  );
}
