// One donor's giving statement, as printed: letterhead, the tax year large at
// the top, the gifts, the total and the 501(c)(3) acknowledgment. Staff print
// it for every donor at /admin/giving/statements; a donor prints their own at
// /account/giving-statement (27 Oct 2026). One sheet, so the two can never
// say different things. No hooks: it renders on the server.

import { dollars } from '@/lib/payments';

const METHOD_LABEL = {
  card: 'Card',
  bank_transfer: 'Bank transfer',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
};

const longDay = (d) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

// The tax year, printed large (Lawrence, 26 Oct 2026): "2026 Tax Year" when
// the range is one whole calendar year; otherwise the year (or years) with
// the exact dates beneath, so a partial statement never passes for a
// year-end one. `from` and `to` are YYYY-MM-DD.
export function statementTitle(from, to) {
  const fromYear = from.slice(0, 4);
  const toYear = to.slice(0, 4);
  const wholeYear = fromYear === toYear && from.slice(5) === '01-01' && to.slice(5) === '12-31';
  return {
    yearTitle: wholeYear ? `${fromYear} Tax Year` : fromYear === toYear ? fromYear : `${fromYear}–${toYear}`,
    rangeLine: `${longDay(from)} – ${longDay(to)}`,
  };
}

// `gifts` carry { date (YYYY-MM-DD, ministry time), fund, method, amount_cents }.
export default function GivingStatementSheet({ yearTitle, rangeLine, name, email, gifts, total }) {
  return (
    <div className="print-sheet mb-10 break-after-page">
      {/* Letterhead */}
      <div className="border-b-2 border-neutral-800 pb-3 mb-5 flex flex-wrap items-end justify-between gap-3">
        <img
          src="/images/Luke_14_Ministries_Logo__285_x_2_in_29.png"
          alt="Luke 14 Ministries"
          className="h-16 w-auto"
        />
        <p className="text-sm text-neutral-600 text-right">
          2348 W Andrew Johnson Hwy, #140 · Morristown, TN 37814
          <br />
          giving@luke14ministries.net
        </p>
      </div>

      {/* The tax year, large, before anything else on the page. */}
      <div className="mb-5 text-center">
        <p className="text-3xl font-bold tracking-tight print:text-[26px]">{yearTitle}</p>
        <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-neutral-600 print:text-[12px]">
          Giving statement
        </p>
        <p className="text-sm text-neutral-600 print:text-[12px]">Gifts received {rangeLine}</p>
      </div>

      <div className="mb-4 text-sm">
        <p className="font-bold">{name}</p>
        {email && <p className="text-neutral-600">{email}</p>}
      </div>

      <table className="w-full text-sm border-collapse mb-3">
        <thead>
          <tr className="text-left border-b border-neutral-400">
            <th className="py-1 pr-3">Date</th>
            <th className="py-1 pr-3">Designated to</th>
            <th className="py-1 pr-3">Method</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {gifts.map((g, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-1 pr-3">{g.date}</td>
              <td className="py-1 pr-3">{g.fund}</td>
              <td className="py-1 pr-3">{METHOD_LABEL[g.method] ?? g.method}</td>
              <td className="py-1 text-right">{dollars(g.amount_cents)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="py-2 font-bold">
              Total
            </td>
            <td className="py-2 text-right font-bold">{dollars(total)}</td>
          </tr>
        </tbody>
      </table>

      <p className="text-sm text-neutral-700 mb-2">
        Thank you for your generosity. Your support helps families affected by disability find
        community and connection.
      </p>
      <p className="text-xs text-neutral-500">
        Luke 14 Ministries is a registered 501(c)(3) tax-exempt organization (EIN 82-2389397). No
        goods or services were provided in exchange for these contributions. Please retain this
        statement for your tax records.
      </p>
    </div>
  );
}
