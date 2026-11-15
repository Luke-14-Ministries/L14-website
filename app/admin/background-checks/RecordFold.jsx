'use client';

// A person's background check record, folded under their row on Background
// Checks (Fable navigation review, 14 Nov 2026: recording a check by hand
// stays on this page, for volunteers and family adults alike). Opens itself
// for #check-<person id>, the link used from Volunteers, a registration and
// Background Screening, and scrolls there.

import { useEffect, useState } from 'react';

export default function RecordFold({ personId, label = 'Background check record', children }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const look = () => {
      const first = window.location.hash.match(/#[^#]+/)?.[0] ?? '';
      if (first !== `#check-${personId}`) return;
      setOpen(true);
      setTimeout(() => document.getElementById(`check-${personId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
    };
    look();
    window.addEventListener('hashchange', look);
    return () => window.removeEventListener('hashchange', look);
  }, [personId]);
  return (
    <details
      id={`check-${personId}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="scroll-mt-4 text-xs"
    >
      <summary className="cursor-pointer font-semibold text-brand">
        {/* The browser's own marker shows open or closed; no second arrow. */}
        {label}
      </summary>
      <div className="mt-1 max-w-4xl text-sm">{children}</div>
    </details>
  );
}
