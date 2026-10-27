'use client';

// The admin sidebar: Overview on top, an expandable "Events" group holding
// everything event-scoped (rosters, check-in, changes, dietary, medical,
// volunteers, activities, buddies, payments), and org-level pages below.
// The group remembers open/closed per browser.

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import FoldArrow from '@/components/FoldArrow';

const OPEN_KEY = 'l14_admin_nav_events_open';

// Whether the Events group is open is a per-browser preference kept in
// localStorage, and it is read through useSyncExternalStore: React's hook for
// state that lives OUTSIDE React (here, the browser's storage). During server
// rendering and hydration it uses the server snapshot -- open -- and then the
// browser's real answer, with no flash. Until 16 September 2026 this was a
// useState plus an effect that read storage and called setState, which is
// the pattern react-hooks/set-state-in-effect flags: a render, then a second
// render to correct it.
//
// `memOpen` is the fallback when storage is unavailable (private mode, full,
// disabled): the group still toggles, it just forgets on reload. The 'storage'
// event keeps two admin tabs in step with each other.
let memOpen = true;
const openListeners = new Set();
function subscribeOpen(callback) {
  openListeners.add(callback);
  window.addEventListener('storage', callback);
  return () => {
    openListeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}
function readOpen() {
  try {
    const saved = window.localStorage.getItem(OPEN_KEY);
    if (saved !== null) return saved !== '0';
  } catch {}
  return memOpen;
}
function writeOpen(next) {
  memOpen = next;
  try {
    window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
  } catch {}
  openListeners.forEach((callback) => callback());
}

// Two kinds of number, and the difference is NOT whether a human should look
// -- both deserve eyes (24 Aug). It is whether looking makes the number go
// away:
//
//   amber  a queue that DRAINS. Review the item and it leaves the count;
//          zero is reachable and means "nothing outstanding".
//   blue   a rolling seven-day window. It shrinks with time, not with
//          action, and can never be cleared.
//
// Mixing them costs the amber ones their meaning: a badge nobody can ever
// clear teaches staff that badges are wallpaper, and then the two that really
// are to-do lists stop being read as to-do lists.
const BADGE_TONE = {
  '/admin/accounts': 'window',
  '/admin/payments': 'window',
  // A program leader's own count is not a to-do list -- nobody can act on it
  // and make it smaller. It answers "how big is my group?", which is the
  // question they came for. Blue.
  //
  // Note what is NOT here: /admin/programs stays amber, because unplaced
  // people ARE a queue -- place them and it reaches zero.
  '/admin/my-program': 'window',
};

// redBadges: a second count on the same item, in red, for the thing that is
// not merely waiting but WRONG until somebody acts -- today, volunteers
// without a background check (Lawrence, 15 Oct 2026: "12 / 15"). Amber then
// red, side by side, each with its own tooltip.
// A badge title is a phrase after the number, or [one, many] so a count of
// 1 reads "1 family waiting" and not "1 families waiting" (Script 5).
const badgeWords = (t, n, fallback) => (Array.isArray(t) ? t[n === 1 ? 0 : 1] : t ?? fallback);

export default function AdminNav({
  top = [],
  sections = [],
  loose = [],
  badges = {},
  badgeTitles = {},
  redBadges = {},
  redBadgeTitles = {},
  // A family wrote back in the app and nobody has read it (0126; Lawrence,
  // 26 Oct 2026: a reply was lost among the sign-ups). Amber -- it drains --
  // with an envelope so it reads as a message, not one more sign-up.
  mailBadges = {},
  showLegend = true,
}) {
  const pathname = usePathname();
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => true);

  function toggle() {
    writeOpen(!open);
  }

  const isActive = (href) =>
    pathname === href ||
    pathname === `${href}/` ||
    (href !== '/admin' && pathname?.startsWith(`${href}/`)) ||
    // A registration detail page is reached FROM the roster, so Rosters stays
    // lit while inside one -- the trail back stays visible (24 Aug).
    (href === '/admin/rosters' && pathname?.startsWith('/admin/registrations'));

  // "You are here" in the ministry's own teal, with a solid left edge doing
  // most of the work. Grey-200 read as a warm, faintly alarming wash next to
  // the amber count badges (24 Aug); a colour from the palette says "current
  // page" without suggesting anything is wrong. The bold weight and the bar
  // mean the state survives if colour alone is hard to see.
  const Item = ({ n, indent = false }) =>
    n.ready ? (
      <Link
        href={n.href}
        aria-current={isActive(n.href) ? 'page' : undefined}
        // flex, not block: a label long enough to wrap used to push its badge
        // onto a line of its own, which read as a stray number under the item
        // rather than a count on it (25 Aug). Now the label takes the room it
        // needs and the badge holds its place at the end.
        className={`flex items-center justify-between gap-2 rounded-sm px-3 py-2 font-medium hover:bg-brand-light/60 ${
          indent ? 'ml-4' : ''
        } ${
          isActive(n.href)
            ? 'bg-brand-light text-brand-dark font-semibold border-l-4 border-brand pl-2'
            : ''
        }`}
      >
        <span className="min-w-0">{n.label}</span>
        {((badges[n.href] ?? 0) > 0 || (redBadges[n.href] ?? 0) > 0 || (mailBadges[n.href] ?? 0) > 0) && (
          <span className="flex shrink-0 items-center gap-1">
            {(mailBadges[n.href] ?? 0) > 0 && (
              <span
                title={`${mailBadges[n.href]} ${mailBadges[n.href] === 1 ? 'family reply' : 'family replies'} to read`}
                className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-400"
              >
                <span aria-hidden>✉</span>
                {mailBadges[n.href]}
              </span>
            )}
            {(badges[n.href] ?? 0) > 0 && (
              <span
                title={`${badges[n.href]} ${badgeWords(badgeTitles[n.href], badges[n.href], 'needing review')}`}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                  BADGE_TONE[n.href] === 'window'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {badges[n.href]}
              </span>
            )}
            {(redBadges[n.href] ?? 0) > 0 && (
              <span
                title={`${redBadges[n.href]} ${badgeWords(redBadgeTitles[n.href], redBadges[n.href], 'needing attention')}`}
                className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
              >
                {redBadges[n.href]}
              </span>
            )}
          </span>
        )}
      </Link>
    ) : (
      <span
        title="Coming soon"
        className={`block rounded-sm px-3 py-2 text-neutral-400 cursor-default ${indent ? 'ml-4' : ''}`}
      >
        {n.label} <span className="text-xs">· soon</span>
      </span>
    );

  return (
    <nav className="flex flex-col gap-1">
      {top.map((n) => (
        <Item key={n.href} n={n} />
      ))}

      {loose.map((n) => (
        <Item key={n.href} n={n} />
      ))}

      {/* Sections (14 Oct 2026): a small heading over each group. The camp-week
          group is the only one that folds, because it is the long one and the
          one a registrar outside camp season has least use for; its open/closed
          state is the same per-browser preference as before. */}
      {sections.map((sec) =>
        sec.collapsible ? (
          <div key={sec.key} className="mt-2">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:bg-neutral-200 text-left"
            >
              <FoldArrow open={open} />
              <span>{sec.label}</span>
            </button>
            {open && sec.items.map((n) => <Item key={n.href} n={n} indent />)}
          </div>
        ) : (
          <div key={sec.key} className="mt-2">
            <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {sec.label}
            </p>
            {sec.items.map((n) => (
              <Item key={n.href} n={n} indent />
            ))}
          </div>
        )
      )}

      {/* Said once, here, rather than left as tribal knowledge -- the whole
          point of two colours is lost if nobody knows there are two. */}
      {/* Read as a counter by more than one person (14 Oct 2026) -- it is a
          key, and now says so. Not shown to a program leader (26 Oct 2026):
          it speaks of staff queues and background checks. */}
      {showLegend && (
        <p className="mt-3 px-3 text-xs leading-relaxed text-neutral-500">
          Badge colours:{' '}
          <span className="inline-block rounded-full bg-amber-100 px-1.5 font-semibold text-amber-800">
            amber
          </span>{' '}
          waiting on staff — reaches zero when the work is done ·{' '}
          <span className="inline-block rounded-full bg-blue-100 px-1.5 font-semibold text-blue-800">
            blue
          </span>{' '}
          activity in the last 7 days ·{' '}
          <span className="inline-block rounded-full bg-red-100 px-1.5 font-semibold text-red-800">
            red
          </span>{' '}
          adults without a background check ·{' '}
          <span className="inline-block rounded-full bg-amber-100 px-1.5 font-semibold text-amber-800 ring-1 ring-amber-400">
            ✉
          </span>{' '}
          a family wrote back
        </p>
      )}
    </nav>
  );
}
