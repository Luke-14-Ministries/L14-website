'use client';

// "Add to <event>" beside a household member who is on no current
// registration (Lawrence, 11 Nov 2026). Adds the EXISTING person through the
// registration page's own addParticipant (existing_person_id), so the same
// checks hold: one role per person per event (0086), the fee from the chosen
// option (0114's trigger), the discounts re-run. Only rendered for staff with
// Registration write.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addParticipant } from '@/app/admin/registrations/[id]/actions';

const ROLES = [
  ['camper', 'Camper'],
  ['parent_guardian', 'Parent / guardian'],
  ['sibling', 'Sibling'],
  ['caregiver', 'Caregiver'],
  ['volunteer', 'Volunteer'],
  ['volunteer_child', 'Volunteer child (under 16)'],
];
const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const input = 'rounded-sm border border-neutral-300 bg-white px-2 py-1 text-sm';

function One({ person, reg }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [role, setRole] = useState('camper');
  // The option that matches the role, when the event has one per role.
  const optionFor = (r) =>
    (reg.options.find((o) => o.participant_role === r) ?? reg.options.find((o) => !o.participant_role) ?? reg.options[0])
      ?.id ?? '';
  const [optionId, setOptionId] = useState(optionFor('camper'));

  if (done) {
    return (
      <span className="text-sm text-green-700">
        Added to {reg.eventName} as submitted.{' '}
        <Link href={`/admin/registrations/${reg.id}/`} className="font-semibold text-brand underline">
          Open the registration
        </Link>
      </span>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-brand underline">
        Add to {reg.eventName}
      </button>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 rounded-sm border border-neutral-200 bg-neutral-50 p-2 text-sm">
      <span className="font-semibold">Add {person.firstName} to {reg.eventName} as</span>
      <select
        aria-label="Role"
        className={input}
        value={role}
        onChange={(e) => {
          setRole(e.target.value);
          setOptionId(optionFor(e.target.value));
        }}
      >
        {ROLES.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {reg.options.length > 1 && (
        <select aria-label="Camp option (sets the fee)" className={input} value={optionId} onChange={(e) => setOptionId(e.target.value)}>
          {reg.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({money(o.fee_cents)})
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={pending || !optionId}
        onClick={() => {
          setError('');
          start(async () => {
            const res = await addParticipant(reg.id, {
              existing_person_id: person.id,
              first_name: person.firstName,
              last_name: person.lastName,
              event_option_id: optionId,
              camp_role: role,
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setDone(true);
            router.refresh();
          });
        }}
        className="btn-primary py-1! text-sm"
      >
        {pending ? 'Adding…' : 'Add'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-neutral-600 underline">
        Cancel
      </button>
      {error && (
        <span role="alert" className="basis-full text-red-700">
          {error}
        </span>
      )}
      {!optionId && <span className="basis-full text-amber-800">This event has no camp options published yet.</span>}
    </span>
  );
}

export default function AddToRegistration({ person, registrations }) {
  if (registrations.length === 0) {
    return (
      <span className="text-sm text-neutral-500">
        Not on any registration, and the household has none for a current event. The family can
        register them from their account.
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-1">
      {registrations.map((reg) => (
        <One key={reg.id} person={person} reg={reg} />
      ))}
    </span>
  );
}
