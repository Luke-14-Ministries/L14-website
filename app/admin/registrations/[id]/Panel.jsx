'use client';

import { useEffect, useState } from 'react';
import FoldArrow from '@/components/FoldArrow';

// A card that folds.
//
// Asked for 25 Aug: a registrar arriving to check ONE thing reads past
// household details, agreements, payments and a people list to reach it.
// Open by default, because most visits want most of the page — this is about
// getting things out of the way, not hiding them.
//
// Since 26 Oct 2026 the registration page passes defaultOpen card by card
// (Lawrence: "everything default open when items are outstanding and default
// folded when done"); each card's rule is written beside it in
// RegistrationManager. It only sets the first state: a card someone opened
// or folded stays that way when the page refreshes after a save.
//
// Deliberately NOT remembered between visits. A card someone folded in June
// staying folded in July is how a registrar stops seeing the payments panel
// and never notices they have stopped.
//
// Its own file from 15 Oct 2026, so the "how it is being paid" card
// (StaffPlanPanel, built by page.jsx) could fold the same way as every card
// above it; it used to be the one card with no title and no fold (Lawrence,
// 15 Oct). Since 26 Oct it is a section inside the Money card instead.
//
// Linked to (26 Oct 2026): a link to "#<id>" -- or, with opensFor, to any
// "#<opensFor>..." inside the card, such as one person's row in People on
// this week -- opens a folded card and scrolls to the target once it is
// drawn. A folded card's contents are not in the page, so the browser's own
// jump to the anchor would find nothing. Use PanelLink below for such links:
// it also works when the address already ends in that anchor. opensFor may
// be a list, for a card holding several linked sections (Money: #payments,
// #plan).
export default function Panel({ title, count = null, children, defaultOpen = true, id, opensFor = null }) {
  // count may be a number ("3") or a phrase ("4 signed") — whichever says the
  // most in the fewest characters for that card.
  const [open, setOpen] = useState(defaultOpen);
  const [scrollTo, setScrollTo] = useState(null);
  // Joined into one string so a list written inline does not re-run the
  // effect below on every render.
  const opensKey = opensFor == null ? '' : [].concat(opensFor).join('|');
  useEffect(() => {
    if (!id && !opensKey) return undefined;
    const prefixes = opensKey ? opensKey.split('|') : [];
    const check = () => {
      const target = decodeURIComponent(window.location.hash.slice(1));
      if (!target) return;
      if (target === id || prefixes.some((p) => target.startsWith(p))) {
        setOpen(true);
        setScrollTo({ target });
      }
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [id, opensKey]);
  useEffect(() => {
    if (open && scrollTo) document.getElementById(scrollTo.target)?.scrollIntoView({ block: 'start' });
  }, [open, scrollTo]);
  return (
    <div id={id} className="rounded-lg bg-white border border-neutral-200 shadow-xs scroll-mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg px-6 py-4 text-left hover:bg-neutral-50"
      >
        <span className="flex items-center gap-2">
          <FoldArrow open={open} />
          <span className="text-lg font-bold">{title}</span>
          {count != null && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
              {count}
            </span>
          )}
        </span>
      </button>
      {open && <div className="border-t border-neutral-100 px-6 pb-6 pt-4">{children}</div>}
    </div>
  );
}

// An in-page link to a Panel, or to something inside one (see opensFor). A
// plain <a href="#x"> fires no hashchange when the address already ends in
// #x -- after the card was folded again, say -- so this one announces it.
export function PanelLink({ to, className = 'underline', children }) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={() => {
        if (decodeURIComponent(window.location.hash.slice(1)) === to) {
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        }
      }}
    >
      {children}
    </a>
  );
}
