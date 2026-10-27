// "Due in the next 7 days" (0138; draft §6): which families the automatic
// emails will write to, on which day, about what -- so nothing surprises
// anyone. A server component; the list comes from upcomingReminders(), the
// job's own rules run forward, nothing sent. Family names, events and kinds
// only: no amounts. Folded under the site's one fold pattern.

import Link from 'next/link';
import FoldCard from '@/components/FoldCard';
import { formatDueDateShort } from '@/lib/events';

const KIND = {
  plan_upcoming: 'payment coming in a week',
  plan_finished: 'plan paid in full',
  card_expiring: 'plan card expiring',
  deposit: 'deposit reminder',
  balance: 'balance reminder',
  past_due: 'balance past due',
  missing_details: 'details still needed',
  confirmed: 'confirmed',
  off_waitlist: 'off the waitlist',
  not_submitted: 'registration not submitted',
};

export default function UpcomingReminders({ rows, mode, error }) {
  const badge =
    mode === 'live' ? null : (
      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        {mode === 'off' ? 'switched off' : 'test mode: only @luke14ministries.net addresses are emailed'}
      </span>
    );
  return (
    <FoldCard title={`Automatic emails due in the next 7 days${rows ? ` (${rows.length})` : ''}`} badges={badge} defaultOpen={false} className="mb-6">
      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-600">Nothing is due to go out in the next 7 days.</p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-100 text-sm">
          {rows.map((r, n) => (
            <li key={n} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
              <span className="w-24 shrink-0 text-neutral-500">{formatDueDateShort(r.day)}</span>
              <Link href={`/admin/registrations/${r.registrationId}/`} className="font-medium text-brand underline">
                {r.household}
              </Link>
              <span className="text-neutral-600">
                {r.kinds.map((k) => KIND[k] ?? k).join(', ')}
                {r.events.length ? ` · ${r.events.join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        Sent each morning, one email per family. Pause them for a family from its registration&rsquo;s
        <em> Emails sent</em> section. The schedule: deposit and balance monthly on the 15th, then 2 weeks
        before the balance due date and on it, then weekly once past due; missing details monthly, then 2
        weeks and 5 days before camp; a plan notice a week before each payment.
      </p>
    </FoldCard>
  );
}
