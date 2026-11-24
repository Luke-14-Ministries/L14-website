import Link from 'next/link';
import Pill from '@/components/Pill';
import FilterChips from '@/components/FilterChips';
import AdminPageHeader from '@/components/AdminPageHeader';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { balanceDueOn, formatDueDateShort, todayInMorristown, dayInMorristown, inPaymentsScope, eventNameWithYear, eventScopeLabel } from '@/lib/events';
import EventFilter from '@/components/EventFilter';
import RecordPaymentForm from './RecordPaymentForm';
import FoldCard from '@/components/FoldCard';
import ExportBar from './ExportBar';
import { requiresPaymentChoice, ROUTE_LABEL, SCHEDULE_LABEL, REVIEW_CLASS, REVIEW_FLAG, reviewClassLabel } from '@/lib/plans';
import { isStaleRefund, STALE_REFUND_DAYS, CLEARING_PILL } from '@/lib/payments';
import RecheckRefund from './RecheckRefund';

import ResizableTable from '@/components/ResizableTable';
export const metadata = { title: 'Event Payments · Staff Admin' };

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const METHOD_LABEL = {
  card: 'Card',
  bank_transfer: 'Bank transfer',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
};
const STATUS_CLS = {
  pending: 'bg-neutral-100 text-neutral-600',
  processing: CLEARING_PILL,
  succeeded: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  refunded: 'bg-neutral-200 text-neutral-600',
};

// Event money only (Camp Celebrate, retreats, dinners...). Donations live on the separate Giving page, behind their
// own permission -- reconciling camp fees does not require seeing who gave
// what. Registrar-gated; RLS is the backstop.
export default async function AdminPaymentsPage({ searchParams }) {
  const params = await searchParams;
  const paystate = typeof params?.paystate === 'string' ? params.paystate : '';
  const eventFilter = typeof params?.event === 'string' ? params.event : '';
  // Search the balances table (Lawrence, 14 Nov 2026): a family's name, a
  // person on the registration, or the event.
  const q = typeof params?.q === 'string' ? params.q.trim().slice(0, 100) : '';

  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/payments/');
  if (!can(staff, 'read:payments')) redirect('/admin');

  const supabase = await createClient();

  const [
    { data: balances, error: balancesError },
    { data: regs, error: regsError },
    { data: pays, error: paysError },
    { data: routes, error: routesError },
    { data: reviews, error: reviewError },
    { data: people, error: peopleError },
    { data: pendingRefunds, error: pendingRefundsError },
  ] = await Promise.all([
    supabase
      .from('registration_balances')
      .select('registration_id, event_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents, fees_cents'),
    supabase
      .from('registrations')
      .select('id, events ( id, name, event_type, starts_on, ends_on, archived_at, balance_due_on ), households ( display_name )'),
    supabase
      .from('payments')
      .select('registration_id, amount_cents, fee_cover_cents, method, status, received_on, created_at, note')
      .order('created_at', { ascending: false }),
    // How each registration is being paid (0080).
    supabase.from('registration_payment_routes').select('registration_id, route, plan_status, plan_schedule'),
    // The three review classes and the flags (0081, Lawrence 30 Sep 2026).
    supabase.from('registration_review').select('registration_id, review_class, flags, confirmed_paid_cents, deposit_expected_cents, deposit_scholarship_cents'),
    // How many are registered on each family's registration, for the
    // "3 registered" line under the name (Lawrence, 26 Oct 2026).
    // Their names too, so the search finds a family by anyone on it.
    supabase
      .from('registration_participants')
      .select('registration_id, people ( first_name, last_name, preferred_name )')
      .neq('status', 'cancelled'),
    // Refunds still pending, for the stale-refund strip (lib/payments.js).
    supabase
      .from('payment_refunds')
      .select('id, registration_id, amount_cents, status, created_at')
      .eq('status', 'pending')
      .order('created_at'),
  ]);
  // Never an empty table in place of an error (CLAUDE.md).
  if (balancesError) throw new Error(`Balances: ${balancesError.message}`);
  if (regsError) throw new Error(`Registrations: ${regsError.message}`);
  if (paysError) throw new Error(`Payments: ${paysError.message}`);
  if (reviewError) throw new Error(`Review classes: ${reviewError.message}`);
  if (peopleError) throw new Error(`Participants: ${peopleError.message}`);
  if (pendingRefundsError) throw new Error(`Pending refunds: ${pendingRefundsError.message}`);
  // Refunds pending past STALE_REFUND_DAYS, every event: one stuck anywhere
  // is money the page may be counting wrongly (Lawrence, 26 Oct 2026).
  const staleRefunds = (pendingRefunds ?? []).filter((r) => isStaleRefund(r));
  const countByReg = new Map();
  const namesByReg = new Map();
  for (const x of people ?? []) {
    countByReg.set(x.registration_id, (countByReg.get(x.registration_id) ?? 0) + 1);
    const p = x.people;
    if (p) {
      namesByReg.set(
        x.registration_id,
        `${namesByReg.get(x.registration_id) ?? ''} ${p.first_name ?? ''} ${p.preferred_name ?? ''} ${p.last_name ?? ''}`
      );
    }
  }
  // The 15 payments Recent activity lists, counted by status for its title.
  const recentCounts = [
    ...(pays ?? []).slice(0, 15).reduce((m, p) => m.set(p.status, (m.get(p.status) ?? 0) + 1), new Map()),
  ];
  const reviewByReg = new Map((reviews ?? []).map((x) => [x.registration_id, x]));
  if (routesError) throw new Error(`Payment routes: ${routesError.message}`);
  const routeByReg = new Map((routes ?? []).map((x) => [x.registration_id, x]));

  const regById = new Map((regs ?? []).map((r) => [r.id, r]));
  const dueToday = todayInMorristown();

  // Every event that has at least one registration, for the event dropdown
  // (which sorts them itself: current soonest first, then the rest).
  const evById = new Map();
  for (const r of regs ?? []) if (r.events?.id) evById.set(r.events.id, r.events);
  const eventOptions = [...evById.values()].sort((a, b) =>
    (b.starts_on ?? '').localeCompare(a.starts_on ?? '')
  );

  // Event scope. The dashboard is a quick view of the events being worked
  // on, not a wall of history — old years stay one pick away in the event
  // dropdown, under "All" or by name. Scope values:
  //   ''         All (current), the default -- isCurrentEventRow(), the rule
  //              every staff page uses (to two weeks after an event ends, a
  //              year ahead), so camp weeks open for registration show
  //   'all'      All: full history, archived included
  //   'archived' All (archived): archived events only
  //   'upcoming' starts within 90 days or currently running
  //   'recent'   ended within the last 90 days
  //   <uuid>     one specific event
  // The first three are every staff page's (EVENT_SCOPES, lib/events.js,
  // 4 Nov 2026); the 90-day windows are this page's own.
  // An archived event is in none of the time scopes (inPaymentsScope, built
  // on isCurrentEventRow -- lib/events.js); 'all' and a chosen event keep it.
  const inScope = (ev) => inPaymentsScope(ev, eventFilter);
  const SCOPE_LABEL = {
    upcoming: 'Upcoming events (next 90 days)',
    recent: 'Recent events (last 90 days)',
  };
  const scopeLabel =
    eventScopeLabel(eventFilter) ?? SCOPE_LABEL[eventFilter] ?? evById.get(eventFilter)?.name ?? 'Selected event';

  // One card per event, keyed by its id (two events may share a name);
  // registrations with no event share one Unassigned card.
  const UNASSIGNED = 'unassigned';
  const events = new Map();
  for (const b of balances ?? []) {
    const ev = regById.get(b.registration_id)?.events;
    if (!inScope(ev)) continue;
    const key = ev?.id ?? UNASSIGNED;
    // starts_on kept for the card order below; null for Unassigned.
    const cur = events.get(key) ?? {
      name: ev?.id ? ev.name ?? 'Unnamed event' : 'Unassigned',
      startsOn: ev?.starts_on ?? null,
      fees: 0,
      assist: 0,
      paid: 0,
      outstanding: 0,
    };
    // 0123: returned-payment and staff-added fees are owed, so they count here.
    cur.fees += (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0) + (b.fees_cents ?? 0);
    cur.assist += (b.scholarship_cents ?? 0) + (b.discount_cents ?? 0) + (b.coupon_cents ?? 0);
    cur.paid += b.paid_cents ?? 0;
    cur.outstanding += Math.max(0, b.balance_cents ?? 0);
    events.set(key, cur);
  }
  // Cards by start date, earliest first; the name breaks a tie, and
  // Unassigned (or an event with no date) comes last.
  const eventCards = [...events.entries()].sort(([ak, a], [bk, b]) => {
    const aLast = ak === UNASSIGNED || !a.startsOn;
    const bLast = bk === UNASSIGNED || !b.startsOn;
    if (aLast !== bLast) return aLast ? 1 : -1;
    return (a.startsOn ?? '').localeCompare(b.startsOn ?? '') || a.name.localeCompare(b.name);
  });
  // Two cards with the same name: each heading also gets its start date.
  const nameCount = new Map();
  for (const [, e] of eventCards) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
  const cardHeading = (e) => (nameCount.get(e.name) > 1 && e.startsOn ? `${e.name} (${formatDueDateShort(e.startsOn)})` : e.name);
  const feeCoverTotal = (pays ?? []).reduce(
    (s, p) =>
      s +
      (inScope(regById.get(p.registration_id)?.events) &&
      (p.status === 'succeeded' || p.status === 'processing' || p.status === 'refunded')
        ? p.fee_cover_cents ?? 0
        : 0),
    0
  );

  const regOptions = (balances ?? []).map((b) => {
    const r = regById.get(b.registration_id);
    return {
      id: b.registration_id,
      label: `${r?.households?.display_name ?? 'Household'}: ${eventNameWithYear(r?.events)} (balance ${money(b.balance_cents)})`,
    };
  });

  // Payment-state filter for the balances table + CSV. Definitions:
  //   unpaid  = owes something, nothing received
  //   partial = something received, balance remains
  //   paid    = balance settled (payments incl. clearing bank transfers)
  //   scholarship = any scholarship or discount applied
  const matchesPaystate = (b) => {
    const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0) + (b.fees_cents ?? 0);
    const paid = b.paid_cents ?? 0;
    const bal = b.balance_cents ?? 0;
    switch (paystate) {
      case 'unpaid':
        return paid === 0 && bal > 0;
      case 'partial':
        return paid > 0 && bal > 0;
      case 'paid':
        return net > 0 && bal <= 0;
      case 'scholarship':
        return (b.scholarship_cents ?? 0) > 0 || (b.discount_cents ?? 0) > 0;
      // The review classes (0081).
      case 'deposit_paid':
      case 'full_scholarship':
      case 'neither':
        return reviewByReg.get(b.registration_id)?.review_class === paystate;
      case 'flagged':
        // Money flags only (14 Oct 2026): the photo and Creed flags moved to
        // the review queue (/admin/review), where every flag lives together.
        return (reviewByReg.get(b.registration_id)?.flags ?? []).includes('deposit_short');
      // A family that has paid more than it owes -- a refund due, a scholarship
      // granted after payment, a cancelled person. Money staff must settle, so
      // it is a flag here (Lawrence, 15 Oct 2026).
      case 'credit':
        return bal < 0;
      default:
        return true;
    }
  };
  // Every word typed must appear in the family's name, a person's name on
  // the registration, or the event's name (case and accents aside).
  const fold = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const words = fold(q).split(/\s+/).filter(Boolean);
  const matchesSearch = (b) => {
    if (words.length === 0) return true;
    const r = regById.get(b.registration_id);
    const hay = fold(
      `${r?.households?.display_name ?? ''} ${namesByReg.get(b.registration_id) ?? ''} ${r?.events ? eventNameWithYear(r.events) : ''}`
    );
    return words.every((w) => hay.includes(w));
  };
  const filteredBalances = (balances ?? []).filter(
    (b) => matchesPaystate(b) && inScope(regById.get(b.registration_id)?.events) && matchesSearch(b)
  );
  const PAYSTATES = [
    ['', 'All'],
    ['unpaid', 'Nothing paid'],
    ['partial', 'Partially paid'],
    ['paid', 'Fully paid'],
    ['scholarship', 'Scholarship/discount'],
    // 'To review: deposit received' and 'To contact: full scholarship' left
    // the row on 23 Nov 2026 (review): Awaiting Review lists both, with the
    // flags beside them. matchesPaystate still answers ?paystate=deposit_paid
    // and full_scholarship, so an old bookmark keeps working.
    ['neither', 'Deposit short'],
    ['flagged', 'Deposit short, part paid'],
    ['credit', 'Credit to settle'],
  ];
  // One helper builds every filter-carrying URL (pills, CSVs) so the active
  // event + payment state always travel together.
  const qs = (over = {}) => {
    const p = new URLSearchParams();
    const ps = 'paystate' in over ? over.paystate : paystate;
    const ev = 'event' in over ? over.event : eventFilter;
    const qq = 'q' in over ? over.q : q;
    if (ps) p.set('paystate', ps);
    if (ev) p.set('event', ev);
    if (qq) p.set('q', qq);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  // QuickBooks Online shape (item 14) is money received in a date range,
  // across every event -- not the page's scope (Script 6, 13.40, 26 Oct
  // 2026). It opens on this month so far.
  const monthStart = `${dueToday.slice(0, 8)}01`;

  return (
    <div>
      {/* Money Changes (the money audit trail, 0111) at top right for
          administrators, who alone may read it (23 Nov 2026 review). */}
      <AdminPageHeader
        title="Event Payments"
        className="mb-4"
        actions={
          can(staff, 'admin') && (
            <Link href="/admin/payments/changes/" className="text-sm text-brand underline">
              Money changes →
            </Link>
          )
        }
        intro={
          <>
            What each family owes and has paid for an event (Camp Celebrate, retreats and others). Online
            payments are recorded automatically. Enter checks and cash below. Donations are on the Giving
            page.
          </>
        }
      />

      {staleRefunds.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            ⚑ {staleRefunds.length} {staleRefunds.length === 1 ? 'refund has' : 'refunds have'} been pending more
            than {STALE_REFUND_DAYS} days
          </p>
          <p className="mt-1">
            Refunds usually clear in a few business days. Until these clear, &ldquo;Paid&rdquo; still
            includes them, so check each one. <em>Re-check with Stripe</em> asks Stripe for the status and
            records it.
          </p>
          <ul className="mt-2 space-y-0.5">
            {staleRefunds.map((r) => {
              const reg = regById.get(r.registration_id);
              return (
                <li key={r.id}>
                  <Link href={`/admin/registrations/${r.registration_id}/#payments`} className="font-semibold underline">
                    {reg?.households?.display_name ?? 'A family'}
                  </Link>{' '}
                  · {money(r.amount_cents)} · pending since {dayInMorristown(r.created_at)}
                  {reg?.events?.name ? ` · ${reg.events.name}` : ''}
                  {can(staff, 'write:payments') && <RecheckRefund refundId={r.id} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* The one event dropdown every staff page uses. It governs the cards,
          fee covers, the balances table, and the Balances and Payments CSVs
          (not the QuickBooks CSV, which is a date range of money received).
          Default: All (current). Until 4 Nov 2026 a second "Showing … Apply"
          dropdown sat under the event pills offering the 90-day windows and
          full history (Lawrence: pills and a dropdown were redundant); those
          are pinned options here now -- full history is the shared "All" --
          on the same ?event= parameter. */}
      <EventFilter
        events={eventOptions.map((ev) => ({
          id: ev.id,
          name: ev.name,
          startsOn: ev.starts_on,
          endsOn: ev.ends_on,
          archivedAt: ev.archived_at,
        }))}
        selected={eventFilter || null}
        basePath="/admin/payments"
        extraParams={{ paystate }}
        allowAll
        scopes={Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label }))}
      />
      {/* Exports: report, then format, then dates (ExportBar.jsx). Under the
          event filter since 23 Nov 2026 (design scheme): two of its three
          files follow that filter, so the row sits with what it depends on. */}
      <ExportBar eventFilter={eventFilter} paystate={paystate} defaultFrom={monthStart} defaultTo={dueToday} />

      <h3 className="mb-2 text-lg font-bold">
        By event <span className="font-normal text-sm text-neutral-500">· {scopeLabel}</span>
      </h3>
      {events.size === 0 && (
        <p className="text-sm text-neutral-500 mb-8">
          No events in this window. Choose another in the event list above. &ldquo;All&rdquo; shows the
          full history.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {eventCards.map(([key, e]) => (
          <div key={key} className="card p-5">
            <h4 className="font-bold mb-2">{cardHeading(e)}</h4>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between"><dt className="text-neutral-500">Fees (net of assistance)</dt><dd className="font-semibold">{money(e.fees)}</dd></div>
              {e.assist > 0 && (
                <div className="flex justify-between"><dt className="text-neutral-500">Scholarships &amp; discounts</dt><dd className="font-semibold text-green-700">−{money(e.assist)}</dd></div>
              )}
              <div className="flex justify-between"><dt className="text-neutral-500">Paid / clearing</dt><dd className="font-semibold text-green-700">{money(e.paid)}</dd></div>
              <div className="flex justify-between"><dt className="text-neutral-500">Outstanding</dt><dd className="font-semibold text-amber-700">{money(e.outstanding)}</dd></div>
            </dl>
          </div>
        ))}
        <div className="card p-5">
          <h4 className="font-bold mb-2">Fee covers</h4>
          <div className="text-2xl font-bold">{money(feeCoverTotal)}</div>
          <p className="text-xs text-neutral-500 mt-1">
            What payers chose to add to cover processing fees, for the events shown above. It
            never counts toward a family&rsquo;s balance. The treasurer decides how it&rsquo;s
            classified.
          </p>
        </div>
      </div>

      {/* Above the table (Lawrence, 26 Oct 2026): recording a check is the
          everyday job here, and the table is long. */}
      <h3 className="mb-2 text-lg font-bold">Record a payment &amp; recent activity</h3>
      <div className="grid items-start gap-6 lg:grid-cols-2 mb-8">
        <FoldCard as="h4" title="Record a check or cash payment">
          <RecordPaymentForm registrations={regOptions} />
        </FoldCard>

        {/* The status counts sit in the title, so they read with the card
            closed (Lawrence, 26 Oct 2026). */}
        <FoldCard
          as="h4"
          title="Recent activity"
          badges={recentCounts.map(([status, n]) => (
            <span
              key={status}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[status] ?? 'bg-neutral-100 text-neutral-600'}`}
            >
              {n} {status}
            </span>
          ))}
        >
          {(pays ?? []).length === 0 ? (
            <p className="text-neutral-500 text-sm">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {(pays ?? []).slice(0, 15).map((p, i) => {
                const r = regById.get(p.registration_id);
                return (
                  <li key={i} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-medium">{r?.households?.display_name ?? 'Household'}</span>{' '}
                      <span className="text-neutral-500">
                        · {dayInMorristown(p.received_on ?? p.created_at)} · {METHOD_LABEL[p.method] ?? p.method}
                      </span>
                      <br />
                      <span className="font-semibold">{money(p.amount_cents)}</span>
                      {(p.fee_cover_cents ?? 0) > 0 && (
                        <span className="text-neutral-500"> + {money(p.fee_cover_cents)} fee cover</span>
                      )}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[p.status] ?? ''}`}>
                      {p.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </FoldCard>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 className="text-lg font-bold">Balances by family</h3>
        {/* Two plain links (23 Nov 2026 review): this row was styled as tabs,
            with "Balances" underlined, but the other two are separate pages,
            not tabs of this one. The photo and Creed flags that used to show
            in the Review column live on Awaiting Review. */}
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/admin/scholarships/" className="text-brand underline">
            Scholarship Requests →
          </Link>
          <Link href="/admin/review/" className="text-brand underline">
            Awaiting Review →
          </Link>
        </div>
      </div>
      {/* Search (a plain form: works without JavaScript, and the address
          keeps the search with the event and the chip chosen). */}
      <form method="get" action="/admin/payments/" className="flex flex-wrap items-center gap-2 mb-3">
        {paystate && <input type="hidden" name="paystate" value={paystate} />}
        {eventFilter && <input type="hidden" name="event" value={eventFilter} />}
        <label htmlFor="balances-q" className="sr-only">
          Search families
        </label>
        <input
          id="balances-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by family, person or event"
          className="field sm:w-80"
        />
        <button type="submit" className="btn-outline btn-sm">
          Search
        </button>
        {q && (
          <Link href={`/admin/payments/${qs({ q: '' })}`} className="text-sm text-brand underline">
            Clear search
          </Link>
        )}
      </form>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FilterChips
          label="Show families"
          current={paystate}
          items={PAYSTATES.map(([v, label]) => ({ key: v, label, href: `/admin/payments${qs({ paystate: v })}` }))}
        />
        <span className="text-sm text-neutral-500 self-center">
          {filteredBalances.length} {filteredBalances.length === 1 ? 'family' : 'families'}
          {q ? ` matching “${q}”` : ''}
        </span>
      </div>
      {/* The two disabled "coming soon" buttons (balance reminders, email
          selected families) were never wired and are gone (23 Nov 2026
          review): the automatic emails (0138) send balance reminders, and
          Email Families is where staff write to families themselves. */}
      <p className="mb-3 text-sm text-neutral-500">
        Families who still owe get reminder emails automatically.
        {can(staff, 'write:registration') && (
          <>
            {' '}
            To write to families yourself, use{' '}
            <Link href="/admin/email-families/" className="text-brand underline">
              Email Families
            </Link>
            .
          </>
        )}
      </p>
      {/* lg:overflow-visible lets the row-actions menu overlay the table
          edge on desktop; small screens keep horizontal scrolling. */}
      <div className="card p-0 overflow-x-auto lg:overflow-visible mb-8">
        <ResizableTable storageKey="event-payments">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Household</th>
              <th className="px-4 py-2 font-semibold">Event</th>
              <th className="px-4 py-2 font-semibold text-right">Fees</th>
              <th className="px-4 py-2 font-semibold text-right">Scholarship / discount</th>
              <th className="px-4 py-2 font-semibold text-right">Paid</th>
              <th className="px-4 py-2 font-semibold text-right">Balance</th>
              <th className="px-4 py-2 font-semibold">Due</th>
              <th className="px-4 py-2 font-semibold">Paying by</th>
              <th className="px-4 py-2 font-semibold">Review</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {filteredBalances.map((b) => {
              const r = regById.get(b.registration_id);
              const assist = (b.discount_cents ?? 0) + (b.scholarship_cents ?? 0) + (b.coupon_cents ?? 0);
              const bal = b.balance_cents ?? 0;
              // Two weeks before a camp week starts (30 Sep 2026). Overdue =
              // still owing once Morristown's calendar has passed the date.
              const dueOn = balanceDueOn(r?.events);
              const overdue = Boolean(dueOn) && bal > 0 && dueToday > dueOn;
              return (
                <tr key={b.registration_id} className="border-t border-neutral-100">
                  <td className="px-4 py-2">
                    <Link href={`/admin/registrations/${b.registration_id}`} className="text-brand underline font-medium">
                      {r?.households?.display_name ?? 'Household'}
                    </Link>
                    {countByReg.get(b.registration_id) > 0 && (
                      <span className="block text-xs text-neutral-500">
                        {countByReg.get(b.registration_id)} registered
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{r?.events?.name ?? ''}</td>
                  <td className="px-4 py-2 text-right">
                    {money((b.fee_cents ?? 0) + (b.fees_cents ?? 0))}
                    {(b.fees_cents ?? 0) > 0 && (
                      <span className="block text-xs text-amber-800">incl. {money(b.fees_cents)} fees</span>
                    )}
                  </td>
                  {/* A link to where it is decided: the registration, with the
                      scholarship / discount editor open (Lawrence, 29 Oct 2026).
                      Deciding stays there -- it is per person and needs
                      Payments and Registration write (0102). */}
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/admin/registrations/${b.registration_id}/?adjust=1#people`}
                      className={`${assist > 0 ? 'text-green-700' : 'text-neutral-400'} hover:underline`}
                      title="Open this registration's scholarship / discount editor"
                    >
                      {assist > 0 ? `−${money(assist)}` : '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right">{money(b.paid_cents)}</td>
                  {/* A credit reads as one unit, worded as the Review column
                      words it -- a bare "−" wrapped onto its own line above
                      the amount (Script 6, 13.40). */}
                  <td className={`px-4 py-2 text-right whitespace-nowrap font-semibold ${bal > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                    {bal < 0 ? `Credit of ${money(-bal)}` : money(bal)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {!dueOn ? (
                      <span className="text-neutral-400">—</span>
                    ) : overdue ? (
                      <Pill tone="hold">Overdue · {formatDueDateShort(dueOn)}</Pill>
                    ) : (
                      <span className={bal > 0 ? '' : 'text-neutral-400'}>{formatDueDateShort(dueOn)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm">
                    {(() => {
                      const rt = routeByReg.get(b.registration_id);
                      if (!rt) return <span className="text-neutral-400">—</span>;
                      if (rt.route === 'none') {
                        return requiresPaymentChoice(r?.events) ? (
                          <Pill tone="todo">Not finished</Pill>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        );
                      }
                      if (rt.route === 'plan') {
                        const bad = rt.plan_status === 'failed';
                        return (
                          <span className={bad ? 'font-semibold text-red-700' : ''}>
                            Plan · {SCHEDULE_LABEL[rt.plan_schedule] ?? rt.plan_schedule}
                            {rt.plan_status !== 'active' ? ` · ${rt.plan_status}` : ''}
                          </span>
                        );
                      }
                      return ROUTE_LABEL[rt.route] ?? rt.route;
                    })()}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {(() => {
                      const rv = reviewByReg.get(b.registration_id);
                      const c = rv ? REVIEW_CLASS[rv.review_class] : null;
                      const credit = (b.balance_cents ?? 0) < 0 ? -b.balance_cents : 0;
                      if (!c && !credit) return <span className="text-neutral-400">—</span>;
                      return (
                        <div className="space-y-1">
                          {c && (
                            <Pill cls={c.cls} title={c.hint}>
                              {reviewClassLabel(rv)}
                            </Pill>
                          )}
                          {credit > 0 && (
                            <span
                              title="Paid more than is owed, from a refund due, a later scholarship, or a canceled person. Refund it, or carry it as a credit."
                              className="block text-xs font-semibold text-amber-800"
                            >
                              ⚑ Credit of {money(credit)}, paid more than owed
                            </span>
                          )}
                          {(rv.flags ?? []).filter((f) => f === 'deposit_short').map((f) => (
                            <span
                              key={f}
                              className="block text-xs font-semibold text-amber-800"
                            >
                              ⚑ {REVIEW_FLAG[f] ?? f}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {/* Per-family actions. <details> = no JavaScript needed;
                        the menu floats over the table, anchored to the ⋯
                        button. The disabled "Email balance owed" item was
                        removed on 23 Nov 2026: it was never wired. */}
                    <details className="relative inline-block text-left">
                      <summary
                        className="cursor-pointer select-none list-none rounded-sm border border-neutral-300 px-2 py-0.5 font-bold text-neutral-600 hover:border-brand [&::-webkit-details-marker]:hidden"
                        title="Actions for this family"
                      >
                        ⋯
                      </summary>
                      <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-neutral-200 bg-white py-1 text-left text-sm shadow-lg">
                        <a
                          href={`/admin/registrations/${b.registration_id}/statement`}
                          className="block px-3 py-1.5 text-brand hover:bg-neutral-50"
                        >
                          Statement
                        </a>
                        {/* Real since 0038. A refund reverses one PAYMENT,
                            and this table knows balances, not transactions --
                            so the action lives on the family's registration
                            page, where each payment can be picked. */}
                        <a
                          href={`/admin/registrations/${b.registration_id}#payments`}
                          className="block px-3 py-1.5 text-brand hover:bg-neutral-50"
                        >
                          Refund a payment
                        </a>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
            {filteredBalances.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-neutral-500">
                  {q ? `No families match “${q}” with these filters.` : 'No families with these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </ResizableTable>
      </div>

    </div>
  );
}
