'use client';

// Write and send the prayer email (0141). The preview is the typed text laid
// out as the email lays it out (a blank line starts a paragraph); Send to me
// first shows it in a real inbox. The box starts with the prayer team's
// sign-off below two empty lines, ready to write above (28 Oct 2026).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendPrayerEmail, sendPrayerTest } from './actions';
import { PRAYER_SIGNATURE, prayerBodyIsEmpty } from '@/lib/prayer';

const START = `\n\n${PRAYER_SIGNATURE}`;

const FIELD = 'w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm';

export default function PrayerComposer({ count }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(START);
  const [note, setNote] = useState(null);

  function test() {
    setNote(null);
    start(async () => {
      const res = await sendPrayerTest({ subject, body });
      setNote(res.ok ? { tone: 'ok', text: `A test copy went to ${res.to}.` } : { tone: 'err', text: res.error });
    });
  }

  function send() {
    if (!confirm(`Send “${subject.trim()}” to ${count} ${count === 1 ? 'person' : 'people'} on the prayer list? This cannot be undone.`)) return;
    setNote(null);
    start(async () => {
      const res = await sendPrayerEmail({ subject, body, expected: count });
      if (!res.ok) {
        setNote({ tone: 'err', text: res.error });
        return;
      }
      const parts = [`Sent to ${res.sent} ${res.sent === 1 ? 'person' : 'people'}.`];
      if (res.failed) parts.push(`${res.failed} could not be sent: ${res.error}`);
      if (res.changed) parts.push(`(The list had changed to ${res.changed} since this page opened.)`);
      if (res.logError) parts.push(res.logError);
      setNote({ tone: res.failed || res.logError ? 'err' : 'ok', text: parts.join(' ') });
      setSubject('');
      setBody(START);
      router.refresh();
    });
  }

  const ready = subject.trim() && !prayerBodyIsEmpty(body);
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="prayer-subject" className="mb-1 block text-sm font-semibold">
          Subject
        </label>
        <input id="prayer-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className={FIELD} />
      </div>
      <div>
        <label htmlFor="prayer-body" className="mb-1 block text-sm font-semibold">
          Message
        </label>
        <textarea
          id="prayer-body"
          rows={12}
          value={body}
          maxLength={20000}
          onChange={(e) => setBody(e.target.value)}
          className={FIELD}
          placeholder="Leave a blank line between paragraphs. Web addresses become links."
        />
        <p className="mt-1 text-xs text-neutral-500">
          Write above the sign-off; change it or delete it as you like. Every copy ends with an
          Unsubscribe link and the prayer-request address. Replies go to the prayer team&rsquo;s address.
        </p>
      </div>
      {ready && (
        <details className="rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold">Preview</summary>
          <p className="mt-2 text-neutral-500">
            Subject: <span className="font-semibold text-neutral-800">{subject}</span>
          </p>
          {body
            .trim()
            .split(/\n{2,}/)
            .map((para, i) => (
              <p key={i} className="mt-2 whitespace-pre-wrap">
                {para}
              </p>
            ))}
        </details>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={test} disabled={pending || !ready} className="btn-outline py-1.5! text-sm disabled:opacity-50">
          Send a test to me
        </button>
        <button type="button" onClick={send} disabled={pending || !ready || count === 0} className="btn-primary py-1.5! text-sm disabled:opacity-50">
          {pending ? 'Sending…' : `Send to ${count} ${count === 1 ? 'person' : 'people'}`}
        </button>
      </div>
      {note && (
        <p role="status" className={`text-sm ${note.tone === 'ok' ? 'text-green-800' : 'text-red-700'}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
