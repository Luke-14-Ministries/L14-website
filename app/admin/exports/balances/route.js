// GET /admin/exports/balances — one row per family registration: fees,
// scholarships/discounts, payments, and balance. This is the "who owes what"
// spreadsheet; the payments CSV (one row per transaction) is its companion.
// Registrar-gated; honors the same ?paystate filter as the page.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { csvCell } from '@/lib/csv';
import { todayInMorristown, inPaymentsScope } from '@/lib/events';

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

  const supabase = await createClient();
  const [{ data: balances, error: balancesError }, { data: regs, error: regsError }] = await Promise.all([
    supabase
      .from('registration_balances')
      .select('registration_id, event_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents, fees_cents'),
    supabase.from('registrations').select('id, events ( id, name, starts_on, ends_on, archived_at ), households ( display_name, email, phone )'),
  ]);
  // Never a short file in place of an error.
  const failed = balancesError ?? regsError;
  if (failed) {
    return new Response(`Could not read the balances: ${failed.message}`, { status: 500 });
  }
  const regById = new Map((regs ?? []).map((r) => [r.id, r]));

  // Same event scope as the Event Payments page: '' = current events
  // (isCurrentEventRow), 'upcoming', 'recent', 'all', or one event's id --
  // one function for both (inPaymentsScope, lib/events.js); archived events
  // are in no time scope.
  const inScope = (ev) => inPaymentsScope(ev, eventFilter);

  const matches = (b) => {
    if (!inScope(regById.get(b.registration_id)?.events)) return false;
    const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0) + (b.fees_cents ?? 0);
    const paid = b.paid_cents ?? 0;
    const bal = b.balance_cents ?? 0;
    if (paystate === 'unpaid') return paid === 0 && bal > 0;
    if (paystate === 'partial') return paid > 0 && bal > 0;
    if (paystate === 'paid') return net > 0 && bal <= 0;
    if (paystate === 'scholarship') return (b.scholarship_cents ?? 0) > 0 || (b.discount_cents ?? 0) > 0;
    return true;
  };

  const d = (c) => ((c ?? 0) / 100).toFixed(2);
  const rows = [
    ['Household', 'Email', 'Phone', 'Event', 'Fees', 'Discounts', 'Scholarships', 'Coupons', 'Added fees (returned payments etc.)', 'Net due', 'Paid', 'Balance'],
  ];
  for (const b of balances ?? []) {
    if (!matches(b)) continue;
    const r = regById.get(b.registration_id);
    const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0) + (b.fees_cents ?? 0);
    rows.push([
      r?.households?.display_name ?? '',
      r?.households?.email ?? '',
      r?.households?.phone ?? '',
      r?.events?.name ?? '',
      d(b.fee_cents),
      d(b.discount_cents),
      d(b.scholarship_cents),
      d(b.coupon_cents),
      d(b.fees_cents),
      d(net),
      d(b.paid_cents),
      d(b.balance_cents),
    ]);
  }

  // \ufeff is the UTF-8 byte-order mark so Excel reads dashes/accents correctly.
  const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="luke14-balances-${todayInMorristown()}.csv"`,
    },
  });
}
