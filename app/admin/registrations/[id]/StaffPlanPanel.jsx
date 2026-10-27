'use client';

// How this registration is being paid (0080): the route the family chose,
// the payment plan and its schedule, and the staff controls for it.
// Staff never see or enter card details -- a new card or bank account is the
// family's to save, from their dashboard.

import { useState, useTransition } from 'react';
import { setPlanStatus } from './actions';
import {
  ROUTE_LABEL,
  SCHEDULE_LABEL,
  PLAN_STATUS_LABEL,
  planStoppedAt,
  planFailingSince,
  planFailingNext,
} from '@/lib/plans';
import { dayInMorristown } from '@/lib/events';

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const INST_LABEL = {
  scheduled: 'Scheduled',
  processing: 'Clearing the bank',
  failed: 'Failed',
  paid: 'Paid',
  waived: 'Not needed',
  cancelled: 'Cancelled',
  sent: 'Sent',
};

// A cancelled charge that had been tried and failed: resuming a plan sets its
// failed charges aside and rebuilds the schedule from today.
const replacedAfterFailing = (i) => i.status === 'cancelled' && (i.attempts ?? 0) > 0 && Boolean(i.last_error);

export default function StaffPlanPanel({
  registrationId,
  route,
  plan,
  cancelledByFamily = false,
  installments,
  earlyDiscountCents,
  familyDiscountCents = 0,
  requiresChoice,
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [keep, setKeep] = useState(plan?.keeps_early_discount ?? true);

  function run(action, extra = {}) {
    setError('');
    start(async () => {
      const res = await setPlanStatus(registrationId, { action, ...extra });
      if (!res.ok) setError(res.error);
      else setConfirmCancel(false);
    });
  }

  const unfinished = requiresChoice && route === 'none';
  // A charge failed and the plan is still running (27 Oct 2026): the amber
  // line below, before the red one a third failure brings.
  const failing = planFailingSince(plan);

  // The last section of the Money card (26 Oct 2026), under a heading of its
  // own and without card chrome of its own: it folds with the rest of the
  // money. From 15 Oct it was a folding card at the foot of the page; before
  // that, a bare white box with the review pill as its first line (the
  // review has its own card now, ReviewCard.jsx). It is only about how the
  // money arrives. "#plan" still reaches it (the Money card opens for it).
  return (
    <section id="plan" className="scroll-mt-4">
      <h3 className="mb-1 text-base font-bold">How this registration is being paid</h3>
      <p className={`text-sm mb-3 ${unfinished ? 'font-semibold text-amber-800' : 'text-neutral-600'}`}>
        {ROUTE_LABEL[route] ?? route ?? '—'}
        {unfinished && ' — the family has not chosen pay in full, a payment plan or a scholarship yet.'}
        {earlyDiscountCents > 0 && ` · Early-registration discount ${money(earlyDiscountCents)}`}
        {familyDiscountCents > 0 && ` · Family discount ${money(familyDiscountCents)}`}
      </p>

      {plan && plan.status !== 'pending' && (
        <>
          {/* The Plan stopped flag (22 Oct 2026): the same rule as the review
              queue's tab and the Overview's red card. */}
          {plan.status === 'failed' && (
            <p className="mb-2 text-sm font-semibold text-red-700">
              This plan stopped after 3 failed payments
              {planStoppedAt(plan) ? ` on ${dayInMorristown(planStoppedAt(plan))}` : ''}.
            </p>
          )}
          {/* The earlier flag (Lawrence, 27 Oct 2026): one failed payment is
              worth knowing about before the plan stops. Amber -- the charger
              is still trying; it turns into the red line above if the third
              try fails. */}
          {failing && (
            <p className="mb-2 text-sm font-semibold text-amber-800">
              ⚑ A plan payment failed{failing.since ? ` on ${dayInMorristown(failing.since)}` : ''} —{' '}
              {planFailingNext(failing)}.
            </p>
          )}
          <p className="text-sm">
            <span className="font-semibold">{SCHEDULE_LABEL[plan.schedule] ?? plan.schedule}</span> ·{' '}
            {PLAN_STATUS_LABEL[plan.status] ?? plan.status}
            {plan.payment_method_label && ` · ${plan.payment_method_label}`}
            {!plan.keeps_early_discount && ' · early discount removed by staff'}
          </p>
          {plan.status === 'cancelled' && plan.cancelled_at && (
            <p className="mt-1 text-sm font-semibold text-neutral-700">
              Cancelled {dayInMorristown(plan.cancelled_at)} by {cancelledByFamily ? 'the family' : 'staff'}.
              {cancelledByFamily && plan.keeps_early_discount
                ? ' Decide whether they keep the early-registration discount.'
                : ''}
            </p>
          )}
          {plan.consented_at && (
            <details className="text-xs text-neutral-500 mt-1">
              <summary className="fold-summary">
                Consent given {new Date(plan.consented_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}
              </summary>
              <p className="mt-1">{plan.consent_text}</p>
            </details>
          )}

          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1 font-semibold">Date</th>
                <th className="py-1 font-semibold text-right">Amount</th>
                <th className="py-1 pl-6 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(installments ?? []).map((i) => (
                <tr key={i.id} className="border-t border-neutral-100">
                  <td className="py-1">{i.due_on}</td>
                  <td className="py-1 text-right">
                    {['scheduled', 'failed'].includes(i.status) ? `≈ ${money(i.amount_cents)}` : money(i.amount_cents)}
                  </td>
                  <td className={`py-1 pl-6 ${i.status === 'failed' || replacedAfterFailing(i) ? 'text-red-700' : ''}`}>
                    {/* A charge that failed and was then set aside when staff
                        resumed the plan is not "Cancelled" (Lawrence, 27 Oct
                        2026): it failed, and what it would have taken is
                        spread over the payments still to come. */}
                    {replacedAfterFailing(i)
                      ? `Failed${i.last_error ? ` — ${i.last_error}` : ''} · moved into the later payments`
                      : INST_LABEL[i.status] ?? i.status}
                    {i.status === 'failed' && i.last_error ? ` — ${i.last_error}` : ''}
                    {i.status === 'failed' && i.next_attempt_on ? ` (retry ${i.next_attempt_on}, try ${i.attempts})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-neutral-500 mt-1">
            Amounts marked ≈ are estimates. Each charge is worked out on the day from the balance
            still owed, so the last one lands the balance on $0.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {plan.status === 'active' && (
              <button type="button" disabled={pending} onClick={() => run('pause')} className="btn-outline py-1.5!">
                Pause plan
              </button>
            )}
            {['paused', 'failed'].includes(plan.status) && (
              <button type="button" disabled={pending} onClick={() => run('resume')} className="btn-outline py-1.5!">
                {plan.status === 'failed' ? 'Retry and resume plan' : 'Resume plan'}
              </button>
            )}
            {!['cancelled', 'completed'].includes(plan.status) && !confirmCancel && (
              <button type="button" disabled={pending} onClick={() => setConfirmCancel(true)} className="btn-outline py-1.5! text-red-700">
                Cancel plan…
              </button>
            )}
            {['cancelled', 'failed', 'paused'].includes(plan.status) && !confirmCancel && (
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={plan.keeps_early_discount}
                  disabled={pending}
                  onChange={(e) => run('discount', { keepsEarlyDiscount: e.target.checked })}
                />
                Family keeps the early-registration discount
              </label>
            )}
          </div>

          {confirmCancel && (
            <div className="mt-3 rounded-sm border border-red-200 bg-red-50 p-3 text-sm">
              <p className="font-semibold">Cancel this payment plan?</p>
              <p className="mt-1">No more automatic charges will be made. Payments already taken stay.</p>
              <label className="mt-2 flex items-center gap-1">
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                Family keeps the early-registration discount
              </label>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run('cancel', { keepsEarlyDiscount: keep })}
                  className="btn-primary py-1.5! bg-red-700!"
                >
                  Cancel plan
                </button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="text-sm underline">
                  Keep it
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {plan?.status === 'pending' && (
        <p className="text-sm text-neutral-500">A plan was started but its deposit has not been paid.</p>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
