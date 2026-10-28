'use client';

// "Take off the list" on the Prayer List page (Prayer list write), for a
// request to leave that came by email.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeFromPrayerList } from './actions';

export default function RemoveButton({ id, email }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  function go() {
    if (!confirm(`Take ${email} off the prayer list? They will not be emailed again unless they sign up afresh.`)) return;
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
