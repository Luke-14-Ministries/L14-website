'use client';

// One person's activity choices for one event.
//
// The three booking modes are not decoration -- they are three different
// things the ministry runs, and each is asked differently:
//
//   interest    "would you like to?" Nothing is held, so the control is a
//               plain tick and capacity is never mentioned.
//   signup      a real place. Capacity is shown honestly, including when it
//               has run out, and the server refuses an oversell even if this
//               page is stale.
//   appointment a specific slot. Treated as signup here until slots are
//               actually scheduled (activity_slots is seeded per event).
//
// SITTINGS (0052). A sign-up activity may run in sittings -- the pontoon goes
// out four times on the Tuesday. Where it does, the tick is not enough: the
// database refuses a signup with no time, because a place nobody can roster is
// not a place. So ticking reveals the times, and choosing one is what saves.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setActivityChoice } from './actions';
import WaiverUpload from './WaiverUpload';
import { dayInMorristown } from '@/lib/events';

function Availability({ activity }) {
  if (activity.booking_mode === 'interest' || activity.capacity == null) return null;
  if (activity.placesLeft === 0) {
    return <span className="text-sm font-semibold text-amber-700">Full</span>;
  }
  return (
    <span className="text-sm text-neutral-500">
      {activity.placesLeft} of {activity.capacity} left
    </span>
  );
}

function ActivityRow({ person, activity }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  const existing = person.choices[activity.id] ?? null;
  const isOn = existing?.status === 'interested' || existing?.status === 'signed_up';
  const slots = activity.slots ?? [];
  const hasSlots = slots.length > 0;
  const [slotId, setSlotId] = useState(existing?.slot_id ?? '');
  // True between ticking an activity that runs in sittings and choosing a
  // time. Until 14 Oct 2026 the tick set nothing visible, so the box stayed
  // unticked and the times never appeared -- "clicking it seemed to do
  // nothing" (Lawrence, on the Salon).
  const [choosing, setChoosing] = useState(false);
  const chosenSlot = slots.find((sl) => sl.id === (existing?.slot_id ?? slotId)) ?? null;
  const needsProvider = Boolean(activity.provider_url || activity.provider_name);
  const [ack, setAck] = useState(Boolean(existing?.waiver_acknowledged_at));

  // THE WAIVER (0116). An activity may carry an agreement of the ministry's
  // own -- horseback riding does -- and the rider is signed for before the
  // place is taken, on this page, the way the wizard takes the others. Once
  // signed it stays signed: cancelling the signup does not unsign anything,
  // and ticking again later asks for nothing.
  const agreement = activity.agreement ?? null;
  const signed = agreement ? person.signed?.[agreement.id] ?? null : null;
  const needsSignature = Boolean(agreement) && !signed;
  const [signing, setSigning] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signerName, setSignerName] = useState('');
  // A minor is always signed for by a parent or guardian; an adult may sign
  // for themselves, or another adult may with the rider's permission.
  const roleOptions = person.adult
    ? [
        ['self', 'I am the rider'],
        ['parent_guardian', "I am the rider's parent or legal guardian"],
        ['authorized_adult', 'I am an adult authorised to sign for this adult'],
      ]
    : [['parent_guardian', "I am the rider's parent or legal guardian"]];
  const [signerRole, setSignerRole] = useState(roleOptions.length === 1 ? roleOptions[0][0] : '');
  const [affirmed, setAffirmed] = useState(false);
  const firstName = person.name.split(' ')[0] || 'the rider';

  const wantStatus = activity.booking_mode === 'interest' ? 'interested' : 'signed_up';
  const full = activity.placesLeft === 0 && !isOn;

  function toggle(next, nextSlot = slotId, signature = null) {
    setError('');
    // Ticking an activity that runs in sittings does not book anything yet --
    // it opens the times. Saving without one would be refused by the database
    // anyway; asking first is kinder than bouncing them.
    if (next && hasSlots && !nextSlot) {
      setSlotId('');
      setError('');
      setChoosing(true);
      return;
    }
    // Likewise a waiver: the tick opens it, and the Save button under it is
    // what saves the signup -- together with the signature, never without.
    if (next && needsSignature && !signature) {
      setSigning(true);
      return;
    }
    if (!next) {
      setChoosing(false);
      setSigning(false);
      // Unticking something that was never saved has nothing to cancel.
      if (!isOn) return;
    }
    start(async () => {
      const res = await setActivityChoice({
        participantId: person.participantId,
        activityId: activity.id,
        status: next ? wantStatus : 'cancelled',
        acknowledgeWaiver: ack,
        slotId: next ? nextSlot : null,
        signature,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSigning(false);
      router.refresh();
    });
  }

  // The checks the server makes too, asked here first so the family is told
  // in words before anything is sent.
  function sign() {
    const name = signerName.trim();
    if (!agreed) {
      setError('Please tick to confirm you have read the agreement and agree to it.');
      return;
    }
    if (name.length < 2 || name.length > 120) {
      setError('Please type the full name of the person signing.');
      return;
    }
    if (!signerRole) {
      setError('Please say who is signing.');
      return;
    }
    if (signerRole === 'authorized_adult' && !affirmed) {
      setError(`Please confirm that ${firstName} has given you permission to sign on their behalf.`);
      return;
    }
    toggle(true, slotId, {
      agreementId: agreement.id,
      signerName: name,
      signerRole,
      agreed: true,
      affirmed: signerRole === 'authorized_adult' ? affirmed : false,
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex flex-1 min-w-0 items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isOn || choosing || signing}
            disabled={pending || full}
            onChange={(e) => toggle(e.target.checked)}
            className="mt-1 shrink-0"
          />
          <span className="min-w-0">
            <span className="font-semibold">{activity.name}</span>
            {activity.description && (
              <span className="block text-sm text-neutral-600">{activity.description}</span>
            )}
            {needsProvider && (
              <span className="mt-1 block text-sm text-amber-800">
                Run by {activity.provider_name || 'an outside provider'} — their own form
                has to be completed with them, not here.
                {activity.provider_url && (
                  <>
                    {' '}
                    <a
                      href={activity.provider_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-semibold"
                    >
                      Open their page ↗
                    </a>
                  </>
                )}
              </span>
            )}
          </span>
        </label>
        <span className="shrink-0 pt-1">
          {pending ? (
            <span className="text-sm text-neutral-400">saving…</span>
          ) : (
            <Availability activity={activity} />
          )}
        </span>
      </div>

      {/* The times. Shown once the activity is ticked (or already booked),
          because until then there is nothing to put a time on. Each says how
          many places are left, the way the activity itself does. */}
      {hasSlots && (isOn || choosing || slotId !== '' || error) && (
        <fieldset className="mt-2 ml-7">
          <legend className="text-sm font-semibold">
            {isOn ? 'Time' : 'Choose a time — the tick takes effect once a time is picked'}
          </legend>
          <div className="mt-1 space-y-1">
            {slots.map((sl) => {
              const left = sl.capacity == null ? null : Math.max(0, sl.capacity - (sl.taken ?? 0));
              const mine = existing?.slot_id === sl.id;
              const soldOut = left === 0 && !mine;
              return (
                <label
                  key={sl.id}
                  className={`flex items-center gap-2 rounded-sm border px-3 py-1.5 text-sm ${
                    mine ? 'border-brand bg-brand-light font-semibold' : 'border-neutral-200'
                  } ${soldOut ? 'opacity-60' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name={`slot-${person.participantId}-${activity.id}`}
                    checked={mine || slotId === sl.id}
                    disabled={pending || soldOut}
                    onChange={() => {
                      setSlotId(sl.id);
                      toggle(true, sl.id);
                    }}
                  />
                  <span>{sl.label_text}</span>
                  <span className="ml-auto text-xs text-neutral-500">
                    {left == null ? '' : soldOut ? 'full' : `${left} left`}
                  </span>
                </label>
              );
            })}
          </div>
          {chosenSlot && isOn && (
            <p className="mt-1 text-xs text-neutral-500">
              Booked on {chosenSlot.label_text}. Pick another to move.
            </p>
          )}
        </fieldset>
      )}

      {/* The waiver, opened by the tick and closed by Save or Cancel. The
          text is the agreement as stored, with the event's name filled in;
          what is signed is that version, by row id, so a later rewording
          never changes what this family agreed to. */}
      {needsSignature && signing && !isOn && (
        <div className="mt-3 ml-7 rounded-sm border border-neutral-300 bg-neutral-50 p-4">
          <p className="font-semibold">{agreement.title}</p>
          <p className="mt-1 text-xs text-neutral-600">
            {activity.name} needs this waiver signed for {firstName} before the place is
            saved. Version {agreement.version}.
          </p>
          <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-line rounded-sm border border-neutral-200 bg-white p-3 text-sm text-neutral-800">
            {agreement.body}
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={agreed}
              disabled={pending}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>I have read this agreement and agree to it.</span>
          </label>
          <div className="mt-3 sm:max-w-sm">
            <label className="block text-sm font-semibold" htmlFor={`signer-${person.participantId}-${activity.id}`}>
              Signed by (full name)
            </label>
            <input
              id={`signer-${person.participantId}-${activity.id}`}
              className="mt-1 w-full rounded-sm border border-neutral-300 px-3 py-2 font-serif italic text-lg"
              value={signerName}
              disabled={pending}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Your full name"
              autoComplete="name"
              maxLength={120}
            />
          </div>
          <fieldset className="mt-3">
            <legend className="text-sm font-semibold">Who is signing</legend>
            <div className="mt-1 space-y-1 text-sm">
              {roleOptions.map(([value, text]) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`signer-role-${person.participantId}-${activity.id}`}
                    value={value}
                    checked={signerRole === value}
                    disabled={pending}
                    onChange={() => setSignerRole(value)}
                  />
                  <span>{text}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {signerRole === 'authorized_adult' && (
            <label className="mt-3 flex items-start gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={affirmed}
                disabled={pending}
                onChange={(e) => setAffirmed(e.target.checked)}
              />
              <span>
                I confirm that {firstName} has given me permission to sign this agreement on
                their behalf.
              </span>
            </label>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary py-2! text-sm" disabled={pending} onClick={sign}>
              Save
            </button>
            <button
              type="button"
              className="btn-outline py-2! text-sm"
              disabled={pending}
              onClick={() => toggle(false)}
            >
              Cancel
            </button>
            <span className="text-xs text-neutral-600">
              Dated{' '}
              {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>
      )}

      {signed && (
        <p className="mt-1 ml-7 text-xs text-neutral-500">
          Waiver signed by {signed.signer_name} on {dayInMorristown(signed.signed_at)}.
        </p>
      )}

      {/* The acknowledgement, shown only where it applies and only while it
          still needs giving. It records that we TOLD them -- never that a
          waiver was signed, which is not ours to assert. */}
      {needsProvider && !isOn && (
        <label className="mt-2 ml-7 flex items-start gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I understand {activity.provider_name || 'the provider'} has their own form to
            complete, and that the ministry cannot complete it for us. Staff will send us
            what we need.
          </span>
        </label>
      )}

      {/* The proof, not the promise (14 Oct 2026): once signed up for a
          provider-run activity, the family uploads the provider's own
          confirmation. Staff see who has one. */}
      {needsProvider && isOn && (
        <WaiverUpload
          participantId={person.participantId}
          activityId={activity.id}
          providerName={activity.provider_name}
          existing={person.waivers?.[activity.id] ?? null}
        />
      )}

      {needsProvider && isOn && existing?.waiver_acknowledged_at && (
        <p className="mt-1 ml-7 text-xs text-neutral-500">
          You confirmed you understand their form is yours to complete, on{' '}
          {dayInMorristown(existing.waiver_acknowledged_at)}.
        </p>
      )}

      {full && (
        <p className="mt-1 ml-7 text-sm text-amber-800">
          Full at the moment — <span className="font-semibold">please ask anyway</span>.
          Email info@luke14ministries.net and staff will look at whether the numbers can
          stretch.
        </p>
      )}

      {error && <p className="mt-1 ml-7 text-sm text-red-700">{error}</p>}
    </li>
  );
}

export default function ActivityPicker({ person, activities }) {
  const chosenCount = activities.filter((a) => {
    const c = person.choices[a.id];
    return c && (c.status === 'interested' || c.status === 'signed_up');
  }).length;

  return (
    <div className="rounded-lg bg-white border border-neutral-200 shadow-xs p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="text-lg font-bold">{person.name}</h3>
        <span className="text-sm text-neutral-500">
          {chosenCount === 0
            ? 'nothing chosen yet'
            : `${chosenCount} ${chosenCount === 1 ? 'activity' : 'activities'} chosen`}
        </span>
      </div>
      <ul className="divide-y divide-neutral-100">
        {activities.map((a) => (
          <ActivityRow key={a.id} person={person} activity={a} />
        ))}
      </ul>
    </div>
  );
}
