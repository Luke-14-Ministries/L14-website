'use client';

// "Take off the list" on the Prayer List page (Prayer list write), for a
// request to leave that came by email. Since 0181 (23 Nov 2026) the removal
// sticks, and "Let them sign up again" is the way back when they write in
// asking to rejoin.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeFromPrayerList, allowPrayerSignUpAgain } from './actions';

export default function RemoveButton({ id, email }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  function go() {
    if (
      !confirm(
        `Take ${email} off the prayer list? They won't be emailed again, and the Pray page won't add them back. If they ask to rejoin, use "Let them sign up again".`
      )
    )
      return;
    setError('');
    start(async () => {
      const res = await removeFromPrayerList(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }
  return (
    <>
      <button type="button" onClick={go} disabled={pending} className="text-xs text-red-700 underline">
        Take off the list
      </button>
      {error && <span className="ml-2 text-xs text-red-700">{error}</span>}
    </>
  );
}

export function AllowAgainButton({ id, email }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  function go() {
    if (
      !confirm(
        `Let ${email} sign up again? Nothing is sent now. They join by signing up on the Pray page and confirming from their inbox.`
      )
    )
      return;
    setError('');
    start(async () => {
      const res = await allowPrayerSignUpAgain(id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }
  return (
    <>
      <button type="button" onClick={go} disabled={pending} className="text-xs text-brand underline">
        Let them sign up again
      </button>
      {error && <span className="ml-2 text-xs text-red-700">{error}</span>}
    </>
  );
}
