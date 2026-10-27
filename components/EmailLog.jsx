// A list of emails sent, from message_log (lib/emailLog.js). No hooks, so it
// renders on the server or inside a client card alike. `showHousehold` for the
// all-families list on Email Families; `eventOf(registrationId)` names the
// event on a family's list when they have more than one.

import Link from 'next/link';
import { whenInMorristown } from '@/lib/events';
import { resendUrl } from '@/lib/emailLog';

const STATUS = {
  sent: ['Sent', 'bg-green-100 text-green-800'],
  delivered: ['Delivered', 'bg-green-100 text-green-800'],
  queued: ['Queued', 'bg-neutral-200 text-neutral-700'],
  bounced: ['Bounced', 'bg-red-100 text-red-800'],
  failed: ['Not sent', 'bg-red-100 text-red-800'],
};

export default function EmailLog({ emails, showHousehold = false, eventOf = null, empty = 'No emails yet.' }) {
  if (!emails?.length) return <p className="text-sm text-neutral-500">{empty}</p>;
  return (
    <ul className="divide-y divide-neutral-100 text-sm">
      {emails.map((m) => {
        const [label, cls] = STATUS[m.status] ?? [m.status, 'bg-neutral-200 text-neutral-700'];
        const eventName = eventOf ? eventOf(m.registrationId) : null;
        return (
          <li key={m.id} className="py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {m.subject || '(no subject)'}
                <span className="ml-2 text-xs font-normal text-neutral-500">{m.kind}</span>
              </span>
              <span className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
            </div>
            <div className="mt-0.5 text-xs text-neutral-600">
              {whenInMorristown(m.sentAt)} · to {m.to}
              {showHousehold && m.householdId && (
                <>
                  {' '}
                  (
                  {m.registrationId ? (
                    <Link href={`/admin/registrations/${m.registrationId}/`} className="text-brand underline">
                      {m.household ?? 'family'}
                    </Link>
                  ) : (
                    m.household ?? 'family'
                  )}
                  )
                </>
              )}
              {eventName ? ` · ${eventName}` : ''} · by {m.by}
              {m.providerId && (
                <>
                  {' '}
                  ·{' '}
                  <a
                    href={resendUrl(m.providerId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                    title="Resend's record of this email: delivered, bounced or opened"
                  >
                    delivery ↗
                  </a>
                </>
              )}
            </div>
            {m.error && <p className="mt-0.5 text-xs text-red-700">{m.error}</p>}
            {/* What it said (0134), folded: the same left ▶ as every fold. */}
            {m.body ? (
              <details className="mt-1">
                <summary className="fold-summary cursor-pointer text-xs font-semibold text-brand">What it said</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded-sm border border-neutral-200 bg-neutral-50 p-3 font-sans text-sm text-neutral-800">
                  {m.body}
                </pre>
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
