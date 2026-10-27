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
//
// The family answers in the app (0126, Lawrence 26 Oct 2026): their reply
// from the dashboard clears "waiting on the family" by itself and shows here
// as an amber "Family replied" box until someone with Registration write marks
// it read (or writes back to the family, which counts as reading it). No
// email is sent on a reply -- the app is the one place it arrives.
//
// Decided people come first (0128, Lawrence 26 Oct 2026: a waitlisted family
// read as "nobody waiting / No review needed yet" -- "not obvious they were
// waitlisted or why"). Waitlisting asks for a reason the family can read; the
// top of the card lists who is waitlisted (amber, with the reason, when and
// by whom) and who is confirmed (a plain line), each name a link to that
// person's row in People on this week.
//
// Who is still undecided gets the same treatment (Lawrence, 26 Oct 2026:
// "'Still submitted' is odd wording ... not immediately obvious who the '2
// waiting on staff' were"): a "Waiting on your decision" block naming each
// person, with their role, as a link to their row -- directly above the
// buttons that decide them.
//
// Two flags inform rather than ask for work, so they no longer hold the card
// open (the rule is RegistrationManager's): photo permission declined, which
// links to the photographer's list (/admin/rosters/photos/), and the Creed
// not affirmed, where Registration write records "Talked with Larry" (0129;
// the database stamps who and when) and the line turns calm.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Panel, { PanelLink } from './Panel';
import { reviewRegistration, markFamilyReplyRead } from './actions';
import { REVIEW_CLASS, REVIEW_FLAG } from '@/lib/plans';
import { whenInMorristown } from '@/lib/events';

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const when = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) : '';

// " (Oct 26, 3:21 PM, by Ellen Smith)" -- when and by whom a status was last
// changed (0128); '' for rows from before the stamp existed.
function changedNote(p) {
  if (!p.changedAt) return p.changedBy ? ` (by ${p.changedBy})` : '';
  return ` (${whenInMorristown(p.changedAt)}${p.changedBy ? `, by ${p.changedBy}` : ''})`;
}

// The link to People on this week, which opens it if folded (Panel opensFor).
function PeopleLink() {
  return (
    <PanelLink to="people">
      <em>People on this week</em>
    </PanelLink>
  );
}

export default function ReviewCard({
  registrationId,
  participants,
  review,
  awaiting,
  // { at, unread, messages } -- the family's reply (0126), or null.
  familyReply = null,
  hold = null,
  // { at, by, note } once staff recorded talking with Larry about the Creed
  // (0129), or null.
  creedDiscussed = null,
  // The registration's event, for the photographer's list link.
  eventId = null,
  depositWaived = null,
  depositCents = 0,
  // Registration write / scholarship decision (0101, 0102). Without them the
  // card shows the state and offers nothing to press.
  canWrite = true,
  canDecide = true,
  // Open or folded when the page first draws (26 Oct 2026): the rule is
  // RegistrationManager's, beside the other cards'.
  defaultOpen = true,
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [waiving, setWaiving] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [undoReason, setUndoReason] = useState('');
  const [holding, setHolding] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [waitlisting, setWaitlisting] = useState(false);
  const [waitlistReason, setWaitlistReason] = useState('');
  const [creedNoting, setCreedNoting] = useState(false);
  const [creedNote, setCreedNote] = useState('');

  const waiting = participants.filter((p) => p.status === 'submitted');
  const cls = review ? REVIEW_CLASS[review.review_class] : null;
  const flags = review?.flags ?? [];
  const onFamily = Boolean(awaiting?.since);

  function markRead() {
    setError('');
    start(async () => {
      const res = await markFamilyReplyRead(registrationId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

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
      setUndoing(false);
      setUndoReason('');
      setHolding(false);
      setHoldReason('');
      setWaitlisting(false);
      setWaitlistReason('');
      setCreedNoting(false);
      setCreedNote('');
      router.refresh();
    });
  }

  // A hold (0098) is offered while somebody holds a decided place.
  const canHold = participants.some((p) => p.status === 'confirmed' || p.status === 'waitlisted');

  // Who has been decided (0128): the first thing the card says about them.
  const confirmed = participants.filter((p) => p.status === 'confirmed');
  const waitlisted = participants.filter((p) => p.status === 'waitlisted');
  const decidedOnly = waiting.length === 0 && confirmed.length + waitlisted.length > 0;
  // "No review needed yet" is wrong once people are decided: say so instead.
  const hint = !cls
    ? ''
    : !decidedOnly
      ? cls.hint
      : review.review_class === 'neither' && review.deposit_expected_cents > 0
        ? 'Decided — the deposit is still owed'
        : 'Decided';

  const count = waiting.length === 0
    ? decidedOnly
      ? [confirmed.length && `${confirmed.length} confirmed`, waitlisted.length && `${waitlisted.length} waitlisted`]
          .filter(Boolean)
          .join(' · ')
      : 'nobody waiting'
    : onFamily
      ? `${waiting.length} waiting on the family`
      : `${waiting.length} waiting on staff`;

  return (
    <Panel title="Review" count={count} id="review" defaultOpen={defaultOpen}>
      {/* The family replied in the app (0126). First in the card, and amber:
          it is waiting on staff to read and answer (Lawrence, 26 Oct 2026). */}
      {familyReply?.unread && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-bold text-amber-900"><span aria-hidden>✉</span> Family replied {when(familyReply.at)}</p>
          {(familyReply.messages ?? []).map((m) => (
            <p key={m.id} className="mt-1 whitespace-pre-wrap text-amber-900">
              &ldquo;{m.body}&rdquo; <span className="text-xs text-amber-800">· {m.at}</span>
            </p>
          ))}
          <p className="mt-1 text-xs text-amber-900">
            Their reply put this registration back in front of staff. The whole conversation is in{' '}
            <PanelLink to="family-messages">Notes to and from the family</PanelLink>
            ; writing back to them there also marks this as read.
          </p>
          {canWrite && (
            <button
              type="button"
              disabled={pending}
              onClick={markRead}
              className="btn-outline py-1.5! mt-2 text-sm"
            >
              Mark as read
            </button>
          )}
        </div>
      )}
      {waitlisted.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-bold">Waitlisted</p>
          <ul className="mt-1 space-y-1">
            {waitlisted.map((p) => (
              <li key={p.id}>
                <PanelLink to={`person-${p.id}`} className="font-semibold underline">
                  {p.name || 'Person'}
                </PanelLink>
                {' — '}
                {p.waitlistReason ? <>&ldquo;{p.waitlistReason}&rdquo;</> : <em>no reason recorded</em>}
                {changedNote(p)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">The family sees the reason on their dashboard.</p>
        </div>
      )}
      {confirmed.length > 0 && (
        <p className="mb-3 text-sm text-neutral-700">
          <span className="font-semibold">Confirmed:</span>{' '}
          {confirmed.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <PanelLink to={`person-${p.id}`} className="underline">
                {p.name || 'Person'}
              </PanelLink>
              {changedNote(p)}
            </span>
          ))}
        </p>
      )}
      {cls && (
        <p className="text-sm mb-3">
          <span className={`inline-block rounded-sm px-2 py-0.5 font-semibold ${cls.cls}`}>{cls.label}</span>{' '}
          <span className="text-neutral-600">
            {hint}
            {review.deposit_expected_cents > 0 && (
              <>
                {' '}· received {money(review.confirmed_paid_cents)} of a {money(review.deposit_expected_cents)} deposit
              </>
            )}
          </span>
        </p>
      )}
      {flags.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {flags.map((f) => {
            // The Creed, once staff have talked with Larry (0129): calm, with
            // who, when and the note, and an Undo for Registration write.
            if (f === 'creed_not_affirmed' && creedDiscussed) {
              return (
                <li key={f} className="text-neutral-700">
                  <span aria-hidden>✓</span> {REVIEW_FLAG[f]} — talked with Larry, {when(creedDiscussed.at)}
                  {creedDiscussed.by ? ` (${creedDiscussed.by})` : ''}
                  {creedDiscussed.note ? <>: &ldquo;{creedDiscussed.note}&rdquo;</> : ''}
                  {canWrite && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm('Remove the record that you talked with Larry about the Creed?')) {
                          run('clear_creed_discussed');
                        }
                      }}
                      className="ml-2 text-xs underline"
                    >
                      Undo
                    </button>
                  )}
                </li>
              );
            }
            if (f === 'creed_not_affirmed') {
              return (
                <li key={f}>
                  <span className="font-semibold text-amber-800">⚑ {REVIEW_FLAG[f]}</span>
                  {canWrite && !creedNoting && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setCreedNoting(true)}
                      className="btn-outline py-1! ml-2 text-xs"
                    >
                      Talked with Larry…
                    </button>
                  )}
                  {canWrite && creedNoting && (
                    <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <label className="block text-sm font-semibold mb-1" htmlFor="creed-note">
                        Talked with Larry about the Apostles&rsquo; Creed
                      </label>
                      <input
                        id="creed-note"
                        value={creedNote}
                        onChange={(e) => setCreedNote(e.target.value)}
                        maxLength={500}
                        placeholder="Note (optional) — e.g. spoke by phone; happy for them to serve"
                        className="w-full rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-xs text-neutral-500">
                        Recorded with your name and today&rsquo;s date. Keep it factual: the
                        family&rsquo;s own account can read this registration&rsquo;s record.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run('creed_discussed', { reason: creedNote })}
                          className="btn-primary py-1.5! text-sm disabled:opacity-50"
                        >
                          {pending ? 'Saving…' : 'Record it'}
                        </button>
                        <button type="button" onClick={() => setCreedNoting(false)} className="text-sm underline">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            }
            // Photo permission declined: kept, because the camp photographer
            // needs the list (Lawrence, 26 Oct 2026).
            if (f === 'media_declined') {
              return (
                <li key={f}>
                  <span className="font-semibold text-amber-800">⚑ {REVIEW_FLAG[f]}</span>
                  {eventId && (
                    <Link
                      href={`/admin/rosters/photos/?event=${eventId}`}
                      className="ml-2 text-xs font-semibold text-brand underline"
                    >
                      Photographer&rsquo;s list →
                    </Link>
                  )}
                </li>
              );
            }
            return (
              <li key={f} className="font-semibold text-amber-800">
                ⚑ {REVIEW_FLAG[f] ?? f}
              </li>
            );
          })}
        </ul>
      )}

      {depositWaived && (
        <div className="mb-3 rounded-sm border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          <p>
            <span className="font-semibold">Deposit waived</span> on {when(depositWaived.at)}
            {depositWaived.reason && <> — &ldquo;{depositWaived.reason}&rdquo;</>}. Each fee-paying person holds a
            scholarship of at least the per-person deposit; the registration counts as deposit-received.
          </p>
          {/* Undoing it (0127; Lawrence, 26 Oct 2026: "suppose it was done in
              error??"). Each person's scholarship from before the waiver comes
              back, unless staff have decided it since; nobody is un-approved. */}
          {canDecide && !undoing && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setUndoing(true)}
              className="mt-1 text-xs text-green-900 underline"
            >
              Undo waiver…
            </button>
          )}
          {canDecide && undoing && (
            <div className="mt-2">
              <input
                value={undoReason}
                onChange={(e) => setUndoReason(e.target.value)}
                maxLength={300}
                placeholder="Why it is being undone (required) — e.g. waived on the wrong family"
                className="w-full rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending || !undoReason.trim()}
                  onClick={() => {
                    if (
                      window.confirm(
                        'This takes back the deposit scholarship it granted. Anyone already approved stays approved; the registration will show its real deposit again.'
                      )
                    ) {
                      run('undo_deposit_waiver', { reason: undoReason });
                    }
                  }}
                  className="btn-outline py-1.5! text-sm disabled:opacity-50"
                >
                  {pending ? 'Saving…' : 'Undo the waiver'}
                </button>
                <button type="button" onClick={() => setUndoing(false)} className="text-sm underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Waiving the deposit (Larry, 16 Oct 2026): the registrar grants the
          per-person deposit as a scholarship and the registration counts as
          deposit-received, so approval can go ahead. Offered only while the
          deposit is actually the thing in the way. */}
      {canDecide && !depositWaived && cls && review?.review_class === 'neither' && depositCents > 0 && (
        <div className="mb-4">
          {!waiving ? (
            <button type="button" disabled={pending} onClick={() => setWaiving(true)} className="btn-outline py-1.5! text-sm">
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
                className="w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run('waive_deposit', { reason: waiveReason })}
                  className="btn-primary py-1.5! text-sm disabled:opacity-50"
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
          {canWrite && <button
            type="button"
            disabled={pending}
            onClick={() => run('lift_hold')}
            className="btn-outline py-1.5! mt-2 text-sm"
          >
            Lift the hold without deciding
          </button>}
        </div>
      )}
      {canWrite && !hold?.since && canHold && (
        <div className="mb-4">
          {!holding ? (
            <button type="button" disabled={pending} onClick={() => setHolding(true)} className="btn-outline py-1.5! text-sm">
              Put on hold…
            </button>
          ) : (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-sm font-semibold mb-1">Put this registration on hold?</p>
              <p className="text-xs text-neutral-600 mb-2">
                Everyone confirmed or waitlisted goes back to <em>submitted</em> and the
                registration returns to Awaiting Review. The reason is shown to the family.
                Nothing is emailed — write to them from Outlook if they should hear from you.
              </p>
              <input
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                maxLength={1000}
                placeholder="e.g. Sam's seizure plan changed — the nurse needs to look again"
                className="w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending || !holdReason.trim()}
                  onClick={() => run('hold', { reason: holdReason })}
                  className="btn-primary py-1.5! text-sm disabled:opacity-50"
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
            Not counted as waiting on staff while this is set. The family can reply from their
            dashboard, which brings it back to staff by itself; their edits still arrive in Recent
            Changes.
          </p>
          {canWrite && <button
            type="button"
            disabled={pending}
            onClick={() => run('answered')}
            className="btn-outline py-1.5! mt-2 text-sm"
          >
            The family has answered — back to staff
          </button>}
        </div>
      )}

      {/* Who is still undecided (26 Oct 2026), as plainly as who is
          waitlisted or confirmed above: each person a link to their row,
          with their role, directly above the buttons that decide them. */}
      {waiting.length > 0 && (
        <div className="mb-3 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-bold">
            {canWrite ? 'Waiting on your decision' : 'Waiting on a decision'}
            {onFamily && <span className="font-normal"> — the family has been asked for more first</span>}
          </p>
          <ul className="mt-1 space-y-1">
            {waiting.map((p) => (
              <li key={p.id}>
                <PanelLink to={`person-${p.id}`} className="font-semibold underline">
                  {p.baseName || p.name || 'Person'}
                </PanelLink>
                {p.role && <span className="text-sky-900"> — {p.role}</span>}
              </li>
            ))}
          </ul>
          {canWrite && (
            <p className="mt-1 text-xs">
              Approving confirms them and takes the family out of Awaiting Review. One at a time:{' '}
              <PeopleLink />.
            </p>
          )}
        </div>
      )}

      {!canWrite ? (
        <p className="text-sm text-neutral-600">
          Read only — approving, waitlisting and asking the family need Registration write.
        </p>
      ) : waiting.length === 0 ? (
        <p className="text-sm text-neutral-600">
          Nobody on this registration is waiting on review. Each person&rsquo;s status is in{' '}
          <PeopleLink />.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run('approve')}
              className="btn-primary py-1.5! text-sm disabled:opacity-50"
            >
              {pending ? 'Saving…' : `Approve ${waiting.length === 1 ? 'this person' : `all ${waiting.length}`}`}
            </button>
            {!waitlisting && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setWaitlisting(true)}
                className="btn-outline py-1.5! text-sm"
              >
                Waitlist {waiting.length === 1 ? 'this person' : `all ${waiting.length}`}…
              </button>
            )}
            {!asking && (
              <button
                type="button"
                disabled={pending}
                onClick={() => setAsking(true)}
                className="btn-outline py-1.5! text-sm"
              >
                Ask the family for more information…
              </button>
            )}
          </div>
          {/* Waitlisting says why (0128): required, and the family reads it. */}
          {waitlisting && (
            <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <label className="block text-sm font-semibold mb-1" htmlFor="waitlist-reason">
                Why {waiting.length === 1 ? 'is this person' : 'are they'} waitlisted?
              </label>
              <textarea
                id="waitlist-reason"
                rows={2}
                value={waitlistReason}
                onChange={(e) => setWaitlistReason(e.target.value)}
                maxLength={500}
                placeholder="e.g. The camper cabins are full for this week; we will call if a place opens."
                className="w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-neutral-500">
                The family can see this reason. It is kept with each person and shown at the top of
                this card; nothing is emailed.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending || !waitlistReason.trim()}
                  onClick={() => run('waitlist', { reason: waitlistReason })}
                  className="btn-primary py-1.5! text-sm disabled:opacity-50"
                >
                  {pending ? 'Saving…' : `Waitlist ${waiting.length === 1 ? 'this person' : `all ${waiting.length}`}`}
                </button>
                <button type="button" onClick={() => setWaitlisting(false)} className="text-sm underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
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
                className="w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Sent to the family as a note on their dashboard, and recorded here as the reason
                this registration is waiting on them. They reply on their dashboard, and the reply
                brings it back to staff. Nothing is emailed automatically — write to them as well
                if it is urgent.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={pending || !reason.trim()}
                  onClick={() => run('ask', { reason })}
                  className="btn-primary py-1.5! text-sm disabled:opacity-50"
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
        <p className="mt-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}
    </Panel>
  );
}
