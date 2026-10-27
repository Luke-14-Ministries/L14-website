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

// Stripe's refund statuses -> ours, as the webhook maps them.
function mapStatus(s) {
  if (s === 'succeeded' || s === 'failed' || s === 'canceled') return s;
  return 'pending'; // 'pending', 'requires_action', anything new
}

export async function recheckRefund(refundId) {
  const staff = await getStaff();
  if (!staff || !can(staff, 'write:payments')) {
    return { ok: false, error: 'Only staff with Payments write can re-check a refund.' };
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
    return { ok: true, status: row.status, message: `Already ${row.status} here — nothing to re-check.` };
  }
  if (!row.stripe_refund_id) {
    return {
      ok: false,
      error: 'This refund has no Stripe reference on file, so Stripe cannot be asked about it. Look for it on the payment in Stripe.',
    };
  }

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: 'Stripe is not configured on this site, so it cannot be asked.' };

  let refund;
  try {
    refund = await stripe.refunds.retrieve(row.stripe_refund_id);
  } catch (e) {
    console.error('recheckRefund stripe:', e?.type, e?.code, e?.message);
    return {
      ok: false,
      error: `Stripe could not be asked about ${row.stripe_refund_id}${e?.code ? ` (${e.code})` : ''}. Try again, or look it up in Stripe.`,
    };
  }

  // The answer must be about this refund's payment: never record Stripe's word
  // about one payment on another's row.
  const intent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  const expected = row.payments?.stripe_payment_intent_id ?? null;
  if (expected && intent && intent !== expected) {
    return {
      ok: false,
      error: `Stripe's refund ${row.stripe_refund_id} belongs to a different payment, so nothing was recorded. Tell an administrator.`,
    };
  }

  const status = mapStatus(refund.status);
  if (status === 'pending') {
    return {
      ok: true,
      status,
      message: `Stripe says: still pending at Stripe (since ${dayInMorristown(row.created_at)}). Nothing changed here.`,
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
      error: `Stripe says ${refund.status}, but it could not be recorded: ${moveError.message}`,
    };
  }
  if (!moved || moved.length === 0) {
    return { ok: true, status, message: 'Someone recorded this refund a moment ago — reload to see it.' };
  }

  revalidatePath('/admin/payments');
  revalidatePath(`/admin/registrations/${row.registration_id}`);
  revalidatePath('/account/dashboard');

  if (status === 'succeeded') return { ok: true, status, message: 'Stripe says: succeeded — recorded.' };
  const why = refund.failure_reason ? `: ${String(refund.failure_reason).replace(/_/g, ' ')}` : '';
  return {
    ok: true,
    status,
    message: `Stripe says: ${status}${why} — recorded; ${money(row.amount_cents)} can be refunded again.`,
  };
}
