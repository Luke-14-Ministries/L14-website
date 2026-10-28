'use client';

// The My Program table on screen: sort any column, drag a column wider, search
// by name (Lawrence, 26 Oct 2026). The rows come from programRosterRows() in
// lib/programs.js, already in name order, which stays the order until a
// heading is clicked. The CSV and the print view do not use this file: they
// always carry the whole list.

import DataTable from '@/components/DataTable';
import StatusMark from '@/components/StatusMark';

const pill = 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900';
const none = <span className="text-neutral-400">—</span>;

const askAbout = (r) => [r.allergies && 'Allergies', r.support && 'Support needs'].filter(Boolean);

const COLUMNS = [
  {
    key: 'name',
    label: 'Name',
    defaultWidth: 240,
    render: (r) => (
      <>
        <span className="font-medium">{r.name}</span>
        {r.formalName && (
          <span className="block text-xs text-neutral-500">on paperwork: {r.formalName}</span>
        )}
      </>
    ),
  },
  { key: 'age', label: 'Age', defaultWidth: 70, render: (r) => r.age ?? '—' },
  { key: 'role', label: 'Role', defaultWidth: 140, sortValue: (r) => r.roleLabel, render: (r) => r.roleLabel },
  {
    key: 'buddy',
    label: 'Buddy',
    defaultWidth: 220,
    render: (r) =>
      r.buddy ? (
        r.buddy
      ) : r.buddyRequired ? (
        // The print sheet's mark (Lawrence, 28 Oct 2026): short in a narrow column.
        <StatusMark state="warn" label="Not paired" title="Buddy needed — not paired yet" />
      ) : (
        none
      ),
  },
  {
    key: 'ask',
    label: 'Ask about',
    defaultWidth: 200,
    // As words, so ascending puts flagged people first and the unflagged
    // (blank) last.
    sortValue: (r) => askAbout(r).join(', '),
    render: (r) => {
      const words = askAbout(r);
      return words.length ? (
        <div className="flex flex-wrap gap-1">
          {words.map((w) => (
            <span key={w} className={pill}>
              {w}
            </span>
          ))}
        </div>
      ) : (
        none
      );
    },
  },
];

// Names are what a leader looks for; the buddy too ("who is with Sam?").
const FILTER_KEYS = ['name', 'formalName', 'buddy'];

export default function ProgramRosterTable({ rows }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey="id"
      filterKeys={FILTER_KEYS}
      storageKey="l14_table_widths_my_program"
      searchPlaceholder="Search names…"
      searchLabel="Search names in this program"
      emptyText="Nobody has been placed in this program yet."
    />
  );
}
