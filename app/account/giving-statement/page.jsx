import { redirect } from 'next/navigation';
import Link from 'next/link';
import BackLink from '@/components/BackLink';
import PrintButton from '@/components/PrintButton';
import GivingStatementSheet, { statementTitle } from '@/components/GivingStatementSheet';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { dayInMorristown } from '@/lib/events';

export const metadata = { title: 'My Giving Statement — Luke 14 Ministries' };

// A donor's own giving statement, one calendar year at a time (Lawrence,
// 27 Oct 2026: the dashboard's "Download Giving Statement" was a coming-soon
// button). The same sheet staff print at /admin/giving/statements, so the
// two cannot disagree; printing it, or saving it as a PDF from the print
// dialog, is the download.
//
// Scoped to this login's gifts EXPLICITLY (profile_id), never by RLS alone:
// a staff member with the Giving grant reads every gift, and their own
// statement must still be only theirs. Settled ("succeeded") gifts only -- a
// statement is a tax document, so clearing money stays off it. A gift staff
// recorded by hand (a check) with no login attached is not here; staff print
// that donor's statement.
export default async function MyGivingStatementPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect('/account/?next=/account/giving-statement/');

  const supabase = await createClient();
  const { data: gifts, error: giftsError } = await supabase
    .from('gifts')
    .select('donor_name, email, amount_cents, fund, method, received_on, created_at')
    .eq('profile_id', user.id)
    .eq('status', 'succeeded')
    .order('received_on');
  // CLAUDE.md: never turn a query error into an empty list -- here it would
  // read "No gifts received".
  if (giftsError) throw new Error(`Your gifts: ${giftsError.message}`);

  const dated = (gifts ?? []).map((g) => ({ ...g, date: dayInMorristown(g.received_on ?? g.created_at) }));
  // The years this donor gave in, newest first; the newest is the default.
  const years = [...new Set(dated.map((g) => g.date.slice(0, 4)))].sort().reverse();
  const asked = (await searchParams)?.year;
  const year = typeof asked === 'string' && /^\d{4}$/.test(asked) ? asked : years[0] ?? String(new Date().getFullYear());

  const inYear = dated.filter((g) => g.date.startsWith(year));
  const total = inYear.reduce((sum, g) => sum + (g.amount_cents ?? 0), 0);
  const { yearTitle, rangeLine } = statementTitle(`${year}-01-01`, `${year}-12-31`);
  // The name the donor gave with their latest gift that year.
  const name = [...inYear].reverse().find((g) => g.donor_name)?.donor_name || user.email;

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0 bg-white text-neutral-900 print:text-[12px]">
      <div className="mb-6 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
          <h1 className="text-3xl font-bold">My giving statement</h1>
          {/* The way back on the title's line, Print under it (27 Oct 2026). */}
          <span className="flex flex-col items-end gap-2">
            <BackLink />
            {inYear.length > 0 && <PrintButton label="Print or save as PDF" />}
          </span>
        </div>
        {years.length > 1 && (
          <p className="text-sm text-neutral-600">
            Year:{' '}
            {years.map((y, i) => (
              <span key={y}>
                {i > 0 && ' · '}
                {y === year ? (
                  <strong>{y}</strong>
                ) : (
                  <Link href={`/account/giving-statement/?year=${y}`} className="text-brand underline">
                    {y}
                  </Link>
                )}
              </span>
            ))}
          </p>
        )}
      </div>

      {inYear.length === 0 ? (
        <p className="text-neutral-600">
          No gifts received in {year} are on record for this account. Gifts given online while
          logged in appear here once they have settled. For a gift by check, or one given without
          logging in, write to{' '}
          <a href="mailto:giving@luke14ministries.net" className="text-brand underline">
            giving@luke14ministries.net
          </a>{' '}
          and staff will send your statement.
        </p>
      ) : (
        <GivingStatementSheet
          yearTitle={yearTitle}
          rangeLine={rangeLine}
          name={name}
          email={user.email}
          gifts={inYear}
          total={total}
        />
      )}
    </div>
  );
}
