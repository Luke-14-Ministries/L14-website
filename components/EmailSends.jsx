// Emails sent, grouped (27 Oct 2026): one staff send to three families was
// three near-identical lines on Email Families. Takes the output of
// groupSendsByEvent(groupEmailsBySend(...)) from lib/emailLog.js -- event
// headings, newest first, and under each one line per send. A send folds open
// (a native <details>, the site's left ▶ via `fold-summary`) to its families,
// drawn by EmailLog. No hooks, so it renders on the server.

import { whenInMorristown } from '@/lib/events';
import EmailLog from './EmailLog';

const emailCount = (ev) => ev.sends.reduce((n, s) => n + s.emails.length, 0);

function SendSummary({ send }) {
  const n = send.emails.length;
  const only = n === 1 ? send.emails[0] : null;
  return (
    <summary className="fold-summary py-2 text-sm">
      <span className="font-medium">{send.subject || '(no subject)'}</span>
      <span className="ml-2 text-xs text-neutral-500">{send.kind}</span>
      <span className="ml-2 text-xs text-neutral-600">
        {whenInMorristown(send.sentAt)} · by {send.by} ·{' '}
        {only ? `to ${only.household ?? only.to}` : `${n} families`}
      </span>
      {send.sent > 0 && (
        <span className="ml-2 rounded-sm bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-800">
          {n === 1 ? 'Sent' : `${send.sent} sent`}
        </span>
      )}
      {send.failed > 0 && (
        <span className="ml-2 rounded-sm bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">
          {n === 1 ? 'Not sent' : `${send.failed} not sent`}
        </span>
      )}
    </summary>
  );
}

export default function EmailSends({ byEvent, empty = 'Nothing sent yet.' }) {
  if (!byEvent?.length) return <p className="text-sm text-neutral-500">{empty}</p>;
  return (
    <div className="space-y-5">
      {byEvent.map((ev) => (
        <section key={ev.eventId ?? 'none'}>
          <h5 className="mb-1 flex flex-wrap items-baseline gap-2 border-b border-neutral-200 pb-1 font-bold">
            {ev.name}
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
              {emailCount(ev)} {emailCount(ev) === 1 ? 'email' : 'emails'}
            </span>
          </h5>
          <ul className="divide-y divide-neutral-100">
            {ev.sends.map((s) => (
              <li key={s.id}>
                <details>
                  <SendSummary send={s} />
                  <div className="mb-2 ml-5 border-l-2 border-neutral-100 pl-3">
                    <EmailLog emails={s.emails} showHousehold inSend />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
