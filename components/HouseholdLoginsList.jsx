'use client';

// Who can sign in to a household, for staff (23 Nov 2026). A family can now
// invite another adult to share its household itself (W75, 0174), with no
// approval step, so the office sees who joined, how, and any invite still
// waiting. Staff with Registration write can take a sign-in off the household
// (0178's remove_household_login(): never the person who set it up). The rows
// come from staff_household_logins() (0180) and household_invites.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { takeOutOfHousehold } from '@/app/admin/accounts/actions';

const dayFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' });
const fmtDay = (iso) => (iso ? dayFmt.format(new Date(iso)) : '');

function howJoined(l) {
  if (l.role === 'owner') return 'Set up the household';
  if (l.invite_accepted_at) {
    return `Joined by invite from ${l.invited_by_name ?? 'someone no longer on the household'}, ${fmtDay(l.invite_accepted_at)}`;
  }
  return `Added ${fmtDay(l.joined_at)}`;
}

export default function HouseholdLoginsList({ householdId, logins = [], invites = [], canRemove = false }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  function takeOut(l) {
    const who = l.name || l.email || 'this person';
    if (!window.confirm(`Take ${who} out of this household?\n\nThey keep their account but can no longer see this family's registrations. The family's people and registrations stay as they are.`)) {
      return;
    }
    setError('');
    setDone('');
    start(async () => {
      const res = await takeOutOfHousehold(householdId, l.profile_id);
      if (!res.ok) setError(res.error);
      else {
        setDone(`${who} was taken out of the household.`);
        router.refresh();
      }
    });
  }

  return (
    <div className="text-sm">
      {logins.length === 0 ? (
        <p className="text-neutral-500">Nobody can sign in to this household.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {logins.map((l) => (
            <li key={l.profile_id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="font-medium text-neutral-900">{l.name || 'No name'}</p>
                <p className="text-neutral-500 break-all">{l.email}</p>
                <p className="text-xs text-neutral-500">{howJoined(l)}</p>
              </div>
              {canRemove && l.role !== 'owner' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => takeOut(l)}
                  className="rounded-sm border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:border-red-400 hover:text-red-700 disabled:opacity-40"
                >
                  Take out of household
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {invites.length > 0 && (
        <div className="mt-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          {invites.map((i) => (
            <p key={i.id}>
              Invite waiting: {i.email}, sent {fmtDay(i.created_at)}
              {i.invited_by_name ? ` by ${i.invited_by_name}` : ''}. It runs out {fmtDay(i.expires_at)}.
            </p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}
      {done && (
        <p className="mt-2 rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-green-800">{done}</p>
      )}
    </div>
  );
}
