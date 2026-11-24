import Link from 'next/link';

// The one row of filter chips on a staff list (23 Nov 2026, the admin
// review: nine pages drew their own, some pale when selected and some solid,
// some with the count in brackets and some not, and the Awaiting Review row
// ran off a phone's edge). A wrapping row; the selected chip is solid teal;
// a count sits in a small bubble.
//
//   items    [{ key, label, count?, href?, onClick?, title?, tone? }]
//            href: a link (server pages, the filter in the URL);
//            onClick: a button (client lists). tone 'todo' (amber) or 'hold'
//            (red) outlines an unselected chip that needs attention, in the
//            pill colours (components/Pill.jsx); selected is always teal.
//   current  the selected item's key
//   label    what a screen reader hears for the row ("Show")
//
// No 'use client': a server page passes hrefs, a client list passes
// onClick. The selected link says aria-current, the selected button
// aria-pressed.

const BASE = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold';
const SELECTED = 'border-brand bg-brand text-white';
const IDLE = {
  plain: 'border-neutral-300 bg-white text-neutral-700 hover:border-brand',
  todo: 'border-amber-400 bg-amber-50 text-amber-900 hover:border-amber-600',
  hold: 'border-red-300 bg-red-50 text-red-800 hover:border-red-700',
};

function Count({ n, on }) {
  if (n === undefined || n === null) return null;
  return (
    <span
      className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-xs ${
        on ? 'bg-white/25 text-white' : 'bg-neutral-100 text-neutral-700'
      }`}
    >
      {n}
    </span>
  );
}

export default function FilterChips({ items, current, label = 'Show', className = '' }) {
  return (
    <nav aria-label={label} className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((it) => {
        const on = it.key === current;
        const cls = `${BASE} ${on ? SELECTED : (IDLE[it.tone] ?? IDLE.plain)}`;
        const body = (
          <>
            <span>{it.label}</span>
            <Count n={it.count} on={on} />
          </>
        );
        if (it.href) {
          return (
            <Link
              key={it.key || 'all'}
              href={it.href}
              title={it.title}
              aria-current={on ? 'page' : undefined}
              className={cls}
            >
              {body}
            </Link>
          );
        }
        return (
          <button
            key={it.key || 'all'}
            type="button"
            onClick={it.onClick}
            title={it.title}
            aria-pressed={on}
            className={cls}
          >
            {body}
          </button>
        );
      })}
    </nav>
  );
}
