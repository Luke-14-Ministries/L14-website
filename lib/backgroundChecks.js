// Who needs screening, and how (0161/0162; Lawrence 10-11 Nov 2026: "everyone
// 18+ registered needs to be covered by one of the background check options").
//
//   * Volunteers: the full background check through Checkr (the 0152 gate).
//   * Every other adult (camper, parent/guardian, sibling, caregiver, any
//     later non-volunteer role): a current, clear
//     sex-offender registry search, or a current full check.
//   * Under 18 on the event's FIRST DAY is not screened. One age rule
//     everywhere, the Review card's; record_registry_search() asks the same.
//
// Shared by the Background Checks page and the nav badge, so the queue and the
// number beside it never disagree. Server side: it takes the caller's client.

import { ageOnDay, isVolunteerRole } from '@/lib/roles';
import { isRegistrySearch } from '@/lib/format';

// 18 or older on this event's first day. An unknown birth date counts as an
// adult, as the volunteer gate and record_registry_search() do.
export function adultOnFirstDay(dateOfBirth, startsOn) {
  const age = ageOnDay(dateOfBirth, startsOn);
  return age == null ? true : age >= 18;
}

// Everyone with a non-cancelled place at an upcoming, unarchived event, one
// entry per PERSON. Throws on a failed read (never an empty list that means
// "the query failed").
export async function loadScreeningPeople(supabase, today) {
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, starts_on')
    .gte('ends_on', today)
    .is('archived_at', null);
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));
  if (eventById.size === 0) return { people: [], minors: 0 };

  const { data: places, error: placesError } = await supabase
    .from('registration_participants')
    .select(
      'camp_role, status, people ( id, first_name, last_name, date_of_birth, households!people_household_id_fkey ( city, state ) ), registrations!inner ( event_id )'
    )
    .in('registrations.event_id', [...eventById.keys()])
    .neq('status', 'cancelled');
  if (placesError) throw new Error(`Registrations: ${placesError.message}`);

  const byPerson = new Map();
  for (const p of places ?? []) {
    const person = p.people;
    if (!person?.id) continue;
    const ev = eventById.get(p.registrations?.event_id);
    const adult = adultOnFirstDay(person.date_of_birth, ev?.starts_on);
    const entry =
      byPerson.get(person.id) ??
      { person, events: [], volunteer: false, adult: false, roles: new Set() };
    if (ev?.name && !entry.events.includes(ev.name)) entry.events.push(ev.name);
    entry.volunteer ||= isVolunteerRole(p.camp_role);
    entry.adult ||= adult;
    entry.roles.add(p.camp_role);
    byPerson.set(person.id, entry);
  }
  const people = [...byPerson.values()];
  return {
    people: people.filter((e) => e.adult),
    minors: people.filter((e) => !e.adult).length,
  };
}

// Where an adult who is NOT a volunteer stands. 'due' is the queue (no search,
// or out of date); follow_up and not_permitted are findings; a full check on
// file and current covers them too.
export function registryBucket(c, today, soon) {
  if (c?.verdict === 'not_permitted') return 'not_permitted';
  const onFile = Boolean(c?.background_check_on_file);
  const expired = onFile && c.expires_on && c.expires_on < today;
  if (!onFile || expired) return 'due';
  if (c.verdict !== 'ok') return 'follow_up';
  if (c.expires_on && c.expires_on <= soon) return 'soon';
  return 'current';
}

// Where a VOLUNTEER stands, by the approval gate (volunteer_clearance_ok, 0152):
// "current" means a full check on file, in date AND marked OK to serve
// (Lawrence, 11 Nov 2026: a check in date but marked follow-up, or with no
// verdict yet, used to count as current here while it held approval). In
// order: not_permitted; waiting (no usable check, an order out with Checkr);
// missing (none, or only a registry search, which never clears a volunteer);
// expired; decision (in date, verdict not OK: follow-up or none yet); soon
// (OK, expiring within the window); current.
export function volunteerBucket(c, today, soon) {
  if (c?.verdict === 'not_permitted') return 'not_permitted';
  const onFile = Boolean(c?.background_check_on_file) && !isRegistrySearch(c);
  const expired = onFile && c.expires_on && c.expires_on < today;
  if (!(onFile && !expired) && ['invited', 'pending', 'suspended'].includes(c?.checkr_status)) return 'waiting';
  if (!onFile) return 'missing';
  if (expired) return 'expired';
  if (c.verdict !== 'ok') return 'decision';
  if (c.expires_on && c.expires_on <= soon) return 'soon';
  return 'current';
}

// A full check on file and current (it covers a non-volunteer too, and a
// registry search is never recorded over it).
export function fullCheckCurrent(c, today) {
  return Boolean(c?.background_check_on_file) && !isRegistrySearch(c) && (!c.expires_on || c.expires_on >= today);
}

// How many adults who aren't volunteers have a registry search due: the
// Background Checks nav badge. Same people and rule as the page's queue.
export async function countRegistryDue(supabase, today) {
  const { people } = await loadScreeningPeople(supabase, today);
  const ids = people.filter((e) => !e.volunteer).map((e) => e.person.id);
  if (ids.length === 0) return 0;
  const { data, error } = await supabase
    .from('person_clearances')
    .select('person_id, background_check_on_file, expires_on, verdict, provider')
    .in('person_id', ids);
  if (error) throw new Error(`Background checks: ${error.message}`);
  const by = new Map((data ?? []).map((c) => [c.person_id, c]));
  return ids.filter((id) => registryBucket(by.get(id) ?? null, today, today) === 'due').length;
}
