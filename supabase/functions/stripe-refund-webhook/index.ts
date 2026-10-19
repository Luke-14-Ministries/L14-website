// Stripe refund webhook: keeps the ministry's books true when a refund is
// issued anywhere OTHER than our own staff screen.
//
// verify_jwt is FALSE, deliberately and necessarily. Stripe does not send a
// Supabase JWT; it signs the raw body and sends the signature in a header.
// Authentication here is stripe.webhooks.constructEventAsync below, which
// rejects anything not signed with our webhook secret. Leaving verify_jwt on
// would 401 every genuine Stripe call while protecting nothing extra. The
// payment webhook next door is configured the same way for the same reason.
//
// WHY THIS IS A SEPARATE FUNCTION FROM stripe-webhook
// The payment webhook works and money depends on it. Refunds are a distinct
// concern with a distinct failure mode, so they get their own endpoint rather
// than edits to a working, load-bearing path. It costs one extra endpoint in
// the Stripe dashboard and buys the payment path staying untouched.
//
// WHY IT MATTERS AT ALL
// Our own refund action already records what it issues, so in the normal case
// this function only confirms what is already true (it is idempotent -- see
// below). It earns its keep in two cases the staff screen cannot cover:
//
//   1. A refund issued DIRECTLY IN THE STRIPE DASHBOARD. Without this, the
//      money leaves the bank and the ministry's balance never learns -- the
//      family still appears to owe less than they do, and nobody finds out
//      until someone reconciles by hand.
//   2. A refund that FAILS LATER. Bank refunds are asynchronous: 'pending'
//      today can become 'failed' next week. registration_balances counts
//      pending and succeeded refunds, so a silent failure leaves a balance
//      that is permanently wrong in the family's favour.
//
// IDEMPOTENCY: payment_refunds.stripe_refund_id is UNIQUE. This updates an
// existing row when it finds one and inserts otherwise, so Stripe's retries
// and our own staff-issued refunds converge on a single row. It deliberately
// does NOT overwrite `reason` or `note` on a row that already exists: those
// hold a registrar's own words, which are worth more than Stripe's enum.
//
// GRANTS: service_role bypasses RLS but NOT table GRANTs. payment_refunds had
// none until migration 0054, so every delivery was refused at the table while
// this function dutifully returned 200 -- silent from both ends. If a future
// edge function writes nothing and reports nothing, check GRANTs first.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe';
import { createClient } from 'jsr:@supabase/supabase-js@2';

function fail(where: string, message: string, status: number) {
  console.error(`[stripe-refund-webhook] ${where}: ${message}`);
  return new Response(`${where}: ${message}`, { status });
}

function ministryToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Stripe's refund statuses -> ours. 'requires_action' is deliberately mapped
// to pending: the money has not moved, but it is still expected to.
function mapStatus(s: string | null | undefined): string {
  switch (s) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'canceled';
    case 'pending':
    case 'requires_action':
      return 'pending';
    default:
      return 'pending';
  }
}

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  // Its own endpoint means its own signing secret. STRIPE_WEBHOOK_SECRET is
  // accepted as a fallback only so a half-finished setup fails loudly at
  // signature verification rather than silently accepting unsigned calls.
  const webhookSecret =
    Deno.env.get('STRIPE_REFUND_WEBHOOK_SECRET') ?? Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey) return fail('config', 'STRIPE_SECRET_KEY is not set', 500);
  if (!webhookSecret) return fail('config', 'STRIPE_REFUND_WEBHOOK_SECRET is not set', 500);

  const stripe = new Stripe(stripeKey);
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig ?? '', webhookSecret);
  } catch (e) {
    return fail('signature', (e as Error).message, 400);
  }

  const HANDLED = new Set([
    'charge.refunded',
    'refund.created',
    'refund.updated',
    'refund.failed',
    'charge.refund.updated',
  ]);
  if (!HANDLED.has(event.type)) {
    return new Response('ignored', { status: 200 });
  }

  try {
    // Two shapes arrive here. charge.refunded carries a Charge with its
    // refunds nested; the refund.* events carry a single Refund. Normalising
    // first means the logic below is written once.
    let refunds: Stripe.Refund[] = [];
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      refunds = (charge.refunds?.data ?? []) as Stripe.Refund[];
      // A charge with no expanded refunds still tells us something happened;
      // fetch them rather than dropping the event on the floor.
      if (refunds.length === 0 && charge.id) {
        const list = await stripe.refunds.list({ charge: charge.id, limit: 100 });
        refunds = list.data;
      }
    } else {
      refunds = [event.data.object as Stripe.Refund];
    }

    if (refunds.length === 0) {
      return new Response('no refunds in event', { status: 200 });
    }

    let handled = 0;
    for (const r of refunds) {
      const intentId =
        typeof r.payment_intent === 'string' ? r.payment_intent : r.payment_intent?.id;
      if (!intentId || !r.id) continue;

      const { data: payment } = await admin
        .from('payments')
        .select('id, registration_id, amount_cents, fee_cover_cents, status')
        .eq('stripe_payment_intent_id', intentId)
        .maybeSingle();

      if (!payment) {
        // Very likely a refunded DONATION (gifts live in their own table) or a
        // payment made outside this system. Logged, not treated as an error --
        // returning non-200 would make Stripe retry forever.
        console.log(
          `[stripe-refund-webhook] no event payment for intent ${intentId} (refund ${r.id}) - ignoring`
        );
        continue;
      }

      const status = mapStatus(r.status);

      let { data: existing } = await admin
        .from('payment_refunds')
        .select('id, status')
        .eq('stripe_refund_id', r.id)
        .maybeSingle();

      // A refund from our own staff screen reserves its row BEFORE calling
      // Stripe and names it in metadata (0107). If this event beats the screen
      // to filling in the Stripe id, fill that row -- never add a second one,
      // which would count the refund twice on the family's balance.
      const rowId = (r.metadata as Record<string, string> | null)?.refund_row_id;
      if (!existing && rowId) {
        const { data: reserved } = await admin
          .from('payment_refunds')
          .select('id, status, stripe_refund_id')
          .eq('id', rowId)
          .eq('payment_id', payment.id)
          .maybeSingle();
        if (reserved && !reserved.stripe_refund_id) {
          const { error } = await admin
            .from('payment_refunds')
            .update({ stripe_refund_id: r.id, status })
            .eq('id', reserved.id);
          if (error) return fail('refund-fill', error.message, 500);
          existing = { id: reserved.id, status };
        }
      }

      if (existing) {
        // Only the things Stripe is authoritative about. `reason` and `note`
        // are left alone: a registrar's sentence beats Stripe's enum.
        if (existing.status !== status) {
          const { error } = await admin
            .from('payment_refunds')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          if (error) return fail('refund-update', error.message, 500);
          console.log(
            `[stripe-refund-webhook] refund ${r.id}: ${existing.status} -> ${status}`
          );
        }
      } else {
        // Issued in the Stripe dashboard. Stripe's amount can include the
        // family's processing-fee contribution, which we keep in its own
        // column; the part beyond what is left of the payment is fee cover
        // (audit M3). Otherwise a full dashboard refund of payment + fee was
        // refused by the over-refund guard and never recorded.
        const { data: prior } = await admin
          .from('payment_refunds')
          .select('amount_cents, fee_cover_cents, status')
          .eq('payment_id', payment.id);
        const live = (prior ?? []).filter((x) => x.status === 'pending' || x.status === 'succeeded');
        const baseLeft = Math.max(
          0,
          (payment.amount_cents ?? 0) - live.reduce((t, x) => t + (x.amount_cents ?? 0), 0)
        );
        const feeLeft = Math.max(
          0,
          (payment.fee_cover_cents ?? 0) - live.reduce((t, x) => t + (x.fee_cover_cents ?? 0), 0)
        );
        const base = Math.min(r.amount, baseLeft) || r.amount;
        const fee = Math.min(r.amount - Math.min(r.amount, baseLeft), feeLeft);
        const { error } = await admin.from('payment_refunds').insert({
          payment_id: payment.id,
          registration_id: payment.registration_id,
          amount_cents: base,
          fee_cover_cents: fee,
          status,
          method: 'stripe',
          // `reason` is printed on the FAMILY's dashboard, so it is written
          // for them: they do not know the ministry uses Stripe and should not
          // learn it from a refund line (26 Aug). The fact that this row
          // appeared without anyone using our screen -- which is exactly what a
          // registrar will find surprising -- lives in `note` just below, and
          // the staff view prints that.
          reason: 'Refund issued by camp staff',
          note: `Recorded automatically from Stripe (${r.reason ?? 'no reason given'}).`,
          stripe_refund_id: r.id,
          refunded_on: ministryToday(),
        });
        if (error) {
          // The over-refund guard (migration 0044) can legitimately refuse
          // this. That means Stripe and our records genuinely disagree, which
          // a human has to look at -- so say so loudly and do NOT retry.
          // ALERT is the word to search the function's logs for.
          console.error(
            `[stripe-refund-webhook] ALERT could not record refund ${r.id} (${r.amount} cents) for payment ${payment.id}: ${error.message}`
          );
          continue;
        }
        console.log(
          `[stripe-refund-webhook] recorded ${status} refund of ${r.amount} cents (${r.id})`
        );
      }

      // Keep the payment row honest about whether the ministry still holds
      // this money. Recomputed from the refunds actually on file rather than
      // from this one event, so partial refunds add up correctly.
      const { data: allRefunds } = await admin
        .from('payment_refunds')
        .select('amount_cents, status')
        .eq('payment_id', payment.id);
      const refundedTotal = (allRefunds ?? [])
        .filter((x) => x.status === 'pending' || x.status === 'succeeded')
        .reduce((s, x) => s + (x.amount_cents ?? 0), 0);
      const fullyRefunded = refundedTotal >= (payment.amount_cents ?? 0);
      // Only between received and refunded. A payment still clearing
      // ('processing', a bank debit refunded before it landed) is not made
      // "received" by a refund event; the payment webhook settles it.
      if (payment.status === 'succeeded' || payment.status === 'refunded') {
        const next = fullyRefunded ? 'refunded' : 'succeeded';
        if (next !== payment.status) {
          const { error } = await admin.from('payments').update({ status: next }).eq('id', payment.id);
          if (error) return fail('payment-status', error.message, 500);
        }
      }

      handled += 1;
    }

    return new Response(`ok (${handled} refund(s))`, { status: 200 });
  } catch (e) {
    return fail('handler', String((e as Error)?.message ?? e), 500);
  }
});
