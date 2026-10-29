'use client';

// The Giving page's export toolbar, the same shape as Event Payments'
// (ExportBar.jsx; Lawrence, 26 Oct 2026): choose the REPORT, then the
// FORMAT. Both reports follow the filter form below (dates; the gift list
// also fund and method):
//   Gifts received, CSV        every gift in the filter, one row each
//   Gifts received, QuickBooks Date, Name, Memo, Account, Class, Amount --
//                              gifts that arrived; 40000, the fund as the class
//   Donor statements, PDF      the print view, one letter per donor, for the
//                              filter's dates (this year when none are set);
//                              print it, or save it as a PDF from the print
//                              dialog
// A plain link does the work, so CSVs download as before.

import { useState } from 'react';

const selectCls = 'rounded-sm border border-neutral-300 px-2 py-1.5';

export default function GivingExportBar({ from = '', to = '', fund = '', method = '' }) {
  const [report, setReport] = useState('gifts');
  const [format, setFormat] = useState('csv');

  const statements = report === 'statements';
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (!statements) {
    if (fund) p.set('fund', fund);
    if (method) p.set('method', method);
    if (format === 'quickbooks') p.set('format', 'quickbooks');
  }
  const q = p.toString();
  const href = statements
    ? `/admin/giving/statements/${q ? `?${q}` : ''}`
    : `/admin/exports/giving/${q ? `?${q}` : ''}`;

  return (
    <div className="mb-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-neutral-700">Export</span>
        <label htmlFor="giving-report" className="sr-only">Report</label>
        <select
          id="giving-report"
          value={report}
          onChange={(e) => setReport(e.target.value)}
          className={selectCls}
        >
          <option value="gifts">Gifts received</option>
          <option value="statements">Donor statements</option>
        </select>
        <label htmlFor="giving-format" className="text-neutral-600">as</label>
        <select
          id="giving-format"
          value={statements ? 'pdf' : format}
          onChange={(e) => setFormat(e.target.value)}
          className={selectCls}
        >
          <option value="csv" disabled={statements}>CSV (spreadsheet)</option>
          <option value="quickbooks" disabled={statements}>QuickBooks CSV</option>
          <option value="pdf" disabled={!statements}>PDF / print — statements only</option>
        </select>
        <a href={href} className="btn-outline py-1.5! text-sm">
          {statements ? 'Open print view' : 'Download'}
        </a>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {statements
          ? 'One letter per donor for the dates in the filter below (this year when none are set). Print it, or choose “Save as PDF” in the print dialog.'
          : format === 'quickbooks'
            ? 'Gifts that arrived, in the filter below — Date, Name, Memo, Account (40000 Individual Contributions), Class (the fund; none for General), Amount.'
            : 'Every gift in the filter below, one row each.'}
      </p>
    </div>
  );
}
