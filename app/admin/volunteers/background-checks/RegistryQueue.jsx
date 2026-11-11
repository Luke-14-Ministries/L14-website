'use client';

// Registry searches due (Lawrence, 10-11 Nov 2026): every adult who isn't a
// volunteer (camper, parent, sibling, caregiver) whose
// sex-offender registry search is missing or out of date, as a queue staff can
// work through quickly.
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

function fmtDob(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : 'Unknown';
}

function QueueRow({ row, today, onDone }) {
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
      onDone(row.id);
    });
  }

  return (
    <li className="border-b border-neutral-100 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-48 flex-1">
          <a href={`/admin/people/${row.id}/`} className="font-medium text-brand underline">
            {row.name}
          </a>
          <span className="block text-xs text-neutral-600">
            {row.roleLabel ? `${row.roleLabel} · ` : ''}Born {fmtDob(row.dob)}
            {row.place ? ` · ${row.place}` : ''} · {row.events.join(' · ')}
            {row.reason ? ` · ${row.reason}` : ''}
          </span>
        </div>
        <button type="button" onClick={search} className="rounded-sm border border-neutral-300 px-2 py-1 text-sm">
          {searched ? 'Search again ↗' : 'Copy last name and search ↗'}
        </button>
        <button
          type="button"
          onClick={() => copy(row.firstName, 'first')}
          className="rounded-sm border border-neutral-300 px-2 py-1 text-sm"
          title={`First name: ${row.firstName}`}
        >
          {copied === 'first' ? 'First name copied' : `Copy first name (${row.firstName})`}
        </button>
        <button
          type="button"
          disabled={pending || !searched}
          onClick={() => save('ok', '')}
          className="rounded-sm bg-green-700 px-2 py-1 text-sm font-semibold text-white disabled:opacity-50"
          title={searched ? `Records today (${today}): searched, no match.` : 'Search nsopw.gov first.'}
        >
          {pending && mode === 'idle' ? 'Saving…' : 'No match'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setMode(mode === 'match' ? 'idle' : 'match')}
          className="rounded-sm border border-amber-400 bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-900"
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
            <button type="submit" disabled={pending} className="btn-primary py-1! text-sm">
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setMode('idle')} className="text-sm text-neutral-600 underline">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </li>
  );
}

export default function RegistryQueue({ rows, today }) {
  const router = useRouter();
  const [done, setDone] = useState(() => new Set());
  const left = rows.filter((r) => !done.has(r.id));

  function onDone(id) {
    setDone((d) => new Set(d).add(id));
    router.refresh();
  }

  return (
    // Same box as the volunteer part's "How to run a check" (HOW_TO_BOX on
    // the page; Lawrence, 11 Nov 2026).
    <div className="rounded-lg border border-neutral-300 bg-white p-4">
      <h3 className="font-bold">Registry searches due ({left.length})</h3>
      <p className="mt-1 text-sm text-neutral-600">
        Adults who aren&rsquo;t volunteers and have no current search. For each one:{' '}
        <strong>Copy last name and search</strong> opens nsopw.gov with the last name on your
        clipboard, and <strong>Copy first name</strong> copies the first. Check the date of birth and
        place against any result, then press <strong>No match</strong> (recorded with today&rsquo;s
        date) or <strong>Possible match</strong>. NSOPW doesn&rsquo;t allow automated searching, so a
        person runs each search.
        {done.size > 0 && ` ${done.size} recorded this visit.`}
      </p>
      {left.length === 0 ? (
        <p className="mt-3 text-sm text-green-800">Nothing due. Every adult who isn&rsquo;t a volunteer has a current search.</p>
      ) : (
        <ul className="mt-2">
          {left.map((r) => (
            <QueueRow key={r.id} row={r} today={today} onDone={onDone} />
          ))}
        </ul>
      )}
    </div>
  );
}
