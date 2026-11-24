'use server';

// Recording a mailed check or cash DONATION. Runs as the signed-in staff
// member; the gifts_manual_insert policy (migration 0010) is the real gate --
// it requires the giving grant (admin, or can_view_giving) and allows only the
// check/cash/other methods. Online gifts come exclusively from the Stripe
// webhook.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { todayInMorristown } from '@/lib/events';
import { withReason } from '@/lib/dbErrors';
import { MAX_MANUAL_CENTS, receivedOnProblem, requestKeyOf } from '@/lib/manualMoney';
import { DONATION_FUNDS } from '@/lib/funds';

const MANUAL_METHODS = ['check', 'cash', 'other'];

export async function recordManualGift({ donorName, email, amountCents, fund, method, receivedOn, note, requestKey }) {
  const staff = await getStaff();
  if (!can(staff, 'write:giving')) {
    return { ok: false, error: 'You don’t have access to record gifts.' };
  }
  if (!MANUAL_METHODS.includes(method)) {
    return { ok: false, error: 'Method must be check, cash, or other.' };
  }
  const amt = Math.round(Number(amountCents));
  if (!Number.isFinite(amt) || amt < 1) {
    return { ok: false, error: 'Please enter an amount greater than zero.' };
  }
  if (amt > MAX_MANUAL_CENTS) {
    return { ok: false, error: 'That amount is over $50,000, which looks like a typo. Check it and try again.' };
  }
  const dateProblem = receivedOnProblem(receivedOn);
  if (dateProblem) return { ok: false, error: dateProblem };
  // One of the Donate page's funds (lib/funds.js), the list the form offers;
  // blank is the first, as before. A typed fund would split the Giving
  // page's totals and the QuickBooks export by a misspelling.
  const chosenFund = fund || DONATION_FUNDS[0];
  if (!DONATION_FUNDS.includes(chosenFund)) {
    return { ok: false, error: 'Choose one of the funds on the list.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('gifts').insert({
    donor_name: donorName?.trim() || null,
    email: email?.trim() || null,
    amount_cents: amt,
    fund: chosenFund,
    method,
    status: 'succeeded',
    received_on: receivedOn || todayInMorristown(),
    recorded_by: staff.userId,
    note: note?.trim() ? note.trim() : null,
    request_key: requestKeyOf(requestKey),
  });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, duplicate: true, error: 'This was already recorded. Refresh the page.' };
    }
    return { ok: false, error: withReason('The gift could not be recorded.', error) };
  }

  revalidatePath('/admin/giving');
  return { ok: true };
}
