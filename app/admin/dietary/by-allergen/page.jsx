import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow } from '@/lib/events';
import { allergenWords } from '@/lib/support';
import PrintButton from '@/components/PrintButton';

export const metadata = { title: 'Allergies by allergen — Luke 14 Ministries' };

// The kitchen list WITH names (Ellen's ink, 15 Oct 2026; build plan item 9):
// grouped by allergen, each person named with their severity, anaphylaxis
// first. For the cook and the nurse who plan a week, not for the kitchen
// door -- the no-names tally (/admin/dietary/print) stays for that. Gated by
// the sensitive permission, like the Dietary page it hangs off.
//
// Groups come from the tick list (0097), so one person who ticked peanut and
// milk is under both headings. A row saved before the list shows its free
// text under "Other: ..." until the family saves again -- never guessed into
// a heading.

const SEV_RANK = { anaphylaxis: 4, severe: 3, unrecorded: 2, mild: 1 };
const SEV_LABEL = {
  anaphylaxis: 'ANAPHYLAXIS',
  severe: 'severe',
  mild: 'mild',
  unrecorded: 'severity not recorded',
};
const SEV_CLS = {
  anaphylaxis: 'bg-red-600 text-white',
  severe: 'bg-orange-200 text-orange-900',
  mild: 'bg-amber-100 text-amber-900',
  unrecorded: 'bg-neutral-200 text-neutral-900 ring-1 ring-neutral-400',
};

export default async function AllergiesByAllergenPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/dietary/by-allergen/');
  if (!can(staff, 'sensitive')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: events, error: eventsError }, { data: regs, error }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on, archived_at').order('starts_on'),
    supabase
      .from('registrations')
      .select(
        `id, event_id,
         households ( display_name ),
         registration_participants ( status, camp_role,
           people ( id, first_name, last_name, preferred_name,
             person_support ( has_allergies, allergens, allergy_other, allergy_detail, allergy_severity ) ) )`
      ),
  ]);
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  if (error) throw new Error(`Allergies by allergen: ${error.message}`);

  // The same window the Dietary page uses, so "current" means the same thing.
  const eventFilter = typeof params?.event === 'string' ? params.event : '';
  const isCurrent = isCurrentEventRow;
  const shownEvents = (events ?? []).filter((ev) => (eventFilter ? ev.id === eventFilter : isCurrent(ev)));
  const shownIds = new Set(shownEvents.map((e) => e.id));

  // event id -> allergen word -> [{ name, role, household, severity }]
  const byEvent = new Map();
  for (const r of regs ?? []) {
    if (!shownIds.has(r.event_id)) continue;
    for (const p of r.registration_participants ?? []) {
      if (p.status === 'cancelled' || p.status === 'draft') continue;
      const s = Array.isArray(p.people?.person_support)
        ? p.people.person_support[0]
        : p.people?.person_support;
      if (!s?.has_allergies) continue;
      const words = allergenWords(s);
      if (words.length === 0) words.push('Allergy — not specified');
      const severity = s.allergy_severity || 'unrecorded';
      const name = `${p.people?.preferred_name || p.people?.first_name || ''} ${p.people?.last_name ?? ''}`.trim();
      if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, new Map());
      const groups = byEvent.get(r.event_id);
      for (const w of words) {
        if (!groups.has(w)) groups.set(w, []);
        groups.get(w).push({
          name,
          role: p.camp_role,
          household: r.households?.display_name ?? '',
          severity,
          detail: (s.allergy_detail ?? '').trim(),
        });
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8 print:p-0 bg-white print:text-[12px]">
      <div className="flex items-center justify-between mb-2 print:hidden">
        <h1 className="text-xl font-bold">Allergies by allergen — with names</h1>
        <PrintButton />
      </div>
      <p className="text-sm text-neutral-500 mb-2 print:hidden">
        Every allergen that anyone on a current event has ticked, with who and how serious —
        anaphylaxis first. For the cook and the nurse. The{' '}
        <a href={`/admin/dietary/print${eventFilter ? `?event=${eventFilter}` : ''}`} className="text-brand underline">
          no-names tally
        </a>{' '}
        is the one to pin in the kitchen.
      </p>
      <p className="mb-6 text-sm font-semibold">
        {eventFilter ? shownEvents[0]?.name ?? 'Selected event' : 'Current and upcoming events'}
      </p>

      {shownEvents.map((ev) => {
        const groups = byEvent.get(ev.id);
        if (!groups || groups.size === 0) return null;
        // Worst severity in the group decides the order; anaphylaxis first.
        const worst = (list) => Math.max(...list.map((x) => SEV_RANK[x.severity] ?? 0));
        const ordered = [...groups.entries()].sort(
          (a, b) => worst(b[1]) - worst(a[1]) || b[1].length - a[1].length || a[0].localeCompare(b[0])
        );
        const people = new Set([...groups.values()].flat().map((x) => x.name));
        return (
          <div key={ev.id} className="mb-8 break-inside-avoid">
            <h2 className="text-lg font-bold border-b-2 border-neutral-800 pb-1 mb-2">
              {ev.name}{' '}
              <span className="font-normal text-sm">
                · {people.size} {people.size === 1 ? 'person' : 'people'} with allergies
              </span>
            </h2>
            {ordered.map(([word, list]) => (
              <div key={word} className="mb-4 break-inside-avoid">
                <h3 className="font-bold">
                  {word}{' '}
                  <span className="font-normal text-sm text-neutral-600">
                    · {list.length}
                  </span>
                </h3>
                <ul className="mt-1 divide-y divide-neutral-200 border border-neutral-200 rounded-sm">
                  {[...list]
                    .sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) || a.name.localeCompare(b.name))
                    .map((x, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm">
                        <span className="font-semibold">{x.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEV_CLS[x.severity]}`}>
                          {SEV_LABEL[x.severity]}
                        </span>
                        <span className="text-neutral-600">
                          {x.role}{x.household ? ` · ${x.household}` : ''}
                        </span>
                        {x.detail && <span className="w-full text-xs text-neutral-600">{x.detail}</span>}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        );
      })}
      {shownEvents.every((ev) => !byEvent.get(ev.id)?.size) && (
        <p className="text-sm text-neutral-500">Nobody on these events has an allergy recorded.</p>
      )}
    </div>
  );
}
