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
// events of the earliest program still to come, grouped by the part of the
// name before " — " (the pairing used everywhere else).

import { createClient } from '@/lib/supabase/server';
import { enrollmentOption, registrationOpen, todayInMorristown, OPEN_EVENT_COLUMNS } from '@/lib/events';

export async function getCampFacts() {
  const supabase = await createClient();
  const today = todayInMorristown();
  const { data, error } = await supabase
    .from('events')
    .select(`${OPEN_EVENT_COLUMNS}, event_type, early_registration_ends_on, early_registration_discount_cents`)
    .eq('published', true)
    .is('archived_at', null)
    .eq('event_type', 'camp_week')
    .gte('ends_on', today)
    .order('starts_on', { ascending: true });
  // CLAUDE.md: never an empty answer for a failed read -- here it would read
  // as "no camp this year".
  if (error) throw new Error(`Camp dates: ${error.message}`);
  const weeks = data ?? [];
  if (!weeks.length) return null;

  const program = (name) => String(name ?? '').split(' — ')[0].trim();
  const first = program(weeks[0].name);
  const these = weeks.filter((w) => program(w.name) === first);
  const fees = these.map((w) => enrollmentOption(w)?.fee_cents).filter((c) => c != null);
  const earlyWeeks = these.filter(
    (w) => (w.early_registration_discount_cents ?? 0) > 0 && w.early_registration_ends_on && w.early_registration_ends_on >= today
  );
  return {
    program: first,
    year: (these[0].starts_on ?? '').slice(0, 4),
    open: these.some((w) => registrationOpen(w)),
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

// "July 19–23" (or "July 30 – August 3" across a month end).
export function dayRange(fromIso, toIso) {
  if (!fromIso) return '';
  const f = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  if (!toIso || toIso === fromIso) return f(fromIso, { month: 'long', day: 'numeric' });
  return fromIso.slice(5, 7) === toIso.slice(5, 7)
    ? `${f(fromIso, { month: 'long', day: 'numeric' })}–${f(toIso, { day: 'numeric' })}`
    : `${f(fromIso, { month: 'long', day: 'numeric' })} – ${f(toIso, { month: 'long', day: 'numeric' })}`;
}
