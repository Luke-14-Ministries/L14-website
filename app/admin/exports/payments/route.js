// GET /admin/exports/payments — every event payment as a CSV download.
// Registrar-gated; RLS is the backstop.
//
// ?format=quickbooks (build plan item 14; the call of 16 Oct 2026, 3:30 pm):
// the same payments in the column order QuickBooks Online takes -- Date,
// Name, Memo, Account, Amount -- one row per payment that actually moved
// money (succeeded), a second row for a processing fee the payer covered
// (booked with its transaction, as agreed), and negative rows for refunds.
// Gross per payment, as the treasurer books it; Stripe's own fee is not in
// this system and comes from Stripe's payout report. The account names are
// placeholders until the treasurer confirms the chart of accounts -- they are
// the one thing here that is a guess, and QuickBooks maps them on import.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { csvCell } from '@/lib/csv';
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

  const supabase = await createClient();
  const [{ data: pays }, { data: regs }, { data: balances }, { data: refunds }] = await Promise.all([
    supabase
      .from('payments')
      .select('registration_id, amount_cents, fee_cover_cents, method, status, received_on, created_at, note, payer_email, payer_name, stripe_payment_intent_id')
      .order('created_at'),
    supabase.from('registrations').select('id, events ( id, name, starts_on, ends_on, archived_at ), households ( display_name )'),
    supabase
      .from('registration_balances')
      .select('registration_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents'),
    // Refunds, for the QuickBooks shape: money that went back out.
    supabase
      .from('payment_refunds')
      .select('registration_id, amount_cents, fee_cover_cents, status, method, reason, note, refunded_on, created_at, stripe_refund_id')
      .order('created_at'),
  ]);
  const regById = new Map((regs ?? []).map((r) => [r.id, r]));

  // Same payment-state filter as the Event Payments page: the CSV matches
  // whatever pill was active when Download was clicked.
  let allowed = null;
  if (paystate) {
    allowed = new Set(
      (balances ?? [])
        .filter((b) => {
          const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
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
  // Same event scope as the Event Payments page: '' = upcoming + recent
  // (90 days each way), 'upcoming', 'recent', 'all', or one event's id --
  // one function for both (lib/events.js); archived events are in no time
  // scope.
  const inScope = (ev) => inPaymentsScope(ev, eventFilter);

  if (quickbooks) {
    // MM/DD/YYYY, which QuickBooks Online reads without a format question.
    const mdy = (iso) => {
      const [y, m, d] = dayInMorristown(iso).split('-');
      return y && m && d ? `${m}/${d}/${y}` : '';
    };
    const qb = [['Date', 'Name', 'Memo', 'Account', 'Amount']];
    for (const p of pays ?? []) {
      if (p.status !== 'succeeded') continue;
      if (allowed && !allowed.has(p.registration_id)) continue;
      const r = regById.get(p.registration_id);
      if (!inScope(r?.events)) continue;
      const date = mdy(p.received_on ?? p.created_at);
      const name = r?.households?.display_name ?? '';
      const ev = r?.events?.name ?? 'Event';
      const memo = [ev, p.method, p.stripe_payment_intent_id, noteInDollars(p.note)].filter(Boolean).join(' — ');
      qb.push([date, name, memo, 'Camp registration fees', ((p.amount_cents ?? 0) / 100).toFixed(2)]);
      if ((p.fee_cover_cents ?? 0) > 0) {
        qb.push([date, name, `${ev} — processing fee covered by the payer`, 'Processing fees covered', ((p.fee_cover_cents ?? 0) / 100).toFixed(2)]);
      }
    }
    for (const f of refunds ?? []) {
      if (f.status !== 'succeeded') continue;
      if (allowed && !allowed.has(f.registration_id)) continue;
      const r = regById.get(f.registration_id);
      if (!inScope(r?.events)) continue;
      const date = mdy(f.refunded_on ?? f.created_at);
      const name = r?.households?.display_name ?? '';
      const ev = r?.events?.name ?? 'Event';
      const memo = ['Refund', ev, f.method, f.stripe_refund_id, f.reason, f.note].filter(Boolean).join(' — ');
      qb.push([date, name, memo, 'Camp registration fees', (-(f.amount_cents ?? 0) / 100).toFixed(2)]);
      if ((f.fee_cover_cents ?? 0) > 0) {
        qb.push([date, name, `Refund — ${ev} — processing fee returned`, 'Processing fees covered', (-(f.fee_cover_cents ?? 0) / 100).toFixed(2)]);
      }
    }
    const csvQb = '\ufeff' + qb.map((row) => row.map(esc).join(',')).join('\r\n');
    return new Response(csvQb, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="luke14-event-payments-quickbooks-${todayInMorristown()}.csv"`,
      },
    });
  }

  for (const p of pays ?? []) {
    if (allowed && !allowed.has(p.registration_id)) continue;
    const r = regById.get(p.registration_id);
    if (!inScope(r?.events)) continue;
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
      'Content-Disposition': `attachment; filename="luke14-event-payments-${todayInMorristown()}.csv"`,
    },
  });
}
