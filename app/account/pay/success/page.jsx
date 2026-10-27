import BackLink from '@/components/BackLink';
import { getStripe } from '@/lib/stripe/server';
import { dollars } from '@/lib/payments';

export const metadata = { title: 'Payment received' };

// Where Stripe returns the family after checkout. The payment is actually
// recorded by the stripe-webhook Edge Function, not here -- this page just
// confirms and reads the session back to show what happened (including the
// "pending" state a bank transfer is in until it settles).
export default async function PaySuccessPage({ searchParams }) {
  const params = await searchParams;
  const sessionId = typeof params?.session_id === 'string' ? params.session_id : '';

  let amount = null;
  let pending = false;
  const stripe = getStripe();
  if (stripe && sessionId) {
    try {
      const s = await stripe.checkout.sessions.retrieve(sessionId);
      amount = s.amount_total;
      pending = s.payment_status !== 'paid';
    } catch {
      /* fall back to the generic message */
    }
  }

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-2xl mx-auto">
        {/* The account pages' header (26 Oct 2026): title left, the Back to
            dashboard pill right -- a full page load, so the dashboard shows
            this payment. */}
        {/* No wrap: a title this long pushed the pill onto a line of its own
            (27 Oct 2026); the title wraps in its own column instead. */}
        <div className="flex items-start justify-between gap-3 mb-6">
          <h1 className="min-w-0 text-3xl font-bold">
            {pending ? 'Payment on its way ⏳' : 'Thank you — payment received ✅'}
          </h1>
          <BackLink hard className="shrink-0" />
        </div>
        <div className="rounded-lg border border-neutral-200 shadow-sm bg-white p-6 sm:p-8">
          <p className="text-neutral-700">
            {amount != null ? (
              <>
                We&rsquo;ve started a payment of <strong>{dollars(amount)}</strong>.{' '}
              </>
            ) : (
              <>Your payment has been started. </>
            )}
            {pending
              ? 'Bank transfers may take a few days to clear; it will show as “pending” on your dashboard until it settles, and you don’t need to do anything else.'
              : 'It will appear on your dashboard, and a receipt is on its way.'}
          </p>
          <p className="mt-4 text-xs text-neutral-400">
            Registration payments for camp and other ministry events cover event costs (food,
            lodging, and activities) and are not tax-deductible.
          </p>
        </div>
      </div>
    </section>
  );
}
