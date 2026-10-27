'use client';

// A white card whose body folds away under its title -- the same disclosure
// pattern as My Registrations on the dashboard (RegistrationsPanel.jsx): a
// real button inside the heading, so the heading stays a heading for screen
// readers and the button says whether the card is open. `badges` stay in the
// title, so what matters is visible with the card closed. The fold arrow is
// the site's one marker (FoldArrow), at the left of the title.

import { useId, useState } from 'react';
import FoldArrow from './FoldArrow';

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
          className="flex w-full flex-wrap items-center gap-2 text-left"
        >
          <FoldArrow open={open} />
          <span>{title}</span>
          {badges}
        </button>
      </h4>
      <div id={bodyId} hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  );
}
