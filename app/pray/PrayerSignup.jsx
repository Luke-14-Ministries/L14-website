'use client';

// The Pray page's sign-up (0141, 28 Oct 2026), in place of the Google Form.
// Name and email, the same "I am human" check as the contact form, then a
// confirmation email: nothing is sent to the list until the person presses
// its button.

import { useState } from 'react';
import Turnstile, { turnstileEnabled } from '@/components/Turnstile';
import { signUpForPrayerList } from './actions';

const FIELD =
  'w-full rounded-sm border border-neutral-300 px-4 py-2 focus:outline-hidden focus:ring-2 focus:ring-brand';

export default function PrayerSignup() {
  const [form, setForm] = useState({ name: '', email: '' });
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaBump, setCaptchaBump] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (turnstileEnabled && !captchaToken) {
      setError('Please complete the “I am human” check just above the button.');
      return;
    }
    setBusy(true);
    const res = await signUpForPrayerList({ ...form, captchaToken });
    setBusy(false);
    if (!res?.ok) {
      setError(res?.error || 'Sorry — something went wrong. Please try again.');
      setCaptchaToken(null);
      setCaptchaBump((n) => n + 1);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div role="status" className="rounded-sm border border-brand bg-brand-light px-5 py-6 text-left text-brand-dark">
        <p className="text-lg font-bold">Thank you — please check your email.</p>
        <p className="mt-2">
          We sent a confirmation to <span className="font-semibold">{form.email}</span>. Press the
          button in it and the prayer emails will start coming. If it is not there in a few minutes,
          look in your junk or spam folder.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left">
      <div>
        <label htmlFor="prayer-name" className="mb-1 block font-semibold">
          Name
        </label>
        <input id="prayer-name" type="text" autoComplete="name" value={form.name} onChange={set('name')} className={FIELD} />
      </div>
      <div>
        <label htmlFor="prayer-email" className="mb-1 block font-semibold">
          Email
        </label>
        <input
          id="prayer-email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={set('email')}
          className={FIELD}
        />
      </div>
      <Turnstile onToken={setCaptchaToken} resetKey={captchaBump} action="prayer" />
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Signing up…' : 'Join the prayer email list'}
      </button>
      {error && (
        <p role="alert" className="rounded-sm border border-red-300 bg-red-50 px-4 py-3 font-semibold text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}
