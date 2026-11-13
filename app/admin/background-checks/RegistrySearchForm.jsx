'use client';

// Recording a sex-offender registry search for an adult who isn't a volunteer
// (0161/0162, Lawrence 10-11 Nov 2026). Shown on their row on Background
// Checks. The search itself happens at nsopw.gov, by hand; this records only
// the date and what it found.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordRegistrySearch } from './actions';

const RESULTS = [
  { value: 'ok', label: 'No match' },
  { value: 'follow_up', label: 'Possible match: needs follow-up' },
  { value: 'not_permitted', label: 'Not permitted to attend' },
];

export default function RegistrySearchForm({ personId, name, today, initial }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [result, setResult] = useState('ok');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function openForm() {
    // A new search is a new date; the last result and note are a starting point.
    setDate(today);
    setResult(initial?.verdict || 'ok');
    setNote(initial?.note || '');
    setError('');
    setOpen(true);
  }

  function save(e) {
    e.preventDefault();
    setError('');
    start(async () => {
      const res = await recordRegistrySearch({ personId, date, result, note });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={openForm} className="mt-1 block text-xs font-semibold text-brand underline">
        {initial ? 'Record a new registry search' : 'Record registry search'}
      </button>
    );
  }

  return (
    <form onSubmit={save} className="mt-2 space-y-2 rounded-sm border border-neutral-200 bg-neutral-50 p-2 text-sm">
      <p className="text-xs text-neutral-600">
        Search{' '}
        <a href="https://www.nsopw.gov/" target="_blank" rel="noopener noreferrer" className="underline">
          nsopw.gov
        </a>{' '}
        for {name}, then record what you found. Nothing from the search itself is kept here.
      </p>
      <label className="block">
        <span className="block text-xs font-semibold text-neutral-600">Date searched</span>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-sm border border-neutral-300 px-2 py-1"
          required
        />
      </label>
      <fieldset>
        <legend className="text-xs font-semibold text-neutral-600">What it found</legend>
        {RESULTS.map((r) => (
          <label key={r.value} className="mr-3 inline-flex items-center gap-1">
            <input type="radio" name={`result-${personId}`} value={r.value} checked={result === r.value} onChange={() => setResult(r.value)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="block text-xs font-semibold text-neutral-600">
          Note {result === 'ok' ? '(optional)' : '(required: what was found, without copying the registry entry)'}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="w-full rounded-sm border border-neutral-300 px-2 py-1"
        />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="btn-primary py-1! text-sm">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-neutral-600 underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
