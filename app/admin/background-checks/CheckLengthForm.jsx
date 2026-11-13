'use client';

// How long a background check lasts, and changing it (0158). A change moves
// every expiry date already on file (Lawrence, 9 Nov 2026: "recalculate
// existing expiry dates"), so the page asks first and says how many.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCheckLength } from './actions';

export default function CheckLengthForm({ months, onFile, canEdit }) {
  const router = useRouter();
  const [value, setValue] = useState(String(months));
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  function save(e) {
    e.preventDefault();
    setError('');
    setDone('');
    const n = Number(value);
    if (n === months) {
      setEditing(false);
      return;
    }
    if (
      !confirm(
        `Change how long a background check lasts from ${months} to ${n} months?\n\n` +
          `The expiry date of every check on file (${onFile}) is worked out again from its check date. ` +
          'Each change is kept in that person’s history.'
      )
    )
      return;
    start(async () => {
      const res = await setCheckLength(n);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(
        `Saved. ${res.recalculated} ${res.recalculated === 1 ? 'expiry date was' : 'expiry dates were'} worked out again.`
      );
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-4">
      <h3 className="font-bold">How long a check lasts</h3>
      {editing ? (
        <form onSubmit={save} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-semibold text-neutral-600">Months</span>
            <input
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-20 rounded-sm border border-neutral-300 px-2 py-1"
            />
          </label>
          <button type="submit" disabled={pending} className="btn-primary py-1.5! text-sm">
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              setValue(String(months));
              setEditing(false);
              setError('');
            }}
            className="text-sm text-neutral-600 underline"
          >
            Cancel
          </button>
        </form>
      ) : (
        <p className="mt-1 text-sm text-neutral-700">
          A check is current for <strong>{months} months</strong> from the date it was done. After
          that it shows as out of date and a new one is due.{' '}
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="font-semibold text-brand underline">
              Change
            </button>
          )}
        </p>
      )}
      <p className="mt-1 text-xs text-neutral-500">
        Changing it works out every expiry date on file again from its check date.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {done && <p className="mt-2 text-sm text-green-700">{done}</p>}
    </div>
  );
}
