// One family's row on Awaiting Review, unfolded: the People, Money, Flags and
// Paid / balance columns the table showed before rows folded (Lawrence,
// 11 Nov 2026), unchanged, side by side on a computer and stacked on a phone.
// A server component: ReviewGroup mounts it only when its row is open.

import Link from 'next/link';
import { REVIEW_CLASS, REVIEW_FLAG, reviewClassLabel, planFailingNext } from '@/lib/plans';
import { statusPill } from '@/lib/format';
import { dayInMorristown } from '@/lib/events';

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

export default function ReviewRowBody({ r, seesMoney, nameOf }) {
  const cls = r.review ? REVIEW_CLASS[r.review.review_class] : null;
  const flags = r.flags;
  return (
    <div className="grid gap-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto]">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">People</p>
        <div className="font-medium">
          {r.pending.length} of {r.people.length} waiting
        </div>
        <ul className="mt-1 space-y-0.5">
          {r.people.map((p, i) => {
            const pill = statusPill(p.status);
            return (
              <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span>
                  {p.people?.first_name} {p.people?.last_name}
                </span>
                <span className="text-neutral-400">· {p.camp_role?.replace('_', '/')}</span>
                <span className={`rounded-sm px-1.5 py-0.5 font-semibold ${pill.cls}`}>
                  {pill.text}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Money</p>
        {cls ? (
          <span
            title={cls.hint}
            className={`inline-block whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs font-semibold ${cls.cls}`}
          >
            {reviewClassLabel(r.review)}
          </span>
        ) : (
          <span className="text-neutral-400">—</span>
        )}
        {r.review?.deposit_expected_cents > 0 && (
          <div className="mt-1 text-xs text-neutral-500">
            {money(r.review.confirmed_paid_cents)} of a{' '}
            {money(r.review.deposit_expected_cents)} deposit
          </div>
        )}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Flags</p>
        {flags.length === 0 && !r.creed && r.ageFlags.length === 0 && !r.awaitingSince && r.owed.length === 0 && !r.planStopped && !r.planFailing && !r.familyReplied ? (
          <span className="text-neutral-400">—</span>
        ) : (
          <ul className="space-y-0.5">
            {r.familyReplied && (
              <li>
                {/* Straight to the conversation (Lawrence, 28 Oct 2026). */}
                <Link
                  href={`/admin/registrations/${r.id}/#family-messages`}
                  className="inline-block whitespace-nowrap rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-400 hover:bg-amber-200"
                >
                  ✉ Family replied
                  {r.familyRepliedAt ? ` ${dayInMorristown(r.familyRepliedAt)}` : ''}
                </Link>
              </li>
            )}
            {r.planStopped && (
              <li className="whitespace-nowrap text-xs font-semibold text-red-700">
                ⚑ Payment plan stopped
                {r.planStoppedAt ? ` ${dayInMorristown(r.planStoppedAt)}` : ''}
              </li>
            )}
            {r.planFailing && (
              <li className="whitespace-nowrap text-xs font-semibold text-amber-800">
                ⚑ Plan payment failed
                {r.planFailing.since ? ` ${dayInMorristown(r.planFailing.since)}` : ''}.{' '}
                {planFailingNext(r.planFailing)}
              </li>
            )}
            {r.ageFlags.map((f) => (
              <li key={f.text} className="text-xs font-semibold text-amber-800">
                ⚑ {f.text}
              </li>
            ))}
            {r.creed?.pending.length > 0 && (
              <li className="text-xs font-semibold text-amber-800">
                ⚑ {REVIEW_FLAG.creed_not_affirmed}: {r.creed.pending.map((p) => p.name).join(', ')}
              </li>
            )}
            {r.creed?.covered.length > 0 && (
              // Talked through with Larry (0130): informs, no longer alarms.
              <li className="text-xs text-neutral-600">
                ✓ {REVIEW_FLAG.creed_not_affirmed}: {r.creed.covered.map((c) => c.name).join(', ')},
                talked with Larry
              </li>
            )}
            {flags.map((f) => (
              <li key={f} className="whitespace-nowrap text-xs font-semibold text-amber-800">
                ⚑ {REVIEW_FLAG[f] ?? f}
              </li>
            ))}
            {r.owed.map((o) => (
              <li
                key={`${o.person_id}:${o.activity_name}:${o.kind}`}
                className="text-xs font-semibold text-amber-800"
              >
                ⚑ {o.activity_name}: {nameOf.get(`${r.id}:${o.person_id}`) || 'someone'}{' '}
                {o.kind === 'ours'
                  ? 'needs the waiver signed'
                  : o.upload_status === 'rejected'
                    ? "outfitter's confirmation rejected, needs a new upload"
                    : "needs the outfitter's confirmation"}
              </li>
            ))}
            {r.awaitingSince && (
              <li className="text-xs text-neutral-700" title={r.awaitingReason ?? ''}>
                <span className="font-semibold">Waiting on the family</span> since{' '}
                {dayInMorristown(r.awaitingSince)}
                {r.awaitingReason && (
                  <span className="block max-w-xs truncate text-neutral-500">
                    &ldquo;{r.awaitingReason}&rdquo;
                  </span>
                )}
              </li>
            )}
          </ul>
        )}
      </div>
      <div className="sm:text-right whitespace-nowrap">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Paid / balance</p>
        {seesMoney ? (
          <>
            <div>{money(r.balance?.paid_cents)}</div>
            <div className="text-xs text-neutral-500">
              {(r.balance?.balance_cents ?? 0) < 0
                ? `${money(-r.balance.balance_cents)} credit`
                : `${money(r.balance?.balance_cents)} owed`}
            </div>
          </>
        ) : (
          <span className="text-neutral-400" title="Payments read is needed to see money">
            &mdash;
          </span>
        )}
      </div>
    </div>
  );
}
