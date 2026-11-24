'use client';

import { useEffect, useState } from 'react';

// The address just signed up with, shown on the check-email page. The sign-up
// form keeps it in this tab's sessionStorage rather than the URL (23 Nov
// 2026): an address in a URL lands in browser history, server logs and
// analytics. Read after the page loads, so the server-rendered page (which
// cannot see sessionStorage) and the first browser render agree.
export const SIGNUP_EMAIL_KEY = 'l14_signup_email';

export default function SignedUpAddress() {
  const [email, setEmail] = useState('');
  useEffect(() => {
    let saved = '';
    try {
      saved = sessionStorage.getItem(SIGNUP_EMAIL_KEY) || '';
    } catch {
      /* private modes can refuse; the sentence reads fine without it */
    }
    // One read of browser storage after mount, which is what the rule asks
    // effects to be for; set once, never in a loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setEmail(saved);
  }, []);
  if (!email) return null;
  return (
    <>
      {' '}
      to <strong className="wrap-break-word">{email}</strong>
    </>
  );
}
