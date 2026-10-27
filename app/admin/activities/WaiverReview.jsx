'use client';

// Outside-provider waiver confirmations, as staff see them (0124, 26 Oct
// 2026). Since Lawrence's "cluttered ... will become klunky when there are
// many" (26 Oct), the deciding happens in ONE place -- the "Confirmations to
// check" queue at the top of the Activities page -- and the activity cards
// only say where each person stands. Three pieces, shared by both:
//
//   WaiverStatusPill  the card's one pill per person: awaiting check (links
//                     to that upload's row in the queue), accepted, rejected
//                     (the reason on hover), or no confirmation. Accepted and
//                     rejected open the file.
//   WaiverFileLink    "Open file" for a queue row (a ten-minute signed URL
//                     minted by the page; the bucket is private).
//   ReviewActions     Accept / Reject for staff with Registration write. A
//                     rejection needs a reason; the family reads it on their
//                     Activities page and dashboard, the row is outstanding
//                     again (activity_waivers_outstanding), and their next
//                     upload goes back to "awaiting check" by itself (the
//                     guard trigger in 0124).

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewWaiverUpload } from './actions';
import { waiverReviewPill } from '@/lib/format';
// The queue row an awaiting pill links to.
import { checkAnchor } from '@/lib/waiverAnchors';

// Lawrence's examples (26 Oct): wrong file, unreadable, low resolution.
const QUICK_REASONS = ['Wrong file', "Can't read it", 'Picture too small', 'Not signed'];


function reviewedLine(upload) {
  return upload.reviewedAt
    ? ` — ${upload.status} ${upload.reviewedAt}${upload.reviewerName ? ` by ${upload.reviewerName}` : ''}`
    : '';
}

export function WaiverStatusPill({ upload }) {
  if (!upload) {
    return (
      <span
        title="No provider confirmation uploaded yet"
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
      >
        no confirmation
      </span>
    );
  }
  const pill = waiverReviewPill(upload);
  if (pill.key === 'pending') {
    return (
      <a
        href={`#${checkAnchor(upload.id)}`}
        title={`Uploaded ${upload.uploadedAt} — check it in Confirmations to check, at the top of the page`}
        className={`rounded-full px-2 py-0.5 text-xs font-semibold underline ${pill.cls}`}
      >
        awaiting check
      </a>
    );
  }
  return (
    <a
      href={upload.url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      title={`${pill.key === 'rejected' ? `Rejected: ${upload.note || 'no reason given'}. ` : ''}Uploaded ${
        upload.uploadedAt
      }${reviewedLine(upload)} — opens the file`}
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pill.cls}`}
    >
      {pill.key === 'rejected' ? 'rejected' : pill.text}
    </a>
  );
}

export function WaiverFileLink({ upload }) {
  if (!upload.url) return <span className="text-xs text-neutral-400">file unavailable</span>;
  return (
    <a
      href={upload.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm font-semibold text-brand underline"
      title={`Uploaded ${upload.uploadedAt} — opens the file`}
    >
      Open file ↗
    </a>
  );
}

export default function ReviewActions({ upload, canReview = false }) {
  const router = useRouter();
  const reasonId = useId();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  if (!canReview) return null;

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

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {upload.status !== 'accepted' && (
        <button
          type="button"
          onClick={() => run('accepted')}
          disabled={pending}
          className="btn-outline py-0.5! px-2! text-xs"
        >
          {pending && !rejecting ? 'Saving…' : 'Accept'}
        </button>
      )}
      {upload.status !== 'rejected' && !rejecting && (
        <button
          type="button"
          onClick={() => setRejecting(true)}
          disabled={pending}
          className="text-xs text-red-800 underline"
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
