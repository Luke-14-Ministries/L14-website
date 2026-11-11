'use client';

// The first step for a new account (0149): name the household's first person
// -- the person signing in -- so Manage Household has something to manage
// before any registration. Everything else (address, more people) is edited
// on the page that appears next.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMyHousehold } from './actions';
import { formatPhone } from '@/lib/format';

const input = 'w-full rounded-sm border border-neutral-300 bg-white px-3 py-2';
const label = 'block text-sm font-semibold text-neutral-700 mb-1';

export default function SetUpHousehold({ firstName = '', lastName = '' }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ firstName, lastName, phone: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    setError('');
    start(async () => {
      const res = await createMyHousehold(f);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
      <h2 className="text-lg font-bold">Set up your household</h2>
      <p className="mt-1 mb-4 text-sm text-neutral-600">
        Start with yourself. You can add your address and the rest of your family on the next
        page, now or whenever you register.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Your first name</span>
          <input required className={input} value={f.firstName} onChange={set('firstName')} autoComplete="given-name" />
        </label>
        <label className="block">
          <span className={label}>Your last name</span>
          <input required className={input} value={f.lastName} onChange={set('lastName')} autoComplete="family-name" />
        </label>
        <label className="block sm:col-span-2">
          <span className={label}>
            Phone <span className="font-normal text-neutral-500">(optional)</span>
          </span>
          <input
            type="tel"
            className={input}
            value={f.phone}
            onChange={set('phone')}
            // Tidied on blur like every other phone box (alpha feedback,
            // 11 Nov 2026: a number typed here was saved as bare digits).
            onBlur={() => setF((prev) => ({ ...prev, phone: formatPhone(prev.phone) }))}
            autoComplete="tel"
            inputMode="tel"
          />
        </label>
      </div>
      {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={pending} className="btn-primary mt-5">
        {pending ? 'Setting up…' : 'Set up my household'}
      </button>
    </form>
  );
}
