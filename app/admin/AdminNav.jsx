'use client';

// The staff sidebar: Overview and Awaiting Review on top, then the sections
// in lib/adminNav.js (Registration, Money, Camp Planning, Camp Week,
// Communication, Admin; 23 Nov 2026). Sections marked collapsible fold, each
// remembering open or closed in this browser. Below the lg breakpoint the
// whole menu is one closed fold, "Menu · <this page>", so a phone opens on
// the page's own content rather than a screen of links (23 Nov 2026 review).

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import FoldArrow from '@/components/FoldArrow';

// Whether a section is open is a per-browser preference kept in
// localStorage, and it is read through useSyncExternalStore: React's hook for
// state that lives OUTSIDE React (here, the browser's storage). During server
// rendering and hydration it uses the server snapshot -- open -- and then the
// browser's real answer, with no flash. Until 16 September 2026 this was a
// useState plus an effect that read storage and called setState, which is
// the pattern react-hooks/set-state-in-effect flags: a render, then a second
// render to correct it.
//
// `memOpen` is the fallback when storage is unavailable (private mode, full,
// disabled): the section still toggles, it just forgets on reload. The
// 'storage' event keeps two admin tabs in step with each other. One key per
// section since 23 Nov 2026 (two sections fold now); the store is shared.
const memOpen = new Map();
const openListeners = new Set();
function subscribeOpen(callback) {
  openListeners.add(callback);
  window.addEventListener('storage', callback);
  return () => {
    openListeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}
function readOpen(key) {
  try {
    const saved = window.localStorage.getItem(key);
    if (saved !== null) return saved !== '0';
  } catch {}
  return memOpen.get(key) ?? true;
}
function writeOpen(key, next) {
  memOpen.set(key, next);
  try {
    window.localStorage.setItem(key, next ? '1' : '0');
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
// not merely waiting but WRONG until somebody acts -- adult volunteers
// without a background check marked OK (Lawrence, 15 Oct 2026: "12 / 15").
// On Background Checks since 23 Nov 2026, where that work is done (it was on
// Volunteers). Amber then red, side by side, each with its own tooltip.
// A badge title is a phrase after the number, or [one, many] so a count of
// 1 reads "1 family waiting" and not "1 families waiting" (Script 5).
const badgeWords = (t, n, fallback) => (Array.isArray(t) ? t[n === 1 ? 0 : 1] : t ?? fallback);

// The amber work on one item: its amber count and any unread family replies
// (the envelope is amber too). What a folded section and the closed phone
// menu add up, so a fold never hides that something is waiting.
const amberOn = (href, counts) =>
  (BADGE_TONE[href] === 'window' ? 0 : counts.badges[href] ?? 0) + (counts.mailBadges[href] ?? 0);

function AmberTotal({ n }) {
  if (!n) return null;
  return (
    <span
      title={`${n} waiting on staff in here`}
      className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
    >
      {n}
    </span>
  );
}

function ItemBadges({ href, counts }) {
  const { badges, badgeTitles, redBadges, redBadgeTitles, mailBadges } = counts;
  const amber = badges[href] ?? 0;
  const red = redBadges[href] ?? 0;
  const mail = mailBadges[href] ?? 0;
  if (amber <= 0 && red <= 0 && mail <= 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {mail > 0 && (
        <span
          title={`${mail} ${mail === 1 ? 'family reply' : 'family replies'} to read`}
          className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-400"
        >
          <span aria-hidden>✉</span>
          {mail}
        </span>
      )}
      {amber > 0 && (
        <span
          title={`${amber} ${badgeWords(badgeTitles[href], amber, 'needing review')}`}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            BADGE_TONE[href] === 'window' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {amber}
        </span>
      )}
      {red > 0 && (
        <span
          title={`${red} ${badgeWords(redBadgeTitles[href], red, 'needing attention')}`}
          className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
        >
          {red}
        </span>
      )}
    </span>
  );
}

// "You are here" in the ministry's own teal, with a solid left edge doing
// most of the work. Grey-200 read as a warm, faintly alarming wash next to
// the amber count badges (24 Aug); a colour from the palette says "current
// page" without suggesting anything is wrong. The bold weight and the bar
// mean the state survives if colour alone is hard to see.
// Hoisted to module level (23 Nov 2026): it was defined inside AdminNav,
// which CLAUDE.md forbids (React remounts such a component every render).
function NavItem({ n, indent = false, active, counts }) {
  if (!n.ready) {
    return (
      <span
        title="Coming soon"
        className={`block rounded-sm px-3 py-2 text-neutral-400 cursor-default ${indent ? 'ml-4' : ''}`}
      >
        {n.label} <span className="text-xs">· soon</span>
      </span>
    );
  }
  return (
    <Link
      href={n.href}
      aria-current={active ? 'page' : undefined}
      // flex, not block: a label long enough to wrap used to push its badge
      // onto a line of its own, which read as a stray number under the item
      // rather than a count on it (25 Aug). Now the label takes the room it
      // needs and the badge holds its place at the end.
      className={`flex items-center justify-between gap-2 rounded-sm px-3 py-2 font-medium hover:bg-brand-light/60 ${
        indent ? 'ml-4' : ''
      } ${active ? 'bg-brand-light text-brand-dark font-semibold border-l-4 border-brand pl-2' : ''}`}
    >
      <span className="min-w-0">{n.label}</span>
      <ItemBadges href={n.href} counts={counts} />
    </Link>
  );
}

const SECTION_HEADING = 'px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500';

// One section. A collapsible one reads its own stored key; folded, it shows
// the sum of its amber numbers beside the heading (23 Nov 2026), so closing
// Camp Planning never hides three campers still without a buddy.
function NavSection({ sec, isActive, counts }) {
  const open = useSyncExternalStore(
    subscribeOpen,
    () => (sec.collapsible ? readOpen(sec.storeKey) : true),
    () => true
  );
  if (!sec.collapsible) {
    return (
      <div className="mt-2">
        <p className={SECTION_HEADING}>{sec.label}</p>
        {sec.items.map((n) => (
          <NavItem key={n.href} n={n} indent active={isActive(n.href)} counts={counts} />
        ))}
      </div>
    );
  }
  const folded = sec.items.reduce((sum, n) => sum + amberOn(n.href, counts), 0);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => writeOpen(sec.storeKey, !open)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-sm text-left hover:bg-neutral-200 ${SECTION_HEADING}`}
      >
        <FoldArrow open={open} />
        <span className="flex-1">{sec.label}</span>
        {!open && <AmberTotal n={folded} />}
      </button>
      {open && sec.items.map((n) => <NavItem key={n.href} n={n} indent active={isActive(n.href)} counts={counts} />)}
    </div>
  );
}

// The colour key as four short lines (23 Nov 2026 review): one long
// sentence with dots between was read as a counter by more than one person
// (14 Oct 2026). Not shown to a program leader (26 Oct 2026): it speaks of
// staff queues and background checks.
const LEGEND = [
  ['bg-amber-100 text-amber-800', 'amber', 'waiting on staff'],
  ['bg-blue-100 text-blue-800', 'blue', 'last 7 days'],
  ['bg-red-100 text-red-800', 'red', 'volunteer without a background check'],
  ['bg-amber-100 text-amber-800 ring-1 ring-amber-400', '✉', 'a family wrote back'],
];

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
  const counts = { badges, badgeTitles, redBadges, redBadgeTitles, mailBadges };

  // The phone menu is open for the page it was opened on: a route change
  // closes it without an effect, because the pathname no longer matches.
  const [openFor, setOpenFor] = useState(null);
  const menuOpen = openFor !== null && openFor === pathname;

  const isActive = (href) =>
    pathname === href ||
    pathname === `${href}/` ||
    (href !== '/admin' && pathname?.startsWith(`${href}/`)) ||
    // A registration detail page is reached FROM the roster, so Rosters stays
    // lit while inside one -- the trail back stays visible (24 Aug).
    (href === '/admin/rosters' && pathname?.startsWith('/admin/registrations'));

  const all = [...top, ...loose, ...sections.flatMap((sec) => sec.items)];
  const current = all.find((n) => isActive(n.href));
  const amberTotal = all.reduce((sum, n) => sum + amberOn(n.href, counts), 0);

  return (
    <nav aria-label="Staff pages">
      <button
        type="button"
        onClick={() => setOpenFor(menuOpen ? null : pathname)}
        aria-expanded={menuOpen}
        aria-controls="staff-menu"
        className="lg:hidden flex w-full items-center gap-2 rounded-sm border border-neutral-300 bg-white px-3 py-2 text-left font-medium"
      >
        <FoldArrow open={menuOpen} />
        <span className="min-w-0 flex-1 truncate">
          Menu{current ? <span className="text-neutral-500"> · {current.label}</span> : null}
        </span>
        <AmberTotal n={amberTotal} />
      </button>

      {/* Hidden below lg until opened; always shown from lg up. Tapping a
          link closes it, even the link to the page already open. */}
      <div
        id="staff-menu"
        className={`${menuOpen ? 'flex' : 'hidden'} mt-2 flex-col gap-1 lg:mt-0 lg:flex`}
        onClick={(e) => {
          if (e.target.closest?.('a')) setOpenFor(null);
        }}
      >
        {top.map((n) => (
          <NavItem key={n.href} n={n} active={isActive(n.href)} counts={counts} />
        ))}

        {loose.map((n) => (
          <NavItem key={n.href} n={n} active={isActive(n.href)} counts={counts} />
        ))}

        {sections.map((sec) => (
          <NavSection key={sec.key} sec={sec} isActive={isActive} counts={counts} />
        ))}

        {/* Said once, here, rather than left as tribal knowledge -- the whole
            point of two colours is lost if nobody knows there are two. */}
        {showLegend && (
          <div className="mt-3 px-3 text-xs leading-relaxed text-neutral-500">
            <p className="font-semibold">Badge colors</p>
            <ul>
              {LEGEND.map(([cls, word, meaning]) => (
                <li key={word}>
                  <span className={`inline-block rounded-full px-1.5 font-semibold ${cls}`}>{word}</span> {meaning}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </nav>
  );
}
