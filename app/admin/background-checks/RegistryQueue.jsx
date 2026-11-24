'use client';

// The quick registry search on an adult camper's row (Lawrence, 10-11 Nov
// 2026; a queue box of its own until 15 Nov 2026, when it moved into each row
// so the Adult campers card matches the other two).
//
// It is a queue and not an automatic search ON PURPOSE. nsopw.gov's Conditions
// of Use forbid automated searching, it uses CAPTCHAs and throttles, and its FAQ
// says the browser is the only way to search -- so a person runs each search.
// What this does is everything around it: copy the name, open the site, and
// record "No match" in one click (today's date). Only a possible match asks
// for more. See DECISIONS, 10 Nov 2026.
//
// NSOPW's form has separate first-name and last-name boxes, so the last name
// (the box it asks for first) is copied and the first name has its own copy
// button. "No match" stays off until a search has been opened for that row
// (11 Nov 2026): it records that someone searched.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordRegistrySearch } from './actions';

const NSOPW = 'https://www.nsopw.gov/';

export function RegistryQuickSearch({ row, today }) {
  const router = useRouter();
  const [mode, setMode] = useState('idle'); // idle | match
  const [result, setResult] = useState('follow_up');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(''); // '' | 'last' | 'first'
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();

  async function copy(text, which) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
    } catch {
      setCopied('');
    }
  }

  async function search() {
    // The last name goes on the clipboard for NSOPW's last-name box; NSOPW's
    // own search page opens in a new tab. Nothing is sent to NSOPW from here.
    await copy(row.lastName, 'last');
    setSearched(true);
    window.open(NSOPW, '_blank', 'noopener,noreferrer');
  }

  function save(verdict, why) {
    setError('');
    start(async () => {
      const res = await recordRegistrySearch({ personId: row.id, date: today, result: verdict, note: why });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={search} className="rounded-sm border border-neutral-300 px-2 py-1 text-xs">
          {searched ? 'Search again ↗' : 'Copy last name and search ↗'}
        </button>
        <button
          type="button"
          onClick={() => copy(row.firstName, 'first')}
          className="rounded-sm border border-neutral-300 px-2 py-1 text-xs"
          title={`First name: ${row.firstName}`}
        >
          {copied === 'first' ? 'First name copied' : `Copy first name (${row.firstName})`}
        </button>
        <button
          type="button"
          disabled={pending || !searched}
          onClick={() => save('ok', '')}
          className="rounded-sm bg-green-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
          title={searched ? `Records today (${today}): searched, no match.` : 'Search nsopw.gov first.'}
        >
          {pending && mode === 'idle' ? 'Saving…' : 'No match'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setMode(mode === 'match' ? 'idle' : 'match')}
          className="rounded-sm border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900"
        >
          Possible match…
        </button>
      </div>
      {mode === 'match' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(result, note);
          }}
          className="mt-2 space-y-2 rounded-sm border border-amber-200 bg-amber-50 p-2 text-sm"
        >
          <fieldset>
            <legend className="text-xs font-semibold text-neutral-700">Record as</legend>
            <label className="mr-3 inline-flex items-center gap-1">
              <input type="radio" name={`q-${row.id}`} checked={result === 'follow_up'} onChange={() => setResult('follow_up')} />
              Possible match: needs follow-up
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="radio" name={`q-${row.id}`} checked={result === 'not_permitted'} onChange={() => setResult('not_permitted')} />
              Not permitted to attend
            </label>
          </fieldset>
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-700">
              Note (required: what was found, without copying the registry entry)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              className="w-full rounded-sm border border-neutral-300 bg-white px-2 py-1"
            />
          </label>
          <div className="flex gap-3">
            <button type="submit" disabled={pending} className="btn-primary btn-sm">
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="text-sm text-neutral-600 underline">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
