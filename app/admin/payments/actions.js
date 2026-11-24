'use server';

// Recording a check or cash CAMP payment that arrived by hand. Runs as the
// signed-in registrar; the payments_manual_insert RLS policy is the real gate
// (registrars only, and only the check/cash/other methods -- card and bank rows
// come exclusively from the Stripe webhook). Donations are recorded on the
// separate Giving page, behind the giving permission.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { todayInMorristown } from '@/lib/events';
import { withReason } from '@/lib/dbErrors';
import { MAX_MANUAL_CENTS, receivedOnProblem, requestKeyOf } from '@/lib/manualMoney';

const MANUAL_METHODS = ['check', 'cash', 'other'];

export async function recordManualPayment({ registrationId, amountCents, method, receivedOn, note, requestKey }) {
  const staff = await getStaff();
  if (!can(staff, 'write:payments')) {
    return { ok: false, error: 'You do not have permission to record payments.' };
  }
  if (!registrationId) return { ok: false, error: 'Please choose a registration.' };
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

  const supabase = await createClient();

  // Who the payment is FROM, frozen at this moment. A check is written by a
  // person, and the household's contact details are theirs to change -- so
  // reading them back next year answers "who are they now", not "who paid
  // this". Migration 0054 has the full reasoning; the short version is that a
  // family changed their email and their Stripe record became unmatchable.
  //
  // Best effort on purpose: a missing contact must never stop a registrar
  // recording money that has arrived.
  let payerEmail = null;
  let payerName = null;
  try {
    const { data: reg, error: regError } = await supabase
      .from('registrations')
      .select(
        'households!registrations_household_id_fkey(display_name, email, primary_contact:people!households_primary_contact_person_id_fkey(first_name, last_name, email))'
      )
      .eq('id', registrationId)
      .maybeSingle();
    // Still best effort (above), but a failed read is logged, not silent.
    if (regError) console.error('recordPayment payer:', regError.message);
    const hh = reg?.households ?? null;
    const pc = hh?.primary_contact ?? null;
    payerEmail = pc?.email ?? hh?.email ?? null;
    payerName = pc ? [pc.first_name, pc.last_name].filter(Boolean).join(' ') : (hh?.display_name ?? null);
  } catch {
    // Leave both null. "Not recorded" is honest; a guess is not.
  }

  const { error } = await supabase.from('payments').insert({
    registration_id: registrationId,
    amount_cents: amt,
    method,
    status: 'succeeded',
    received_on: receivedOn || todayInMorristown(),
    recorded_by: staff.userId,
    payer_email: payerEmail || null,
    payer_name: payerName || null,
    note: note?.trim() ? note.trim() : null,
    request_key: requestKeyOf(requestKey),
  });
  if (error) {
    // 23505 on request_key: this press was already recorded (0182). The form
    // keeps its key for that answer, so pressing again never adds a second.
    if (error.code === '23505') {
      return { ok: false, duplicate: true, error: 'This was already recorded. Refresh the page.' };
    }
    return { ok: false, error: withReason('The payment could not be recorded.', error) };
  }

  revalidatePath('/admin/payments');
  revalidatePath('/admin');
  return { ok: true };
}
