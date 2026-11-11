'use client';

// The door list: big touch targets, type-to-find, arrival counts. Flags shown
// beside a name are the ones door staff need at a glance; full detail stays on
// the sensitive-gated medical pages (and only appears here at all for staff
// who hold that permission -- RLS strips it for everyone else).

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleCheckIn } from './actions';
import QrCode from '@/components/QrCode';

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  volunteer_child: 'Volunteer child (under 16)',
};

export default function CheckinList({ rows }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [pendingId, setPendingId] = useState(null);
  const [, start] = useTransition();
  const [error, setError] = useState('');
  // The "Pay on your phone" QR being shown, if any: { path, title, caption }.
  const [qr, setQr] = useState(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) || r.household.toLowerCase().includes(needle)
        )
      : rows;
    return [...list].sort((a, b) => a.sortName.localeCompare(b.sortName));
  }, [rows, q]);

  const arrived = rows.filter((r) => r.checkedInAt).length;

  function toggle(row) {
    setError('');
    setPendingId(row.id);
    start(async () => {
      const res = await toggleCheckIn(row.id, !row.checkedInAt);
      if (!res.ok) setError(res.error);
      setPendingId(null);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a name or family…"
          className="flex-1 min-w-56 rounded-sm border border-neutral-300 px-4 py-2.5"
        />
        <span className="text-sm font-semibold text-neutral-600">
          {arrived} / {rows.length} arrived
        </span>
        {/* Paying at the door goes through the family's OWN phone and login
            (1 Nov 2026): the money lands on their registration by itself and
            no card touches a staff phone. This one works for any family and
            needs no money grant -- their dashboard shows what is left. */}
        <button
          type="button"
          onClick={() =>
            setQr({
              path: '/account/dashboard/',
              title: 'Pay on your phone',
              caption:
                'Point your phone’s camera here and sign in. Your page shows what is left to pay. Use “Ways to pay” to pay by card or bank account.',
            })
          }
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 hover:border-brand"
        >
          Pay on your phone (QR)
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
        {filtered.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* Absent until a family uploads one, so the layout still has to
                  look right with no photo at all. */}
              {r.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.photoUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full object-cover border border-neutral-200"
                />
              )}
              <div className="min-w-0">
              <p className="font-semibold">
                {r.name}
                <span className="font-normal text-neutral-500"> · {ROLE_LABEL[r.role] ?? r.role}</span>
                {/* Deliberately beside the NAME rather than among the red
                    medical flags below: it is a rule to follow, not an alert,
                    and it must stay visible to door staff who don't hold the
                    sensitive grant and therefore see no medical flags at all. */}
                {r.noPhoto && (
                  <span
                    className="ml-2 rounded-full bg-neutral-800 text-white px-2 py-0.5 text-xs font-semibold align-middle"
                    title="This family asked us not to feature them in photos or video we share. They may still appear in the background of a group shot."
                  >
                    no photos
                  </span>
                )}
              </p>
              <p className="text-sm text-neutral-500">
                {/* The gray line is the household -- worth saying, because in
                    testing it read as a mystery second name. */}
                <span title="Household">{r.household}</span>
                {/* Only for staff with Payments read (the page asks nothing
                    otherwise). The amount is the FAMILY's balance, shown on
                    each of its people -- hence "family owes". */}
                {r.owed && (
                  <button
                    type="button"
                    onClick={() =>
                      setQr({
                        path: `/account/finish/${r.registrationId}/`,
                        title: `${r.household}: ${r.owed} left to pay`,
                        caption:
                          'Point your phone’s camera here and sign in. It opens “Ways to pay” for this registration, and the payment is applied to it.',
                      })
                    }
                    title="What this family still owes. Tap for a QR code that opens their own payment page."
                    className="ml-2 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-semibold hover:bg-amber-200"
                  >
                    family owes {r.owed} · QR
                  </button>
                )}
                {r.flags.length > 0 && (
                  <span className="ml-2">
                    {r.flags.map((f) => (
                      <span
                        key={f.t}
                        title={f.title}
                        /* red = ignoring it harms someone or breaks a
                           promise; amber = work outstanding; neutral = a
                           settled fact worth seeing (an assigned buddy). */
                        className={`mr-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          f.tone === 'amber'
                            ? 'bg-amber-100 text-amber-800'
                            : f.tone === 'neutral'
                              ? 'bg-neutral-100 text-neutral-600'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {f.t}
                      </span>
                    ))}
                  </span>
                )}
              </p>
              </div>
            </div>
            <button
              onClick={() => toggle(r)}
              disabled={pendingId === r.id}
              className={
                r.checkedInAt
                  ? 'rounded-lg bg-green-100 text-green-800 px-4 py-2.5 font-semibold border border-green-300'
                  : 'btn-primary py-2.5!'
              }
            >
              {/* Time AND date (25 Aug). A camp week runs several days and
                  people arrive across them — "Arrived ✓ 4:12 PM" on the
                  Thursday of a Monday-to-Friday week does not say which day,
                  and that is exactly the question asked when someone is
                  looking for a person. The date is smaller because the time is
                  what is usually wanted; the day is what is occasionally
                  needed. */}
              {pendingId === r.id ? (
                '…'
              ) : r.checkedInAt ? (
                <span className="flex flex-col items-center leading-tight">
                  <span>
                    Arrived ✓{' '}
                    {new Date(r.checkedInAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="text-xs font-normal opacity-75">
                    {new Date(r.checkedInAt).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </span>
              ) : (
                'Check in'
              )}
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-center text-neutral-500">No matches.</li>
        )}
      </ul>

      {qr && <QrOverlay qr={qr} onClose={() => setQr(null)} />}
    </div>
  );
}

// Full-screen so the code is big enough to scan from a phone held at arm's
// length. The link is built from THIS site's address, so the preview's QR
// opens the preview and the live site's opens the live site.
function QrOverlay({ qr, onClose }) {
  const url = `${window.location.origin}${qr.path}`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={qr.title}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-3">{qr.title}</h3>
        <div className="flex justify-center">
          <QrCode value={url} size={260} label={`QR code: ${qr.title}`} />
        </div>
        <p className="mt-3 text-sm text-neutral-600">{qr.caption}</p>
        <p className="mt-1 text-xs text-neutral-400 break-all">{url}</p>
        <button type="button" onClick={onClose} className="btn-primary mt-4 w-full">
          Done
        </button>
      </div>
    </div>
  );
}
