import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { shortEventName } from '@/lib/events';
import { statusPill } from '@/lib/format';

export const metadata = { title: 'Search — Staff Admin' };

// Find a person or a family by name or email and get to their page in one
// step (Ellen's "search tab"; Lawrence, 14 Oct 2026). The box lives in the
// staff header on every page and lands here. Results are people, each with
// their household and every event they are on, linking to the person page
// and to each registration -- which is where everything about them is.
//
// Deliberately simple: a few words of a name, or part of an email. No
// filters; the roster has those.

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent / guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/search/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const q = typeof params?.q === 'string' ? params.q.trim() : '';
  const supabase = await createClient();

  let people = [];
  if (q.length >= 2) {
    // Each word must match somewhere: "ada bot" finds Ada BOTFAMILY-A. The
    // email check uses the whole string.
    const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
    let query = supabase
      .from('people')
      .select(
        `id, first_name, last_name, preferred_name, email, date_of_birth,
         households ( id, display_name, email ),
         registration_participants ( id, camp_role, status, registration_id,
           registrations ( id, events ( id, name, starts_on ) ) )`
      )
      .limit(60);
    for (const w of words) {
      const like = `%${w.replace(/[%_]/g, '')}%`;
      query = query.or(
        `first_name.ilike.${like},last_name.ilike.${like},preferred_name.ilike.${like},email.ilike.${like}`
      );
    }
    const { data, error } = await query;
    if (error) console.error('search:', error.message);
    people = data ?? [];
  }

  // Households whose own name or email matches, for the case where the family
  // name is known but no person's is.
  let households = [];
  if (q.length >= 2) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const { data } = await supabase
      .from('households')
      .select('id, display_name, email, people ( id, first_name, last_name )')
      .or(`display_name.ilike.${like},email.ilike.${like}`)
      .limit(20);
    households = data ?? [];
  }

  const sorted = [...people].sort((a, b) =>
    `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
  );

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Search</h2>
      <form action="/admin/search/" method="get" className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="A name, part of a name, or an email"
          className="w-80 max-w-full rounded border border-neutral-300 px-3 py-2"
          autoFocus
        />
        <button type="submit" className="btn-primary !py-2">
          Search
        </button>
        <span className="text-sm text-neutral-500">
          People and families, across every event. Open a person to see everything about them.
        </span>
      </form>

      {q.length > 0 && q.length < 2 && (
        <p className="text-sm text-neutral-500">Type at least two characters.</p>
      )}

      {q.length >= 2 && sorted.length === 0 && households.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nothing matches &ldquo;{q}&rdquo;. Try fewer words, or part of an email address.
        </p>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white mb-6">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr className="border-b border-neutral-200">
                <th className="px-3 py-2 text-left font-semibold">Person</th>
                <th className="px-3 py-2 text-left font-semibold">Family</th>
                <th className="px-3 py-2 text-left font-semibold">Registered for</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const live = (p.registration_participants ?? []).filter((r) => r.status !== 'cancelled');
                return (
                  <tr key={p.id} className="border-b border-neutral-100 align-top hover:bg-neutral-50">
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/people/${p.id}/`} className="font-medium text-brand-dark hover:underline">
                        {p.first_name} {p.last_name}
                      </Link>
                      {p.preferred_name && p.preferred_name !== p.first_name && (
                        <span className="ml-1 text-xs text-neutral-500">goes by &ldquo;{p.preferred_name}&rdquo;</span>
                      )}
                      {p.email && <div className="text-xs text-neutral-500">{p.email}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-700">
                      {p.households?.display_name ?? <span className="text-neutral-400">—</span>}
                      {p.households?.email && (
                        <div className="text-xs text-neutral-500">{p.households.email}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {live.length === 0 ? (
                        <span className="text-neutral-400">Not registered for anything</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {live.map((r) => {
                            const pill = statusPill(r.status);
                            const ev = r.registrations?.events;
                            return (
                              <li key={r.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                                <Link
                                  href={`/admin/registrations/${r.registration_id}/`}
                                  title={ev?.name ?? ''}
                                  className="text-brand-dark hover:underline whitespace-nowrap"
                                >
                                  {shortEventName(ev?.name ?? 'Event')}
                                </Link>
                                <span className="text-neutral-500">{ROLE_LABEL[r.camp_role] ?? r.camp_role}</span>
                                <span className={`rounded px-1.5 py-0.5 font-semibold ${pill.cls}`}>{pill.text}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {households.length > 0 && (
        <>
          <h3 className="font-semibold text-neutral-700 mb-2">Families</h3>
          <ul className="space-y-1 text-sm">
            {households.map((h) => (
              <li key={h.id} className="rounded border border-neutral-200 bg-white px-3 py-2">
                <span className="font-medium">{h.display_name}</span>
                {h.email && <span className="ml-2 text-xs text-neutral-500">{h.email}</span>}
                <span className="ml-2 text-xs text-neutral-500">
                  {(h.people ?? [])
                    .map((p) => `${p.first_name} ${p.last_name}`)
                    .join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
