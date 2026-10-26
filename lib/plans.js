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

// Is something wrong with this plan that the family should see? The plan
// stopped (status 'failed', after three tries) or a payment still to come
// failed and is waiting to be retried. One answer for the plan card's red
// panel and the dashboard's "Needs:" chip (26 Oct 2026). Pass a plan row with
// payment_installments ( status ) embedded.
export function planHasProblem(plan) {
  if (!plan) return false;
  return (
    plan.status === 'failed' ||
    (plan.payment_installments ?? []).some((i) => i.status === 'failed')
  );
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
  neither: { label: 'No full deposit yet', hint: 'No review needed yet', cls: 'bg-neutral-100 text-neutral-600' },
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
