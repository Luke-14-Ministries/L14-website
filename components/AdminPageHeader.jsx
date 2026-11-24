import BackLink from './BackLink';

// The top of every staff page (23 Nov 2026, the admin review: some pages
// put the title in a white card, some on the gray, some with the buttons
// above the words and some below). Bare on the gray background, in one
// order: the title (an h2; the site's h1 is the staff header), any actions
// on the right of it, then the intro, then the page's own cards below.
//
//   title    the page's name, the same words as its menu item
//   intro    one short paragraph, or a node (a link inside it)
//   actions  buttons or links on the title's line (btn-outline btn-sm)
//   back     { href, label }: the back pill, on the title's line too
//   children anything that belongs with the intro (a colour key)
//
// No 'use client', so server pages render it directly.

export default function AdminPageHeader({ title, intro, actions, back, className = '', children }) {
  return (
    <div className={`mb-6 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="min-w-0 text-xl font-bold">{title}</h2>
        {(actions || back) && (
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {back && <BackLink href={back.href} label={back.label} />}
          </div>
        )}
      </div>
      {intro && <div className="mt-1 max-w-4xl text-sm text-neutral-600">{intro}</div>}
      {children}
    </div>
  );
}
