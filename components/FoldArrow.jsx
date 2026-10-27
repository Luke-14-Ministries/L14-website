// The one fold/expand marker on the site (Lawrence, 26 Oct 2026: "I expect it
// in upper left corner of card, not upper right... be consistent
// EVERYWHERE!"). A ▶ at the LEFT of a folding card's or section's title,
// turned to point down while it is open. It sits inside the heading's button
// (which carries aria-expanded); there is no arrow, chevron or "Show / Hide"
// word at the right edge -- counts and badges may sit there.
//
// No hooks, so it renders on the server or in a client component alike. For a
// native <details>, give the <summary> the `fold-summary` class (globals.css),
// which draws the same arrow.

export const FOLD_ARROW = 'inline-block shrink-0 text-[0.75em] leading-none text-neutral-400 transition-transform';

export default function FoldArrow({ open, className = '' }) {
  return (
    <span aria-hidden className={`${FOLD_ARROW} ${open ? 'rotate-90' : ''} ${className}`}>
      ▶
    </span>
  );
}
