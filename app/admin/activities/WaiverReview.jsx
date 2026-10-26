'use client';

// One outside-provider waiver confirmation, as staff see it (0124, 26 Oct
// 2026): a pill saying where it stands -- awaiting check, accepted, or
// rejected with the reason -- which opens the file, and for staff with
// Registration write the Accept / Reject buttons. A rejection needs a reason;
// the family reads it on their Activities page and dashboard, the row is
// outstanding again (activity_waivers_outstanding), and their next upload
// goes back to "awaiting check" by itself (the guard trigger in 0124).

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewWaiverUpload } from './actions';
import { waiverReviewPill } from '@/lib/format';

// Lawrence's examples (26 Oct): wrong file, unreadable, low resolution.
const QUICK_REASONS = ['Wrong file', "Can't read it", 'Picture too small', 'Not signed'];

export default function WaiverReview({ upload, canReview = false, label = null }) {
  const router = useRouter();
  const reasonId = useId();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const pill = waiverReviewPill(upload);

  function run(status, note = null) {
    setError('');
    start(async () => {
      const res = await reviewWaiverUpload(upload.id, status, note);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRejecting(false);
      setReason('');
      router.refresh();
    });
  }

  const reviewedLine = upload.reviewedAt
    ? ` — ${upload.status} ${upload.reviewedAt}${upload.reviewerName ? ` by ${upload.reviewerName}` : ''}`
    : '';

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {label && <span className="font-medium">{label}</span>}
      <a
        href={upload.url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        title={`Provider confirmation uploaded ${upload.uploadedAt}${reviewedLine} — opens the file`}
        className={`rounded-full px-2 py-0.5 text-xs font-semibold underline ${pill.cls}`}
      >
        {pill.text}
      </a>
      {canReview && upload.status !== 'accepted' && (
        <button
          type="button"
          onClick={() => run('accepted')}
          disabled={pending}
          className="text-xs text-brand underline"
        >
          Accept
        </button>
      )}
      {canReview && upload.status !== 'rejected' && !rejecting && (
        <button
          type="button"
          onClick={() => setRejecting(true)}
          disabled={pending}
          className="text-xs text-brand underline"
        >
          Reject…
        </button>
      )}
      {rejecting && (
        <span className="basis-full rounded-sm border border-red-200 bg-red-50 px-2 py-2 text-xs">
          <label htmlFor={reasonId} className="block font-semibold text-red-900">
            Why can it not be accepted? The family reads this and uploads again.
          </label>
          <span className="mt-1 flex flex-wrap gap-1">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`rounded-full border px-2 py-0.5 ${
                  reason === r ? 'border-red-700 bg-red-100 text-red-900' : 'border-red-200 bg-white text-red-800'
                }`}
              >
                {r}
              </button>
            ))}
          </span>
          <input
            id={reasonId}
            type="text"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Or say it in your own words"
            className="mt-1 w-full rounded-sm border border-neutral-300 px-2 py-1"
          />
          <span className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={() => {
                if (!reason.trim()) {
                  setError('Give the family a reason.');
                  return;
                }
                run('rejected', reason.trim());
              }}
              disabled={pending}
              className="font-semibold text-red-800 underline"
            >
              {pending ? 'Saving…' : 'Reject this upload'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setReason('');
                setError('');
              }}
              disabled={pending}
              className="text-neutral-600 underline"
            >
              Cancel
            </button>
          </span>
        </span>
      )}
      {error && <span className="basis-full text-xs text-red-700">{error}</span>}
    </span>
  );
}
