'use client';

// The family's side of the conversation with camp staff, in ONE card per
// registration (Lawrence, 28 Oct 2026: the "reply sent" notice and the notes
// thread below it were two boxes saying one thing). The card is the thread
// (staff notes, 0019, and the family's own replies, 0126, oldest first), its
// state, and the way to write:
//
//   staff asked      amber, open -- the question, the thread so far, a
//                    "Reply to camp staff" box and Send. The registration is
//                    held meanwhile (0089).
//   reply sent       calm, folded, its bar saying "Sent <when> — camp staff
//                    will be in touch" until staff have read it.
//   otherwise        calm; open when camp staff wrote last (something to
//                    read), folded when the family did. With no messages yet,
//                    just a quiet "Write to camp staff…" (offerWrite).
//
// One way to answer, in the app (Lawrence): no "or email registration@" line.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { replyToStaff } from './reply-actions';
import { whenInMorristown } from '@/lib/events';

const MAX_REPLY = 4000;

function ReplyForm({ registrationId, label, onSent, onCancel = null, tone = 'amber' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const id = `reply-${registrationId}`;

  function send() {
    setError('');
    start(async () => {
      const res = await replyToStaff({ registrationId, body });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody('');
      onSent(res.sentAt);
      router.refresh();
    });
  }

  return (
    <div className="mt-3">
      <label
        htmlFor={id}
        className={`block text-sm font-semibold ${tone === 'amber' ? 'text-amber-900' : 'text-neutral-800'}`}
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={body}
        maxLength={MAX_REPLY}
        onChange={(e) => setBody(e.target.value)}
        className="mt-1 w-full rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
        placeholder="Write your answer here — camp staff read it on your registration."
      />
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={pending || !body.trim()}
          className="btn-primary py-1.5! text-sm disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={pending} className="text-sm text-neutral-500 underline">
            Never mind
          </button>
        )}
      </div>
    </div>
  );
}

function Thread({ messages }) {
  if (!messages.length) return null;
  return (
    <ul className="mt-2 space-y-1.5 text-sm text-neutral-700">
      {messages.map((m, n) => (
        <li key={n} className={m.fromFamily ? 'border-l-2 border-brand/40 pl-2' : ''}>
          <span className="font-semibold text-neutral-800">{m.fromFamily ? 'You: ' : 'Camp staff: '}</span>
          <span className="whitespace-pre-wrap">{m.body}</span>{' '}
          <span className="text-xs text-neutral-500">· {m.at}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ReplyToStaff({
  registrationId,
  // registrations.awaiting_family_since / _reason (0089)
  awaitingSince = null,
  awaitingReason = null,
  // registrations.family_replied_at and family_reply_unread (0126): once camp
  // staff have read the reply, "will be in touch" has done its job.
  repliedAt = null,
  replyUnread = false,
  // The thread, oldest first: { body, at (a printed day), fromFamily }.
  messages = [],
  // Offer to write. Since 28 Oct 2026 on every current registration, so a
  // family can start the conversation; a past event's card only reads.
  offerWrite = false,
}) {
  // Set by this visit's send. Beats the server's props while the refresh is
  // still on its way, and keeps the "Sent" line after it lands.
  const [sentAt, setSentAt] = useState(null);
  const [writing, setWriting] = useState(false);

  if (awaitingSince && !sentAt) {
    return (
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
        <p className="font-bold text-amber-900">Camp staff need something from you</p>
        {awaitingReason && <p className="mt-1 whitespace-pre-wrap text-amber-900">{awaitingReason}</p>}
        <p className="mt-1 text-xs text-amber-900">
          Answer here, and update your registration below if they asked for a change. Your
          registration is held in the meantime.
        </p>
        <Thread messages={messages} />
        <ReplyForm registrationId={registrationId} label="Reply to camp staff" onSent={setSentAt} />
      </div>
    );
  }

  const waitingOnStaff = Boolean(sentAt) || (repliedAt && replyUnread);
  const form = (
    <ReplyForm
      registrationId={registrationId}
      label="Write to camp staff"
      tone="calm"
      onSent={(at) => {
        setSentAt(at);
        setWriting(false);
      }}
      onCancel={() => setWriting(false)}
    />
  );
  const writeLink = (
    <button type="button" onClick={() => setWriting(true)} className="mt-2 text-sm text-brand underline">
      Write to camp staff…
    </button>
  );

  if (!messages.length && !waitingOnStaff) {
    if (!offerWrite) return null;
    return writing ? (
      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">{form}</div>
    ) : (
      writeLink
    );
  }

  const last = messages.at(-1);
  return (
    <details
      open={!waitingOnStaff && last && !last.fromFamily}
      className="group mt-3 rounded-lg border border-brand/30 bg-brand-light/50 px-4 py-3 text-sm"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2">
        <span aria-hidden className="text-neutral-500 group-open:rotate-90 transition-transform">▸</span>
        <span className="font-semibold text-brand-dark">Messages with camp staff</span>
        {messages.length > 0 && <span className="text-xs text-neutral-500">({messages.length})</span>}
        {waitingOnStaff && (
          <span className="text-xs text-neutral-600">
            · Sent {whenInMorristown(sentAt ?? repliedAt)} — camp staff will be in touch
          </span>
        )}
      </summary>
      <Thread messages={messages} />
      {offerWrite && (writing ? form : writeLink)}
    </details>
  );
}
