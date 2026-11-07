'use client';

// The dashboard's Support details card. Its title is always the fold control
// (Lawrence, 7 Nov 2026: "should start expanded but be collapsible with a
// notification pill in header"), the same pattern as My Registrations
// (RegistrationsPanel.jsx): the ▶ at the left (FoldArrow), and a pill beside
// the title so a closed card still says what is inside -- amber "N to finish"
// while anyone's details are owed, green "All N on file ✓" once they are.
//
// Open by default while there is work in it; folded by default once all are
// on file. A choice to close it is kept for this visit only (visitChoice.js),
// keyed on who is still owed, so someone new needing details opens it again.
//
// The body is HIDDEN, not unmounted, as in RegistrationsPanel.

import { useId } from 'react';
import { useVisitChoice } from './visitChoice';
import FoldArrow from '@/components/FoldArrow';

export default function SupportDetailsCard({
  title = 'Support details',
  allDone = false,
  count = 0,
  todoCount = 0,
  stateKey = 'l14.dashboard.support',
  children,
}) {
  const [open, setOpen] = useVisitChoice(stateKey, !allDone);
  const bodyId = useId();

  return (
    <div className="mb-8 rounded-lg bg-white border border-neutral-200 shadow-xs p-6">
      <h2 className="text-xl font-bold">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full flex-wrap items-center gap-2 text-left"
        >
          <FoldArrow open={open} />
          <span>{title}</span>
          {allDone ? (
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
              All {count} on file ✓
            </span>
          ) : todoCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
              {todoCount} to finish
            </span>
          ) : null}
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
