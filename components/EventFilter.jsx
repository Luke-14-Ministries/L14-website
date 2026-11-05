'use client';

// Choosing which event a staff page is about.
//
// ONE control, the same on every staff page: a searchable dropdown (Lawrence,
// 4 Nov 2026). Until then current events were pills with an "Other events
// (n) ▾" search box beside them, Event Payments had a third "Showing …
// Apply" dropdown under both, and Check-In, the Overview and Rosters each had
// their own shape. Pills and a dropdown answering one question were
// redundant, and every exception made the next page look different again.
// So every page that picks an event uses this, even the pages that only ever
// offer current events: consistency is worth more than the click a pill saved.
//
// What still holds from testing (25 Aug): past events are searchable -- "eg
// can type 2025 to filter to events from 2025". Typing filters every event in
// the list, current or not.
//
// The open list, top to bottom:
//   - the page's "all" choice (allLabel), pinned, where the page has one
//   - any other pinned scopes the page offers (Event Payments' 90-day
//     windows and full history)
//   - CURRENT events, soonest first -- the reason the page was opened
//   - "Other events": finished, far-future and archived ones, newest first,
//     an archived one marked "(archived)". Archived is never current.
//
// The box itself is components/SearchSelect.jsx, a WAI-ARIA combobox, so the
// keys and what a screen reader announces are the same as the print pages'
// pickers. Every event stays reachable; nothing is hidden in the database.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import SearchSelect from '@/components/SearchSelect';
import { eventWindow, eventNameWithYear, eventDateRange } from '@/lib/events';

// "Current" has two edges, not one.
//
// BEHIND: two weeks' grace (16 Oct 2026; it was 30 days) — a week that
// finished last Tuesday is still live work, one that finished last month is
// the archive.
//
// AHEAD: twelve months (agreed 25 Aug). Without it, an event booked three
// years out sits at the top of the list from the day it is created, and a
// group meant to say "what is happening now" slowly becomes everything.
// Anything further off is under "Other events", one search away.
// Both edges come from lib/events.js -- the same function every staff page
// uses to decide which event it opens on -- so the list and a page default
// can never disagree.
const cutoffISO = () => eventWindow().cutoff;
const horizonISO = () => eventWindow().horizon;

export function isCurrentEvent(e, cutoff = cutoffISO(), horizon = horizonISO()) {
  // Archived on Setup (0099): never current, always under "Other events".
  if (e.archivedAt) return false;
  const ends = e.endsOn ?? e.startsOn ?? '9999';
  const starts = e.startsOn ?? e.endsOn ?? '0000';
  return ends >= cutoff && starts <= horizon;
}

const OTHER = 'Other events';

// One event as the list shows it: the name (with its year, as every event
// dropdown does) and the dates underneath, which is what tells Week 1 from
// Week 2 -- Check-In's pills carried them for that reason -- and what "2025"
// matches.
const asOption = (e, group) => ({
  value: e.id,
  label: `${eventNameWithYear(e)}${e.archivedAt ? ' (archived)' : ''}`,
  hint: eventDateRange(e.startsOn || null, e.endsOn || null),
  group,
});

export default function EventFilter({
  events = [],
  selected = null,
  basePath,
  // Query params to carry across when the event changes (e.g. a search box).
  extraParams = {},
  label = 'Event',
  // Some pages (Dietary, Medical, Payments, the Overview) legitimately show
  // EVERY current event at once — a kitchen list is not per-week. Those get
  // an "all" choice, pinned first, that clears the selection.
  allowAll = false,
  allLabel = 'All current events',
  // Other non-event choices pinned under "all", each { value, label }. The
  // value travels as ?event= exactly like an event id (Event Payments:
  // 'upcoming', 'recent', 'all' -- folded in from its old "Showing" dropdown).
  scopes = [],
  // In the box while nothing is chosen and there is no "all".
  placeholder = 'Choose an event',
  // Client-state pages (Rosters filters in the browser, not the URL; Email
  // Families' send form) pass this and nothing navigates.
  onSelect = null,
  // Inside a GET form with its own Apply button (Email Families' sent list):
  // a hidden input of this name carries the choice; nothing navigates.
  name = null,
  disabled = false,
  // In a row of other filters the label line would push the box down out of
  // line, so it is kept for screen readers only.
  hideLabel = false,
  // The wrapper: a block of its own by default; a row passes its own width.
  className = 'mb-6 w-full max-w-sm',
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Form mode keeps the pick until the form is submitted. A new `selected`
  // from the server (the page reloaded with other filters) replaces it --
  // React's "adjust state when a prop changes" pattern, no effect needed.
  const [picked, setPicked] = useState(selected ?? '');
  const [seen, setSeen] = useState(selected);
  if (seen !== selected) {
    setSeen(selected);
    setPicked(selected ?? '');
  }

  const cutoff = cutoffISO();
  const horizon = horizonISO();
  // TWO TIERS, each sorted the opposite way (31 Aug 2026). Current events
  // soonest first: the soonest is the one being worked on (Lawrence, 4 Nov
  // 2026: Volunteers lists events newest first, so its pills read Week 2,
  // Week 1). Other events newest first: the one that just finished is the one
  // anybody still has questions about, and 2019 can stay at the bottom. The
  // family dashboard documents the same rule.
  const byStart = (a, b) => String(a.startsOn ?? '').localeCompare(String(b.startsOn ?? ''));
  const current = events.filter((e) => isCurrentEvent(e, cutoff, horizon)).sort(byStart);
  const other = events.filter((e) => !isCurrentEvent(e, cutoff, horizon)).sort((a, b) => byStart(b, a));
  const options = [...current.map((e) => asOption(e, null)), ...other.map((e) => asOption(e, OTHER))];
  // No events at all (a new database, a page with nothing yet): the box
  // stays, greyed, and says so, rather than vanishing from the page.
  const none = events.length === 0;
  const pinned = none ? [] : [...(allowAll ? [{ value: '', label: allLabel }] : []), ...scopes];

  const href = (id) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) p.set(k, String(v));
    }
    if (id) p.set('event', id);
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const choose = (id) => {
    if (name) {
      setPicked(id ?? '');
      return;
    }
    if (onSelect) {
      onSelect(id ?? '');
      return;
    }
    startTransition(() => router.push(href(id || null)));
  };

  return (
    <div className={className}>
      <SearchSelect
        label={label}
        hideLabel={hideLabel}
        noun={['event', 'events']}
        placeholder={none ? 'No events to choose from' : placeholder}
        pinned={pinned}
        options={options}
        value={name ? picked : selected ?? ''}
        onChange={choose}
        busy={pending}
        disabled={disabled || none}
        // The page's own heading names the event on paper.
        printPrefix={false}
      />
      {name && <input type="hidden" name={name} value={picked} />}
    </div>
  );
}
