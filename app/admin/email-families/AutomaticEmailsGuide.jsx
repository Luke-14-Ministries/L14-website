// "What the automatic emails say" (23 Nov 2026, review A4-16/A4-17): every
// kind of daily automatic email as a family would get it, filled with
// made-up facts, and when it goes. Read-only. The wording lives in
// lib/reminders/templates.js and is still for Ellen and Katie to mark up;
// this card is where they can read it. A server component: FoldCard folds
// it, each email is a native <details> like the sent list's.

import FoldCard from '@/components/FoldCard';
import { sampleAutomaticEmails } from '@/lib/reminders/templates';

export const AUTOMATIC_EMAILS_ANCHOR = 'automatic-emails';

export default function AutomaticEmailsGuide({ origin }) {
  const emails = sampleAutomaticEmails({ origin, eventType: 'camp_week' });
  return (
    <section id={AUTOMATIC_EMAILS_ANCHOR} className="mb-6 scroll-mt-4">
      <FoldCard title="What the automatic emails say" defaultOpen={false}>
        <p className="mb-3 text-sm text-neutral-600">
          Each email below is filled with made-up names and amounts. A family gets at most one email a day; when
          two things are due the same day, they arrive together under one subject. For the Adult Adventure
          Retreat, &ldquo;camp&rdquo; reads &ldquo;the retreat&rdquo; and &ldquo;Camp staff&rdquo; reads
          &ldquo;Our staff.&rdquo; To change the wording, send the changes to whoever looks after the website.
        </p>
        <ul className="divide-y divide-neutral-100">
          {emails.map((e) => (
            <li key={e.kind}>
              <details>
                <summary className="fold-summary py-2 text-sm">
                  <span className="font-medium">{e.label}</span>
                  <span className="ml-2 text-xs text-neutral-600">{e.when}</span>
                </summary>
                <div className="mb-3 ml-5 border-l-2 border-neutral-100 pl-3 text-sm">
                  <p>
                    <span className="text-neutral-500">Subject:</span> <span className="font-medium">{e.subject}</span>
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words rounded-sm bg-neutral-50 p-3 text-neutral-700">
                    {e.text}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </FoldCard>
    </section>
  );
}
