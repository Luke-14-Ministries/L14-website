// Payment plans: the words and the small rules the pages share.
//
// The money rules live in the database (migration 0080) so that the website,
// the Stripe webhook and the daily charger can never disagree:
//   balance_due_on()                    -- the due date (mirrors balanceDueOn())
//   plan_charge_dates()                 -- the charge dates after the deposit
//   recalc_early_registration_discount()-- the early discount
//   registration_payment_routes (view)  -- "has this family finished registering?"
// This file is only what the pages need to SAY about them.

import { balanceDueOn, dateISO } from './events';
import { dollars } from './payments';

export const SCHEDULE_LABEL = {
  monthly: 'Monthly',
  semi_monthly: 'Twice a month',
};

export const PLAN_STATUS_LABEL = {
  pending: 'Setting up',
  active: 'Active',
  paused: 'Paused by staff',
  failed: 'Payment problem',
  cancelled: 'Cancelled',
  completed: 'Paid in full',
};

// A plan needs at least a week between now and the due date to be worth
// setting up; closer than that, the family pays in full or asks for help.
// When a stopped plan stopped (22 Oct 2026, the "Plan stopped" flag). A plan
// goes to 'failed' only when an installment's third try fails
// (supabase/functions/_shared/plans.ts), so the moment is that try: the latest
// last_attempt_at on a failed installment. The plan's updated_at is the
// fallback -- it also moves when staff tick the discount box, so it is second
// best. Pass a payment_plans row with payment_installments ( status,
// last_attempt_at ) embedded; returns an ISO timestamp or null.
export function planStoppedAt(plan) {
  if (!plan || plan.status !== 'failed') return null;
  const tries = (plan.payment_installments ?? [])
    .filter((i) => i.status === 'failed' && i.last_attempt_at)
    .map((i) => i.last_attempt_at)
    .sort();
  return tries.length ? tries[tries.length - 1] : plan.updated_at ?? null;
}

// How many tries a plan charge gets before the plan stops. Mirrors
// MAX_ATTEMPTS in supabase/functions/_shared/plans.ts (Deno cannot import
// from lib/, so the number lives in both places; change both together).
export const PLAN_MAX_TRIES = 3;

// The EARLIER flag (Lawrence, 27 Oct 2026, Testing Script 17.11: "should flag
// after ONE failure"): a plan that is still running -- active, or paused by
// staff -- with a charge that failed and has not yet been collected. The
// daily charger tries it again 3 days later; only the third failure stops the
// plan, and a stopped plan is planStoppedAt()'s, never this one's. One answer
// for the review queue's Plan problems tab, the Overview's amber card and the
// plan card's amber line. Pass a payment_plans row with payment_installments
// ( status, attempts, last_error, last_attempt_at ) and
// payment_method_changed_at. Returns
//   { since, tries, paused, setAside }
//                             -- since: the oldest outstanding failure's
//                                last_attempt_at (ISO, or null);
//                                tries: how many tries that charge has had
//                                (0 after the family saved a new payment
//                                method, which resets the count);
//                                paused: staff paused the plan, so the
//                                charger is not retrying until it is resumed;
//                                setAside: the failure was set aside on a
//                                resume (setAsideAfterFailing)
//   null                      -- nothing failing (or the plan stopped).
export function planFailingSince(plan) {
  if (!plan || !['active', 'paused'].includes(plan.status)) return null;
  const open = unresolvedFailures(plan).sort((a, b) =>
    String(a.last_attempt_at ?? '').localeCompare(String(b.last_attempt_at ?? ''))
  );
  if (open.length === 0) return null;
  const first = open[0];
  return {
    since: first.last_attempt_at ?? null,
    tries: first.attempts ?? 0,
    paused: plan.status === 'paused',
    setAside: first.status === 'cancelled',
  };
}

// A charge that failed and was then set aside when staff resumed the plan:
// resuming cancels the failed charges and rebuilds the schedule from today,
// spreading what they would have taken over the payments still to come.
export function setAsideAfterFailing(i) {
  return i?.status === 'cancelled' && (i.attempts ?? 0) > 0 && Boolean(i.last_error);
}

// The failures still standing (Lawrence, 27 Oct 2026: "keep the flag until
// fixed"). A failed charge stands until it is collected, as before. A charge
// set aside on a resume stands too -- resuming does not change the card that
// failed -- until a later plan charge succeeds or the family saves a new card
// or bank account after it (payment_plans.payment_method_changed_at, 0136).
// Only a running plan's set-aside charges count; a cancelled or finished plan
// has nothing left to fix. Pass a plan with payment_installments ( status,
// attempts, last_error, last_attempt_at ) and payment_method_changed_at.
function unresolvedFailures(plan) {
  const inst = plan?.payment_installments ?? [];
  const running = ['active', 'paused'].includes(plan?.status);
  const lastPaid = inst
    .filter((i) => i.status === 'paid' && i.last_attempt_at)
    .map((i) => i.last_attempt_at)
    .sort()
    .pop() ?? '';
  const methodChanged = plan?.payment_method_changed_at ?? '';
  const later = (a, b) => new Date(a).getTime() > new Date(b).getTime();
  return inst.filter(
    (i) =>
      i.status === 'failed' ||
      (running &&
        setAsideAfterFailing(i) &&
        (!lastPaid || later(i.last_attempt_at, lastPaid)) &&
        (!methodChanged || later(i.last_attempt_at, methodChanged)))
  );
}

// What happens next to a failing plan, in words, for the flag and the plan
// card: "retrying (try 1 of 3)". Pass planFailingSince()'s result.
export function planFailingNext(failing) {
  if (!failing) return '';
  if (failing.paused) return 'plan paused — no retry until staff resume it';
  if (failing.setAside) return 'plan resumed with the same card or bank account, so the next payment may fail too';
  if (failing.tries < 1) return 'retrying with the new payment method';
  return `retrying (try ${failing.tries} of ${PLAN_MAX_TRIES})`;
}

// Is something wrong with this plan that the family should see? The plan
// stopped (status 'failed', after three tries) or a payment still to come
// failed and is waiting to be retried. One answer for the plan card's red
// panel and the dashboard's "Needs:" chip (26 Oct 2026); since 27 Oct a
// failure set aside on a resume counts until it is fixed (unresolvedFailures).
export function planHasProblem(plan) {
  if (!plan) return false;
  return plan.status === 'failed' || unresolvedFailures(plan).length > 0;
}

// A payment provider's error as a phrase inside our own sentence (Lawrence,
// 27 Oct 2026: "(Your card was declined.)." read badly): no closing period
// and a lower-case first word, so it reads "(your card was declined)". A
// word in capitals (an acronym) is left alone.
export function declineReason(message) {
  const s = String(message ?? '').trim().replace(/[.\s]+$/, '');
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

export const PLAN_MIN_DAYS = 7;

// Whether a registration counts as "not finished" until the family picks
// pay in full / payment plan / scholarship.
//
// OFF since 30 Sep 2026 (Lawrence, staff questions): a family submits with
// nothing paid; the $50 deposit is what staff need for APPROVAL (unless a
// full scholarship is requested), and staff sort registrations into three
// classes instead -- see registration_review (0081) and REVIEW_CLASS below.
// Paying in full and payment plans stay on offer through /account/finish/.
// Every "not finished" banner, pill and column keys off this one function, so
// turning it back on is one line. The `event` argument is kept for that.
export function requiresPaymentChoice(event) {
  return false;
}

// Only camp weeks carry a due date, so only camp weeks offer a plan.
export function offersPaymentPlan(event) {
  return balanceDueOn(event) != null;
}

// The three classes staff review registrations in (Lawrence, 30 Sep 2026),
// from registration_review.review_class (0081).
export const REVIEW_CLASS = {
  deposit_paid: { label: 'Deposit received', hint: 'Review and approve', cls: 'bg-green-100 text-green-800' },
  full_scholarship: { label: 'Full scholarship requested', hint: 'Reach out to the family', cls: 'bg-blue-100 text-blue-800' },
  neither: { label: 'No full deposit yet', hint: 'Approval waits on the deposit or a waiver', cls: 'bg-neutral-100 text-neutral-600' },
};

// registration_review.flags: reasons for a second look, whatever the class.
export const REVIEW_FLAG = {
  deposit_short: 'Deposit short of the per-person amount',
  deposit_waived: 'Deposit waived by staff',
  media_declined: 'Photo permission declined',
  creed_not_affirmed: "Apostles' Creed not affirmed",
  // 0098: staff put the registration back in front of a reviewer.
  on_hold: 'On hold — staff are re-checking a change',
};

// Server components only (reads the clock -- see THE CLOCK in lib/events.js).
export function planAvailable(event, now = Date.now()) {
  const due = balanceDueOn(event);
  return Boolean(due) && due > dateISO(PLAN_MIN_DAYS, now);
}

// The consent a family gives for recurring charges. Stored word for word on
// the plan (payment_plans.consent_text) with who agreed and when, so it can
// be shown back if a charge is ever questioned. Kept under Stripe's 500
// character metadata limit, because it travels to the webhook that way.
// Change the wording -> bump the version.
//
// v2 (22 Oct 2026, 0123): v1's words, plus ONE sentence when the event passes
// on a returned-bank-payment fee -- only when that fee is over $0, so with no
// fee the text is exactly v1's. The fee named is the one the family agrees
// to; it travels in the metadata and is stored on the plan, and it is the
// only fee the plan can ever add. Longest case is about 485 characters.
export const PLAN_CONSENT_VERSION = 'plan-consent-v2';

const CONSENT_CADENCE = {
  monthly: 'once a month',
  semi_monthly: 'twice a month (on the 1st and 15th)',
};

export function planConsentText({ schedule, dueLabel, returnedFeeCents = 0 }) {
  return (
    `I authorize Luke 14 Ministries to charge the payment method I save today: the deposit now, ` +
    `then the remaining balance in equal payments ${CONSENT_CADENCE[schedule] ?? schedule}, with the ` +
    `last one on ${dueLabel}. Amounts can go down if my balance changes. I can ask the ministry to ` +
    `change or cancel this plan at any time.` +
    (returnedFeeCents > 0
      ? ` If my bank returns a payment, a ${dollars(returnedFeeCents)} fee is added to my balance to cover ` +
        `what the bank charges the ministry, and my remaining payments include it.`
      : '')
  );
}

// The disclosure beside the bank choice (Lawrence, 22 Oct 2026; 0123), shown
// only when the event's returned-payment fee is over $0. null otherwise, so a
// page renders nothing -- not an empty line.
export function returnedFeeDisclosure(returnedFeeCents) {
  if (!(returnedFeeCents > 0)) return null;
  return `If your bank returns a payment, a ${dollars(returnedFeeCents)} fee is added to cover what the bank charges us.`;
}

// How a registration_fees row (0123) is named to families and staff.
export function feeLabel(fee) {
  if (fee?.kind === 'returned_payment') return 'Returned-payment fee';
  return fee?.reason ? `Fee — ${fee.reason}` : 'Fee';
}

// Registration-wide "what does this family still have to do?" wording, from
// registration_payment_routes.route.
export const ROUTE_LABEL = {
  plan: 'Payment plan',
  paid_in_full: 'Paid in full',
  nothing_owed: 'Nothing owed',
  scholarship: 'Scholarship requested',
  none: 'Not finished — no payment choice',
};
