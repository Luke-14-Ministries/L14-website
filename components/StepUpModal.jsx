'use client';

// The staff pages' confirm boxes, and the one that asks for your own code.
//
// Dialog: a modal box that says it is one (role="dialog", aria-modal), closes
// on Escape, and closes on a click outside only when that is harmless. The
// Accounts page's merge and delete boxes pass closeOnOutside={false}: a stray
// click beside a half-typed family name should not throw the work away, and
// a box that vanishes mid-decision reads as "did it happen?" (23 Nov 2026).
//
// StepUpModal: for the account actions that cannot be undone or that hand
// someone a way in -- Reset two-factor, Remove account, Delete family
// (security review, 23 Nov 2026). It names the account, reminds staff to
// confirm who they are dealing with by phone or in person, and asks for the
// administrator's OWN 6-digit code. The code is checked here with Supabase's
// listFactors + challengeAndVerify, which raises this browser's session to
// aal2; the server action then runs on that session, and the database
// function refuses anything less (0180). A browser remembered for 7 days
// still reaches staff pages, but no longer resets, removes or deletes on one
// click.

import { useEffect, useId, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function Dialog({ title, titleClassName = '', children, onClose, closeOnOutside = true, busy = false }) {
  const titleId = useId();
  // Escape closes, unless something is still being saved.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={closeOnOutside && !busy ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className={`text-lg font-bold mb-2 ${titleClassName}`}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

// Someone with two devices may type a code from either: try each verified one.
async function verifyOwnCode(code) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { ok: false, error: `Your two-factor devices could not be read. ${error.message}` };
  const verified = (data?.totp ?? []).filter((f) => f.status === 'verified');
  if (verified.length === 0) {
    return { ok: false, error: 'Your account has no authenticator app set up, so this cannot be confirmed. Set one up under Two-factor on your account page.' };
  }
  for (const f of verified) {
    const { error: vError } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    if (!vError) return { ok: true };
  }
  return { ok: false, error: 'That code did not work. Check you are reading your own authenticator app, wait for a fresh code and try again.' };
}

// onConfirm: async () => ({ ok, error? }) -- the server action, run only after
// the code has verified. onDone(result) on success; an error stays in the box.
export default function StepUpModal({
  title,
  account,
  danger = false,
  children = null,
  confirmLabel = 'Confirm',
  busyLabel = 'Working…',
  canConfirm = true,
  remind = true,
  onConfirm,
  onDone,
  onClose,
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const codeOk = /^\d{6}$/.test(code);

  async function submit(e) {
    e.preventDefault();
    if (!codeOk || !canConfirm || busy) return;
    setBusy(true);
    setError('');
    const check = await verifyOwnCode(code).catch((err) => ({ ok: false, error: `The code could not be checked. ${err?.message ?? ''}`.trim() }));
    if (!check.ok) {
      setBusy(false);
      setCode('');
      setError(check.error);
      return;
    }
    const result = await Promise.resolve(onConfirm()).catch((err) => ({
      ok: false,
      error: `It did not go through. ${err?.message ?? ''}`.trim(),
    }));
    setBusy(false);
    if (result?.ok) onDone?.(result);
    else {
      setCode('');
      setError(result?.error || 'It did not go through.');
    }
  }

  return (
    <Dialog
      title={title}
      titleClassName={danger ? 'text-red-700' : ''}
      onClose={onClose}
      closeOnOutside={false}
      busy={busy}
    >
      <form onSubmit={submit}>
        {account && (
          <p className="text-sm text-neutral-700 mb-3">
            Account: <strong className="wrap-break-word">{account}</strong>
          </p>
        )}
        {children}
        {remind && (
          <p className="text-sm rounded-sm border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 mb-3">
            Before you go on, confirm who you are dealing with by phone or in person, not by email
            alone.
          </p>
        )}
        <label className="block text-sm font-semibold mb-1.5" htmlFor="step-up-code">
          Your own 6-digit code
        </label>
        <p className="text-xs text-neutral-500 mb-1.5">
          From the authenticator app on your phone, the same code you sign in with.
        </p>
        <input
          id="step-up-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          className="w-40 rounded-sm border border-neutral-300 px-3 py-2 mb-3 font-mono tracking-widest"
          autoFocus
        />
        {error && (
          <p role="alert" className="text-sm rounded-sm border border-red-300 bg-red-50 text-red-800 px-3 py-2 mb-3">
            {error}
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="btn-outline btn-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !codeOk || !canConfirm}
            className={
              danger
                ? 'rounded-sm bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-semibold px-4 py-1.5'
                : 'btn-primary btn-sm disabled:opacity-40'
            }
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
