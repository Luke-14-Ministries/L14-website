import Link from 'next/link';

// The way back, at the top of a page.
//
// Same shape as the floating BackBar that appears once you have scrolled
// (25 Aug: "I like the way you've programmed the sticky/floating pill — let's
// make sure that formatting cascades"). One look for one action: the link at
// the top and the pill that follows you down the page are the same door, and
// they should not read as two different things.
//
// Deliberately NOT a client component. It does nothing but sit there; only the
// floating variant needs to watch the scroll position.

export const BACK_PILL =
  'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-sm font-semibold text-brand shadow-xs hover:bg-neutral-50';

// The title line of an account page: the heading on the left, the back pill
// on the right (Lawrence, 30 Oct 2026). It never wraps the pill under the
// title: wider than a phone, a long title wraps inside its own space; on a
// phone the pill rises above the title, still on the right.
export const TITLE_ROW =
  'flex flex-col-reverse items-end gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 [&>h1]:min-w-0 [&>h1]:self-start sm:[&>h1]:self-auto';

// `hard`: a plain anchor, a full page load, for a page whose own save changes
// what the destination shows -- the registration wizard, where a stale
// dashboard seconds after registering would read as lost data.
export default function BackLink({
  href = '/account/dashboard/',
  label = 'Back to dashboard',
  className = '',
  hard = false,
}) {
  if (hard) {
    return (
      <a href={href} className={`${BACK_PILL} ${className}`}>
        ← {label}
      </a>
    );
  }
  return (
    <Link href={href} className={`${BACK_PILL} ${className}`}>
      ← {label}
    </Link>
  );
}
