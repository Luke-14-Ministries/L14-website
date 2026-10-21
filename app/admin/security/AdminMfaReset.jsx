'use client';

// Admin control to reset a locked-out user's two-factor. It calls
// resetMfaByEmail (./actions.js), which goes through admin_reset_mfa(): a
// code-verified session, never your own account, and logged (0104). The
// admin-reset-mfa Edge Function it used before is retired.

import { useState } from 'react';
import { resetMfaByEmail } from './actions';

export default function AdminMfaReset() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const data = await resetMfaByEmail(email.trim()).catch(() => ({
      ok: false,
      error: 'Could not reset two-factor. Please try again.',
    }));
    setBusy(false);

    if (data?.ok) {
      setResult({
        ok: true,
        message:
          data.removed > 0
            ? `Done — removed ${data.removed} two-factor ${
                data.removed === 1 ? 'device' : 'devices'
              } from ${data.email}. They can log in with just their password and set it up again.`
            : `${data.email} had no two-factor set up, so there was nothing to remove.`,
      });
      setEmail('');
    } else {
      setResult({ ok: false, message: data?.error || 'Could not reset two-factor.' });
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Reset a user&rsquo;s two-factor</h2>
      <p className="text-sm text-neutral-500 mb-5 max-w-prose">
        For someone locked out because they lost their phone or reinstalled their
        authenticator app. This removes their two-factor so they can log in with
        their password and set it up again. It does not change their password.
      </p>

      <form onSubmit={submit} className="max-w-md">
        <label className="block font-semibold mb-1.5" htmlFor="reset-email">
          Their account email
        </label>
        <input
          id="reset-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@luke14ministries.net"
          className="w-full rounded-sm border border-neutral-300 px-4 py-2.5 mb-4"
        />
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Resetting…' : 'Reset two-factor'}
        </button>
      </form>

      {result && (
        <p
          className={`mt-5 rounded border px-4 py-3 ${
            result.ok
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
