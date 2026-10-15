'use client';

import { useState } from 'react';

// A card that folds.
//
// Asked for 25 Aug: a registrar arriving to check ONE thing reads past
// household details, agreements, payments and a people list to reach it.
// Open by default, because most visits want most of the page — this is about
// getting things out of the way, not hiding them.
//
// Deliberately NOT remembered between visits. A card someone folded in June
// staying folded in July is how a registrar stops seeing the payments panel
// and never notices they have stopped.
//
// Its own file from 15 Oct 2026, so the "how it is being paid" card at the
// bottom of the page (StaffPlanPanel, rendered by page.jsx beside the
// manager) folds the same way as every card above it. It used to be the one
// card with no title and no fold (Lawrence, 15 Oct).
export default function Panel({ title, count = null, children, defaultOpen = true, id }) {
  // count may be a number ("3") or a phrase ("4 signed") — whichever says the
  // most in the fewest characters for that card.
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div id={id} className="rounded-lg bg-white border border-neutral-200 shadow-sm scroll-mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-6 py-4 text-left hover:bg-neutral-50"
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`text-xs text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          <span className="text-lg font-bold">{title}</span>
          {count != null && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
              {count}
            </span>
          )}
        </span>
        <span className="text-xs text-neutral-400">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="border-t border-neutral-100 px-6 pb-6 pt-4">{children}</div>}
    </div>
  );
}
