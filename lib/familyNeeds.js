// What a family still owes us, as rules shared by the dashboard and the
// automatic emails (27 Oct 2026). They lived inside the dashboard page until
// the reminder job needed the same answers; one copy, so the email can never
// ask for something the dashboard says is done.

import { supportProblems, emptySupport } from './support.js';

// Is the deposit being asked for right now? The rule the title-bar pill and
// the deposit banner have always used -- not waived, a deposit set, nothing
// paid or clearing, something still owed -- plus "no full scholarship
// requested" (26 Oct 2026), because the banner itself tells a family asking
// for a full scholarship that no deposit is needed.
export function depositDueNow({ registration, balance, clearingCents, depositCents, fullScholarship }) {
  const nothingPaid = balance && (balance.paid_cents ?? 0) === 0 && (clearingCents ?? 0) === 0;
  return (
    !registration.deposit_waived_at &&
    depositCents > 0 &&
    Boolean(nothingPaid) &&
    (balance?.balance_cents ?? 0) > 0 &&
    !fullScholarship
  );
}

// One person's support details: 'empty' (the details form never saved),
// 'incomplete' (saved, but no photo, no emergency contact, or -- for a camper
// -- the required support answers missing), or 'complete'. `missing` names
// what is missing, in the dashboard's words. The reasons for each check are
// on the dashboard's Support details card (31 Aug, 16 Oct 2026).
export function supportState({ row, hasPhoto, isCamper }) {
  if (!row || !row.details_saved_at) return { state: 'empty', missing: [] };
  const missing = [];
  if (!hasPhoto) missing.push('a photo');
  if (!row.emergency_contact_name?.trim() || !row.emergency_contact_phone?.trim()) {
    missing.push('an emergency contact');
  }
  if (isCamper && supportProblems(emptySupport(row), { isCamper: true }).length > 0) {
    missing.push('the support details a camper needs');
  }
  return { state: missing.length ? 'incomplete' : 'complete', missing };
}

// A volunteer whose application is still needed: none filed, or withdrawn.
export function volunteerApplicationNeeded(status) {
  return !status || status === 'withdrawn';
}
