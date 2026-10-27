// "Emails sent to families" at the foot of Email Families (27 Oct 2026,
// Lawrence: "should be collapsible and filterable; grouped by event, date,
// etc" -- and searchable). A server component: the filter bar is a plain GET
// form, so the filters live in the URL, survive a reload and work without
// JavaScript, like Giving's. The reading, filtering and grouping are in
// lib/emailLog.js; this file only draws them.
//
// The card is OPEN by default: it is the record of what was sent, at the foot
// of the page people open to send, and its sends are already folded to one
// line each, so open costs little room. FoldCard is the site's folding card
// (the left ▶); a filtered page reloads, so it opens again after Apply.

import FoldCard from '@/components/FoldCard';
import EmailSends from '@/components/EmailSends';
import { KIND_FILTERS, MAX_FAMILY_MATCHES, hasEmailFilters } from '@/lib/emailLog';

const BASE = '/admin/email-families/';
const ANCHOR = 'emails-sent';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What the list shows, in a sentence.
function Showing({ result, filters }) {
  const { emails, total, capped, windowDays } = result;
  const filtered = hasEmailFilters(filters);
  let text;
  if (!filtered) {
    text = capped
      ? `Showing the newest ${emails.length} of ${plural(total, 'email', 'emails')} from the past ${windowDays} days.`
      : `Showing the last ${plural(total, 'email', 'emails')} (the past ${windowDays} days).`;
  } else {
    text = `${plural(total, 'email matches', 'emails match')}${filters.q ? ` ‘${filters.q}’` : ''}`;
    if (windowDays) text += ` in the past ${windowDays} days`;
    text += capped ? ` — the newest ${emails.length} are shown.` : '.';
  }
  return (
    <p className="text-sm text-neutral-700">
      {text}
      {capped && ' Narrow the filters to see the rest.'}
      {windowDays && ' Set From for anything older.'}
    </p>
  );
}

export default function EmailsSentSection({ result, byEvent, filters, eventOptions, keepParams = {} }) {
  const keep = Object.entries(keepParams).filter(([, v]) => v);
  const clearHref = `${BASE}${keep.length ? `?${new URLSearchParams(keep).toString()}` : ''}#${ANCHOR}`;
  const field = 'rounded-sm border border-neutral-300 bg-white px-2 py-1.5';

  return (
    <section id={ANCHOR} className="mt-8 scroll-mt-4">
      <FoldCard
        title="Emails sent to families"
        badges={
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
            {result.total}
          </span>
        }
        defaultOpen
      >
        <p className="text-sm text-neutral-500 mb-3">
          From here and the site&rsquo;s own (payment plans), one line per send — open one for each
          family&rsquo;s address and <em>What it said</em>. Each family&rsquo;s full list is on their
          registration page. <em>Delivery</em> opens the mail service&rsquo;s record: delivered,
          bounced or opened.
        </p>

        {/* Plain GET form (like Giving's): the URL is the filter. The send
            form's own choices (?event, ?activity, ...) ride along hidden, so
            filtering here does not reset what it is about to send to. */}
        <form
          method="get"
          action={`${BASE}#${ANCHOR}`}
          className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm"
        >
          {keep.map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label className="block grow basis-56">
            <span className="block font-semibold mb-1">Search</span>
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              maxLength={100}
              placeholder="Subject, words in the email, address or family"
              className={`${field} w-full`}
            />
          </label>
          <label className="block">
            <span className="block font-semibold mb-1">Event</span>
            <select name="sent_event" defaultValue={filters.eventId} className={field}>
              <option value="">All events</option>
              {eventOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block font-semibold mb-1">Kind</span>
            <select name="sent_kind" defaultValue={filters.kind} className={field}>
              <option value="">All kinds</option>
              {Object.entries(KIND_FILTERS).map(([v, k]) => (
                <option key={v} value={v}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block font-semibold mb-1">From</span>
            <input type="date" name="sent_from" defaultValue={filters.from} className={field} />
          </label>
          <label className="block">
            <span className="block font-semibold mb-1">To</span>
            <input type="date" name="sent_to" defaultValue={filters.to} className={field} />
          </label>
          <button type="submit" className="btn-primary py-1.5! text-sm">
            Apply
          </button>
          {hasEmailFilters(filters) && (
            <a href={clearHref} className="text-sm text-neutral-500 underline">
              Clear
            </a>
          )}
        </form>

        <div className="mb-3 space-y-1">
          <Showing result={result} filters={filters} />
          {result.familyMatchesCapped && (
            <p className="text-sm text-amber-800">
              More than {MAX_FAMILY_MATCHES} families&rsquo; names contain &lsquo;{filters.q}&rsquo;, so family
              names were left out of this search — type more of the name.
            </p>
          )}
        </div>

        <EmailSends
          byEvent={byEvent}
          empty={
            hasEmailFilters(filters) ? 'No emails match these filters.' : `Nothing sent in the past ${result.windowDays} days.`
          }
        />
      </FoldCard>
    </section>
  );
}
