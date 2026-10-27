'use client';

// The "Re-check with Stripe" button beside a refund pending more than
// STALE_REFUND_DAYS (lib/payments.js), on the registration page and on Event
// Payments' amber strip. The work is refundRecheckAction.js; this shows its answer
// in a sentence and refreshes the page when something was recorded.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recheckRefund } from './refundRecheckAction';

export default function RecheckRefund({ refundId }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState(null); // { ok, message | error }

  function go() {
    setResult(null);
    start(async () => {
      const res = await recheckRefund(refundId);
      setResult(res);
      if (res?.ok && res.status && res.status !== 'pending') router.refresh();
    });
  }

  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="rounded-sm border border-amber-400 bg-white px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-50 disabled:opacity-50"
      >
        {pending ? 'Asking Stripe…' : 'Re-check with Stripe'}
      </button>
      {result && (
        <span className={`text-xs ${result.ok ? 'text-neutral-700' : 'font-semibold text-red-700'}`} role="status">
          {result.ok ? result.message : result.error}
        </span>
      )}
    </span>
  );
}
