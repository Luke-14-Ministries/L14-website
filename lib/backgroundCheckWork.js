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
// total = ready + results + registry. Server only; throws on a failed read.

import { loadScreeningCandidates } from '@/lib/screeningCandidates';
import { WAITING_ON_DEPOSIT } from '@/lib/screeningDeposit';
import { countRegistryDue } from '@/lib/backgroundChecks';

export async function backgroundCheckWork(supabase, { sandbox = false, today } = {}) {
  const { candidates } = await loadScreeningCandidates(supabase, { sandbox });
  const ready = candidates.filter((c) => !c.blockedBecause).length;
  const held = candidates.filter((c) => String(c.blockedBecause ?? '').startsWith(WAITING_ON_DEPOSIT)).length;
  const { data: waiting, error } = await supabase
    .from('volunteerbadge_requests')
    .select('person_id')
    .eq('sandbox', sandbox)
    .in('status', ['clear', 'consider'])
    .is('confirmed_at', null);
  if (error) throw new Error(`VolunteerBadge results: ${error.message}`);
  const results = new Set((waiting ?? []).map((r) => r.person_id)).size;
  const registry = await countRegistryDue(supabase, today, { campersOnly: true });
  return { ready, held, results, registry, total: ready + results + registry };
}
