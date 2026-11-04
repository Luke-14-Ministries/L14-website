'use client';

// A password box with an eye button to show or hide what was typed (Lawrence,
// 4 Nov 2026). Hidden by default; the button says which it will do, for
// screen readers too. Everything else is passed to the <input>, so autoComplete,
// required and minLength behave as before -- password managers still see a
// password field, because it is one until the person asks to see it.

import { useState } from 'react';

export default function PasswordInput({ className = '', wrapClassName = '', ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${wrapClassName}`}>
      <input {...props} type={show ? 'text' : 'password'} className={`${className} pr-12`} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        title={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-neutral-500 hover:text-neutral-800"
      >
        {show ? (
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5 0 9 4.5 10 8a12.6 12.6 0 0 1-3.2 4.9M6.6 6.6A12.5 12.5 0 0 0 2 12c1 3.5 5 8 10 8a10.7 10.7 0 0 0 5.4-1.4" />
          </svg>
        ) : (
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12c1-3.5 5-8 10-8s9 4.5 10 8c-1 3.5-5 8-10 8s-9-4.5-10-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
