// Which tracked changes came AFTER approval (Lawrence, 15 Nov 2026: the
// Recent Changes count "should only be changes to applications, volunteer or
// family, that were ALREADY approved"). Before approval, staff see the
// current details when they review the registration, so an edit then is not
// news; after it, a change can mean a nurse's list or a buddy's briefing is
// out of date.
//
// A change counts when the person it is about (or, for a household-level
// change with no person, anyone in that household) had a CONFIRMED place on a
// current event (unarchived, not yet ended) at the moment of the change: the
// place's status_changed_at (0128) is on or before changed_at. A volunteer's
// place and application are one decision (0152), so this covers both. A place
// confirmed before 0128 has no stamp and counts as confirmed long ago.
//
// Server side: takes the caller's client. Throws on a failed read (never an
// empty answer that means "the query failed").

import { todayInMorristown } from '@/lib/events';
import { adultOnFirstDay } from '@/lib/backgroundChecks';

export async function afterApprovalFilter(supabase) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('registration_participants')
    .select('person_id, status_changed_at, registrations!inner ( household_id, events!inner ( ends_on, archived_at ) )')
    .eq('status', 'confirmed')
    .gte('registrations.events.ends_on', today)
    .is('registrations.events.archived_at', null)
    .limit(10000);
  if (error) throw new Error(`Approved places: ${error.message}`);
  // Earliest confirmation per person and per household ('' = no stamp).
  const earliest = (map, key, at) => {
    if (!key) return;
    const prev = map.get(key);
    if (prev === undefined || at < prev) map.set(key, at);
  };
  const byPerson = new Map();
  const byHousehold = new Map();
  for (const p of data ?? []) {
    const at = p.status_changed_at ?? '';
    earliest(byPerson, p.person_id, at);
    earliest(byHousehold, p.registrations?.household_id, at);
  }
  // A change row: { person_id, household_id, changed_at }.
  return (r) => {
    const since = r.person_id ? byPerson.get(r.person_id) : byHousehold.get(r.household_id);
    return since !== undefined && since <= r.changed_at;
  };
}

// A date of birth change that takes someone from 18 or older to under 18 on
// the first day of an upcoming event they have a place at (security review,
// 23 Nov 2026). Everyone 18+ on the first day is screened (0161/0162); under
// 18 is not, so this one edit can quietly take a person out of screening.
// Families can't make it once registered (0177), but staff can, and a change
// made before that is still in the list. A missing old date counts as an
// adult, as the screening rule does (adultOnFirstDay).
//
// rows: change rows { id, person_id, field, old_value, new_value }. Returns a
// Map of change id -> the event names it applies to. Throws on a failed read.
export async function dobDropsUnder18(supabase, rows) {
  const dobRows = rows.filter((r) => r.field === 'date_of_birth' && r.person_id && r.new_value);
  const out = new Map();
  if (dobRows.length === 0) return out;
  const today = todayInMorristown();
  const { data, error } = await supabase
    .from('registration_participants')
    .select('person_id, registrations!inner ( events!inner ( name, starts_on, ends_on, archived_at ) )')
    .in('person_id', [...new Set(dobRows.map((r) => r.person_id))])
    .neq('status', 'cancelled')
    .gte('registrations.events.ends_on', today)
    .is('registrations.events.archived_at', null);
  if (error) throw new Error(`Places for date of birth changes: ${error.message}`);
  for (const r of dobRows) {
    const names = (data ?? [])
      .filter((p) => p.person_id === r.person_id)
      .map((p) => p.registrations?.events)
      .filter((e) => e && adultOnFirstDay(r.old_value, e.starts_on) && !adultOnFirstDay(r.new_value, e.starts_on))
      .map((e) => e.name);
    if (names.length) out.set(r.id, [...new Set(names)]);
  }
  return out;
}
