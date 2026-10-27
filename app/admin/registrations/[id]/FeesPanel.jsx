'use client';

// Fees on this registration (0123): the automatic returned-bank-payment fee
// and any a staff member added. Shown to Payments read as a section of the
// Money card (26 Oct 2026; it was its own card under the money summary); Waive (reason required) and Add a fee are Payments write. Both go
// through definer functions and are logged in money_change_log; the family
// sees each fee, and a waived one struck through, on their dashboard and
// statement. Unwaived fees are part of the balance everywhere
// (registration_balances.fees_cents).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dollars } from '@/lib/payments';
import { feeLabel } from '@/lib/plans';
import { dayInMorristown } from '@/lib/events';
import { addRegistrationFee, waiveRegistrationFee } from './actions';

// Module level (CLAUDE.md: never a component inside another's body).
function FeeRow({ fee, canWaive, registrationId }) {
  const router = useRouter();
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function waive() {
    setError('');
    start(async () => {
      const res = await waiveRegistrationFee(registrationId, fee.id, reason);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setWaiving(false);
      router.refresh();
    });
  }

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={fee.waived_at ? 'text-neutral-400' : ''}>
          {feeLabel(fee)} ({dayInMorristown(fee.created_at)})
          <span className="ml-1 text-xs text-neutral-500">
            {fee.created_by ? `added by ${fee.createdByName ?? 'staff'}` : 'added automatically'}
          </span>
        </span>
        <span className="flex items-baseline gap-3">
          <span className={`tabular-nums ${fee.waived_at ? 'line-through text-neutral-400' : 'text-amber-800'}`}>
            {dollars(fee.amount_cents)}
          </span>
          {!fee.waived_at && canWaive && !waiving && (
            <button type="button" onClick={() => setWaiving(true)} className="text-sm text-brand underline">
              Waive
            </button>
          )}
        </span>
      </div>
      {fee.waived_at && (
        <p className="text-xs text-neutral-500">
          Waived {dayInMorristown(fee.waived_at)}
          {fee.waivedByName ? ` by ${fee.waivedByName}` : ''}: {fee.waived_reason}
        </p>
      )}
      {waiving && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why it is waived (required)"
            className="min-w-64 flex-1 rounded-sm border border-neutral-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={waive}
            disabled={pending || !reason.trim()}
            className="btn-primary py-1! text-sm disabled:opacity-40"
          >
            {pending ? 'Waiving…' : 'Waive fee'}
          </button>
          <button type="button" onClick={() => setWaiving(false)} className="text-sm text-neutral-600 underline">
            Cancel
          </button>
          <p className="w-full text-xs text-neutral-500">The family can see this reason.</p>
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </li>
  );
}

function AddFeeForm({ registrationId }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function add() {
    setError('');
    start(async () => {
      const res = await addRegistrationFee(registrationId, { dollars: amount, reason });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAmount('');
      setReason('');
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-sm text-brand underline">
        Add a fee
      </button>
    );
  }
  return (
    <div className="mt-3 rounded-sm border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block font-semibold text-neutral-700 mb-0.5">Amount ($)</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28 rounded-sm border border-neutral-300 px-2 py-1"
          />
        </label>
        <label className="min-w-64 flex-1 text-sm">
          <span className="block font-semibold text-neutral-700 mb-0.5">Reason (the family sees it)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Returned check"
            className="w-full rounded-sm border border-neutral-300 px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={pending || !amount.trim() || !reason.trim()}
          className="btn-primary py-1.5! text-sm disabled:opacity-40"
        >
          {pending ? 'Adding…' : 'Add fee'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-neutral-600 underline">
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

// canWrite: Payments write -- may ADD a fee. canWaive: Payments AND
// Registration write (can_decide_scholarships, 0102) -- waiving is a hand-set
// money decision, like a scholarship.
export default function FeesPanel({ registrationId, fees = [], canWrite = false, canWaive = false }) {
  if (fees.length === 0 && !canWrite) return null;
  return (
    <section className="text-sm">
      <h3 className="text-base font-bold">Fees</h3>
      {fees.length === 0 ? (
        <p className="mt-1 text-neutral-500">No fees on this registration.</p>
      ) : (
        <ul className="mt-1 divide-y divide-neutral-100">
          {fees.map((f) => (
            <FeeRow key={f.id} fee={f} canWaive={canWaive} registrationId={registrationId} />
          ))}
        </ul>
      )}
      {canWrite && <AddFeeForm registrationId={registrationId} />}
      <p className="mt-2 text-xs text-neutral-500">
        Unwaived fees are part of the balance. A returned bank payment adds the fee the family was
        shown when they chose to pay by bank; a plan&rsquo;s remaining charges collect it.
      </p>
    </section>
  );
}
