import { redirect } from 'next/navigation';
import BackLink from '@/components/BackLink';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from './PrintButton';
import { dayInMorristown } from '@/lib/events';
import GivingStatementSheet, { statementTitle } from '@/components/GivingStatementSheet';

export const metadata = { title: 'Giving Statements — Staff Admin' };

// Year-end donor statements: one per donor, each on its own printed page, with
// the 501(c)(3) acknowledgment language. Print the whole run in January, or
// narrow to one donor with ?donor=. Date range defaults to the current
// calendar year; ?from/?to override (the Giving page passes its filters
// through). Only settled ("succeeded") gifts appear — a statement is a tax
// document, so clearing money stays off it.
export default async function GivingStatementsPage({ searchParams }) {
  const params = await searchParams;

  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/giving/statements/');
  if (!can(staff, 'giving')) redirect('/admin');

  const year = new Date().getFullYear();
  const from = typeof params?.from === 'string' && params.from ? params.from : `${year}-01-01`;
  const to = typeof params?.to === 'string' && params.to ? params.to : `${year}-12-31`;
  const donorFilter = typeof params?.donor === 'string' ? params.donor.toLowerCase() : '';

  // The tax year, large at the top of every statement (statementTitle).
  const { yearTitle, rangeLine } = statementTitle(from, to);

  const supabase = await createClient();
  const { data: gifts, error: giftsError } = await supabase
    .from('gifts')
    .select('donor_name, email, amount_cents, fund, method, received_on, created_at')
    .eq('status', 'succeeded')
    .order('received_on');
  // CLAUDE.md: never turn a query error into an empty list -- here it would
  // read "No settled gifts in this date range".
  if (giftsError) throw new Error(`Gifts: ${giftsError.message}`);

  const giftDate = (g) => dayInMorristown(g.received_on ?? g.created_at);
  const inRange = (gifts ?? []).filter((g) => giftDate(g) >= from && giftDate(g) <= to);

  // Group by donor: email is the identity when present, else the name.
  const donors = new Map();
  for (const g of inRange) {
    const key = (g.email ?? g.donor_name ?? 'Unknown donor').toLowerCase();
    if (donorFilter && !key.includes(donorFilter)) continue;
    if (!donors.has(key)) {
      donors.set(key, {
        name: g.donor_name || g.email || 'Unknown donor',
        email: g.email ?? '',
        gifts: [],
        total: 0,
      });
    }
    const d = donors.get(key);
    d.gifts.push(g);
    d.total += g.amount_cents ?? 0;
    if (g.donor_name) d.name = g.donor_name;
  }
  const donorList = [...donors.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0 bg-white text-neutral-900 print:text-[12px]">
      <div className="mb-6 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h1 className="text-xl font-bold">Giving statements — print view</h1>
          <span className="flex flex-wrap items-center gap-3">
          <PrintButton />
          <BackLink href="/admin/giving/" label="Back to Giving" />
        </span>
        </div>
        <form method="get" className="mb-2 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <label className="block">
            <span className="block font-semibold mb-1">From</span>
            <input type="date" name="from" defaultValue={from} className="rounded-sm border border-neutral-300 px-2 py-1.5" />
          </label>
          <label className="block">
            <span className="block font-semibold mb-1">To</span>
            <input type="date" name="to" defaultValue={to} className="rounded-sm border border-neutral-300 px-2 py-1.5" />
          </label>
          <label className="block flex-1 min-w-48">
            <span className="block font-semibold mb-1">One donor (name or email, optional)</span>
            <input name="donor" defaultValue={donorFilter} placeholder="leave blank for all donors" className="w-full rounded-sm border border-neutral-300 px-2 py-1.5" />
          </label>
          <button type="submit" className="btn-primary py-1.5!">Apply</button>
        </form>
        <p className="text-sm text-neutral-500">
          {donorList.length} {donorList.length === 1 ? 'donor' : 'donors'} · {from} to {to} · each
          statement prints on its own page · settled gifts only.
        </p>
      </div>

      {donorList.length === 0 && (
        <p className="text-neutral-500">No settled gifts in this date range.</p>
      )}

      {donorList.map((d, di) => (
        <GivingStatementSheet
          key={di}
          yearTitle={yearTitle}
          rangeLine={rangeLine}
          name={d.name}
          email={d.email}
          gifts={d.gifts.map((g) => ({ ...g, date: giftDate(g) }))}
          total={d.total}
        />
      ))}
    </div>
  );
}
