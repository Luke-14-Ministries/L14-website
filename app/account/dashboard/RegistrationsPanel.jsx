'use client';

// The whole "My Registrations" card, collapsible to its title (Lawrence,
// 26 Oct 2026: "whole My Registrations card should be collapsible? and
// flagged if there are outstanding?").
//
// Open by default, always: it is the dashboard's main card, and a family
// arriving with something outstanding must land on it. The title carries a
// summary chip -- amber "N need something" when any registration has a
// "Needs:" chip of its own, green "All set" otherwise -- so a closed card is
// still honest about what is inside. A closed choice is kept for this visit
// only (visitChoice.js), keyed on what is outstanding.
//
// The body is HIDDEN, not unmounted: the registrations keep their own open
// rows, a half-typed payment amount and the cancel disclosure while the card
// is closed. `hidden` is display:none, so nothing inside is focusable while
// it cannot be seen.

import { useId } from 'react';
import { useVisitChoice } from './visitChoice';

export default function RegistrationsPanel({
  className = '',
  needCount = 0,
  hasRegistrations = false,
  stateKey,
  children,
}) {
  const [open, setOpen] = useVisitChoice(stateKey, true);
  const bodyId = useId();

  return (
    <div className={`rounded-lg bg-white border border-neutral-200 shadow-xs p-6 ${className}`}>
      <h2 className="text-xl font-bold">
        {/* A real button inside the heading (the disclosure pattern): the
            heading stays a heading for screen-reader navigation, and the
            button announces whether the card is open. */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span>My Registrations</span>
            {needCount > 0 ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
                {needCount} {needCount === 1 ? 'needs' : 'need'} something
              </span>
            ) : hasRegistrations ? (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                All set
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-2 text-sm font-normal text-neutral-500">
            {open ? 'Hide' : 'Show'}
            <span
              aria-hidden
              className={`inline-block text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
            >
              ▶
            </span>
          </span>
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="mt-4">
        {children}
      </div>
    </div>
  );
}
