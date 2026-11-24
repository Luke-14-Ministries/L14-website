'use client';

import { useEffect, useState } from 'react';
import PasswordInput from '@/components/PasswordInput';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { authErrorWords } from '@/lib/authErrors';
import LostPhoneNote from '@/components/LostPhoneNote';

// Supabase refuses a password change on an account with two-factor until the
// session has passed the code step (aal2), and the link in a reset email only
// gives aal1 -- so a reset by anyone with two-factor failed with Supabase's own
// "AAL2 session is required..." (Lawrence, 21 Nov 2026). A browser remembered
// at login is aal1 too (the skip is ours, not Supabase's), so Change password
// on the dashboard hit the same wall. When the account needs it, the form asks
// for the authenticator code and verifies it before saving.
async function verifyAnyFactor(supabase, code) {
  const { data: list } = await supabase.auth.mfa.listFactors();
  const verified = (list?.totp ?? []).filter((f) => f.status === 'verified');
  // Someone with two devices may type a code from either: try each.
  for (const f of verified) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    if (!error) return true;
  }
  return false;
}

// Changing a password from the dashboard needs the current one (Lawrence,
// 21 Nov 2026: a phone left signed in should not let someone else take over
// the account). The reset-email link is the exception -- that person has
// forgotten it. Supabase draws the same line when its "require current
// password" setting is on: a session that began from an emailed link (amr
// otp / magiclink / recovery) is exempt, and so is no one else. The server's
// check is the real one; this only decides whether to show the box.
const LINK_METHODS = ['otp', 'magiclink', 'recovery'];
function cameFromEmailLink(aal) {
  return (aal?.currentAuthenticationMethods ?? []).some((m) => LINK_METHODS.includes(m?.method));
}

export default function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [current, setCurrent] = useState('');
  const [needsCurrent, setNeedsCurrent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const annual = useSearchParams().get('reason') === 'annual';

  useEffect(() => {
    createClient()
      .auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data }) => {
        setNeedsCode(data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2');
        setNeedsCurrent(!cameFromEmailLink(data));
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    const supabase = createClient();
    if (needsCode) {
      if (!(await verifyAnyFactor(supabase, code.trim()))) {
        setError('That code did not match. It changes every 30 seconds, so try the current one.');
        setBusy(false);
        return;
      }
      setNeedsCode(false);
    }
    const { error: updateError } = await supabase.auth.updateUser(
      needsCurrent ? { password, current_password: current } : { password }
    );

    if (updateError) {
      // In case the lookup above failed and the box was not shown.
      if (updateError.code === 'current_password_required') {
        setNeedsCurrent(true);
        setError('Please enter your current password as well.');
        setBusy(false);
        return;
      }
      // In case the code check above was skipped (the level lookup failed).
      if (updateError.code === 'insufficient_aal' || /AAL2/i.test(updateError.message ?? '')) {
        setNeedsCode(true);
        setError('Your account has two-factor turned on. Enter the code from your authenticator app as well.');
      } else {
        // Plain words, shared with sign-up (lib/authErrors.js, 23 Nov 2026).
        setError(authErrorWords(updateError, 'The password could not be saved. Please try again.'));
      }
      setBusy(false);
      return;
    }
    // The annual-change clock (0104) is stamped by the database itself when
    // the password changes (a trigger on auth.users, 0176, 23 Nov 2026), so
    // it cannot be reset without a new password. Nothing to call here.

    // The reset link already signed them in, so there is nothing further to
    // do -- send them into the account area.
    router.push('/account/dashboard/');
    router.refresh();
  }

  return (
    <form
      className="rounded-lg border border-neutral-200 shadow-sm bg-white p-6 sm:p-8"
      onSubmit={handleSubmit}
    >
      {/* The page's heading says "Change password" (23 Nov 2026); a second
          title inside the card said the same thing again. */}
      <p className="text-sm text-neutral-500 mb-5">
        {annual
          ? 'Staff passwords are changed once a year. Choose a new one to carry on: at least 10 characters, and not one you use anywhere else.'
          : needsCurrent
            ? 'Enter your current password, then choose a new one (at least 10 characters).'
            : <>You&rsquo;re signed in from the link in your email. Choose a new password (at least 10 characters) and you&rsquo;re done.</>}
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-red-800"
        >
          {error}
        </p>
      )}

      {needsCurrent && (
        <>
          <label className="block font-semibold mb-1.5" htmlFor="rp-current">
            Current password
          </label>
          <PasswordInput
            id="rp-current"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="w-full rounded-sm border border-neutral-300 px-4 py-2.5"
            wrapClassName="mb-1.5"
          />
          <p className="text-sm text-neutral-500 mb-4">
            Forgotten it? <a href="/account/forgot-password/" className="text-brand underline">Send a reset link</a> instead.
          </p>
        </>
      )}
      <label className="block font-semibold mb-1.5" htmlFor="rp-password">
        New password
      </label>
      <PasswordInput
        id="rp-password"
        autoComplete="new-password"
        required
        minLength={10}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-sm border border-neutral-300 px-4 py-2.5"
        wrapClassName="mb-4"
      />
      <label className="block font-semibold mb-1.5" htmlFor="rp-confirm">
        Confirm new password
      </label>
      <PasswordInput
        id="rp-confirm"
        autoComplete="new-password"
        required
        minLength={10}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="w-full rounded-sm border border-neutral-300 px-4 py-2.5"
        wrapClassName="mb-6"
      />
      {needsCode && (
        <>
          <label className="block font-semibold mb-1.5" htmlFor="rp-code">
            Code from your authenticator app
          </label>
          <p className="text-sm text-neutral-500 mb-1.5">
            Your account has two-factor turned on, so changing the password needs the 6-digit code too.
          </p>
          <input
            id="rp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-full rounded-sm border border-neutral-300 px-4 py-2.5 mb-2 tracking-widest"
          />
          <LostPhoneNote className="mb-6" />
        </>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save New Password'}
      </button>
    </form>
  );
}
