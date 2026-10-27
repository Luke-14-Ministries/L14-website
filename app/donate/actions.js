'use server';

// Creates a Stripe Checkout Session for a donation.
//
// Unlike camp payments, a gift needs NO login -- a donor who has never touched
// the registration system can give. If someone IS logged in, the gift is linked
// to their profile so it appears in their dashboard giving history. The
// stripe-webhook Edge Function records the gift once the money moves.
//
// "Cover the fee" on a GIFT simply increases the gift -- it is all donation,
// all deductible -- so the total is recorded as one amount rather than being
// tracked separately the way camp-payment fee covers are.

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe/server';
import { coverFeeCents } from '@/lib/payments';
import { verifyTurnstile } from '@/lib/turnstile';

// NOT exported: a 'use server' file may only export async functions -- any
// other export crashes the page at runtime. The form keeps its own copy of
// this list; this one is the server-side validation whitelist.
const FUNDS = [
  'General Operating Fund',
  'Camp Celebrate',
  'Luke 14 Party',
  'The Hazelnut Movement',
  'Wheels for Kenya',
];

// The largest gift taken online (security audit L2, 18 Oct 2026). Above it,
// card testers get an easy probe and Stripe answers with its own raw error;
// a gift that size is a conversation with the ministry anyway.
const MAX_GIFT_CENTS = 50_000_00;

export async function createDonationCheckout({ amountCents, fund, method, coverFee, captchaToken }) {
  if (method !== 'card' && method !== 'bank') {
    return { ok: false, error: 'Please choose a payment method.' };
  }
  const base = Math.round(Number(amountCents));
  if (!Number.isFinite(base) || base < 100) {
    return { ok: false, error: 'Please enter a gift of at least $1.00.' };
  }
  if (base > MAX_GIFT_CENTS) {
    return {
      ok: false,
      error: 'For a gift over $50,000, please contact the ministry and we will arrange it with you directly.',
    };
  }
  const chosenFund = FUNDS.includes(fund) ? fund : FUNDS[0];
  // After the amount checks, so the cap's own sentence shows even where Stripe
  // is not configured (a local test machine).
  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, error: 'Online giving is not switched on yet. Please check back soon.' };
  }

  // Logged in? Link the gift to them (and let Stripe pre-fill their email).
  // Not logged in is fine -- Stripe collects the email at checkout.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const fee = coverFee ? coverFeeCents(base, method) : 0;
  const total = base + fee; // all of it is the gift

  const h = await headers();
  // The bot check, as on the contact form (lib/turnstile.js). Gift checkout
  // needs no login, so without it the page is a free card-testing endpoint.
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  const check = await verifyTurnstile(captchaToken, ip);
  if (!check.ok) {
    return { ok: false, error: 'That check timed out. Please tick the box again and press Give.', retryCaptcha: true };
  }

  const host = h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  const origin = host ? `${proto}://${host}` : '';

  const metadata = {
    gift: '1',
    fund: chosenFund,
    base_cents: String(total), // the whole amount is the donation
    method,
    profile_id: user?.id ?? '',
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      allowed_payment_method_types: method === 'bank' ? ['us_bank_account'] : ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: total,
            product_data: { name: `Donation — ${chosenFund}` },
          },
        },
      ],
      ...(user?.email ? { customer_email: user.email } : {}),
      success_url: `${origin}/donate/thank-you/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/donate/`,
      metadata,
      payment_intent_data: { metadata },
    });
    return { ok: true, url: session.url };
  } catch (e) {
    // The detail to the log; the donor gets words (audit L4).
    console.error('createDonationCheckout:', e?.type, e?.code, e?.message);
    return { ok: false, error: 'We could not start the gift. Please try again in a minute.' };
  }
}
