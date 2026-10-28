'use client';

// The family's side of "Camp staff need something from you" (0089), with a
// way to answer in the app (0126; Lawrence, 26 Oct 2026). One component for
// every state of the box, rendered in one place on the registration card, so
// it keeps its "Thanks" line across the refresh that follows a send:
//
//   staff asked      amber -- the question, a "Reply to camp staff" box and
//                    Send. The registration is held meanwhile.
//   reply sent       calm -- "Your reply was sent <when>; camp staff will be
//                    in touch." Shown until camp staff have read it (Mark as
//                    read, or writing back); the reply stays in the thread
//                    below as "You wrote".
//   neither          a quiet "Write to camp staff…" that opens the same box:
//                    a family may write at any time (offerWrite).
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

export default function ReplyToStaff({
  registrationId,
  // registrations.awaiting_family_since / _reason (0089)
  awaitingSince = null,
  awaitingReason = null,
  // registrations.family_replied_at and family_reply_unread (0126): once camp
  // staff have read the reply, the "will be in touch" box has done its job.
  repliedAt = null,
  replyUnread = false,
  // Offer "Write to camp staff…" when nothing is asked. Since 28 Oct 2026 on
  // every current registration, so a family can start the conversation
  // (until then only where one already existed).
  offerWrite = false,
}) {
  // Set by this visit's send. Beats the server's props while the refresh is
  // still on its way, and keeps the thank-you line after it lands.
  const [sentAt, setSentAt] = useState(null);
  const [writing, setWriting] = useState(false);

  if (sentAt || (repliedAt && replyUnread && !awaitingSince)) {
    const when = whenInMorristown(sentAt ?? repliedAt);
    return (
      <div className="mt-3 rounded-lg border border-brand/30 bg-brand-light/50 px-4 py-3 text-sm">
        {sentAt && <p className="font-bold text-brand-dark">Thanks — camp staff will see your reply.</p>}
        <p className={sentAt ? 'mt-1 text-neutral-700' : 'text-neutral-700'}>
          Your reply was sent {when}; camp staff will be in touch.
        </p>
        {writing ? (
          <ReplyForm
            registrationId={registrationId}
            label="Add to your reply"
            tone="calm"
            onSent={(at) => {
              setSentAt(at);
              setWriting(false);
            }}
            onCancel={() => setWriting(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setWriting(true)}
            className="mt-1 text-xs text-brand underline"
          >
            Write to camp staff again…
          </button>
        )}
      </div>
    );
  }

  if (awaitingSince) {
    return (
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
        <p className="font-bold text-amber-900">Camp staff need something from you</p>
        {awaitingReason && <p className="mt-1 whitespace-pre-wrap text-amber-900">{awaitingReason}</p>}
        <p className="mt-1 text-xs text-amber-900">
          Answer here, and update your registration below if they asked for a change. Your
          registration is held in the meantime.
        </p>
        <ReplyForm registrationId={registrationId} label="Reply to camp staff" onSent={setSentAt} />
      </div>
    );
  }

  if (!offerWrite) return null;
  return writing ? (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
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
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setWriting(true)}
      className="mt-2 text-sm text-brand underline"
    >
      Write to camp staff…
    </button>
  );
}
