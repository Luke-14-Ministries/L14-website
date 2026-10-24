'use client';

// "Send us feedback" -- a small card at the foot of the family dashboard
// (Lawrence, 24 Oct 2026). Quiet on purpose: it sits below the registration
// cards and must not compete with them. The welcome card
// (components/WelcomeNotice.jsx) points families here. The server side is
// feedback-actions.js.

import { useState } from 'react';
import { site } from '@/lib/site';
import { sendWebsiteFeedback } from './feedback-actions';

const FIELD =
  'w-full rounded-sm border border-neutral-300 px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-brand';

export default function FeedbackBox() {
  const [message, setMessage] = useState('');
  const [page, setPage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    let res;
    try {
      res = await sendWebsiteFeedback({
        message,
        page,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
    } catch (err) {
      console.error('sendWebsiteFeedback:', err?.message);
      res = { ok: false, failed: true };
    }
    setBusy(false);
    if (res?.ok) {
      setSent(true);
      setMessage('');
      setPage('');
      return;
    }
    setError(
      res?.failed || !res?.error
        ? `That didn’t send — please email ${site.emails.info}.`
        : res.error
    );
  }

  return (
    <div id="send-feedback" className="rounded-lg bg-white border border-neutral-200 shadow-xs p-6">
      <h2 className="text-lg font-bold">Send us feedback</h2>
      {sent ? (
        <div role="status" className="mt-3">
          <p className="font-semibold text-brand-dark">Thank you &mdash; we&rsquo;ve got it.</p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-2 text-sm text-brand underline"
          >
            Send another note
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-3 space-y-3">
          <div>
            <label htmlFor="feedback-message" className="block text-sm font-semibold mb-1">
              What seems confusing, wrong, or could be better?
            </label>
            <textarea
              id="feedback-message"
              rows={4}
              required
              minLength={10}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="feedback-page" className="block text-sm font-semibold mb-1">
              Which page? <span className="font-normal text-neutral-500">(optional)</span>
            </label>
            <input
              id="feedback-page"
              type="text"
              maxLength={200}
              value={page}
              onChange={(e) => setPage(e.target.value)}
              className={FIELD}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className="btn-outline py-2!">
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </div>
  );
}
