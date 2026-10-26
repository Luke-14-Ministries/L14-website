'use client';

// A white card whose body folds away under its title -- the same disclosure
// pattern as My Registrations on the dashboard (RegistrationsPanel.jsx): a
// real button inside the heading, so the heading stays a heading for screen
// readers and the button says whether the card is open. `badges` stay in the
// title, so what matters is visible with the card closed.

import { useId, useState } from 'react';

export default function FoldCard({ title, badges = null, defaultOpen = true, className = '', children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className={`rounded-lg bg-white border border-neutral-200 shadow-xs p-6 ${className}`}>
      <h4 className="font-bold">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span>{title}</span>
            {badges}
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
      </h4>
      <div id={bodyId} hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  );
}
