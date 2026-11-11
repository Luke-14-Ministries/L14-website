'use client';

// Registry searches due (Lawrence, 10 Nov 2026): every adult camper whose
// sex-offender registry search is missing or out of date, as a queue staff can
// work through quickly.
//
// It is a queue and not an automatic search ON PURPOSE. nsopw.gov's Conditions
// of Use forbid automated searching, it uses CAPTCHAs and throttles, and its FAQ
// says the browser is the only way to search -- so a person runs each search.
// What this does is everything around it: copy the name, open the site, and
// record "No match" in one click (today's date). Only a possible match asks
// for more. See DECISIONS, 10 Nov 2026.

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
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  async function search() {
    // The name goes on the clipboard so it can be pasted into NSOPW's form;
    // NSOPW's own search page opens in a new tab. Nothing is sent to NSOPW
    // from here.
    try {
      await navigator.clipboard.writeText(row.searchName);
      setCopied(true);
    } catch {
      setCopied(false);
    }
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
            Born {fmtDob(row.dob)}
            {row.place ? ` · ${row.place}` : ''} · {row.events.join(' · ')}
            {row.reason ? ` · ${row.reason}` : ''}
          </span>
        </div>
        <button type="button" onClick={search} className="rounded-sm border border-neutral-300 px-2 py-1 text-sm">
          {copied ? 'Name copied — search again ↗' : 'Copy name and search ↗'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => save('ok', '')}
          className="rounded-sm bg-green-700 px-2 py-1 text-sm font-semibold text-white disabled:opacity-60"
          title={`Records today (${today}): searched, no match.`}
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
              Possible match — needs follow-up
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="radio" name={`q-${row.id}`} checked={result === 'not_permitted'} onChange={() => setResult('not_permitted')} />
              Not permitted to attend
            </label>
          </fieldset>
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-700">
              Note (required — what was found, without copying the registry entry)
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
    <div className="rounded-lg border border-amber-300 bg-white p-4">
      <h2 className="font-bold">Registry searches due ({left.length})</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Campers 18 or older with no current search. For each one: <strong>Copy name and search</strong>{' '}
        opens nsopw.gov with the name on your clipboard; check the date of birth and place against
        any result, then press <strong>No match</strong> (recorded with today&rsquo;s date) or{' '}
        <strong>Possible match</strong>. NSOPW does not allow automated searching, so each search is
        run by a person.
        {done.size > 0 && ` ${done.size} recorded this visit.`}
      </p>
      {left.length === 0 ? (
        <p className="mt-3 text-sm text-green-800">Nothing due — every adult camper has a current search.</p>
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
