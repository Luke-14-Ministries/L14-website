'use client';

// The staff-side allergy severity control on Dietary & Allergies (29 Sep 2026).
// A plain select that saves on change. The reminder beside it is deliberately a
// NOTE and not a confirm dialog: Lawrence asked for a non-blocking warning, and
// the point is to keep the rule in front of whoever is typing, not to make them
// click through it.
//
// The select IS the pill (15 Oct 2026). It used to sit beside a read-only
// pill saying the same word -- "mild allergy  [Mild v]" -- which Lawrence
// read as redundant. Now one control, coloured like the pill on every other
// page (allergyPill in lib/format.js), with the dropdown arrow as the only
// sign that it can be changed.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAllergySeverity } from './actions';
import { allergyPill } from '@/lib/format';

const OPTIONS = [
  ['', 'allergy — severity not recorded'],
  ['mild', 'mild allergy'],
  ['severe', 'severe allergy'],
  ['anaphylaxis', 'ANAPHYLAXIS'],
];

export default function SeverityPicker({ personId, value, name }) {
  const [current, setCurrent] = useState(value ?? '');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  function onChange(e) {
    const next = e.target.value;
    setCurrent(next);
    setError('');
    start(async () => {
      const res = await setAllergySeverity({ personId, severity: next || null });
      if (!res.ok) {
        setError(res.error);
        setCurrent(value ?? '');
      } else {
        router.refresh();
      }
    });
  }

  const pill = allergyPill(true, current || null);
  return (
    <span className="ml-2 inline-flex flex-col gap-0.5 align-middle">
      <select
        aria-label={`Allergy severity for ${name}`}
        title={`${pill.title} Set this only from what the family or the camp doctor has told you.`}
        value={current}
        onChange={onChange}
        disabled={pending}
        className={`cursor-pointer rounded-full border-0 py-0.5 pl-2 pr-6 text-xs font-semibold ${pill.cls}`}
      >
        {OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
