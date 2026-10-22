// The fee lines on a printed statement (0123): one line per registration_fees
// row, "Returned-payment fee (Oct 22, 2026)   $4.00", a waived one struck
// through and marked. Shared by the family's statement and the one staff
// print, so the two never disagree about what a family was charged.

import { dollars } from '@/lib/payments';
import { feeLabel } from '@/lib/plans';
import { dayInMorristown } from '@/lib/events';

// Only family-facing columns are passed (kind, amount, date, reason, waived)
// -- never who added or waived it -- so the rows are keyed by position.
export default function FeeLines({ fees = [] }) {
  return fees.map((f, i) => (
    <div key={i} className={`flex justify-between gap-2 py-1 ${f.waived_at ? 'text-neutral-400' : ''}`}>
      <span>
        {feeLabel(f)} ({dayInMorristown(f.created_at)})
        {f.waived_at && <span className="ml-1 text-xs">waived</span>}
      </span>
      <span className={f.waived_at ? 'line-through' : ''}>{dollars(f.amount_cents)}</span>
    </div>
  ));
}
