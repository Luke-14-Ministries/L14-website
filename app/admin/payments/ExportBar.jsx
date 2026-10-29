'use client';

// The Event Payments export toolbar (Lawrence, 26 Oct 2026): choose the
// REPORT, then the FORMAT, then the dates -- two separate questions, not one
// list mixing them. What each combination means:
//   Payments received, CSV        the events shown below (Showing and the
//                                 payment-state pill), between the dates
//   Payments received, QuickBooks EVERY event, between the dates -- the
//                                 treasurer books a month of money, not one
//                                 event's families (route.js says why)
//   Balances by family, CSV       the events shown below, as of today; a
//                                 balance has no date range, so the dates
//                                 and the QuickBooks format do not apply
// Blank dates mean no limit. The Download link is a plain link to the export
// route, so the browser downloads the file as before.

import { useState } from 'react';

const selectCls = 'rounded-sm border border-neutral-300 px-2 py-1.5';

export default function ExportBar({ eventFilter = '', paystate = '', defaultFrom = '', defaultTo = '' }) {
  const [report, setReport] = useState('payments');
  const [format, setFormat] = useState('csv');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const balances = report === 'balances';
  const quickbooks = !balances && format === 'quickbooks';

  const p = new URLSearchParams();
  if (!quickbooks) {
    if (eventFilter) p.set('event', eventFilter);
    if (paystate) p.set('paystate', paystate);
  }
  if (quickbooks) p.set('format', 'quickbooks');
  if (!balances) {
    if (from) p.set('from', from);
    if (to) p.set('to', to);
  }
  const q = p.toString();
  const href = `/admin/exports/${balances ? 'balances' : 'payments'}/${q ? `?${q}` : ''}`;

  const scope = balances
    ? 'Events shown below, as of today.'
    : quickbooks
      ? 'Every event, received between the dates — Date, Name, Memo, Account (44000), Class (the event), Amount; covered fees as their own line, refunds negative.'
      : 'Events shown below, received between the dates.';

  return (
    <div className="mb-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-neutral-700">Export</span>
        <label htmlFor="export-report" className="sr-only">Report</label>
        <select
          id="export-report"
          value={report}
          onChange={(e) => setReport(e.target.value)}
          className={selectCls}
        >
          <option value="payments">Payments received</option>
          <option value="balances">Balances by family</option>
        </select>
        <label htmlFor="export-format" className="text-neutral-600">as</label>
        <select
          id="export-format"
          value={balances ? 'csv' : format}
          onChange={(e) => setFormat(e.target.value)}
          className={selectCls}
        >
          <option value="csv">CSV (spreadsheet)</option>
          <option value="quickbooks" disabled={balances}>
            QuickBooks CSV{balances ? ' — payments only' : ''}
          </option>
        </select>
        <label htmlFor="export-from" className={balances ? 'text-neutral-400' : 'text-neutral-600'}>
          from
        </label>
        <input
          id="export-from"
          type="date"
          value={from}
          disabled={balances}
          onChange={(e) => setFrom(e.target.value)}
          className={`${selectCls} disabled:bg-neutral-100 disabled:text-neutral-400`}
        />
        <label htmlFor="export-to" className={balances ? 'text-neutral-400' : 'text-neutral-600'}>
          to
        </label>
        <input
          id="export-to"
          type="date"
          value={to}
          disabled={balances}
          onChange={(e) => setTo(e.target.value)}
          className={`${selectCls} disabled:bg-neutral-100 disabled:text-neutral-400`}
        />
        <a href={href} className="btn-outline py-1.5! text-sm">
          Download
        </a>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {scope}
        {!balances && ' Clear both dates for every date.'}
      </p>
    </div>
  );
}
