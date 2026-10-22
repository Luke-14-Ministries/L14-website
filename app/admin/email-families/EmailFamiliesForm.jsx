'use client';

// The email-families form: who, what, a preview of exactly what goes out,
// and Send behind a confirm. The audience is chosen through the URL (ids
// only) so the server works out the list with the same function the Send
// uses; subject and message stay in this component and never go in a URL.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { sendFamilyEmail } from './actions';
import { familyEmailParts } from '@/lib/familyEmail';

const input = 'w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm';
const label = 'block text-sm font-semibold text-neutral-700 mb-1';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function urlFor({ eventId, activityId, outstanding }) {
  const q = new URLSearchParams();
  if (eventId) q.set('event', eventId);
  if (activityId) q.set('activity', activityId);
  if (outstanding) q.set('outstanding', '1');
  const s = q.toString();
  return `/admin/email-families/${s ? `?${s}` : ''}`;
}

const STATUS_TEXT = {
  sent: ['Sent', 'bg-green-100 text-green-800'],
  failed: ['Failed', 'bg-red-100 text-red-800'],
  skipped: ['Not sent — no email on file', 'bg-neutral-100 text-neutral-700'],
};

export default function EmailFamiliesForm({
  events,
  eventId,
  activities,
  activityId,
  outstanding,
  suggestion,
  preview,
  origin,
}) {
  const router = useRouter();
  const [choosing, startChoosing] = useTransition();
  const [sending, startSending] = useTransition();
  const [subject, setSubject] = useState(suggestion?.subject ?? '');
  const [message, setMessage] = useState(suggestion?.message ?? '');
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);

  function choose(next) {
    setError('');
    setResults(null);
    startChoosing(() => {
      router.replace(urlFor({ eventId, activityId, outstanding, ...next }), { scroll: false });
    });
  }

  const households = preview?.ok ? preview.households : [];
  const sendable = households.filter((h) => h.hasEmail);
  const noEmail = households.filter((h) => !h.hasEmail);
  const sample = sendable[0] ?? null;
  const sampleText = sample
    ? familyEmailParts({
        message,
        items: sample.items,
        activitiesUrl: outstanding && origin ? `${origin}/account/activities/#reg-${sample.registrationId}` : null,
      }).text
    : '';

  function send() {
    setError('');
    if (!subject.trim()) return setError('Write a subject.');
    if (!message.trim()) return setError('Write the message.');
    if (sendable.length === 0) return setError('Nobody on this list has an email on file.');
    if (!confirm(`Send to ${plural(sendable.length, 'family', 'families')}?`)) return;
    startSending(async () => {
      const res = await sendFamilyEmail({
        eventId,
        activityId: activityId || null,
        outstandingOnly: outstanding,
        subject,
        message,
        expectedFamilies: sendable.length,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResults(res.results);
      router.refresh();
    });
  }

  const sentCount = results?.filter((r) => r.status === 'sent').length ?? 0;
  const failedCount = results?.filter((r) => r.status === 'failed').length ?? 0;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className={label}>Event</span>
          <select
            className={input}
            value={eventId}
            disabled={choosing || sending}
            onChange={(e) => choose({ eventId: e.target.value, activityId: '' })}
          >
            <option value="">Choose an event…</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className={label}>Who</span>
          <select
            className={input}
            value={activityId}
            disabled={!eventId || choosing || sending}
            onChange={(e) => choose({ activityId: e.target.value })}
          >
            <option value="">Every family registered for the event</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                Families signed up for {a.name}
                {a.active ? '' : ' (turned off)'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={outstanding}
          disabled={!eventId || choosing || sending}
          onChange={(e) => choose({ outstanding: e.target.checked })}
        />
        <span>
          <span className="font-semibold">Only families with a waiver outstanding</span>
          <span className="text-neutral-600">
            {' '}— someone on {activityId ? 'this activity' : 'an activity'} still needs our waiver
            signed or the outfitter&rsquo;s confirmation uploaded. The email lists each one and
            links to the family&rsquo;s Activities page.
          </span>
        </span>
      </label>

      <label className="block text-sm">
        <span className={label}>Subject</span>
        <input
          className={input}
          value={subject}
          maxLength={150}
          disabled={sending}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className={label}>Message</span>
        <textarea
          rows={8}
          className={input}
          value={message}
          maxLength={5000}
          disabled={sending}
          onChange={(e) => setMessage(e.target.value)}
        />
        <span className="mt-1 block text-xs text-neutral-500">
          Plain text. A blank line starts a new paragraph. It is signed &ldquo;Luke 14
          Ministries&rdquo; for you.
        </span>
      </label>

      {/* The preview: who, how many, and the exact words. */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        {!eventId ? (
          <p className="text-neutral-500">Choose an event to see who this goes to.</p>
        ) : choosing ? (
          <p className="text-neutral-500">Working out who this goes to…</p>
        ) : preview && !preview.ok ? (
          <p className="font-semibold text-red-700">{preview.error}</p>
        ) : households.length === 0 ? (
          <p className="text-neutral-600">Nobody matches — no family would get this.</p>
        ) : (
          <>
            <p>
              <span className="font-semibold">
                This goes to {plural(sendable.length, 'family', 'families')} (
                {plural(preview.peopleCount, 'person', 'people')}):
              </span>{' '}
              {sendable.map((h) => h.name).join(', ')}
            </p>
            {noEmail.length > 0 && (
              <p className="mt-1 text-amber-800">
                Not sent — no email on file: {noEmail.map((h) => h.name).join(', ')}.
              </p>
            )}
            {sample && (
              <>
                <p className="mt-3 text-xs font-semibold text-neutral-600">
                  The email {sample.name} will get
                  {outstanding ? ' (each family’s list is their own)' : ''}:
                </p>
                <div className="mt-1 rounded-sm border border-neutral-200 bg-neutral-50 p-3">
                  <p className="font-semibold">{subject.trim() || '(no subject yet)'}</p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-neutral-800">
                    {sampleText}
                  </pre>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={sending || choosing || sendable.length === 0}
          className="btn-primary py-2! text-sm disabled:opacity-50"
        >
          {sending ? 'Sending… (one at a time)' : `Send to ${plural(sendable.length, 'family', 'families')}`}
        </button>
        <span className="text-xs text-neutral-500">Nothing is sent until you confirm.</span>
      </div>

      {results && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          <p className="font-semibold">
            {plural(sentCount, 'email', 'emails')} sent
            {failedCount > 0 && `, ${failedCount} failed`}.
          </p>
          <ul className="mt-2 divide-y divide-neutral-100">
            {results.map((r) => {
              const [text, cls] = STATUS_TEXT[r.status] ?? [r.status, ''];
              return (
                <li key={r.householdId} className="flex flex-wrap items-baseline gap-2 py-1.5">
                  <span className="font-medium">{r.name}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{text}</span>
                  {r.status === 'failed' && r.error && (
                    <span className="text-xs text-red-700">{r.error}</span>
                  )}
                  {r.logError && (
                    <span className="text-xs text-red-700">Not recorded in the message log: {r.logError}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
