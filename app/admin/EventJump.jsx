'use client';

// The shared event filter, on a page that shows every current event at once
// (the Overview's "By event" table). Here the pills JUMP to the event's row
// instead of hiding the others -- the table is the point of the page, and a
// filter that left one row would make it say less. Said on screen, so nobody
// presses a pill and wonders why nothing disappeared (build plan item 12,
// 16 Oct 2026).

import EventFilter from '@/components/EventFilter';

export default function EventJump({ events }) {
  return (
    <div className="mb-2">
      <EventFilter
        events={events}
        selected={null}
        basePath="/admin"
        onSelect={(id) => {
          if (!id) return;
          const row = document.getElementById(`event-${id}`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // :target styling without a hash in the URL: a brief highlight.
            row.classList.add('bg-brand-light');
            setTimeout(() => row.classList.remove('bg-brand-light'), 1500);
          }
        }}
      />
      <p className="-mt-4 mb-4 text-xs text-neutral-500">
        Pills jump to the event&rsquo;s row — this page shows every current event at once.
      </p>
    </div>
  );
}
