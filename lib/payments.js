// Money helpers. Everything is in integer cents end to end -- floats and money
// do not mix. Safe to import from both server and client code (no secrets here).

export const CARD_PCT = 0.029; // Stripe card: 2.9% + 30c
export const CARD_FLAT = 30;
export const ACH_PCT = 0.008; // Stripe ACH bank transfer: 0.8%, capped at $5
export const ACH_CAP = 500;

// The fee to ADD on top of `net` so that, after Stripe takes its cut, the
// ministry is left with `net` cents. This is what "cover the fee" charges.
// Card is grossed up (fee is charged on the fee too); bank is grossed up but
// never exceeds the $5 cap.
export function coverFeeCents(net, method) {
  if (net <= 0) return 0;
  if (method === 'bank') {
    const gross = Math.ceil(net / (1 - ACH_PCT));
    return Math.min(gross - net, ACH_CAP);
  }
  const gross = Math.ceil((net + CARD_FLAT) / (1 - CARD_PCT));
  return gross - net;
}

export function dollars(cents) {
  return `$${((cents ?? 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// A participant's money (fee, scholarship, the discount columns) lives on its
// own table, participant_money, since migration 0114 -- so that what a person
// owes is readable only by their own family and by staff with Payments read,
// enforced in the database. Pages read it through a PostgREST embed:
//
//   registration_participants ( id, ..., participant_money ( fee_cents, ... ) )
//
// The relationship is one-to-one, so the embed is an OBJECT, not a list -- or
// null when the caller may not see it (a staff member without Payments read)
// or when no row exists, which should never happen for a saved participant.
//
// On a FAMILY page the family's own rows are always visible, so a null there
// is a fault worth reporting, never a free place. This returns the object or
// null and logs the null: callers show "—" for a missing object rather than
// a $0 that looks like a real number (CLAUDE.md: never turn a bad read into
// a quiet zero). Staff pages have their own rule -- a null means "not yours to
// see" and shows "—" without a log.
export function participantMoney(participant, where) {
  const m = participant?.participant_money ?? null;
  if (!m) {
    console.error(
      `${where}: participant ${participant?.id ?? '?'} has no participant_money row (not visible to this caller, or missing)`
    );
  }
  return m;
}

// What deposit a registration owes: PER PERSON, not per registration.
//
// Corrected 31 August 2026. Every caller used to read events.deposit_cents
// straight through, which made a $50-per-head deposit read as $50 however many
// people were on the registration -- and this was not only a display fault.
// PayPanel pre-selects the deposit as the amount to CHARGE when nothing has
// been paid, so a family of two was being offered a button that took $50 when
// the ministry was owed $100.
//
// Capped at the balance, which is what stops a deposit exceeding a registration
// already reduced by a scholarship or a discount.
//
// Cancelled participants do not count: somebody withdrawn before any money
// moved is not a place being held.
//
// KNOWN LIMIT, deliberate. This applies the EVENT's per-person figure to
// everyone. event_options carries its own nullable deposit_cents, so a future
// event could ask a different deposit of volunteers than of campers, and this
// would not notice. Today no option overrides it to anything other than the
// event's own figure, so the two agree; the day one does, this function is
// where the participant's option has to be read.
//
// PEOPLE, NOT ROWS (29 Sep 2026, Testing Script 3 §14.3). A parent who is also
// volunteering holds TWO participant rows -- parent/guardian with the fee, and
// volunteer at $0 (migration 0069) -- but is one person holding one place. The
// row count made a family of two owe a $150 deposit "for each of the 3 people",
// which is the §21.2 "deposit that does not match" fault in a new coat. Heads
// are therefore counted by person, and any row shape callers pass is accepted:
// person_id (a bare select), people.id (a nested select), or, failing both, the
// participant's own id, which degrades to the old row count rather than to zero.
export function registrationHeads(participants) {
  const seen = new Set();
  for (const p of participants ?? []) {
    if (!p || p.status === 'cancelled') continue;
    seen.add(p.person_id ?? p.people?.id ?? p.person?.id ?? p.id ?? seen.size);
  }
  return seen.size;
}

export function registrationDepositCents({ perPersonCents, participants, balanceCents }) {
  const heads = registrationHeads(participants);
  const asked = Math.max(0, perPersonCents ?? 0) * heads;
  return Math.min(asked, Math.max(0, balanceCents ?? 0));
}

// THE REFUND RULE (Larry, call of 16 Oct 2026, 3:36 pm; build plan item 6):
// the per-person deposit is not refunded; the rest comes back in full until
// 30 days before the event starts, and half after that. A SUGGESTION the
// registrar can override on the form, never a lock -- the refund form has
// always been free text with a reason, and stays so.
//
// Worked per payment, which is all the form knows: `keep` is the deposit for
// the fee-paying people on the registration, capped at what this payment can
// still refund. If an earlier refund already kept the deposit, the registrar
// adjusts -- the arithmetic is shown so that is a glance, not a guess.
export const REFUND_FULL_UNTIL_DAYS = 30;
export function refundSuggestion({
  startsOn,
  depositCents = 0,
  feePeople = 0,
  refundableCents = 0,
  today = new Date().toISOString().slice(0, 10),
}) {
  if (!startsOn) return null;
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(now)) return null;
  const daysBefore = Math.round((start - now) / 86400000);
  const keep = Math.max(0, Math.min(refundableCents, (depositCents ?? 0) * (feePeople ?? 0)));
  const rest = Math.max(0, refundableCents - keep);
  const half = daysBefore < REFUND_FULL_UNTIL_DAYS;
  const suggested = half ? Math.round(rest / 2) : rest;
  return { daysBefore, keep, rest, half, suggested };
}
