// One family's folded row on Awaiting Review (Lawrence, 11 Nov 2026): whether
// staff still have something to do on this tab, and the pills that say why.
// Pure functions over the row the page builds (app/admin/review/page.jsx), so
// the rule lives in one place and can be checked without a database.

import { REVIEW_CLASS, reviewClassLabel } from './plans';

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const QUIET = 'bg-neutral-100 text-neutral-600';
const AMBER = 'bg-amber-100 text-amber-900';

// Does staff have something to do for this family on THIS tab? Someone still
// submitted (and not parked with the family), an unread reply, or the thing
// the tab is about (an outstanding waiver, a plan problem). A row that needs
// nothing reads plainly different: no amber edge, quiet pills.
export function reviewRowNeedsStaff(r, show) {
  if (r.familyReplied) return true;
  if (show === 'waiver') return r.owed.length > 0;
  if (show === 'plan') return r.planStopped || Boolean(r.planFailing);
  return r.pending.length > 0 && !r.awaitingSince;
}

// Everything the Flags column lists as a ⚑, counted.
export function reviewRowFlagCount(r) {
  return (
    r.flags.length +
    (r.creed?.pending?.length > 0 ? 1 : 0) +
    r.ageFlags.length +
    r.owed.length +
    (r.planStopped ? 1 : 0) +
    (r.planFailing ? 1 : 0)
  );
}

// [{ text, cls, title }], in reading order.
export function reviewRowPills(r, { show, seesMoney }) {
  const busy = reviewRowNeedsStaff(r, show);
  const out = [];
  if (r.familyReplied) {
    out.push({ text: '✉ Family replied', cls: `${AMBER} ring-1 ring-amber-400` });
  }
  if (r.pending.length > 0) {
    out.push(
      r.awaitingSince
        ? { text: `${r.pending.length} waiting on the family`, cls: QUIET, title: r.awaitingReason ?? '' }
        : { text: `${r.pending.length} to review`, cls: busy ? AMBER : QUIET }
    );
  } else {
    out.push({ text: 'Nobody to review', cls: QUIET });
  }
  const cls = r.review ? REVIEW_CLASS[r.review.review_class] : null;
  if (cls) {
    // The money class keeps its own colour, except that a row needing nothing
    // from staff shows no amber at all.
    const amber = r.review.review_class === 'neither';
    out.push({ text: reviewClassLabel(r.review), cls: amber && !busy ? QUIET : cls.cls, title: cls.hint });
  }
  const n = reviewRowFlagCount(r);
  if (n > 0) {
    out.push({
      text: `⚑ ${n} ${n === 1 ? 'flag' : 'flags'}`,
      cls: r.planStopped ? 'bg-red-100 text-red-800' : busy ? AMBER : QUIET,
    });
  }
  if (seesMoney && r.balance) {
    const bal = r.balance.balance_cents ?? 0;
    out.push({
      text: `${money(r.balance.paid_cents)} paid · ${bal < 0 ? `${money(-bal)} credit` : `${money(bal)} owed`}`,
      cls: 'bg-white text-neutral-600 ring-1 ring-neutral-200',
    });
  }
  return out;
}
