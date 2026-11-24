'use client';

// A white card whose body folds away under its title -- the same disclosure
// pattern as My Registrations on the dashboard (RegistrationsPanel.jsx): a
// real button inside the heading, so the heading stays a heading for screen
// readers and the button says whether the card is open. `badges` stay in the
// title, so what matters is visible with the card closed. The fold arrow is
// the site's one marker (FoldArrow), at the left of the title.
//
// The card is the shared `card` class and the title an h3 by default (23 Nov
// 2026, the design scheme: page title h2, card title h3). `as` picks another
// level where the card sits under a section heading of its own.

import { useId, useState } from 'react';
import FoldArrow from './FoldArrow';

export default function FoldCard({ title, badges = null, defaultOpen = true, as: Heading = 'h3', className = '', children }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className={`card ${className}`}>
      <Heading className="font-bold">
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
      </Heading>
      <div id={bodyId} hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  );
}
