'use client';

// A family's payment plan on their dashboard: what is saved, what comes next,
// and a way to change the card or bank account. Changing it opens Stripe's
// own page -- no card details are ever typed into our site. Since 27 Oct
// 2026 the family can also cancel it (0135), from a link beside its status.

import { useState, useTransition } from 'react';
import { dollars } from '@/lib/payments';
import { formatDueDateShort } from '@/lib/events';
import {
  SCHEDULE_LABEL,
  PLAN_STATUS_LABEL,
  planHasProblem,
  planFailingSince,
  setAsideAfterFailing,
  declineReason,
} from '@/lib/plans';
import { updatePlanPaymentMethod, cancelPaymentPlan } from '@/app/account/finish/[registrationId]/actions';

// The status as a pill (Lawrence, 27 Oct 2026: "active should be highlighted
// in green"). Stopped is red, as the box around it is.
const STATUS_PILL = {
  active: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  completed: 'bg-green-100 text-green-800',
};

export default function PlanPanel({ registrationId, plan, installments, balanceCents }) {
  const [changing, setChanging] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [method, setMethod] = useState('bank');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const upcoming = (installments ?? []).filter((i) => ['scheduled', 'failed', 'processing'].includes(i.status));
  const next = upcoming[0];
  // The same answer as the dashboard's "Needs:" chip (lib/plans.js).
  const failed = planHasProblem({ ...plan, payment_installments: installments });
  // A failure set aside when staff resumed the plan (27 Oct 2026): nothing
  // retries it, and the card that failed is still the one on file.
  const setAside = planFailingSince({ ...plan, payment_installments: installments })?.setAside
    ? (installments ?? []).filter(setAsideAfterFailing).pop()
    : null;
  // The real amount is worked out on the day from the balance, so the
  // estimate shown is the balance shared across what is left.
  const left = upcoming.filter((i) => i.status !== 'processing').length;
  const each = left > 0 ? Math.ceil(Math.max(0, balanceCents ?? 0) / left) : 0;
  const canChange = ['active', 'paused', 'failed'].includes(plan.status);

  function go() {
    setError('');
    start(async () => {
      const res = await updatePlanPaymentMethod({ registrationId, method });
      if (!res.ok) return setError(res.error);
      window.location.href = res.url;
    });
  }

  function cancelPlan() {
    setError('');
    start(async () => {
      const res = await cancelPaymentPlan({ registrationId });
      if (!res.ok) return setError(res.error);
      // The dashboard's pills and buttons all read the plan; reload them.
      window.location.reload();
    });
  }

  return (
    <div
      // The dashboard's payment-problem banner links here (27 Oct 2026).
      id={`plan-${registrationId}`}
      className={`mt-4 scroll-mt-6 rounded-sm border px-4 py-3 text-sm ${
        failed ? 'border-red-300 bg-red-50 text-red-900' : 'border-neutral-200 bg-neutral-50'
      }`}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-semibold">
          Payment plan · {SCHEDULE_LABEL[plan.schedule] ?? plan.schedule} ·
        </span>
        {/* A charge failing while the plan still retries is not "Active" in
            green inside the red box: it says what is happening. */}
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            failed ? 'bg-red-100 text-red-800' : STATUS_PILL[plan.status] ?? 'bg-neutral-200 text-neutral-700'
          }`}
        >
          {failed && plan.status === 'active' ? 'Payment failed — retrying' : PLAN_STATUS_LABEL[plan.status] ?? plan.status}
        </span>
        {canChange && !confirmCancel && (
          <>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="text-neutral-600 underline hover:text-neutral-800"
            >
              Cancel payment plan
            </button>
          </>
        )}
      </p>
      {confirmCancel && (
        <div className="mt-2 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          <p className="font-semibold">Stop this payment plan?</p>
          <p className="mt-1">
            No more automatic payments will be taken. Nothing already paid is refunded, and what is
            still owed{balanceCents > 0 ? ` (${dollars(balanceCents)})` : ''} stays on your balance,
            to pay by the due date from &ldquo;Ways to pay&rdquo;. If the plan earned an
            early-registration discount, camp staff will let you know whether it stays.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={cancelPlan} disabled={pending} className="btn-outline py-1.5!">
              {pending ? 'Cancelling…' : 'Yes, cancel the plan'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              disabled={pending}
              className="text-sm underline"
            >
              Keep the plan
            </button>
          </div>
        </div>
      )}
      {plan.payment_method_label && <p className="mt-1">Paying with {plan.payment_method_label}.</p>}
      {failed && (
        <p className="mt-1">
          A scheduled payment didn&rsquo;t go through
          {next?.last_error ? ` (${declineReason(next.last_error)})` : ''}.{' '}
          {plan.status === 'failed'
            ? 'The plan is paused and camp staff will be in touch. Saving a new card or bank account starts it again.'
            : setAside
              ? `The payment on ${formatDueDateShort(setAside.due_on)}${setAside.last_error ? ` (${declineReason(setAside.last_error)})` : ''} has been spread over the payments still to come, but the same card or bank account is still on file — please change it below so the next payment goes through.`
              : next?.next_attempt_on
              ? `We'll try again on ${formatDueDateShort(next.next_attempt_on)}.`
              : ''}
        </p>
      )}
      {/* A finished plan is not "paid in full" if someone was added since
          (29 Oct 2026): the charger skips completed plans, so say what is
          owed and where to pay it (the Ways to pay button below). */}
      {plan.status === 'completed' && (balanceCents ?? 0) > 0 && (
        <p className="mt-1 text-amber-800">
          The plan&rsquo;s payments are finished, but {dollars(balanceCents)} is still owed (added
          since the last payment). Pay it from &ldquo;Ways to pay&rdquo; below.
        </p>
      )}
      {next && plan.status === 'active' && !failed && (
        <p className="mt-1">
          Next payment: about <strong>{dollars(each)}</strong> on {formatDueDateShort(next.due_on)}
          {left > 1 ? `, then ${left - 1} more` : ''}.
        </p>
      )}
      {upcoming.length > 0 && (
        <details className="mt-1">
          <summary className="fold-summary text-brand">Full schedule</summary>
          <ul className="mt-1 space-y-0.5">
            {upcoming.map((i) => (
              <li key={i.id}>
                {formatDueDateShort(i.due_on)} — about {dollars(i.status === 'processing' ? i.amount_cents : each)}
                {i.status === 'processing' ? ' (clearing the bank)' : i.status === 'failed' ? ' (failed — will retry)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canChange && !changing && (
        <button type="button" onClick={() => setChanging(true)} className="btn-outline mt-2 py-1.5!">
          Change card or bank account
        </button>
      )}
      {changing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded-sm border border-neutral-300 px-2 py-1.5"
          >
            <option value="bank">Bank account</option>
            <option value="card">Card</option>
          </select>
          <button type="button" onClick={go} disabled={pending} className="btn-primary py-1.5!">
            {pending ? 'Opening…' : 'Continue to secure page'}
          </button>
          <button type="button" onClick={() => setChanging(false)} className="text-sm underline">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
