'use client';

// Name/phone and the sign-in email change (goes through Supabase Auth's
// confirmation email). The news tick moved to Manage Household, beside the
// contact email it is sent to (Lawrence, 23 Nov 2026). Transactional email -- receipts,
// confirmations, password resets -- always sends; the preference only covers
// ministry news & updates.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { updateMyProfile, requestLoginEmailChange } from './actions';

const inputCls = 'w-full rounded-sm border border-neutral-300 px-3 py-2';

// One save-status line per form, given the entry for its form from `msg`.
//
// At module level, not inside ContactManager. Defined inside, it was a NEW
// component type on every render, so React threw away and remounted it each
// time state changed (react-hooks/static-components). Harmless for a span,
// but the same habit on anything with an input loses what was typed.
function Status({ s }) {
  if (!s) return null;
  if (s.state === 'saving') return <span className="text-sm text-neutral-500">Saving…</span>;
  return (
    <span className={`text-sm ${s.state === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
      {s.text}
    </span>
  );
}

export default function ContactManager({ email, profile }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [msg, setMsg] = useState({});
  // The login email change asks for the authenticator code when Supabase
  // wants a code-verified session (two-factor accounts, 23 Nov 2026).
  const [needsCode, setNeedsCode] = useState(false);

  function run(key, fn) {
    setMsg((m) => ({ ...m, [key]: { state: 'saving' } }));
    start(async () => {
      const res = await fn();
      if (key === 'email') setNeedsCode(Boolean(res.needsCode));
      setMsg((m) => ({
        ...m,
        [key]: res.ok
          ? { state: 'ok', text: res.message ?? 'Saved ✓' }
          : { state: 'err', text: res.error },
      }));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Name & personal phone */}
      <form
        className="rounded-lg bg-white border border-neutral-200 shadow-xs p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          run('profile', () => updateMyProfile(f));
        }}
      >
        <h2 className="text-lg font-bold mb-1">My name &amp; phone</h2>
        {/* Says where a name change goes (23 Nov 2026): updateMyProfile
            copies it to your own card on Manage household. */}
        <p className="text-sm text-neutral-500 mb-4">
          How your name appears across the site. A change here also updates your own card on
          Manage household.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-sm font-semibold mb-1">First name</span>
            <input name="first_name" defaultValue={profile.first_name} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-sm font-semibold mb-1">Last name</span>
            <input name="last_name" defaultValue={profile.last_name} className={inputCls} />
          </label>
          {/* The "OK to text me" tick is hidden (23 Nov 2026): the site
              sends no texts, so it promised something that never happens.
              The column and the opt-ins already saved are untouched. */}
          <label className="block">
            <span className="block text-sm font-semibold mb-1">My phone</span>
            <input name="phone" type="tel" defaultValue={profile.phone} className={inputCls} />
            <span className="mt-1 block text-xs text-neutral-500">
              Your own cell, for camp staff to reach you directly. Your household&rsquo;s main phone
              is on Manage household.
            </span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" className="btn-primary py-2!">Save</button>
          <Status s={msg.profile} />
        </div>
      </form>

      {/* Login email */}
      <form
        className="rounded-lg bg-white border border-neutral-200 shadow-xs p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          run('email', () => requestLoginEmailChange(f.new_email, f.code ?? ''));
        }}
      >
        <h2 className="text-lg font-bold mb-1">Sign-in email</h2>
        <p className="text-sm text-neutral-500 mb-4">
          The address you sign in with, and where password reset emails go. Currently{' '}
          <span className="font-semibold">{email}</span>. To change it, enter the new address.{' '}
          {/* Both links, because "secure email change" is on in Supabase: it
              said one link until 23 Nov 2026, and the second email then
              looked like a mistake. */}
          We will email a link to the new address and one to your current address. Nothing
          changes until both are pressed. This does not change where camp email goes: that is your household&rsquo;s contact
          email, changed on{' '}
          <Link href="/account/household/" className="text-brand underline">
            Manage household
          </Link>
          .
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[16rem]">
            <span className="block text-sm font-semibold mb-1">New email address</span>
            <input name="new_email" type="email" required className={inputCls} />
          </label>
          <button type="submit" className="btn-outline py-2!">Send confirmation</button>
        </div>
        {needsCode && (
          <label className="mt-3 block max-w-xs">
            <span className="block text-sm font-semibold mb-1">Code from your authenticator app</span>
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className={`${inputCls} tracking-widest`}
            />
          </label>
        )}
        <div className="mt-2">
          <Status s={msg.email} />
        </div>
      </form>
    </div>
  );
}
