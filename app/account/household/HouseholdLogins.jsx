'use client';

// Who can sign in to this household, and inviting another adult (W75, 0174,
// Lawrence 23 Nov 2026). Each adult keeps their own sign-in; all of them see
// and manage the same family. An invite works only for the address it was
// sent to, for 7 days.
//
// 23 Nov 2026 (0178): the person who set the household up can remove another
// adult's sign-in here, and "Who they are" lists adults only (a sign-in on a
// child's record is refused by the database).
//
// 23 Nov 2026 (review A5-06/A5-07; a guess, flagged for Lawrence to confirm): the
// card says plainly that an invited adult sees and can change everything the
// first one can; the first login reads "Started this account"; the office
// address is a link.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inviteAdult, cancelInvite, removeHouseholdLogin } from './actions';

const inputCls = 'w-full rounded-sm border border-neutral-300 px-3 py-2';

// 18 or over today, or no date of birth on file (the database's own rule).
function isAdult(dob) {
  if (!dob) return true;
  const [y, m, d] = String(dob).split('-').map(Number);
  const now = new Date();
  const ageYears = now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
  return ageYears >= 18;
}

function fmtDay(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  } catch {
    return '';
  }
}

export default function HouseholdLogins({ householdId, logins = [], invites = [], people = [] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [status, setStatus] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);
  // People in the household with no login yet: the invite can say "this is them".
  const unclaimed = people.filter((p) => !p.profile_id && isAdult(p.date_of_birth));
  const iAmOwner = logins.some((l) => l.is_me && l.role === 'owner');

  function run(fn, after) {
    setBusy(true);
    setStatus(null);
    start(async () => {
      const res = await fn();
      setBusy(false);
      setStatus(res.ok ? { ok: true, text: res.message ?? 'Done ✓' } : { ok: false, text: res.error });
      if (res.ok && after) after();
      router.refresh();
    });
  }

  return (
    <section id="logins" className="mt-6 rounded-lg bg-white border border-neutral-200 shadow-xs p-6 scroll-mt-24">
      <h2 className="text-lg font-bold mb-1">Who can sign in to this household</h2>
      <p className="text-sm text-neutral-600 mb-4">
        Another parent, guardian or adult in your family can have their own sign-in. They see, and
        can change, the same things you can: registrations, payments and everyone&rsquo;s details.
        Invite them by email.
      </p>

      <ul className="mb-4 divide-y divide-neutral-100 rounded-sm border border-neutral-200">
        {logins.map((l) => (
          <li key={l.profile_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span>
              <span className="font-semibold">{l.name || 'A family member'}</span>
              {l.is_me ? <span className="text-neutral-500"> (you)</span> : null}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-neutral-500">{l.role === 'owner' ? 'Started this account' : 'Can sign in'}</span>
              {iAmOwner && !l.is_me && l.role !== 'owner' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${l.name || 'this person'}'s sign-in? They will no longer see this household.`)) {
                      run(() => removeHouseholdLogin(householdId, l.profile_id));
                    }
                  }}
                  className="text-sm font-semibold text-red-700 underline disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </span>
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-3 py-2 text-sm">
            <span>
              <span className="font-semibold">{i.email}</span>
              <span className="text-amber-900"> · invited {fmtDay(i.created_at)}, waiting (works until {fmtDay(i.expires_at)})</span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => cancelInvite(i.id))}
              className="text-sm font-semibold text-brand underline disabled:opacity-50"
            >
              Cancel invite
            </button>
          </li>
        ))}
      </ul>

      <form
        className="grid gap-3 sm:grid-cols-2 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          const f = Object.fromEntries(new FormData(formEl));
          run(() => inviteAdult(householdId, f), () => formEl.reset());
        }}
      >
        <label className="block">
          <span className="block text-sm font-semibold mb-1">Their email</span>
          <input name="email" type="email" required className={inputCls} />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold mb-1">Who they are (optional)</span>
          <select name="person_id" defaultValue="" className={inputCls}>
            <option value="">Someone not on the list, or not sure</option>
            {unclaimed.map((p) => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}
              </option>
            ))}
          </select>
        </label>
        {/* On its own row: beside the two boxes it squeezed the "who" list until
            its first choice was cut off (23 Nov 2026). */}
        <button type="submit" disabled={busy} className="btn-outline py-2! justify-self-start sm:col-span-2 disabled:opacity-50">
          {busy ? 'Sending…' : 'Send invite'}
        </button>
      </form>
      <p className="mt-2 text-xs text-neutral-500">
        They sign in, or create an account, with the address you enter. If they already have their own
        household on the site with a registration or other records, staff will join the two: email{' '}
        <a href="mailto:registration@luke14ministries.net" className="text-brand underline">
          registration@luke14ministries.net
        </a>
        . Only the person who started this account can remove a sign-in.
      </p>
      {status && (
        <p className={`mt-2 text-sm ${status.ok ? 'text-green-700' : 'text-red-700'}`} role="status">
          {status.text}
        </p>
      )}
    </section>
  );
}
