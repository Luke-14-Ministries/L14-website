'use client';

// One family scholarship request (0159, Lawrence 10 Nov 2026) and the one
// decision staff make about it. Shared by the Scholarship Requests queue and
// the registration page, like ScholarshipReview, so a decision means the same
// thing wherever it is made.
//
// Staff award dollars. A family that asked for a percentage sees it turned
// into dollars here; the award then stays put if fees or discounts change.
// The site splits it over the people by each person's fee, never more than
// each owes, and shows the split before anyone presses Approve.
//
// Amber while it needs a decision, or once decided if someone was added or
// removed since (the flag); the next decision clears it.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { decideFamilyScholarship, declineFamilyScholarship } from './actions';
import { dayInMorristown } from '@/lib/events';

const money = (c) => (typeof c === 'number' ? `$${(c / 100).toFixed(2)}` : '—');

const SETTLED = {
  granted: ['Granted', 'bg-green-100 text-green-800'],
  declined: ['Not granted', 'bg-neutral-200 text-neutral-700'],
  withdrawn: ['Withdrawn by family', 'bg-neutral-100 text-neutral-500'],
};

// The same split the database makes (split_by_weight, 0159): by fee, capped
// at what each owes, whole cents, leftovers to the largest remainders. A
// preview only; the database's answer is the one saved.
function previewSplit(total, people) {
  const n = people.length;
  const out = new Array(n).fill(0);
  const active = people.map((p) => (p.feeCents ?? 0) > 0 && (p.owesCents ?? 0) > 0);
  let left = Math.max(0, total);
  for (;;) {
    const w = people.reduce((t, p, i) => t + (active[i] ? p.feeCents : 0), 0);
    if (w === 0 || left === 0) break;
    let capped = false;
    people.forEach((p, i) => {
      if (active[i] && (left * p.feeCents) / w >= p.owesCents) {
        out[i] = p.owesCents;
        active[i] = false;
        capped = true;
      }
    });
    if (capped) {
      left = Math.max(0, total - out.reduce((t, v, i) => t + (active[i] ? 0 : v), 0));
      continue;
    }
    const frac = new Array(n).fill(-1);
    let given = 0;
    people.forEach((p, i) => {
      if (!active[i]) return;
      const ideal = (left * p.feeCents) / w;
      out[i] = Math.floor(ideal);
      frac[i] = ideal - Math.floor(ideal);
      given += out[i];
    });
    while (given < left) {
      let best = -1;
      for (let i = 0; i < n; i += 1) if (active[i] && out[i] < people[i].owesCents && (best < 0 || frac[i] > frac[best])) best = i;
      if (best < 0) break;
      out[best] += 1;
      frac[best] = -2;
      given += 1;
    }
    break;
  }
  return out;
}

function askText(row) {
  if (row.askKind === 'percent') {
    const dollars = row.familyOwesCents != null ? Math.round((row.familyOwesCents * row.askPercent) / 100) : null;
    return (
      <>
        Asked for <span className="font-semibold">{row.askPercent}%</span>
        {dollars != null && (
          <>
            , which is <span className="font-semibold">{money(dollars)}</span> of the {money(row.familyOwesCents)} the
            family owes
          </>
        )}
      </>
    );
  }
  if (row.askKind === 'amount') {
    return (
      <>
        Asked for <span className="font-semibold">{money(row.askCents)}</span>
        {row.familyOwesCents != null && <> toward the {money(row.familyOwesCents)} the family owes</>}
      </>
    );
  }
  return (
    <>
      Asked for help without naming an amount
      {row.familyOwesCents != null && <> · the family owes {money(row.familyOwesCents)}</>}
    </>
  );
}

export default function FamilyScholarshipReview({ row, showRegistrationLink = false }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const flagged = row.status === 'granted' && Boolean(row.needsReviewSince);
  const isOpen = row.status === 'requested' || flagged;
  const owes = row.familyOwesCents;

  // Pre-filled: what they asked for, in dollars, capped at what the family
  // owes; on a flagged award, the award as it stands.
  const [amount, setAmount] = useState(() => {
    let c = null;
    if (flagged) c = row.grantedCents;
    else if (row.askKind === 'percent' && owes != null) c = Math.round((owes * row.askPercent) / 100);
    else if (row.askKind === 'amount') c = row.askCents;
    if (c == null) return '';
    if (owes != null) c = Math.min(c, owes);
    return (c / 100).toFixed(2);
  });
  const [note, setNote] = useState('');

  const cents = Math.round(Number.parseFloat(String(amount).replace(/[$,\s]/g, '')) * 100);
  const splitPeople = row.people.filter((p) => (p.owesCents ?? 0) > 0 && (p.feeCents ?? 0) > 0);
  const shares = Number.isFinite(cents) && cents > 0 && owes != null ? previewSplit(cents, splitPeople) : null;
  const shareOf = new Map(splitPeople.map((p, i) => [p.participantId, shares ? shares[i] : null]));

  function run(fn) {
    setError('');
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function approve() {
    if (!note.trim()) {
      setError('Add a short reason. Every scholarship decision needs one.');
      return;
    }
    run(() => decideFamilyScholarship({ registrationId: row.registrationId, amount, note }));
  }

  function decline() {
    if (!note.trim()) {
      setError('Add a short reason. The office will need it if the family asks.');
      return;
    }
    if (
      !confirm(
        `Turn down the family request for ${row.household || 'this family'}?\n\nAny amount already awarded comes off everyone's fees. They will see "Not granted this time". Your reason stays with staff.`
      )
    )
      return;
    run(() => declineFamilyScholarship({ registrationId: row.registrationId, note }));
  }

  const [settledLabel, settledClass] = SETTLED[row.status] ?? SETTLED.withdrawn;

  return (
    <div className={`rounded-lg border p-5 ${isOpen ? 'border-amber-300 bg-amber-50 shadow-xs' : 'border-neutral-200 bg-white'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">
          {row.household || 'Family'}: whole family
          {row.eventName && <span className="ml-2 text-sm font-normal text-neutral-500">{row.eventName}</span>}
        </h3>
        {flagged ? (
          <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900">
            Granted {money(row.grantedCents)} · needs another look
          </span>
        ) : isOpen ? (
          <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-900">Needs a decision</span>
        ) : (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${settledClass}`}>
            {settledLabel}
            {row.status === 'granted' && <> · {money(row.grantedCents)}</>}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-neutral-700">{askText(row)}</p>

      {flagged && row.needsReviewReason && (
        <p className="mt-2 rounded-sm border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900">
          {row.needsReviewReason} Approve again to confirm the split, change the amount, or decline.
        </p>
      )}

      {row.statement ? (
        <p className="mt-2 rounded-sm border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800">
          &ldquo;{row.statement}&rdquo;
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-neutral-500">They did not write anything.</p>
      )}

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-1 pr-3">Person</th>
            <th className="py-1 pr-3">Fee</th>
            <th className="py-1 pr-3">Owes</th>
            <th className="py-1">{isOpen ? 'Share of this award' : 'Share'}</th>
          </tr>
        </thead>
        <tbody>
          {row.people.map((p) => (
            <tr key={p.participantId} className="border-t border-neutral-200/70">
              <td className="py-1 pr-3">
                {p.name}
                {p.roleLabel && <span className="ml-1 text-xs text-neutral-500">{p.roleLabel}</span>}
                {!p.covered && row.status === 'granted' && (
                  <span className="ml-1 text-xs text-amber-800">(added after the award)</span>
                )}
              </td>
              <td className="py-1 pr-3">{money(p.feeCents)}</td>
              <td className="py-1 pr-3">{money(p.owesCents)}</td>
              <td className="py-1">
                {isOpen
                  ? shareOf.has(p.participantId) && shareOf.get(p.participantId) != null
                    ? money(shareOf.get(p.participantId))
                    : '—'
                  : p.covered
                    ? money(p.shareCents)
                    : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-xs text-neutral-500">
        {row.requestedAt && <>Asked {dayInMorristown(row.requestedAt)}</>}
        {row.reviewedAt && (
          <>
            {' '}
            · {row.status === 'requested' ? 'previously answered' : 'answered'} {dayInMorristown(row.reviewedAt)}
          </>
        )}
        {row.reviewedBy && <> by {row.reviewedBy}</>}
      </p>
      {row.staffNote && (
        <p className="mt-1 text-sm text-neutral-600">
          <span className="font-semibold">{row.status === 'requested' ? 'Staff note from last time:' : 'Staff note:'}</span>{' '}
          {row.staffNote}
        </p>
      )}

      {showRegistrationLink && (
        <div className="mt-3">
          <Link href={`/admin/registrations/${row.registrationId}`} className="text-sm text-brand underline font-semibold">
            Open the whole registration
          </Link>
        </div>
      )}

      {isOpen && (
        <div className="mt-4 border-t border-amber-200 pt-3">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1" htmlFor={`famamt-${row.id}`}>
                Award for the family ($)
              </label>
              <input
                id={`famamt-${row.id}`}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm"
              />
              {owes != null && <p className="mt-1 text-xs text-neutral-500">Up to {money(owes)}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1" htmlFor={`famnote-${row.id}`}>
                Reason <span className="font-normal text-neutral-500">(staff only)</span>{' '}
                <span className="text-red-600">*</span>
              </label>
              <input
                id={`famnote-${row.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Board hardship fund. Spoke with the family by phone."
                className="w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Needed to award or decline. Your name and the date are saved for you.
              </p>
            </div>
          </div>

          {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={approve} disabled={pending} className="btn-primary py-1.5! text-sm disabled:opacity-50">
              {pending ? 'Saving…' : flagged ? 'Approve again' : 'Approve this award'}
            </button>
            <button onClick={decline} disabled={pending} className="btn-outline py-1.5! text-sm disabled:opacity-50">
              Decline
            </button>
            <span className="text-xs text-neutral-600">
              The award is shared out by each person&rsquo;s fee and comes straight off what the family owes.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
