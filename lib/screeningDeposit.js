// Background checks wait for the deposit (Ellen and Lawrence, 9 Nov 2026):
// "Background checks will only be run upon the collection of the deposit for
// the family. That way we are not out money if we run a check on someone who
// backs out." Lawrence: hold until paid, but still flag that the check is
// missing or out of date.
//
// One answer per PERSON for Background screening and the batch action, so the
// page and the server cannot disagree: a volunteer is ready to order once ANY
// of their volunteer places on an upcoming, unarchived event is on a
// registration whose deposit is in (paid, waived, full scholarship, or none
// owed -- registration_deposit_in(), 0157). Volunteering at both weeks needs
// one paid week, not two.
//
// Server only: pass the caller's Supabase client. Errors are thrown, never
// read as "not paid" (that would hold everyone) or "paid" (that would spend
// money): the page shows the error instead.

import { isVolunteerRole } from './roles.js';

// personIds: people to answer for. Returns Map(personId -> true/false). A
// person with no volunteer place on an upcoming event is not in the map.
export async function depositInByPerson(supabase, personIds) {
  const out = new Map();
  const ids = [...new Set((personIds ?? []).filter(Boolean))];
  if (ids.length === 0) return out;

  const today = new Date().toISOString().slice(0, 10);
  const { data: places, error } = await supabase
    .from('registration_participants')
    .select('person_id, camp_role, status, registrations!inner ( id, events!inner ( ends_on, archived_at ) )')
    .in('person_id', ids)
    .neq('status', 'cancelled')
    .gte('registrations.events.ends_on', today)
    .is('registrations.events.archived_at', null);
  if (error) throw new Error(`Volunteer places: ${error.message}`);

  const regsByPerson = new Map();
  for (const p of places ?? []) {
    if (!isVolunteerRole(p.camp_role) || !p.registrations?.id) continue;
    if (!regsByPerson.has(p.person_id)) regsByPerson.set(p.person_id, new Set());
    regsByPerson.get(p.person_id).add(p.registrations.id);
  }
  const regIds = [...new Set([...regsByPerson.values()].flatMap((s) => [...s]))];
  if (regIds.length === 0) return out;

  const { data: rows, error: rpcError } = await supabase.rpc('registration_deposit_in', {
    p_registration_ids: regIds,
  });
  if (rpcError) throw new Error(`Deposits: ${rpcError.message}`);
  const inByReg = new Map((rows ?? []).map((r) => [r.registration_id, r.deposit_in === true]));

  for (const [personId, regs] of regsByPerson) {
    out.set(personId, [...regs].some((id) => inByReg.get(id) === true));
  }
  return out;
}

export const WAITING_ON_DEPOSIT =
  'waiting on the deposit. The check is ordered once their registration’s deposit is paid, waived or covered by a scholarship';
