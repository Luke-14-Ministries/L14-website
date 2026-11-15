// What staff can do about background checks NOW (Fable badge review, 14 Nov
// 2026): one answer for the Background Checks nav badge and the page's "How
// to run a background check" line, so the two never disagree.
//   ready     adults Background Screening would send an invite to now
//             (volunteers and family adults: nothing in the way)
//   held      due, but waiting on their own share of the deposit
//   results   VolunteerBadge results waiting on staff (clear to confirm as OK
//             to serve, or one that needs review), by person
//   registry  adult campers with a registry search due (still their default
//             until VolunteerBadge says how a guardian completes one)
//   due       every volunteer and family adult who still needs a background
//             check, except those whose invite is out and with VolunteerBadge
//             (nothing for staff to do until it comes back)
// total = due + registry: every adult still needing a background check
// (Lawrence, 15 Nov 2026: the badge should "cover all adults", not only what
// can be done this minute). Server only; throws on a failed read.

import { loadScreeningCandidates } from '@/lib/screeningCandidates';
import { WAITING_ON_DEPOSIT } from '@/lib/screeningDeposit';
import { countRegistryDue, settledByRecord } from '@/lib/backgroundChecks';

export async function backgroundCheckWork(supabase, { sandbox = false, today } = {}) {
  const { candidates } = await loadScreeningCandidates(supabase, { sandbox });
  const ready = candidates.filter((c) => !c.blockedBecause).length;
  const due = candidates.filter((c) => !c.openRequestId).length;
  const held = candidates.filter((c) => String(c.blockedBecause ?? '').startsWith(WAITING_ON_DEPOSIT)).length;
  const { data: waiting, error } = await supabase
    .from('volunteerbadge_requests')
    .select('person_id')
    .eq('sandbox', sandbox)
    .in('status', ['clear', 'consider'])
    .is('confirmed_at', null);
  if (error) throw new Error(`VolunteerBadge results: ${error.message}`);
  // Not one already settled by a record entered by hand.
  const waitingIds = [...new Set((waiting ?? []).map((r) => r.person_id))];
  let settled = new Set();
  if (waitingIds.length) {
    const { data: recs, error: recError } = await supabase
      .from('person_clearances')
      .select('person_id, background_check_on_file, expires_on, verdict, provider')
      .in('person_id', waitingIds);
    if (recError) throw new Error(`Background check records: ${recError.message}`);
    const day = today ?? new Date().toISOString().slice(0, 10);
    settled = new Set((recs ?? []).filter((c) => settledByRecord(c, day)).map((c) => c.person_id));
  }
  const results = waitingIds.filter((id) => !settled.has(id)).length;
  const registry = await countRegistryDue(supabase, today, { campersOnly: true });
  return { ready, held, results, registry, due, total: due + registry };
}
