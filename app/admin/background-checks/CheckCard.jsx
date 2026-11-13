'use client';

// One of the two parts of Background Checks, folding (Lawrence, 11 Nov 2026).
// Folded, the header still says where things stand: a summary line and pills
// for anything that needs doing. The body is mounted only when open, as on
// Awaiting Review.
//
// It starts open when the page says the part has work due (or a filter for it
// is chosen), and also when the address points at it (#volunteers or
// #registry, as the Review card's link does).

import { useEffect, useState } from 'react';

export default function CheckCard({ id, title, summary, pills = [], defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  // Opened by the address too: on arrival, and when a link on the page (the
  // intro's "Volunteers" / "Campers and families") points at this part.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    // A timer, not requestAnimationFrame: a background tab never fires the
    // latter, and a link opened in a new tab is exactly that.
    const timer = setTimeout(check, 0);
    window.addEventListener('hashchange', check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('hashchange', check);
    };
  }, [id]);
  const bodyId = `${id}-body`;

  return (
    <section id={id} className="rounded-lg border border-neutral-300 bg-neutral-50">
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          className="flex w-full items-start gap-3 rounded-lg p-4 text-left hover:bg-neutral-100"
        >
          <span aria-hidden className={`mt-1.5 inline-block text-neutral-500 transition-transform ${open ? 'rotate-90' : ''}`}>
            ▸
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-lg font-bold">{title}</span>
              <span className="flex flex-wrap gap-1.5 font-body">
                {pills.map((p, i) => (
                  <span key={i} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${p.cls}`}>
                    {p.text}
                  </span>
                ))}
              </span>
            </span>
            <span className="mt-1 block font-body text-sm font-normal text-neutral-600">{summary}</span>
          </span>
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="space-y-4 px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
