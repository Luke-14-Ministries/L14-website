import { redirect } from 'next/navigation';
import { allergenWords } from '@/lib/support';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow } from '@/lib/events';
import PrintButton from '@/components/PrintButton';
import BackLink from '@/components/BackLink';

export const metadata = { title: 'Kitchen List — Staff Admin' };

// The KITCHEN copy: dietary needs and allergies tallied per event, with NO
// names. Safe to pin up in the kitchen — it says "gluten-free × 3", never who.
// The named version stays on the Dietary & Allergies screen for staff with the
// sensitive permission.
export default async function KitchenListPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/dietary/print/');
  if (!can(staff, 'sensitive')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: events, error: eventsError }, { data: regs, error: regsError }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on, archived_at').order('starts_on'),
    supabase
      .from('registrations')
      .select(
        `id, event_id,
         registration_participants ( status,
           people ( person_support ( dietary_needs, allergens, allergy_other, allergy_detail, has_allergies, allergy_severity ) ) )`
      ),
  ]);
  // CLAUDE.md: never turn a query error into an empty list -- the kitchen
  // would read it as "no dietary needs".
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  if (regsError) throw new Error(`Dietary needs: ${regsError.message}`);

  // Tally identical needs so the kitchen sees quantities. Dietary free text
  // is split on commas so "Red 40, gluten, dairy" counts as three items.
  // Allergy words are NOT split: allergenWords() already gives one word per
  // ticked allergen, and its "Other: ..." is the family's own phrase, kept
  // whole as the by-allergen page keeps it ("Peanuts; hives" split into a
  // made-up "hives" allergy, 13.30).
  const byEvent = new Map();
  // Severity aggregates to the WORST seen for an item, never the latest and
  // never the commonest. Three campers list "peanuts" mild and a fourth is
  // anaphylactic: this list must say anaphylaxis, or the one person it exists
  // to protect is hidden behind the three it does not.
  //
  // Unrecorded ranks ABOVE mild deliberately. "Nobody said" is not evidence of
  // mildness, and on a page with no names attached there is nobody to ask.
  const SEV_RANK = { anaphylaxis: 4, severe: 3, unrecorded: 2, mild: 1 };
  const addItem = (eventId, kind, text, severity) => {
    const items = (kind === 'allergy' ? [String(text)] : String(text).split(/[,;\n]/))
      .map((t) => t.trim())
      .filter(Boolean);
    for (const item of items) {
      const key = item.toLowerCase();
      if (!byEvent.has(eventId)) byEvent.set(eventId, new Map());
      const bucket = byEvent.get(eventId);
      const cur = bucket.get(key) ?? { label: item, kind, count: 0, severity: null };
      cur.count += 1;
      if (kind === 'allergy') cur.kind = 'allergy'; // allergy flag wins
      if (kind === 'allergy') {
        const incoming = severity || 'unrecorded';
        if ((SEV_RANK[incoming] ?? 0) > (SEV_RANK[cur.severity] ?? 0)) {
          cur.severity = incoming;
        }
      }
      bucket.set(key, cur);
    }
  };

  // The same rule the Dietary page uses, so "Current events" means the same
  // thing on the screen and on the printout.
  const eventFilter = typeof params?.event === 'string' ? params.event : '';
  const showPast = params?.past === '1';
  const isCurrent = isCurrentEventRow;
  const shownEvents = (events ?? []).filter((ev) => {
    if (eventFilter) return ev.id === eventFilter;
    return showPast || isCurrent(ev);
  });
  const shownIds = new Set(shownEvents.map((e) => e.id));

  let people = 0;
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (p.status === 'cancelled' || p.status === 'draft') continue;
      if (!shownIds.has(r.event_id)) continue;
      const s = p.people?.person_support;
      if (!s) continue;
      let counted = false;
      // One item per ticked allergen (0097), so "peanut" is one line however
      // many ways families used to spell it. A pre-0097 row contributes its
      // free text as "Other: ..." until the family saves again.
      const words = allergenWords(s);
      // An allergy with no words is still an allergy (18 Oct review: an
      // anaphylactic volunteer with nothing ticked vanished from the list).
      if (s.has_allergies && words.length === 0) words.push('Allergy — not specified');
      if (words.length > 0) {
        for (const w of words) addItem(r.event_id, 'allergy', w, s.allergy_severity);
        counted = true;
      }
      if (s.dietary_needs) {
        addItem(r.event_id, 'diet', s.dietary_needs);
        counted = true;
      }
      if (counted) people += 1;
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-8 print-sheet bg-white print:text-[12px]">
      <div className="flex items-start justify-between mb-2 print:hidden">
        <h1 className="text-xl font-bold">Kitchen list — no names</h1>
        {/* The way back on the title's line, Print under it (27 Oct 2026). */}
        <span className="flex flex-col items-end gap-2">
          <BackLink href={`/admin/dietary/${eventFilter ? `?event=${eventFilter}` : ''}`} label="Back to Dietary" />
          <PrintButton />
        </span>
      </div>
      <p className="text-sm text-neutral-500 mb-6 print:hidden">
        Dietary needs and allergies tallied per event, with no names attached — safe to post in
        the kitchen. The named list stays on the Dietary &amp; Allergies page.
      </p>

      {/* Says what it covers, on the printed page too — the one place the
          filter is invisible once the paper leaves the screen. */}
      <p className="mb-6 text-sm font-semibold">
        {eventFilter
          ? shownEvents[0]?.name ?? 'Selected event'
          : showPast
            ? 'All events, including past ones'
            : 'Current and upcoming events'}
      </p>

      {/* Only the events asked for. A kitchen list is pinned to a wall and
          cooked from; one that quietly includes a week that is not happening
          is worse than no list, because nobody can tell by looking. */}
      {shownEvents.map((ev) => {
        const bucket = byEvent.get(ev.id);
        if (!bucket || bucket.size === 0) return null;
        const items = [...bucket.values()].sort(
          (a, b) => (a.kind === b.kind ? b.count - a.count : a.kind === 'allergy' ? -1 : 1)
        );
        return (
          <div key={ev.id} className="mb-8 break-inside-avoid">
            <h2 className="text-lg font-bold border-b-2 border-neutral-800 pb-1 mb-2">
              {ev.name}{' '}
              <span className="font-normal text-sm">
                ({ev.starts_on} – {ev.ends_on})
              </span>
            </h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b border-neutral-400">
                  <th className="py-1 pr-3">Need</th>
                  <th className="py-1 pr-3">Type</th>
                  <th className="py-1 text-right">How many people</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-neutral-200">
                    <td className="py-1 pr-3 font-medium">{it.label}</td>
                    <td className="py-1 pr-3">
                      {it.kind === 'allergy' ? (
                        /* Wording, not colour: this sheet is printed, often in
                           black and white, and pinned to a wall. A red pill
                           that photocopies grey is no warning at all. */
                        <span
                          className={
                            it.severity === 'anaphylaxis'
                              ? 'font-bold uppercase'
                              : 'font-bold'
                          }
                        >
                          {it.severity === 'anaphylaxis'
                            ? 'ALLERGY — ANAPHYLAXIS'
                            : it.severity === 'severe'
                              ? 'ALLERGY — severe'
                              : it.severity === 'mild'
                                ? 'ALLERGY — mild'
                                : 'ALLERGY — severity not recorded'}
                        </span>
                      ) : (
                        'dietary'
                      )}
                    </td>
                    <td className="py-1 text-right font-semibold">{it.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {people === 0 && <p className="text-neutral-500">No dietary needs or allergies recorded.</p>}

      <p className="text-xs text-neutral-400 mt-8">
        Names withheld on purpose — ask the camp office for person-level detail. Printed{' '}
        {new Date().toLocaleDateString('en-US')} · Luke 14 Ministries.
      </p>
    </div>
  );
}
