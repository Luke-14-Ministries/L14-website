// GET /admin/exports/payments — every event payment as a CSV download.
// Registrar-gated; RLS is the backstop. The ordinary file follows the Event
// Payments page's scope (?event=, ?paystate=).
//
// ?format=quickbooks (build plan item 14; the call of 16 Oct 2026, 3:30 pm):
// money received, in the column order QuickBooks Online takes -- Date, Name,
// Memo, Account, Class, Amount -- one row per payment that actually moved money
// (succeeded, or since refunded: the refund is its own row), a second row for
// a processing fee the payer covered (booked with its transaction, as
// agreed), and negative rows for refunds. Since 26 Oct 2026 (Script 6, 13.40)
// it is a DATE RANGE on when the money moved -- ?from=YYYY-MM-DD&to=YYYY-MM-DD,
// inclusive, either one empty for no limit -- across EVERY event, sorted by
// date. It ignores the page's event scope and payment-state pill: the
// treasurer books a month of money, not one event's families.
// Gross per payment, as the treasurer books it; Stripe's own fee is not in
// this system and comes from Stripe's payout report. Account and class are
// the ministry's own (Larry, 29 Oct 2026; lib/quickbooks.js): registration
// money is 44000 Purchase of Goods or Services, and the class is the event.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { csvCell } from '@/lib/csv';
import { QB_REGISTRATION_ACCOUNT, eventClass } from '@/lib/quickbooks';
import { dayInMorristown, todayInMorristown, inPaymentsScope } from '@/lib/events';

// A payment's note as the treasurer should read it: in dollars. The Stripe
// webhook's first versions wrote the fee cover in cents ("family added 181¢
// to cover the processing fee"), and those rows keep their note as written;
// the files print "$1.81". The stored note is not changed.
const noteInDollars = (note) =>
  note ? String(note).replace(/(\d+)¢/g, (_, c) => `$${(Number(c) / 100).toFixed(2)}`) : note;

// Quoting and spreadsheet-formula safety: lib/csv.js.
const esc = csvCell;

export async function GET(request) {
  const staff = await getStaff();
  if (!can(staff, 'read:payments')) {
    return new Response('Not permitted', { status: 403 });
  }

  const url = new URL(request.url);
  const paystate = url.searchParams.get('paystate') || '';
  const eventFilter = url.searchParams.get('event') || '';
  const quickbooks = url.searchParams.get('format') === 'quickbooks';
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  // The received-date range applies to the plain CSV too since 26 Oct 2026
  // (Lawrence: one date filter for both payment exports). Either end empty
  // means no limit on that side.
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
    return new Response('From and To must be dates (YYYY-MM-DD).', { status: 400 });
  }
  if (from && to && from > to) {
    return new Response('The From date is after the To date.', { status: 400 });
  }
  const inDateRange = (day) => !from && !to ? true : Boolean(day) && (!from || day >= from) && (!to || day <= to);

  const supabase = await createClient();
  const [
    { data: pays, error: paysError },
    { data: regs, error: regsError },
    { data: balances, error: balancesError },
    { data: refunds, error: refundsError },
  ] = await Promise.all([
    supabase
      .from('payments')
      .select('registration_id, amount_cents, fee_cover_cents, method, status, received_on, created_at, note, payer_email, payer_name, stripe_payment_intent_id')
      .order('created_at'),
    supabase.from('registrations').select('id, events ( id, name, starts_on, ends_on, archived_at ), households ( display_name )'),
    supabase
      .from('registration_balances')
      .select('registration_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents, fees_cents'),
    // Refunds, for the QuickBooks shape: money that went back out.
    supabase
      .from('payment_refunds')
      .select('registration_id, amount_cents, fee_cover_cents, status, method, reason, note, refunded_on, created_at, stripe_refund_id')
      .order('created_at'),
  ]);
  // Never a short file in place of an error: a missing row here is money
  // missing from the books.
  const failed = paysError ?? regsError ?? balancesError ?? refundsError;
  if (failed) {
    return new Response(`Could not read the payments: ${failed.message}`, { status: 500 });
  }
  const regById = new Map((regs ?? []).map((r) => [r.id, r]));

  // Same payment-state filter as the Event Payments page: the CSV matches
  // whatever pill was active when Download was clicked.
  let allowed = null;
  if (paystate) {
    allowed = new Set(
      (balances ?? [])
        .filter((b) => {
          // 0123: added fees are owed, as on the Event Payments page.
          const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0) + (b.fees_cents ?? 0);
          const paid = b.paid_cents ?? 0;
          const bal = b.balance_cents ?? 0;
          if (paystate === 'unpaid') return paid === 0 && bal > 0;
          if (paystate === 'partial') return paid > 0 && bal > 0;
          if (paystate === 'paid') return net > 0 && bal <= 0;
          if (paystate === 'scholarship') return (b.scholarship_cents ?? 0) > 0 || (b.discount_cents ?? 0) > 0;
          return true;
        })
        .map((b) => b.registration_id)
    );
  }

  // Payer and Stripe reference are here for reconciliation: this CSV is what
  // gets laid beside a Stripe export or a bank statement, and the household
  // name alone cannot match a row when the family has since changed their
  // email (26 Aug -- see migration 0054). Payer is the frozen snapshot from
  // the time of payment, so it is allowed to differ from Household.
  const rows = [
    ['Date', 'Household', 'Event', 'Amount', 'Fee cover', 'Method', 'Status',
     'Paid by', 'Payer email', 'Stripe reference', 'Note'],
  ];
  // Same event scope as the Event Payments page: '' = current events
  // (isCurrentEventRow), 'upcoming', 'recent', 'all', or one event's id --
  // one function for both (inPaymentsScope, lib/events.js); archived events
  // are in no time scope.
  const inScope = (ev) => inPaymentsScope(ev, eventFilter);

  if (quickbooks) {
    // MM/DD/YYYY, which QuickBooks Online reads without a format question.
    const mdy = (day) => {
      const [y, m, d] = String(day).split('-');
      return y && m && d ? `${m}/${d}/${y}` : '';
    };
    // The Morristown day the money moved, inside the inclusive range.
    const inRange = (day) => Boolean(day) && (!from || day >= from) && (!to || day <= to);
    // Each payment or refund is a group -- its own row and, when the payer
    // covered the fee, the fee row straight after it -- sorted by day, then
    // by when it was recorded.
    const groups = [];
    for (const p of pays ?? []) {
      // Money that arrived: succeeded, or refunded since (a payment's status
      // follows the refunds on file, 0111). The refund is booked as its own
      // negative row, so leaving the payment out would book money going back
      // that never came in.
      if (p.status !== 'succeeded' && p.status !== 'refunded') continue;
      const day = dayInMorristown(p.received_on ?? p.created_at);
      if (!inRange(day)) continue;
      const r = regById.get(p.registration_id);
      const date = mdy(day);
      const name = r?.households?.display_name ?? '';
      const ev = r?.events?.name ?? 'Event';
      const cls = eventClass(r?.events);
      const memo = [ev, p.method, p.stripe_payment_intent_id, noteInDollars(p.note)].filter(Boolean).join(' — ');
      const lines = [[date, name, memo, QB_REGISTRATION_ACCOUNT, cls, ((p.amount_cents ?? 0) / 100).toFixed(2)]];
      if ((p.fee_cover_cents ?? 0) > 0) {
        lines.push([date, name, `${ev} — processing fee covered by the payer`, QB_REGISTRATION_ACCOUNT, cls, ((p.fee_cover_cents ?? 0) / 100).toFixed(2)]);
      }
      groups.push({ day, at: p.created_at ?? '', lines });
    }
    for (const f of refunds ?? []) {
      if (f.status !== 'succeeded') continue;
      const day = dayInMorristown(f.refunded_on ?? f.created_at);
      if (!inRange(day)) continue;
      const r = regById.get(f.registration_id);
      const date = mdy(day);
      const name = r?.households?.display_name ?? '';
      const ev = r?.events?.name ?? 'Event';
      const cls = eventClass(r?.events);
      const memo = ['Refund', ev, f.method, f.stripe_refund_id, f.reason, f.note].filter(Boolean).join(' — ');
      const lines = [[date, name, memo, QB_REGISTRATION_ACCOUNT, cls, (-(f.amount_cents ?? 0) / 100).toFixed(2)]];
      if ((f.fee_cover_cents ?? 0) > 0) {
        lines.push([date, name, `Refund — ${ev} — processing fee returned`, QB_REGISTRATION_ACCOUNT, cls, (-(f.fee_cover_cents ?? 0) / 100).toFixed(2)]);
      }
      groups.push({ day, at: f.created_at ?? '', lines });
    }
    groups.sort((a, b) => a.day.localeCompare(b.day) || String(a.at).localeCompare(String(b.at)));
    const qb = [['Date', 'Name', 'Memo', 'Account', 'Class', 'Amount'], ...groups.flatMap((g) => g.lines)];
    const today = todayInMorristown();
    const range = from || to ? `${from || 'start'}-to-${to || today}` : `all-time-${today}`;
    const csvQb = '\ufeff' + qb.map((row) => row.map(esc).join(',')).join('\r\n');
    return new Response(csvQb, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="luke14-event-payments-quickbooks-${range}.csv"`,
      },
    });
  }

  for (const p of pays ?? []) {
    if (allowed && !allowed.has(p.registration_id)) continue;
    const r = regById.get(p.registration_id);
    if (!inScope(r?.events)) continue;
    if (!inDateRange(dayInMorristown(p.received_on ?? p.created_at))) continue;
    rows.push([
      dayInMorristown(p.received_on ?? p.created_at),
      r?.households?.display_name ?? '',
      r?.events?.name ?? '',
      ((p.amount_cents ?? 0) / 100).toFixed(2),
      ((p.fee_cover_cents ?? 0) / 100).toFixed(2),
      p.method ?? '',
      p.status ?? '',
      p.payer_name ?? '',
      p.payer_email ?? '',
      p.stripe_payment_intent_id ?? '',
      noteInDollars(p.note) ?? '',
    ]);
  }

  // UTF-8 byte-order mark so Excel reads accents and dashes correctly.
  const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="luke14-event-payments-${
        from || to ? `${from || 'start'}-to-${to || todayInMorristown()}` : todayInMorristown()
      }.csv"`,
    },
  });
}
