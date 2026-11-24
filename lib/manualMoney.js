// Hand-recorded money (Record payment, Record gift): the checks both staff
// actions share, so a payment and a gift are held to the same rules.

import { todayInMorristown } from '@/lib/events';

// Checks on a hand-typed amount and date (security review, 23 Nov 2026).
// The date box is a date picker, but the action is a public endpoint and a
// typed "2062-11-23" or "23/11" would have been stored as sent. A date ahead
// of today is a typo (money that arrived has arrived), and an amount above
// $50,000 is far more likely an extra zero than a real check; Lawrence can
// raise MAX_MANUAL_CENTS if a gift that large ever comes in.
export const MAX_MANUAL_CENTS = 50_000_00;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function receivedOnProblem(receivedOn) {
  if (!receivedOn) return null;
  // The round trip catches February 31st, which Date.parse quietly rolls on.
  const parsed = DAY.test(receivedOn) ? new Date(`${receivedOn}T12:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== receivedOn) {
    return 'The date received must be a real date (YYYY-MM-DD).';
  }
  if (receivedOn > todayInMorristown()) return 'The date received can’t be in the future.';
  return null;
}

// The form's one-time key, as 0107 does for refunds: the database keeps it
// unique (0182), so a doubled press records one row.
export const requestKeyOf = (k) => (typeof k === 'string' && k ? k.slice(0, 100) : null);
