import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import SetupManager from './SetupManager';
import { enrollmentOption, todayInMorristown } from '@/lib/events';

export const metadata = { title: 'Setup & Manage Events — Staff Admin' };

// The registration switchboard: which events exist, which are visible, and
// when each one's registration opens and closes. Admin-only; the events_write
// RLS policy (is_admin) is the real gate.
//
// Setup began as registration control only. Dates, capacity and price joined
// it on 25 Aug; creating an event joined it on 2 Oct 2026 (admin_create_event,
// migration 0083), so a new camp week no longer needs a developer.
export default async function SetupPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/setup/');
  if (!can(staff, 'write:setup')) redirect('/admin');

  // Staff read ALL events under RLS, published or not -- that's the point:
  // this page is where "unpublished" gets seen and changed.
  const supabase = await createClient();
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select(
      'id, name, event_type, starts_on, ends_on, archived_at, deposit_cents, balance_due_on, family_discount_cents, family_discount_from_person, multi_week_discount_percent, returned_payment_fee_cents, location, published, registration_opens_at, registration_closes_at, capacity, early_registration_ends_on, early_registration_discount_cents, event_options ( id, fee_cents, published, participant_role )'
    )
    .order('starts_on', { ascending: true });
  // Never an empty list for a failed read: "No events yet" would invite
  // creating a duplicate of an event that exists.
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);

  // "Past" is decided here, on the ministry's calendar day, not in the browser:
  // the year groups below collapse on it, and a server/client disagreement
  // around midnight would flip a group open or shut between renders.
  const today = todayInMorristown();
  const rows = (events ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    eventType: e.event_type,
    isPast: Boolean(e.ends_on) && e.ends_on < today,
    depositCents: e.deposit_cents ?? 0,
    location: e.location ?? '',
    startsOn: e.starts_on,
    endsOn: e.ends_on,
    published: e.published === true,
    // 0099: archived on Setup -- out of every current pill row, never open.
    archivedAt: e.archived_at ?? null,
    opensAt: e.registration_opens_at,
    closesAt: e.registration_closes_at,
    capacity: e.capacity,
    earlyEndsOn: e.early_registration_ends_on,
    earlyCents: e.early_registration_discount_cents ?? 0,
    // The money settings (0096, 16 Oct 2026): a due date and two discounts an
    // administrator edits here, so Larry's numbers never wait on code.
    balanceDueOn: e.balance_due_on,
    familyDiscountCents: e.family_discount_cents ?? 0,
    familyFromPerson: e.family_discount_from_person ?? 3,
    multiWeekPercent: e.multi_week_discount_percent ?? 0,
    // 0123: the returned bank payment fee passed on to families; 0 = off.
    returnedFeeCents: e.returned_payment_fee_cents ?? 0,
    // The enrollment option's fee (0069 published a second, zero-fee volunteer
    // option per event, and "the first published one" could return either).
    feeCents: enrollmentOption(e)?.fee_cents ?? null,
    hasPublishedOption: (e.event_options ?? []).some((o) => o.published),
  }));

  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6">
      <h1 className="text-2xl font-bold mb-1">Setup &amp; Manage Events</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-4xl">
        Create events, and open and close registration, event by event. Each event&rsquo;s{' '}
        <span className="font-semibold">Event status</span> is the master switch:{' '}
        <em>Unpublished</em> keeps it off the public site while staff set it up,{' '}
        <em>Published</em> puts it on the site, and <em>Archived</em> takes a finished event
        out of every current list and off the site while keeping its records. The open/close
        times are optional refinements: leave them blank and a published event takes
        registrations indefinitely; set them and registration opens and closes itself on
        schedule, no midnight clicking required.
      </p>
      <SetupManager events={rows} />
    </div>
  );
}
