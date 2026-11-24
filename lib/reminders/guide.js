// What the automatic emails say, for staff (23 Nov 2026, review A4-16/A4-17).
// Email Families shows every kind as a family would get it, filled with the
// made-up facts below, beside when it goes. Ellen and Katie can read the
// wording there without opening templates.js; a change there shows here at
// once, because each sample goes through the same composeFamilyEmail().
// Each kind alone, as a family gets it on a day it is the only thing due.
// The "when" lines follow schedule.js and run.js; change them together.

import { composeFamilyEmail } from './templates.js';

export const AUTOMATIC_EMAIL_GUIDE = [
  { kind: 'not_submitted', label: 'Registration not submitted', when: '3, 10, 17 and 24 days after a family starts registering and has not submitted.' },
  { kind: 'deposit', label: 'Deposit reminder', when: 'While the deposit is owed: monthly on the 15th, then 2 weeks before the balance due date and on it.' },
  { kind: 'balance', label: 'Balance reminder', when: 'Deposit in, balance still owed and no payment plan: monthly on the 15th, then 2 weeks before the balance due date and on it.' },
  { kind: 'past_due', label: 'Balance past due', when: 'Weekly after the balance due date, until it is paid or staff pause reminders.' },
  { kind: 'missing_details', label: 'Missing details', when: 'Support details, volunteer applications, activity waivers or a staff question still open: monthly on the 15th, then 2 weeks and 5 days before the first day.' },
  { kind: 'confirmed', label: 'Confirmed', when: 'The morning after staff approve someone.' },
  { kind: 'off_waitlist', label: 'Off the waitlist', when: 'The morning after staff approve someone who was on the waiting list.' },
  { kind: 'plan_upcoming', label: 'Payment plan: payment coming', when: '1 week before each automatic payment (10 days for a bank account).' },
  { kind: 'card_expiring', label: 'Payment plan: card expiring', when: 'In the 30 days before the plan’s card expires, when it expires before the last payment.' },
  { kind: 'plan_finished', label: 'Payment plan: paid in full', when: 'The morning after the plan’s last payment.' },
];

// Made-up facts, the same shape run.js builds. Nothing here is a real family.
function sampleFacts(kind, origin, eventType) {
  const camp = eventType === 'camp_week';
  const base = {
    kind,
    eventType,
    eventName: camp ? 'Camp Celebrate 2027 — Week 1' : 'Adult Adventure Retreat 2027',
    registrationId: 'sample',
  };
  const dueOn = '2027-07-01';
  switch (kind) {
    case 'plan_upcoming':
      return { ...base, dueOn: '2027-03-01', amountCents: 12500, methodLabel: 'Visa ending 4242' };
    case 'card_expiring':
      return { ...base, cardLabel: 'Visa ending 4242', expiryMonth: 'April 2027', finalOn: '2027-06-01' };
    case 'deposit':
      return { ...base, depositCents: 10000, perPersonCents: 5000, heads: 2 };
    case 'balance':
      return { ...base, balanceCents: 45000, dueOn };
    case 'past_due':
      return { ...base, balanceCents: 45000, dueOn };
    case 'missing_details':
      return {
        ...base,
        lines: [
          {
            text: 'Support details for Sam: allergies, medications, what helps on a hard day, and an emergency contact',
            href: `${origin}/account/dashboard/`,
            action: 'Fill in',
          },
          { text: "Riley's volunteer application (where you'd like to serve)", href: `${origin}/register/volunteer`, action: 'Complete it' },
        ],
      };
    case 'confirmed':
      return { ...base, names: ['Sam', 'Riley'], balanceCents: 45000, dueOn };
    case 'off_waitlist':
      return { ...base, names: ['Sam'] };
    default:
      return base;
  }
}

// [{ kind, label, when, subject, text }] -- the plain text is what the
// family's email carries and what message_log keeps under "What it said".
export function sampleAutomaticEmails({ origin, eventType = 'camp_week' }) {
  return AUTOMATIC_EMAIL_GUIDE.map((g) => {
    const { subject, text } = composeFamilyEmail({
      origin,
      householdName: 'Sample family',
      items: [sampleFacts(g.kind, origin, eventType)],
    });
    return { ...g, subject, text };
  });
}
