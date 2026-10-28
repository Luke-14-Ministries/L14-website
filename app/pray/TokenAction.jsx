'use client';

// The button on the confirm and unsubscribe pages (0141). A button, not the
// link itself, for the reason the account emails use one (/auth/confirm):
// mail scanners open every link in an email, and a link that acted on its own
// would confirm, or unsubscribe, before the person ever saw it.

import { useState } from 'react';
import Link from 'next/link';
import { confirmPrayerList, unsubscribePrayerList } from './actions';

const ACTIONS = {
  confirm: {
    run: confirmPrayerList,
    button: 'Yes, add me to the prayer email list',
    done: (email) => `You are on the prayer email list${email ? ` as ${email}` : ''}. Thank you for praying with us.`,
  },
  unsubscribe: {
    run: unsubscribePrayerList,
    button: 'Unsubscribe me',
    done: (email) =>
      `${email ?? 'This address'} is off the prayer email list. No more prayer emails will be sent to it. You can sign up again on the Pray page at any time.`,
  },
};

export default function TokenAction({ kind, token }) {
  const a = ACTIONS[kind];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [doneFor, setDoneFor] = useState(null);

  async function go() {
    setBusy(true);
    setError('');
    const res = await a.run(token);
    setBusy(false);
    if (!res?.ok) setError(res?.error || 'Sorry — something went wrong. Please try again.');
    else setDoneFor({ email: res.email ?? null });
  }

  if (doneFor) {
    return (
      <div role="status" className="rounded-sm border border-brand bg-brand-light px-5 py-6 text-brand-dark">
        <p className="font-semibold">{a.done(doneFor.email)}</p>
        <p className="mt-3">
          <Link href="/pray/" className="underline">
            Back to the Pray page
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div>
      <button type="button" onClick={go} disabled={busy} className="btn-primary">
        {busy ? 'One moment…' : a.button}
      </button>
      {error && (
        <p role="alert" className="mt-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3 font-semibold text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
