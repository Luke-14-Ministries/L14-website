'use client';

// The ways to finish registering. Each one hands off to Stripe's hosted
// pages (no card details on our site) or to the scholarship request page.
//
// Since 26 Oct 2026 (Lawrence: the plan's details sat in a panel at the
// bottom, so choosing a card "jumps to bottom which is weird"): the payment
// plan and pay-in-full are expandable cards, one open at a time, each with
// its own details inside it; the scholarship request is a quieter line
// underneath ("de-emphasize scholarship request to bottom").

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { dollars } from '@/lib/payments';
import { formatDueDateShort } from '@/lib/events';
import { returnedFeeDisclosure } from '@/lib/plans';
import { createCheckout } from '@/app/account/dashboard/pay/actions';
import { startPaymentPlan } from './actions';
import FoldArrow from '@/components/FoldArrow';

// Module level, never inside the component (CLAUDE.md: a component defined in
// another's body remounts on every render).
// One way to pay: a header that opens and closes it (a real button, as in
// components/FoldCard.jsx), and its own details inside. Opening one by hand
// brings its header gently into view; the first draw does not scroll.
function OptionCard({ open, onToggle, title, summary, children }) {
  const bodyId = useId();
  const ref = useRef(null);
  const firstDraw = useRef(true);
  useEffect(() => {
    if (firstDraw.current) {
      firstDraw.current = false;
      return;
    }
    if (open) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);
  return (
    <div
      ref={ref}
      className={`scroll-mt-6 rounded-lg border ${open ? 'border-brand bg-brand-light/40' : 'border-neutral-300 bg-white'}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-start gap-2 p-4 text-left"
      >
        <FoldArrow open={open} className="mt-1.5" />
        <span>
          <span className="font-semibold">{title}</span>
          <span className="block text-sm text-neutral-600 mt-1">{summary}</span>
        </span>
      </button>
      <div id={bodyId} hidden={!open} className="space-y-3 border-t border-neutral-200 px-4 pb-4 pt-3">
        {open && children}
      </div>
    </div>
  );
}

// Bank or card, with the bank line and the returned-payment fee (0123) --
// the same in both cards. Bank first and the default.
// Bank first, and plainly the one we hope for (Lawrence, 26 Oct 2026: "make
// the bank preference a little stronger"): the bank account is a full-width
// choice carrying its reason; the card is a quieter text link beneath it,
// still one tap away and never hidden. Choosing the card shows it as chosen
// with a way back to the bank. Nothing here changes an amount.
function PayWith({ method, setMethod, returnedFeeCents }) {
  const bank = method === 'bank';
  return (
    <>
      <p className="text-xs font-semibold text-neutral-500">Pay with</p>
      <button
        type="button"
        onClick={() => setMethod('bank')}
        aria-pressed={bank}
        className={`w-full rounded-sm border px-4 py-3 text-left ${
          bank ? 'border-brand bg-brand-light' : 'border-neutral-300 hover:border-brand'
        }`}
      >
        <span className="block font-semibold">
          Bank account{' '}
          <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
            Recommended
          </span>
        </span>
        <span className="mt-0.5 block text-sm text-neutral-700">
          Lowest processing fee — more of your payment goes to camp.
        </span>
      </button>
      {bank ? (
        <p className="text-sm">
          <button
            type="button"
            onClick={() => setMethod('card')}
            className="text-neutral-500 underline hover:text-neutral-700"
          >
            Pay by card instead
          </button>
        </p>
      ) : (
        <p className="rounded-sm border border-brand bg-brand-light px-4 py-2 text-sm">
          <span className="font-semibold">Card</span> selected.{' '}
          <button type="button" onClick={() => setMethod('bank')} className="text-brand underline">
            Use a bank account instead (recommended)
          </button>
        </p>
      )}
      {/* Lawrence, 22 Oct 2026: say it beside the choice, whichever is
          picked, and without a dollar figure. */}
      <p className="text-sm text-neutral-600">
        <strong>Paying from your bank account costs the camp less in processing fees than a card.</strong>{' '}
        Thank you for choosing it — it extends the impact of Luke 14 Ministries.
      </p>
      {/* 0123: the returned-payment fee is disclosed BEFORE a family chooses
          a bank payment, and only when the event has one. The amount shown is
          the one the checkout carries and the only one that can be charged. */}
      {returnedFeeDisclosure(returnedFeeCents) && (
        <p className="text-xs text-neutral-500">{returnedFeeDisclosure(returnedFeeCents)}</p>
      )}
    </>
  );
}

function Pill({ value, cur, set, children }) {
  return (
    <label
      className={`flex-1 cursor-pointer rounded-sm border px-3 py-2 text-sm text-center ${
        cur === value ? 'border-brand bg-brand-light font-semibold' : 'border-neutral-300'
      }`}
    >
      <input type="radio" className="sr-only" checked={cur === value} onChange={() => set(value)} />
      {children}
    </label>
  );
}

export default function FinishChoices({
  registrationId,
  balanceCents,
  payInFullCents,
  earlySavingCents,
  earlyEndsOn,
  depositCents,
  canPlan,
  preview,
  planPending,
  // The event's returned-bank-payment fee (0123); 0 = none, and nothing is said.
  returnedFeeCents = 0,
}) {
  const [route, setRoute] = useState(canPlan ? 'plan' : 'full');
  const [schedule, setSchedule] = useState('monthly');
  // Bank first and the default, as everywhere else on the site: its fee is a
  // fraction of a card's (the line under the pills says so, 22 Oct 2026).
  const [method, setMethod] = useState('bank');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const plan = preview?.[schedule];
  const early = earlySavingCents > 0;

  // One card open at a time; pressing the open one's header closes it.
  function toggle(next) {
    setError('');
    setRoute((cur) => (cur === next ? null : next));
  }

  function go() {
    setError('');
    start(async () => {
      const res =
        route === 'full'
          ? await createCheckout({ registrationId, kind: 'balance', method, coverFee: false })
          : await startPaymentPlan({ registrationId, schedule, method, agreed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      window.location.href = res.url;
    });
  }

  return (
    <div className="space-y-3">
      {early && (
        <p className="rounded-sm border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-900">
          You registered early, so you save <strong>{dollars(earlySavingCents)}</strong>
          {earlyEndsOn ? ` (early registration ends ${formatDueDateShort(earlyEndsOn)})` : ''} when you
          pay in full or set up a payment plan.
        </p>
      )}
      {planPending && (
        <p className="rounded-sm border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          A payment plan was started but the deposit didn&rsquo;t go through, so it isn&rsquo;t set up
          yet. You can try again below.
        </p>
      )}

      {canPlan && (
        <OptionCard
          open={route === 'plan'}
          onToggle={() => toggle('plan')}
          title="Set up a payment plan"
          summary={`Pay the ${dollars(depositCents)} deposit now, and the rest is charged automatically to the card or bank account you save, ending on the due date.`}
        >
          {plan && (
            <>
              <p className="text-xs font-semibold text-neutral-500">How often</p>
              <div className="flex gap-2">
                <Pill value="monthly" cur={schedule} set={setSchedule}>Monthly</Pill>
                <Pill value="semi_monthly" cur={schedule} set={setSchedule}>Twice a month</Pill>
              </div>
              <div className="text-sm">
                <p>
                  Today: <strong>{dollars(depositCents)}</strong> deposit
                </p>
                <p>
                  Then{' '}
                  <strong>
                    {plan.dates.length} {plan.dates.length === 1 ? 'payment' : 'payments'} of about{' '}
                    {dollars(plan.each)}
                  </strong>
                  {plan.dates.length > 0 && (
                    <>
                      , from {formatDueDateShort(plan.dates[0])} to{' '}
                      {formatDueDateShort(plan.dates[plan.dates.length - 1])}
                    </>
                  )}
                  .
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  Each payment is worked out on the day from what you still owe, so a scholarship
                  or an extra payment makes the rest smaller.
                </p>
              </div>
            </>
          )}
          <PayWith method={method} setMethod={setMethod} returnedFeeCents={returnedFeeCents} />
          {plan && (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>{plan.consent}</span>
            </label>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="button"
            onClick={go}
            disabled={pending || !agreed}
            className="btn-primary py-2! disabled:opacity-50"
          >
            {pending ? 'Opening secure checkout…' : `Pay ${dollars(depositCents)} deposit and start plan`}
          </button>
        </OptionCard>
      )}
      <OptionCard
        open={route === 'full'}
        onToggle={() => toggle('full')}
        title={`Pay in full now — ${dollars(payInFullCents)}`}
        summary={
          early
            ? `Includes your ${dollars(earlySavingCents)} early-registration discount.`
            : 'One payment, and you are done.'
        }
      >
        <PayWith method={method} setMethod={setMethod} returnedFeeCents={returnedFeeCents} />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          type="button"
          onClick={go}
          disabled={pending}
          className="btn-primary py-2! disabled:opacity-50"
        >
          {pending ? 'Opening secure checkout…' : `Pay ${dollars(payInFullCents)}`}
        </button>
      </OptionCard>

      {/* The quieter way (26 Oct 2026): still one click to the request page. */}
      <p className="pt-2 text-sm text-neutral-600">
        Need help with the fee?{' '}
        <Link href={`/account/scholarship/${registrationId}/`} className="font-semibold text-brand underline">
          Request a scholarship
        </Link>{' '}
        — it will not affect anyone&rsquo;s place, and staff will be in touch.
      </p>

      {!canPlan && balanceCents > 0 && (
        <p className="text-xs text-neutral-500">
          A payment plan needs at least a week before the balance is due, so it isn&rsquo;t offered
          for this registration.
        </p>
      )}
    </div>
  );
}
