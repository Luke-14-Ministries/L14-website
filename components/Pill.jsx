// The one status pill on staff pages (23 Nov 2026, the admin review: four
// pages drew square chips and the rest round ones, in a dozen sizes). Round,
// small and bold, coloured by meaning through PILL_TONE in lib/format.js:
//   hold     red    holds approval
//   blocked  solid  red, white words (Not permitted)
//   todo     amber  to do, does not hold anything
//   done     green  current and OK
//   waiting  blue   waiting on someone else (the family, VolunteerBadge)
//   na       gray   doesn't apply, or nothing due
//   info     teal   a plain label that is not a state
//
// No 'use client' and no hooks, so server pages and client tables both use
// it. A helper that already returns a class string (statusPill(),
// clearancePill(), allergyPill()) passes it as `cls` in place of a tone.

import { PILL_TONE } from '@/lib/format';

export const PILL_SHAPE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold';

export default function Pill({ tone = 'na', cls, title, className = '', children }) {
  return (
    <span title={title} className={`${PILL_SHAPE} ${cls ?? PILL_TONE[tone] ?? PILL_TONE.na} ${className}`}>
      {children}
    </span>
  );
}

// The colour key, one line of small pills (Background Checks' intro).
export function PillKey({ items, className = '' }) {
  return (
    <p className={`flex flex-wrap items-center gap-1.5 text-xs text-neutral-600 ${className}`}>
      <span className="font-semibold">Colors:</span>
      {items.map(([tone, words]) => (
        <Pill key={tone} tone={tone}>
          {words}
        </Pill>
      ))}
    </p>
  );
}
