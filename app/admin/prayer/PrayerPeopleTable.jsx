'use client';

// "Who is on it" on the Prayer List page (Lawrence, 28 Oct 2026): folded
// shut by default, sortable and searchable through the shared DataTable, and
// showing only the people the list still covers -- those on it and those who
// have not confirmed yet. An unsubscribed row is kept in the database on
// purpose (it is the record that they asked never to be emailed again), so
// it stays one tick away rather than gone.

import { useState } from 'react';
import DataTable from '@/components/DataTable';
import RemoveButton from './RemoveButton';

export default function PrayerPeopleTable({ people, canWrite }) {
  const [showLeft, setShowLeft] = useState(false);
  const leftCount = people.filter((p) => p.unsubscribed).length;
  const current = people.length - leftCount;
  const rows = showLeft ? people : people.filter((p) => !p.unsubscribed);

  const columns = [
    { key: 'name', label: 'Name', defaultWidth: 200, render: (p) => p.name || '—' },
    { key: 'email', label: 'Email', defaultWidth: 260 },
    { key: 'signedUp', label: 'Signed up', defaultWidth: 120, sortValue: (p) => p.signedUpAt },
    { key: 'status', label: 'Status', defaultWidth: 220, sortValue: (p) => p.statusOrder },
  ];
  if (canWrite) {
    columns.push({
      key: 'actions',
      label: '',
      sortable: false,
      align: 'right',
      defaultWidth: 140,
      render: (p) => (p.unsubscribed ? null : <RemoveButton id={p.id} email={p.email} />),
    });
  }

  return (
    <details className="rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
      <summary className="fold-summary cursor-pointer font-bold">
        Who is on it <span className="font-normal text-neutral-500">({current})</span>
      </summary>
      <div className="mt-4">
        {leftCount > 0 && (
          <label className="mb-3 flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
            Show the {leftCount} who unsubscribed or were taken off
          </label>
        )}
        <DataTable
          columns={columns}
          rows={rows}
          filterKeys={['name', 'email']}
          storageKey="l14-prayer-people-widths"
          emptyText={people.length ? 'Nobody is on the list at the moment.' : 'Nobody has signed up yet.'}
          searchPlaceholder="Search names or emails…"
        />
      </div>
    </details>
  );
}
