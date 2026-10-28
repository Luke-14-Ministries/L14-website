// The camp's dates, price and early-registration offer for the PUBLIC pages,
// read from the events staff set on Setup (Lawrence, 28 Oct 2026: "update
// dates and early-registration to automatically match setup in the admin
// portal"). Camper Information and Volunteer Information printed them by hand
// and went stale: a "register in September" offer was still up in late
// October. Now they say whatever Setup says, and nothing at all when Setup
// has no camp week ahead.
//
// Server only (reads with the visitor's own client; published events are
// public). The weeks are the next camp: the published, unarchived camp_week
// events grouped by the part of the name before " — " (the pairing used
// everywhere else), taking the earliest program whose LAST week has not
// ended. So it keeps itself right through the year (Lawrence, 28 Oct 2026:
// "make sure this stays sensible as time goes on"):
//   - during camp, Week 2 is still listed with Week 1 once Week 1 is over;
//   - once the last week ends it moves to next year's camp if Setup has one,
//     and says "dates posted soon" if not;
//   - the early offer disappears the day after its last day;
//   - the headline (campHeadline) says open, opening soon, closed or
//     underway from the registration window on Setup.
// Nothing here needs editing for a new year: staff create the events.

import { createClient } from '@/lib/supabase/server';
import { enrollmentOption, registrationOpen, todayInMorristown, dayInMorristown, OPEN_EVENT_COLUMNS } from '@/lib/events';

const program = (name) => String(name ?? '').split(' — ')[0].trim();

// ISO day arithmetic at noon UTC, so no time zone moves the date.
function isoMinusDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getCampFacts() {
  const supabase = await createClient();
  const today = todayInMorristown();
  const { data, error } = await supabase
    .from('events')
    .select(`${OPEN_EVENT_COLUMNS}, event_type, early_registration_ends_on, early_registration_discount_cents`)
    .eq('published', true)
    .is('archived_at', null)
    .eq('event_type', 'camp_week')
    // A month back, so a week that has already ended still comes along with
    // its program's later week (a camp's weeks sit within a fortnight).
    .gte('ends_on', isoMinusDays(today, 31))
    .order('starts_on', { ascending: true });
  // CLAUDE.md: never an empty answer for a failed read -- here it would read
  // as "no camp this year".
  if (error) throw new Error(`Camp dates: ${error.message}`);
  const byProgram = new Map();
  for (const w of data ?? []) {
    const key = program(w.name);
    if (!byProgram.has(key)) byProgram.set(key, []);
    byProgram.get(key).push(w);
  }
  // Rows arrive by start date, so the first program still to finish is the
  // next (or the current) camp.
  const next = [...byProgram.entries()].find(([, ws]) =>
    ws.some((w) => (w.ends_on ?? w.starts_on ?? '') >= today)
  );
  if (!next) return null;
  const [first, these] = next;
  const fees = these.map((w) => enrollmentOption(w)?.fee_cents).filter((c) => c != null);
  const earlyWeeks = these.filter(
    (w) => (w.early_registration_discount_cents ?? 0) > 0 && w.early_registration_ends_on && w.early_registration_ends_on >= today
  );
  const open = these.some((w) => registrationOpen(w));
  const opensAt = these
    .map((w) => w.registration_opens_at)
    .filter((t) => t && new Date(t) > new Date())
    .sort()[0];
  const allClosed = these.every((w) => w.registration_closes_at && new Date(w.registration_closes_at) < new Date());
  const underway = Boolean(these[0].starts_on) && these[0].starts_on <= today;
  return {
    program: first,
    year: (these[0].starts_on ?? '').slice(0, 4),
    open,
    // 'open' | 'underway' | 'closed' | 'soon' -- what the headline says.
    state: open ? 'open' : underway ? 'underway' : allClosed ? 'closed' : 'soon',
    opensOn: opensAt ? dayInMorristown(opensAt) : null,
    weeks: these.map((w) => ({
      name: w.name,
      startsOn: w.starts_on,
      endsOn: w.ends_on,
      volunteerArrivesOn: w.volunteer_arrives_on ?? null,
    })),
    // One price when every week costs the same; the lowest otherwise.
    priceCents: fees.length ? Math.min(...fees) : null,
    samePrice: new Set(fees).size <= 1,
    // The offer, while it lasts: the latest last day and the amount off.
    early: earlyWeeks.length
      ? {
          endsOn: earlyWeeks.map((w) => w.early_registration_ends_on).sort().pop(),
          cents: Math.max(...earlyWeeks.map((w) => w.early_registration_discount_cents)),
        }
      : null,
  };
}

// The one headline the public camp pages share, so they never disagree.
export function campHeadline(camp) {
  if (!camp) return 'Camp Celebrate';
  if (camp.state === 'open') return `${camp.program} registration is now OPEN!`;
  if (camp.state === 'underway') return `${camp.program} is underway!`;
  if (camp.state === 'closed') return `${camp.program} registration has closed`;
  return camp.opensOn
    ? `${camp.program} registration opens ${camp.opensOn}`
    : `${camp.program} — registration opens soon`;
}

// "July 19–23" (or "July 30 – August 3" across a month end).
export function dayRange(fromIso, toIso) {
  if (!fromIso) return '';
  const f = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  if (!toIso || toIso === fromIso) return f(fromIso, { month: 'long', day: 'numeric' });
  return fromIso.slice(5, 7) === toIso.slice(5, 7)
    ? `${f(fromIso, { month: 'long', day: 'numeric' })}–${f(toIso, { day: 'numeric' })}`
    : `${f(fromIso, { month: 'long', day: 'numeric' })} – ${f(toIso, { month: 'long', day: 'numeric' })}`;
}
