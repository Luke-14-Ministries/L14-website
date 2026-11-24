import { redirect } from 'next/navigation';
import Notice from '@/components/Notice';
import AdminPageHeader from '@/components/AdminPageHeader';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import SetupManager from './SetupManager';
import { enrollmentOption, todayInMorristown, agreementText } from '@/lib/events';
import { turnstileConfigured } from '@/lib/turnstile';
import { reminderMode } from '@/lib/reminders/run';

export const metadata = { title: 'Setup & Manage Events · Staff Admin' };

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
      'id, name, event_type, starts_on, ends_on, archived_at, hidden_from_families_at, deposit_cents, balance_due_on, family_discount_cents, family_discount_from_person, multi_week_discount_percent, returned_payment_fee_cents, location, volunteer_arrives_on, arrival_note, campus_map_url, waitlist_notice_at, published, registration_opens_at, registration_closes_at, capacity, early_registration_ends_on, early_registration_discount_cents, details_set_by_hand_at, event_options ( id, fee_cents, published, participant_role )'
    )
    .order('starts_on', { ascending: true });
  // Never an empty list for a failed read: "No events yet" would invite
  // creating a duplicate of an event that exists.
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);

  // Who is registered, per event (23 Nov 2026 review): the card says how many
  // families a rename, a date change or unpublishing would reach. Read with
  // the staff member's own client, so only for someone with Registration
  // read; anyone else sees no count rather than a false "0 families".
  const regCounts = new Map();
  const canCount = can(staff, 'read:registration');
  if (canCount) {
    const { data: regs, error: regsError } = await supabase
      .from('registrations')
      .select('event_id, registration_participants ( status )');
    if (regsError) throw new Error(`Registrations: ${regsError.message}`);
    for (const r of regs ?? []) {
      const live = (r.registration_participants ?? []).filter((p) => p.status !== 'cancelled').length;
      if (!live) continue;
      const c = regCounts.get(r.event_id) ?? { families: 0, people: 0 };
      c.families += 1;
      c.people += live;
      regCounts.set(r.event_id, c);
    }
  }

  // The agreements each event asks families to sign (A4-20), read-only here:
  // a signature points at one exact version, so new wording is a new version
  // made by a developer, never an edit. Activity waivers are not listed; they
  // belong to the activity and live on Activities.
  const { data: reqs, error: reqsError } = await supabase
    .from('agreement_requirements')
    .select('event_id, applies_to, is_required, agreements ( id, key, version, title, body, delivery, external_url, created_at )')
    .not('event_id', 'is', null);
  if (reqsError) throw new Error(`Agreements: ${reqsError.message}`);
  const agreementsByEvent = new Map();
  for (const q of reqs ?? []) {
    if (!q.agreements) continue;
    if (!agreementsByEvent.has(q.event_id)) agreementsByEvent.set(q.event_id, []);
    agreementsByEvent.get(q.event_id).push(q);
  }

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
    // 0099: archived on Setup -- out of every current events list, never open.
    archivedAt: e.archived_at ?? null,
    hiddenFromFamiliesAt: e.hidden_from_families_at ?? null,
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
    // 0137: saved by hand on Setup at least once (a later week then stops
    // taking the earlier week's details).
    setByHand: Boolean(e.details_set_by_hand_at),
    // What families read about the event (23 Nov 2026 review): the day
    // volunteers arrive, the arrival line and the venue map (0184, 0078).
    volunteerArrivesOn: e.volunteer_arrives_on ?? '',
    arrivalNote: e.arrival_note ?? '',
    campusMapUrl: e.campus_map_url ?? '',
    // Staff's "this event is full" switch (0184).
    waitlistNoticeAt: e.waitlist_notice_at ?? null,
    // null = this staff member cannot count (no Registration read).
    regFamilies: canCount ? regCounts.get(e.id)?.families ?? 0 : null,
    regPeople: canCount ? regCounts.get(e.id)?.people ?? 0 : null,
    agreements: (agreementsByEvent.get(e.id) ?? [])
      .map((q) => ({
        id: q.agreements.id,
        title: q.agreements.title,
        version: q.agreements.version,
        createdOn: String(q.agreements.created_at ?? '').slice(0, 10),
        required: q.is_required !== false,
        appliesTo: q.applies_to,
        externalUrl: q.agreements.delivery === 'external_link' ? q.agreements.external_url : null,
        // The words as families read them, {{event}} filled (agreementText).
        text: agreementText(q.agreements.body, e),
      }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  }));

  // The weeks of one camp (Lawrence, 27 Oct 2026): events whose names share
  // the part before " — ", the pairing recalc_multi_week_discount() uses. The
  // both-weeks discount is set on the later week, where it applies, and an
  // earlier week's details are the later weeks' defaults.
  // 0154: and start in the same year -- campKey()'s rule, kept here for
  // names with no " — " (an event on its own).
  const programOf = (r) =>
    String(r.name ?? '').includes(' — ')
      ? `${String(r.name).split(' — ')[0].trim()}|${String(r.startsOn ?? '').slice(0, 4)}`
      : null;
  for (const r of rows) {
    const program = programOf(r);
    const weeks = program ? rows.filter((o) => programOf(o) === program) : [r];
    r.earlierWeeks = weeks.filter((o) => o.startsOn < r.startsOn).map((o) => o.name);
    r.laterWeeks = weeks
      .filter((o) => o.startsOn > r.startsOn)
      .map((o) => ({ name: o.name, setByHand: o.setByHand }));
  }

  return (
    <div>
      <AdminPageHeader
        title="Setup &amp; Manage Events"
        intro={
          // Shortened 23 Nov 2026 (review): each status explains itself under
          // the dropdown, so the intro only says what the page is for.
          <>
            Create events and decide what families see. Each event&rsquo;s{' '}
            <span className="font-semibold">Event status</span> puts it on the public site, keeps it
            off while you set it up, or archives it once it&rsquo;s over. Open and close times are
            optional; registration always closes after the event&rsquo;s last day.
          </>
        }
      />
      {/* One health line (23 Nov 2026, security review): the bot check on
          Contact, Donate and the prayer sign-up needs both Turnstile keys,
          and a check that is quietly off looks exactly like one that works.
          On the live site Donate and the prayer sign-up refuse everyone
          while it is off, so this line is the first place to look. */}
      {turnstileConfigured() ? (
        <p className="mb-6 text-sm text-neutral-600">
          <span className="font-semibold text-green-800">Bot check: on.</span> Contact, Donate and the
          prayer sign-up check each visitor before sending.
        </p>
      ) : (
        <Notice tone="error" className="mb-6">
          <span className="font-semibold">Bot check: NOT RUNNING.</span> One or both Turnstile keys
          (TURNSTILE_SECRET_KEY, NEXT_PUBLIC_TURNSTILE_SITE_KEY) are missing here. On the live site
          Donate and the prayer sign-up turn everyone away until both are set in Vercel; Contact still
          sends.
        </Notice>
      )}
      <SetupManager events={rows} reminderMode={reminderMode()} />
    </div>
  );
}
