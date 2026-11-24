'use client';

// Staff form for a mailed check or cash DONATION. Online gifts record
// themselves via the Stripe webhook. Labels are kept to one line so the field
// grid stays aligned; the longer explanations live in the intro text.

import Notice from '@/components/Notice';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { recordManualGift } from './actions';
import { DONATION_FUNDS } from '@/lib/funds';

// The same funds as the Donate page (lib/funds.js). A gift recorded under a
// fund since taken off the list keeps it; this form only offers current ones.
const FUNDS = DONATION_FUNDS;


export default function RecordGiftForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // One key per entry (0182): sent with the save, kept when the answer is
  // "already recorded", replaced once a row is saved. The button is also
  // disabled while a save is running, so a double click sends one.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  // `pending` updates only on the next render, so three quick clicks all see
  // false; this ref turns the second and third away at once (seen in the
  // local check, 23 Nov 2026: one row saved, but an "already recorded" line
  // beside the "Recorded" one).
  const inFlight = useRef(false);
  const [f, setF] = useState({
    donorName: '',
    email: '',
    amount: '',
    fund: FUNDS[0],
    method: 'check',
    receivedOn: '',
    note: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function submit(e) {
    e.preventDefault();
    if (pending || inFlight.current) return;
    inFlight.current = true;
    setError('');
    setDone('');
    const cents = Math.round((parseFloat(f.amount) || 0) * 100);
    start(async () => {
      const res = await recordManualGift({
        requestKey,
        donorName: f.donorName,
        email: f.email,
        amountCents: cents,
        fund: f.fund,
        method: f.method,
        receivedOn: f.receivedOn || undefined,
        note: f.note,
      }).catch(() => ({
        ok: false,
        error: 'The connection dropped. Check the list on this page before pressing again.',
      }));
      inFlight.current = false;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRequestKey(crypto.randomUUID());
      setDone(`Recorded a $${(cents / 100).toFixed(2)} gift (${f.method}).`);
      setF({ ...f, donorName: '', email: '', amount: '', note: '' });
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="card">
      <h3 className="font-bold mb-1">Record a mailed or cash gift</h3>
      <p className="text-sm text-neutral-500 mb-4">
        The donor&rsquo;s email links the gift to their giving history if they have an account
        now or create one later. Online gifts are recorded automatically.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label whitespace-nowrap">Donor name</label>
          <input className="field" value={f.donorName} onChange={set('donorName')} />
        </div>
        <div>
          <label className="field-label whitespace-nowrap">Donor email</label>
          <input className="field" value={f.email} onChange={set('email')} />
        </div>
        <div>
          <label className="field-label whitespace-nowrap">Amount (dollars)</label>
          <input inputMode="decimal" placeholder="0.00" value={f.amount} onChange={set('amount')} className="field" required />
        </div>
        <div>
          <label className="field-label whitespace-nowrap">Fund</label>
          <select className="field" value={f.fund} onChange={set('fund')}>
            {FUNDS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label whitespace-nowrap">Method</label>
          <select className="field" value={f.method} onChange={set('method')}>
            <option value="check">Check</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          {/* Label and hint apart (23 Nov 2026). */}
          <label className="field-label whitespace-nowrap">Date received</label>
          <input type="date" className="field" value={f.receivedOn} onChange={set('receivedOn')} />
          <p className="mt-1 text-xs text-neutral-500">Leave blank for today.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="field-label whitespace-nowrap">Note</label>
          <input className="field" value={f.note} onChange={set('note')} />
          <p className="mt-1 text-xs text-neutral-500">The check number, or who the gift is in memory of.</p>
        </div>
      </div>

      {error && (
        <Notice tone="error" className="mt-3">{error}</Notice>
      )}
      {done && (
        <p className="mt-3 rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>
      )}

      <button type="submit" disabled={pending} className="btn-primary btn-sm mt-4">
        {pending ? 'Recording…' : 'Record gift'}
      </button>
    </form>
  );
}
