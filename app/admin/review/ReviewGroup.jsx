'use client';

// One event's families on Awaiting Review, each a row that folds (Lawrence,
// 11 Nov 2026: with more families registering, the full list of people and
// flags under every family was getting overwhelming).
//
// Folded, a row is one line: the family (the link to the registration), when
// they registered, and pills saying whether staff still have something to do
// and why. Unfolded, it shows the people, money and flags exactly as before.
// Everything starts folded; "Expand all / Collapse all" works on this event.
//
// The page builds each row's pills and body on the server; this only holds
// which rows are open. A folded row's body is not mounted, as on the family
// dashboard's RegistrationCard.

import { useState } from 'react';
import Link from 'next/link';

const PILL = 'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold';

export default function ReviewGroup({ rows }) {
  const [open, setOpen] = useState(() => new Set());
  const allOpen = rows.length > 0 && rows.every((r) => open.has(r.id));
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {rows.length > 1 && (
        <div className="mb-1.5 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(allOpen ? new Set() : new Set(rows.map((r) => r.id)))}
            className="text-xs font-semibold text-brand underline"
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      )}
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {rows.map((r) => {
          const isOpen = open.has(r.id);
          const bodyId = `review-row-${r.id}`;
          return (
            <li
              key={r.id}
              // Amber edge: staff have something to do here. None: nothing
              // for staff on this tab, so it reads plainly different.
              className={`border-l-4 ${r.needsStaff ? 'border-l-amber-400' : 'border-l-transparent bg-neutral-50/60'}`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggle(r.id)}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? bodyId : undefined}
                  className="-my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                >
                  <span aria-hidden className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                    ▸
                  </span>
                  <span className="sr-only">
                    {isOpen ? 'Hide' : 'Show'} details for {r.household}
                  </span>
                </button>
                <Link href={r.href} className="font-medium text-brand-dark hover:underline">
                  {r.household}
                </Link>
                <span className="text-xs text-neutral-500">registered {r.registered}</span>
                <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                  {r.pills.map((p, i) => (
                    <span key={i} className={`${PILL} ${p.cls}`} title={p.title || undefined}>
                      {p.text}
                    </span>
                  ))}
                </span>
              </div>
              {isOpen && (
                <div id={bodyId} className="border-t border-neutral-100 px-3 pb-3 pt-2 sm:pl-13">
                  {r.body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
