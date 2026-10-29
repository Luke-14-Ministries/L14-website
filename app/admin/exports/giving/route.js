// GET /admin/exports/giving — every gift as a CSV download.
// Gated by the giving permission (not just registrar); RLS is the backstop.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { csvCell } from '@/lib/csv';
import { QB_GIFT_ACCOUNT, QB_HEADER, giftProduct, receiptRows } from '@/lib/quickbooks';
import { dayInMorristown, todayInMorristown } from '@/lib/events';

// Quoting and spreadsheet-formula safety: lib/csv.js.
const esc = csvCell;

export async function GET(request) {
  const staff = await getStaff();
  if (!can(staff, 'giving')) {
    return new Response('Not permitted', { status: 403 });
  }

  // Same filters as the Giving page: the CSV matches the filtered screen.
  const url = new URL(request.url);
  const fFrom = url.searchParams.get('from') || '';
  const fTo = url.searchParams.get('to') || '';
  const fFund = url.searchParams.get('fund') || '';
  const fMethod = url.searchParams.get('method') || '';
  // Build plan item 14, reshaped 29 Oct 2026 to QuickBooks' Sales Receipt
  // (lib/quickbooks.js): gifts that actually arrived (succeeded) only, the
  // fund as Product/Service and Class, 40000 Individual Contributions.
  const quickbooks = url.searchParams.get('format') === 'quickbooks';

  const supabase = await createClient();
  const { data: gifts, error } = await supabase
    .from('gifts')
    .select('donor_name, email, amount_cents, fund, method, status, received_on, created_at, note')
    .order('created_at');
  // CLAUDE.md: never turn a query error into an empty list -- an empty file
  // would read as "no gifts" to the treasurer.
  if (error) return new Response(`Could not load gifts: ${error.message}`, { status: 500 });

  const giftDate = (g) => dayInMorristown(g.received_on ?? g.created_at);
  const filtered = (gifts ?? []).filter(
    (g) =>
      (!fFrom || giftDate(g) >= fFrom) &&
      (!fTo || giftDate(g) <= fTo) &&
      (!fFund || g.fund === fFund) &&
      (!fMethod || g.method === fMethod)
  );

  if (quickbooks) {
    // One Sales Receipt per gift that arrived, in QuickBooks' own field
    // order (lib/quickbooks.js); the fund is the Product/Service and Class.
    const qb = [QB_HEADER];
    let n = 0;
    for (const g of filtered) {
      if (g.status !== 'succeeded') continue;
      n += 1;
      qb.push(
        ...receiptRows({
          receipt: String(n),
          day: giftDate(g),
          donor: g.donor_name,
          email: g.email,
          method: g.method,
          product: giftProduct(g.fund),
          account: QB_GIFT_ACCOUNT,
          lines: [{ description: ['Donation', g.note].filter(Boolean).join(' — '), cents: g.amount_cents }],
        })
      );
    }
    const csvQb = '\ufeff' + qb.map((r) => r.map(esc).join(',')).join('\r\n');
    return new Response(csvQb, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="luke14-giving-quickbooks-${todayInMorristown()}.csv"`,
      },
    });
  }

  const rows = [['Date', 'Donor', 'Email', 'Amount', 'Fund', 'Method', 'Status', 'Note']];
  for (const g of filtered) {
    rows.push([
      giftDate(g),
      g.donor_name ?? '',
      g.email ?? '',
      ((g.amount_cents ?? 0) / 100).toFixed(2),
      g.fund ?? '',
      g.method ?? '',
      g.status ?? '',
      g.note ?? '',
    ]);
  }

  // UTF-8 byte-order mark so Excel reads accents and dashes correctly.
  const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="luke14-giving-${todayInMorristown()}.csv"`,
    },
  });
}
