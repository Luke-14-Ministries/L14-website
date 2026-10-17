'use client';

// The review decision, in one card at the top of the registration
// (Lawrence, 15 Oct 2026: "how does the Review number ever drop? how does
// staff accept a registration or send it back for more information?").
//
// Before this card the answer was: change each person's status in "People
// on this week", one dropdown at a time, and write a note to the family if
// you wanted something from them -- with nothing recording that you had
// asked, so the registration sat in Awaiting review looking untouched.
//
// Three decisions, each one click:
//   Approve    -- everyone still "submitted" becomes confirmed. The deposit
//                 guard in setParticipantStatus still applies: short, and
//                 the registrar is asked before it goes through.
//   Waitlist   -- everyone still "submitted" becomes waitlisted.
//   Ask the family for more information -- writes a note to the family (it
//                 appears on their dashboard like any other note) AND marks
//                 the registration as waiting on the family (0089), which
//                 moves it out of "waiting on staff" and off the nav badge
//                 until a registrar says the family has answered, or
//                 approves or waitlists them.
// Person-by-person decisions stay in "People on this week".

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Panel from './Panel';
import { reviewRegistration } from './actions';
import { REVIEW_CLASS, REVIEW_FLAG } from '@/lib/plans';

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const when = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) : '';

export default function ReviewCard({
  registrationId,
  participants,
  review,
  awaiting,
  hold = null,
  depositWaived = null,
  depositCents = 0,
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [waiving, setWaiving] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [holding, setHolding] = useState(false);
  const [holdReason, setHoldReason] = useState('');

  const waiting = participants.filter((p) => p.status === 'submitted');
  const cls = review ? REVIEW_CLASS[review.review_class] : null;
  const flags = review?.flags ?? [];
  const onFamily = Boolean(awaiting?.since);

  function run(action, extra = {}) {
    setError('');
    start(async () => {
      let res = await reviewRegistration(registrationId, { action, ...extra });
      if (res.needsOverride) {
        // The deposit is short. Same conversation the per-person dropdown
        // has: say the numbers, let the registrar decide.
        if (window.confirm(`${res.error}\n\nApprove anyway?`)) {
          res = await reviewRegistration(registrationId, { action, ...extra, override: true });
        } else {
          return;
        }
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAsking(false);
      setReason('');
      setWaiving(false);
      setWaiveReason('');
      setHolding(false);
      setHoldReason('');
      router.refresh();
    });
  }

  // A hold (0098) is offered while somebody holds a decided place.
  const canHold = participants.some((p) => p.status === 'confirmed' || p.status === 'waitlisted');

  const count = waiting.length === 0
    ? 'nobody waiting'
    : onFamily
      ? `${waiting.length} waiting on the family`
      : `${waiting.length} waiting on staff`;

  return (
    <Panel title="Review" count={count} id="review">
      {cls && (
        <p className="text-sm mb-3">
          <span className={`inline-block rounded px-2 py-0.5 font-semibold ${cls.cls}`}>{cls.label}</span>{' '}
          <span className="text-neutral-600">
            {cls.hint}
            {review.deposit_expected_cents > 0 && (
              <>
                {' '}· received {money(review.confirmed_paid_cents)} of a {money(review.deposit_expected_cents)} deposit
              </>
            )}
          </span>
        </p>
      )}
      {flags.length > 0 && (
        <ul className="mb-3 text-sm font-semibold text-amber-800">
          {flags.map((f) => (
            <li key={f}>⚑ {REVIEW_FLAG[f] ?? f}</li>
          ))}
        </ul>
      )}

      {depositWaived && (
        <p className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          <span className="font-semibold">Deposit waived</span> on {when(depositWaived.at)}
          {depositWaived.reason && <> — &ldquo;{depositWaived.reason}&rdquo;</>}. Each fee-paying person holds a
          scholarship of at least the per-person deposit; the registration counts as deposit-received.
        </p>
      )}
      {/* Waiving the deposit (Larry, 16 Oct 2026): the registrar grants the
          per-person deposit as a scholarship and the registration counts as
          deposit-received, so approval can go ahead. Offered only while the
          deposit is actually the thing in the way. */}
      {!depositWaived && cls && review?.review_class === 'neither' && depositCents > 0 && (
        <div className="mb-4">
          {!waiving ? (
            <button type="button" disabled={pending} onClick={() => setWaiving(true)} className="btn-outline !py-1.5 text-sm">
              Waive the deposit…
            </button>
          ) : (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-sm font-semibold mb-1">
                Waive the {money(depositCents)}-per-person deposit for this family?
              </p>
              <p className="text-xs text-neutral-600 mb-2">
                Each fee-paying person gets a scholarship of {money(depositCents)} (kept if they already
                hold more), recorded with your name, and the registration counts as deposit-received.
                The balance is otherwise unchanged.
              </p>
              <input
                value={waiveReason}
                onChange={(e) => setWaiveReason(e.target.value)}
                maxLength={300}
                placeholder="Reason (optional) — e.g. spoke with the family; paying at camp"
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run('waive_deposit', { reason: waiveReason })}
                  className="btn-primary !py-1.5 text-sm disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Waive the deposit'}
                </button>
                <button type="button" onClick={() => setWaiving(false)} className="text-sm underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* On hold (0098, Larry and Ellen 15-16 Oct 2026): staff's move, the
          opposite of "waiting on the family". Everyone was put back to
          submitted when it was set; approving or waitlisting below lifts it. */}
      {hold?.since && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-bold text-amber-900">
            On hold since {when(hold.since)}
            {hold.by ? ` — ${hold.by}` : ''}
          </p>
          {hold.reason && <p className="mt-1 text-amber-900">&ldquo;{hold.reason}&rdquo;</p>}
          <p className="mt-1 text-xs text-amber-900">
            Everyone on it went back to <em>submitted</em>. Approve or waitlist below to
            finish the re-check; the family sees the reason on their dashboard.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run('lift_hold')}
            className="btn-outline !py-1.5 mt-2 text-sm"
          >
            Lift the hold without deciding
          </button>
        </div>
      )}
      {!hold?.since && canHold && (
        <div className="mb-4">
          {!holding ? (
            <button type="button" disabled={pending} onClick={() => setHolding(true)} className="btn-outline !py-1.5 text-sm">
              Put on hold…
            </button>
          ) : (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-sm font-semibold mb-1">Put this registration on hold?</p>
              <p className="text-xs text-neutral-600 mb-2">
                Everyone confirmed or waitlisted goes back to <em>submitted</em> and the
                registration returns to Awaiting review. The reason is shown to the family.
                Nothing is emailed — write to them from Outlook if they should hear from you.
              </p>
              <input
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                maxLength={1000}
                placeholder="e.g. Sam's seizure plan changed — the nurse needs to look again"
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending || !holdReason.trim()}
                  onClick={() => run('hold', { reason: holdReason })}
                  className="btn-primary !py-1.5 text-sm disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Put on hold'}
                </button>
                <button type="button" onClick={() => setHolding(false)} className="text-sm underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {onFamily && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-bold text-amber-900">Waiting on the family since {when(awaiting.since)}</p>
          {awaiting.reason && <p className="mt-1 text-amber-900">&ldquo;{awaiting.reason}&rdquo;</p>}
          <p className="mt-1 text-xs text-amber-900">
            Not counted as waiting on staff while this is set. Their edits still arrive in Recent
            Changes.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run('answered')}
            className="btn-outline !py-1.5 mt-2 text-sm"
          >
            The family has answered — back to staff
          </button>
        </div>
      )}

      {waiting.length === 0 ? (
        <p className="text-sm text-neutral-600">
          Nobody on this registration is waiting on review. Each person&rsquo;s status is in{' '}
          <em>People on this week</em>.
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-600 mb-3">
            Still submitted:{' '}
            <span className="font-medium text-neutral-800">
              {waiting.map((p) => p.name).join(', ')}
            </span>
            . Approving confirms them and takes this family out of Awaiting review; to decide
            person by person, use <em>People on this week</em>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run('approve')}
              className="btn-primary !py-1.5 text-sm disabled:opacity-50"
            >
              {pending ? 'Saving…' : `Approve ${waiting.length === 1 ? 'this person' : `all ${waiting.length}`}`}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run('waitlist')}
              className="btn-outline !py-1.5 text-sm"
            >
              Waitlist {waiting.length === 1 ? 'this person' : `all ${waiting.length}`}
            </button>
            {!asking && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setAsking(true)}
                className="btn-outline !py-1.5 text-sm"
              >
                Ask the family for more information…
              </button>
            )}
          </div>
          {asking && (
            <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <label className="block text-sm font-semibold mb-1" htmlFor="ask-reason">
                What do you need from them?
              </label>
              <textarea
                id="ask-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
                placeholder="e.g. Please add Sam's seizure plan under Medical, and tell us who is coming as caregiver."
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Sent to the family as a note on their dashboard, and recorded here as the reason
                this registration is waiting on them. Nothing is emailed automatically — write to
                them as well if it is urgent.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending || !reason.trim()}
                  onClick={() => run('ask', { reason })}
                  className="btn-primary !py-1.5 text-sm disabled:opacity-50"
                >
                  Send and mark as waiting on the family
                </button>
                <button type="button" onClick={() => setAsking(false)} className="text-sm underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
    </Panel>
  );
}
