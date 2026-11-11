'use client';

// "Their details" on the staff person page, with an Edit for staff who may
// change registrations (Lawrence, 11 Nov 2026). Read-only staff see the same
// facts and no Edit.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatPhone, telHref } from '@/lib/format';
import { updatePersonFromPersonPage } from './actions';

const input = 'w-full rounded-sm border border-neutral-300 bg-white px-2 py-1.5 text-sm';
const label = 'block text-xs font-semibold text-neutral-600 mb-0.5';

function fmtDob(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function Row({ name, children }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-b border-neutral-100 py-1.5 last:border-0">
      <span className="w-40 shrink-0 text-neutral-500">{name}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export default function PersonDetails({ person, canEdit }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const blank = {
    first_name: person.first_name ?? '',
    last_name: person.last_name ?? '',
    preferred_name: person.preferred_name ?? '',
    date_of_birth: person.date_of_birth ?? '',
    gender: person.gender ?? '',
    phone: person.phone ? formatPhone(person.phone) : '',
    email: person.email ?? '',
  };
  const [f, setF] = useState(blank);
  const set = (k) => (e) => {
    setF((prev) => ({ ...prev, [k]: e.target.value }));
    setDone(false);
  };

  function save(confirmIdentityChange = false) {
    setError('');
    start(async () => {
      const res = await updatePersonFromPersonPage(person.id, f, { confirmIdentityChange });
      if (!res.ok) {
        setError(res.error);
        setConfirm(Boolean(res.needsConfirm));
        return;
      }
      setConfirm(false);
      setEditing(false);
      setDone(true);
      router.refresh();
    });
  }

  if (!editing) {
    const phone = person.phone ? formatPhone(person.phone) : '';
    return (
      <div>
        <Row name="Name">
          {`${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || '—'}
          {person.preferred_name ? <span className="text-neutral-500"> · goes by {person.preferred_name}</span> : null}
        </Row>
        <Row name="Date of birth">{fmtDob(person.date_of_birth) || <span className="text-amber-700">Not recorded</span>}</Row>
        <Row name="Sex">{person.gender || '—'}</Row>
        <Row name="Own phone">
          {phone ? (
            <a href={telHref(phone) ?? undefined} className="text-brand underline">
              {phone}
            </a>
          ) : (
            '—'
          )}
        </Row>
        <Row name="Own email">{person.email || '—'}</Row>
        {done && <p className="mt-2 text-sm text-green-700">Saved.</p>}
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setF(blank);
              setError('');
              setConfirm(false);
              setEditing(true);
            }}
            className="mt-3 text-sm font-semibold text-brand underline"
          >
            Edit details
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={label}>First name</span>
          <input className={input} value={f.first_name} onChange={set('first_name')} autoComplete="off" />
        </label>
        <label>
          <span className={label}>Last name</span>
          <input className={input} value={f.last_name} onChange={set('last_name')} autoComplete="off" />
        </label>
        <label>
          <span className={label}>Preferred name (nametags)</span>
          <input className={input} value={f.preferred_name} onChange={set('preferred_name')} autoComplete="off" />
        </label>
        <label>
          <span className={label}>Date of birth</span>
          <input type="date" className={input} value={f.date_of_birth} onChange={set('date_of_birth')} min="1900-01-01" />
        </label>
        <label>
          <span className={label}>Sex</span>
          <select className={input} value={f.gender} onChange={set('gender')}>
            <option value="">— not recorded —</option>
            <option>Male</option>
            <option>Female</option>
            {f.gender && !['Male', 'Female'].includes(f.gender) && <option>{f.gender}</option>}
          </select>
        </label>
        <label>
          <span className={label}>Their own phone</span>
          <input
            type="tel"
            className={input}
            value={f.phone}
            onChange={set('phone')}
            onBlur={() => setF((prev) => ({ ...prev, phone: formatPhone(prev.phone) }))}
            autoComplete="off"
          />
        </label>
        <label className="sm:col-span-2">
          <span className={label}>Their own email</span>
          <input type="email" className={input} value={f.email} onChange={set('email')} autoComplete="off" />
        </label>
      </div>
      {error && (
        <p role="alert" className={`text-sm ${confirm ? 'text-amber-900' : 'text-red-700'}`}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {confirm ? (
          <button type="button" onClick={() => save(true)} disabled={pending} className="btn-primary py-1.5! text-sm">
            {pending ? 'Saving…' : 'Change it anyway'}
          </button>
        ) : (
          <button type="submit" disabled={pending} className="btn-primary py-1.5! text-sm">
            {pending ? 'Saving…' : 'Save'}
          </button>
        )}
        <button type="button" onClick={() => setEditing(false)} className="text-sm text-neutral-600 underline">
          Cancel
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Name and date of birth changes are logged in Recent Changes. Support and medical details
        and caregivers are changed by the family on their account, or on a registration page.
      </p>
    </form>
  );
}
