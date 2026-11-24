'use client';

// Reset a locked-out person's two-factor by their email address. It calls
// resetMfaByEmail (./actions.js), which goes through admin_reset_mfa(): the
// administrator's own code entered just now (aal2), never your own account,
// and logged (0104, 0180). Since 23 Nov 2026 the button opens the same
// step-up box as the Accounts page, which names the account and asks for
// your own code; it no longer resets on one click.

import { useState } from 'react';
import StepUpModal from '@/components/StepUpModal';
import { resetMfaByEmail } from './actions';

export default function AdminMfaReset() {
  const [email, setEmail] = useState('');
  const [asking, setAsking] = useState(null); // the email being confirmed
  const [result, setResult] = useState(null); // { ok, message }

  function submit(e) {
    e.preventDefault();
    const clean = email.trim();
    if (!clean) return;
    setResult(null);
    setAsking(clean);
  }

  function done(data) {
    setAsking(null);
    setEmail('');
    setResult({
      ok: true,
      message:
        data.removed > 0
          ? `Done. Removed ${data.removed} two-factor ${data.removed === 1 ? 'device' : 'devices'} from ${
              data.email
            }. They can sign in with their password and set it up again.`
          : `${data.email} had no two-factor set up, so there was nothing to remove.`,
    });
  }

  return (
    <div>
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
          placeholder="name@example.com"
          className="field-sm mb-4"
        />
        <button type="submit" className="btn-primary">
          Reset two-factor…
        </button>
      </form>

      {result && (
        <p
          className={`mt-5 rounded-sm border px-4 py-3 ${
            result.ok
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {result.message}
        </p>
      )}

      {asking && (
        <StepUpModal
          title="Reset this account's two-factor?"
          account={asking}
          confirmLabel="Reset two-factor"
          busyLabel="Resetting…"
          onClose={() => setAsking(null)}
          onConfirm={() => resetMfaByEmail(asking)}
          onDone={done}
        >
          <p className="text-sm text-neutral-700 mb-3">
            They sign in with their password and set up two-factor again. Their password does not
            change. Anyone who knows that password could set it up in their place, so do this only
            for the person themselves.
          </p>
        </StepUpModal>
      )}
    </div>
  );
}
