'use client';

// The dashboard's Support details card. While anyone's details are still
// owed it is simply open, with no fold control: there is work in it. Once
// every attending person's details are on file it starts folded, and its
// title becomes the site's one fold control -- the ▶ at the left of the
// heading (FoldArrow), the "All N on file" badge beside it (26 Oct 2026:
// one fold pattern everywhere).

import { useId, useState } from 'react';
import FoldArrow from '@/components/FoldArrow';

export default function SupportDetailsCard({ title = 'Support details', allDone = false, count = 0, children }) {
  const [open, setOpen] = useState(!allDone);
  const bodyId = useId();

  return (
    <div className="mb-8 rounded-lg bg-white border border-neutral-200 shadow-xs p-6">
      {allDone ? (
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
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
              All {count} on file ✓
            </span>
          </button>
        </h2>
      ) : (
        <h2 className="text-xl font-bold">{title}</h2>
      )}
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
