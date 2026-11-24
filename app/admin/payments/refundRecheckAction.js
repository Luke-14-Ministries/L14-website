'use server';

// "Re-check with Stripe" for a refund stuck as pending (Lawrence, 26 Oct 2026).
//
// A bank refund settles days after it is sent, and the refund webhook
// (supabase/functions/stripe-refund-webhook) records the outcome when Stripe
// tells it. When that message never arrives -- an endpoint not subscribed to
// refund.updated, a delivery lost -- the row stays 'pending' for ever and the
// balance counts money that may never have left (isStaleRefund flags it after
// STALE_REFUND_DAYS). This asks Stripe directly for the refund's status and
// records it the way the webhook would: the status only.
//
// Why no new database function: a signed-in staff member with Payments write
// can already change a PENDING refund's status (payment_refunds_update, 0101;
// payment_refunds_guard, 0111 -- a settled status is never edited, the amount
// and the Stripe reference never change, the over-refund check still runs).
// That is exactly the narrow path refundPayment uses to record what Stripe
// returned. The triggers do the rest: payments.status follows the refunds on
// file (settle_payment_after_refund) and money_change_log records the change.
// The Stripe secret stays on the server (lib/stripe/server.js); nothing here
// reaches the browser but the sentence.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { getStripe } from '@/lib/stripe/server';
import { dayInMorristown } from '@/lib/events';

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

// 23 Nov 2026: the messages below are plain sentences with no Stripe ids or
// status codes; ids go to the server log when something is wrong.
const STATUS_WORD = { succeeded: 'Refunded', failed: 'Failed', canceled: 'Canceled' };

// Stripe's refund statuses -> ours, as the webhook maps them.
function mapStatus(s) {
  if (s === 'succeeded' || s === 'failed' || s === 'canceled') return s;
  return 'pending'; // 'pending', 'requires_action', anything new
}

export async function recheckRefund(refundId) {
  const staff = await getStaff();
  if (!staff || !can(staff, 'write:payments')) {
    return { ok: false, error: 'Re-checking a refund needs edit access to Payments.' };
  }
  if (typeof refundId !== 'string' || !refundId) return { ok: false, error: 'No refund given.' };

  const supabase = await createClient();
  const { data: row, error: rowError } = await supabase
    .from('payment_refunds')
    .select('id, status, stripe_refund_id, amount_cents, created_at, registration_id, payment_id, payments ( stripe_payment_intent_id, amount_cents )')
    .eq('id', refundId)
    .maybeSingle();
  if (rowError) return { ok: false, error: `The refund could not be read: ${rowError.message}` };
  if (!row) return { ok: false, error: 'That refund was not found.' };
  if (row.status !== 'pending') {
    return { ok: true, status: row.status, message: `This refund is already marked ${STATUS_WORD[row.status] ?? row.status}. Nothing to re-check.` };
  }
  if (!row.stripe_refund_id) {
    return {
      ok: false,
      error: 'This refund has no link to Stripe on file, so Stripe can’t be asked about it. Look for it on the payment in Stripe.',
    };
  }

  const stripe = getStripe();
  if (!stripe) {
    console.error('recheckRefund: STRIPE_SECRET_KEY is not set.');
    return { ok: false, error: 'Card payments aren’t set up on this site, so Stripe can’t be asked. Tell an administrator.' };
  }

  let refund;
  try {
    refund = await stripe.refunds.retrieve(row.stripe_refund_id);
  } catch (e) {
    console.error('recheckRefund stripe:', e?.type, e?.code, e?.message);
    return {
      ok: false,
      error: 'Stripe didn’t answer. Try again in a few minutes, or look the refund up in Stripe.',
    };
  }

  // The answer must be about this refund's payment: never record Stripe's word
  // about one payment on another's row.
  const intent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  const expected = row.payments?.stripe_payment_intent_id ?? null;
  if (expected && intent && intent !== expected) {
    console.error('recheckRefund: refund belongs to another payment', { refund: row.stripe_refund_id, intent, expected });
    return {
      ok: false,
      error: 'Stripe has this refund on a different payment, so nothing was recorded. Tell an administrator.',
    };
  }

  const status = mapStatus(refund.status);
  if (status === 'pending') {
    return {
      ok: true,
      status,
      message: `Stripe says this refund is still on its way (sent ${dayInMorristown(row.created_at)}). Nothing changed.`,
    };
  }

  // Only a row that is still pending moves; the guard refuses anything else.
  const { data: moved, error: moveError } = await supabase
    .from('payment_refunds')
    .update({ status })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id');
  if (moveError) {
    console.error('recheckRefund record:', moveError.message, { refund: row.stripe_refund_id });
    return {
      ok: false,
      error: `Stripe says this refund ${status === 'succeeded' ? 'went through' : 'didn’t go through'}, but the site couldn’t record it. Try again, and tell an administrator if it keeps happening.`,
    };
  }
  if (!moved || moved.length === 0) {
    return { ok: true, status, message: 'Someone recorded this refund a moment ago. Reload to see it.' };
  }

  revalidatePath('/admin/payments');
  revalidatePath(`/admin/registrations/${row.registration_id}`);
  revalidatePath('/account/dashboard');

  if (status === 'succeeded') return { ok: true, status, message: 'Stripe says this refund went through. It is now marked Refunded.' };
  const why = refund.failure_reason ? ` (${String(refund.failure_reason).replace(/_/g, ' ')})` : '';
  const what = status === 'canceled' ? 'was canceled' : 'didn’t go through';
  return {
    ok: true,
    status,
    message: `Stripe says this refund ${what}${why}. That’s recorded, and ${money(row.amount_cents)} can be refunded again.`,
  };
}
