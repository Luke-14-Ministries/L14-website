import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { balanceDueOn, formatDueDateShort, todayInMorristown, dayInMorristown, inPaymentsScope } from '@/lib/events';
import EventFilter from '@/components/EventFilter';
import RecordPaymentForm from './RecordPaymentForm';
import { requiresPaymentChoice, ROUTE_LABEL, SCHEDULE_LABEL, REVIEW_CLASS, REVIEW_FLAG } from '@/lib/plans';

export const metadata = { title: 'Event Payments — Staff Admin' };

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
  processing: 'bg-amber-100 text-amber-800',
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

  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/payments/');
  if (!can(staff, 'read:payments')) redirect('/admin');

  const supabase = await createClient();

  const [
    { data: balances },
    { data: regs },
    { data: pays },
    { data: routes, error: routesError },
    { data: reviews, error: reviewError },
  ] = await Promise.all([
    supabase
      .from('registration_balances')
      .select('registration_id, event_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents'),
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
    supabase.from('registration_review').select('registration_id, review_class, flags'),
  ]);
  if (reviewError) throw new Error(`Review classes: ${reviewError.message}`);
  const reviewByReg = new Map((reviews ?? []).map((x) => [x.registration_id, x]));
  if (routesError) throw new Error(`Payment routes: ${routesError.message}`);
  const routeByReg = new Map((routes ?? []).map((x) => [x.registration_id, x]));

  const regById = new Map((regs ?? []).map((r) => [r.id, r]));
  const dueToday = todayInMorristown();

  // Every event that has at least one registration, newest first, for the
  // "Specific event" section of the scope dropdown.
  const evById = new Map();
  for (const r of regs ?? []) if (r.events?.id) evById.set(r.events.id, r.events);
  const eventOptions = [...evById.values()].sort((a, b) =>
    (b.starts_on ?? '').localeCompare(a.starts_on ?? '')
  );

  // Event scope. The dashboard is a quick view of what is coming up (and
  // just wrapped), not a wall of history — old years stay one dropdown
  // selection away under "All events". Scope values:
  //   ''         default: upcoming (next 90 days) + recent (last 90 days)
  //   'upcoming' starts within 90 days or currently running
  //   'recent'   ended within the last 90 days
  //   'all'      full history
  //   <uuid>     one specific event
  // An archived event is in none of the time scopes (inPaymentsScope, built
  // on isCurrentEventRow -- lib/events.js); 'all' and a chosen event keep it.
  const inScope = (ev) => inPaymentsScope(ev, eventFilter);
  const SCOPE_LABEL = {
    '': 'Upcoming & recent events (90 days each way)',
    upcoming: 'Upcoming events (next 90 days)',
    recent: 'Recent events (last 90 days)',
    all: 'All events — full history',
  };
  const scopeLabel = SCOPE_LABEL[eventFilter] ?? evById.get(eventFilter)?.name ?? 'Selected event';

  const events = new Map();
  for (const b of balances ?? []) {
    const ev = regById.get(b.registration_id)?.events;
    if (!inScope(ev)) continue;
    const evName = ev?.name ?? 'Unassigned';
    const cur = events.get(evName) ?? { fees: 0, assist: 0, paid: 0, outstanding: 0 };
    cur.fees += (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
    cur.assist += (b.scholarship_cents ?? 0) + (b.discount_cents ?? 0) + (b.coupon_cents ?? 0);
    cur.paid += b.paid_cents ?? 0;
    cur.outstanding += Math.max(0, b.balance_cents ?? 0);
    events.set(evName, cur);
  }
  const feeCoverTotal = (pays ?? []).reduce(
    (s, p) =>
      s +
      (inScope(regById.get(p.registration_id)?.events) &&
      (p.status === 'succeeded' || p.status === 'processing')
        ? p.fee_cover_cents ?? 0
        : 0),
    0
  );

  const regOptions = (balances ?? []).map((b) => {
    const r = regById.get(b.registration_id);
    return {
      id: b.registration_id,
      label: `${r?.households?.display_name ?? 'Household'} — ${r?.events?.name ?? ''} (balance ${money(b.balance_cents)})`,
    };
  });

  // Payment-state filter for the balances table + CSV. Definitions:
  //   unpaid  = owes something, nothing received
  //   partial = something received, balance remains
  //   paid    = balance settled (payments incl. clearing bank transfers)
  //   scholarship = any scholarship or discount applied
  const matchesPaystate = (b) => {
    const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
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
  const filteredBalances = (balances ?? []).filter(
    (b) => matchesPaystate(b) && inScope(regById.get(b.registration_id)?.events)
  );
  const PAYSTATES = [
    ['', 'All'],
    ['unpaid', 'Nothing paid'],
    ['partial', 'Partially paid'],
    ['paid', 'Fully paid'],
    ['scholarship', 'Scholarship/discount'],
    ['deposit_paid', 'To review: deposit received'],
    ['full_scholarship', 'To contact: full scholarship'],
    ['neither', 'No full deposit yet'],
    ['flagged', 'Deposit short'],
    ['credit', 'Credit to settle'],
  ];
  // One helper builds every filter-carrying URL (pills, CSVs) so the active
  // event + payment state always travel together.
  const qs = (over = {}) => {
    const p = new URLSearchParams();
    const ps = 'paystate' in over ? over.paystate : paystate;
    const ev = 'event' in over ? over.event : eventFilter;
    if (ps) p.set('paystate', ps);
    if (ev) p.set('event', ev);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const csvHref = `/admin/exports/payments${qs()}`;
  // QuickBooks Online shape (item 14): the same scope, money that moved.
  const qbHref = `${csvHref}${qs() ? '&' : '?'}format=quickbooks`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Event Payments</h2>
        <span className="flex gap-2">
          <a
            href={`/admin/exports/balances${qs()}`}
            className="btn-outline py-2! text-sm"
            title="One row per family: fees, scholarships, paid, balance"
          >
            Balances CSV
          </a>
          <a href={csvHref} className="btn-outline py-2! text-sm" title="One row per payment received">
            Payments CSV
          </a>
          <a
            href={qbHref}
            className="btn-outline py-2! text-sm"
            title="Date, Name, Memo, Account, Amount — succeeded payments and refunds in this scope, covered fees as their own line. Account names are placeholders until the treasurer confirms them."
          >
            QuickBooks CSV
          </a>
        </span>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        What each family owes and has paid for an event (Camp Celebrate, retreats, and the rest). Online payments record themselves; checks
        and cash are entered below. Donations live on the separate Giving page.
      </p>

      {/* The one event filter every staff page uses (16 Oct 2026): pills for
          current events, a search box for the rest. The scope dropdown below
          keeps the time scopes (90 days each way, full history); both drive
          the same ?event= parameter. */}
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
        allLabel="Upcoming & recent"
      />

      {/* Event scope: governs the cards, fee covers, the balances table,
          and both CSV downloads. Default keeps this a quick view of what's
          coming up; full history is one selection away. */}
      <form method="get" action="/admin/payments" className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <label className="font-semibold text-neutral-700" htmlFor="event-scope">Showing</label>
        <select
          id="event-scope"
          name="event"
          defaultValue={eventFilter}
          className="rounded-sm border border-neutral-300 px-2 py-1"
        >
          <option value="">Upcoming &amp; recent events (90 days each way)</option>
          <option value="upcoming">Upcoming events (next 90 days)</option>
          <option value="recent">Recent events (last 90 days)</option>
          <option value="all">All events — full history</option>
          <optgroup label="Specific event">
            {eventOptions.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </optgroup>
        </select>
        {paystate && <input type="hidden" name="paystate" value={paystate} />}
        <button type="submit" className="btn-outline py-1! px-3!">Apply</button>
      </form>

      <h3 className="font-semibold text-neutral-700 mb-2">
        By event <span className="font-normal text-sm text-neutral-500">· {scopeLabel}</span>
      </h3>
      {events.size === 0 && (
        <p className="text-sm text-neutral-500 mb-8">
          No events in this window. Choose another option above — &ldquo;All events&rdquo; shows the
          full history.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {[...events.entries()].map(([name, e]) => (
          <div key={name} className="rounded-lg bg-white border border-neutral-200 shadow-xs p-5">
            <h4 className="font-bold mb-2">{name}</h4>
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
        <div className="rounded-lg bg-white border border-neutral-200 shadow-xs p-5">
          <h4 className="font-bold mb-2">Fee covers</h4>
          <div className="text-2xl font-bold">{money(feeCoverTotal)}</div>
          <p className="text-xs text-neutral-500 mt-1">
            Voluntarily added by payers to cover processing fees, totaled for the events shown
            above. Never counts toward a family&rsquo;s balance; how it is classified is a
            treasurer decision.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h3 className="font-semibold text-neutral-700">Balances by family</h3>
        {/* Scholarship decisions are money decisions (Lawrence, 14 Oct 2026),
            so their page sits here as a tab rather than elsewhere in the
            sidebar. The photo and Creed flags that used to show in the
            Review column live on the review queue instead. */}
        <nav className="flex gap-3 text-sm">
          <span className="font-semibold text-brand-dark border-b-2 border-brand">Balances</span>
          <Link href="/admin/scholarships/" className="text-neutral-600 hover:text-brand-dark hover:underline">
            Scholarship requests →
          </Link>
          <Link href="/admin/review/" className="text-neutral-600 hover:text-brand-dark hover:underline">
            Review queue →
          </Link>
        </nav>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {PAYSTATES.map(([v, label]) => (
          <Link
            key={v}
            href={`/admin/payments${qs({ paystate: v })}`}
            className={`rounded-full px-3 py-1 text-sm font-semibold border ${
              paystate === v
                ? 'bg-brand text-white border-brand'
                : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            {label}
          </Link>
        ))}
        <span className="text-sm text-neutral-500 self-center">
          {filteredBalances.length} {filteredBalances.length === 1 ? 'family' : 'families'}
        </span>
      </div>
      {/* Planned global actions — visible placeholders so staff can see
          what is coming (Resend-powered reminders). Per-family actions
          (statement, email, refund) live in each row's ⋯ menu. */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
        <span className="text-neutral-500 font-semibold">Actions:</span>
        {['Email balance reminders (all shown)', 'Email selected families'].map((label) => (
          <button
            key={label}
            type="button"
            disabled
            title="Planned — not active yet"
            className="cursor-not-allowed rounded-sm border border-dashed border-neutral-300 px-3 py-1 text-neutral-400"
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-neutral-400">coming soon</span>
      </div>
      {/* lg:overflow-visible lets the row-actions menu overlay the table
          edge on desktop; small screens keep horizontal scrolling. */}
      <div className="overflow-x-auto lg:overflow-visible rounded-lg border border-neutral-200 bg-white mb-8">
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
                  </td>
                  <td className="px-4 py-2">{r?.events?.name ?? ''}</td>
                  <td className="px-4 py-2 text-right">{money(b.fee_cents)}</td>
                  <td className="px-4 py-2 text-right text-green-700">
                    {assist > 0 ? `−${money(assist)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{money(b.paid_cents)}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${bal > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                    {bal < 0 ? `−${money(-bal)}` : money(bal)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {!dueOn ? (
                      <span className="text-neutral-400">—</span>
                    ) : overdue ? (
                      <span className="rounded-sm bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">
                        Overdue · {formatDueDateShort(dueOn)}
                      </span>
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
                          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                            Not finished
                          </span>
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
                            <span
                              title={c.hint}
                              className={`inline-block whitespace-nowrap rounded-sm px-1.5 py-0.5 text-xs font-semibold ${c.cls}`}
                            >
                              {c.label}
                            </span>
                          )}
                          {credit > 0 && (
                            <span
                              title="Paid more than is owed: a refund due, a later scholarship, or a cancelled person. Settle it -- refund, or carry it as a credit."
                              className="block text-xs font-semibold text-amber-800"
                            >
                              ⚑ Credit of {money(credit)} — paid more than owed
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
                        button. Email + Refund are planned placeholders
                        (refunds work in Stripe today). */}
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
                        <button
                          type="button"
                          disabled
                          title="Planned — not active yet"
                          className="block w-full cursor-not-allowed px-3 py-1.5 text-left text-neutral-400"
                        >
                          Email balance owed + payment link
                        </button>
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
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold text-neutral-700 mb-2">Record a payment &amp; recent activity</h3>
      <div className="grid gap-6 lg:grid-cols-2">
        <RecordPaymentForm registrations={regOptions} />

        <div className="rounded-lg bg-white border border-neutral-200 shadow-xs p-6">
          <h4 className="font-bold mb-3">Recent activity</h4>
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
        </div>
      </div>
    </div>
  );
}
