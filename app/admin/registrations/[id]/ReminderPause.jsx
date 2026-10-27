'use client';

// "Pause reminders" for one registration (0138; Lawrence, 27 Oct 2026): for
// a family staff are already talking to. A pause stops the automatic deposit,
// balance, past-due, missing-details and not-submitted reminders; the
// confirmations and payment-plan notices still go. Registration write
// changes it; Registration read sees it.

import { useState, useTransition } from 'react';
import { setReminderPause } from './actions';
import { dayInMorristown } from '@/lib/events';

export default function ReminderPause({ registrationId, pause, canWrite }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  function toggle(paused) {
    setError('');
    start(async () => {
      const res = await setReminderPause(registrationId, paused);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      {pause ? (
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          Reminders paused {dayInMorristown(pause.paused_at)}
          {pause.byName ? ` by ${pause.byName}` : ''}
        </span>
      ) : (
        <span className="text-neutral-600">Automatic reminders are on.</span>
      )}
      {canWrite && (
        <button type="button" disabled={pending} onClick={() => toggle(!pause)} className="text-brand underline">
          {pending ? 'Saving…' : pause ? 'Resume reminders' : 'Pause reminders'}
        </button>
      )}
      <span className="text-xs text-neutral-500">
        Pausing stops deposit, balance and missing-details reminders; confirmations and payment-plan notices still go.
      </span>
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}
