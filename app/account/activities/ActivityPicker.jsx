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
import { setActivityChoice, signActivityWaiver } from './actions';
import WaiverUpload from './WaiverUpload';
import { dayInMorristown } from '@/lib/events';

// The signing box: the waiver's text, the agreed tick, Signed by, and who is
// signing -- the wizard's rules, which the server checks again. Used for a
// new signup (the tick opens it; Save saves the place WITH the signature) and,
// since 22 Oct 2026, for a place already held when staff attached the waiver
// afterwards (Save writes the signature only). Module level, not inside
// ActivityRow (CLAUDE.md: a component defined in another's body remounts
// every render and loses what was typed). Exported for a volunteer's own
// waiver (VolunteerWaiver.jsx, 26 Oct 2026).
export function WaiverSigningBox({ person, activity, agreement, intro, pending, onSign, onCancel, setError }) {
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
  const key = `${person.participantId}-${activity.id}`;

  // The checks the server makes too, asked here first so the family is told
  // in words before anything is sent.
  function sign() {
    setError('');
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
    onSign({
      agreementId: agreement.id,
      signerName: name,
      signerRole,
      agreed: true,
      affirmed: signerRole === 'authorized_adult' ? affirmed : false,
    });
  }

  return (
    <div className="mt-3 ml-7 rounded-sm border border-neutral-300 bg-neutral-50 p-4">
      <p className="font-semibold">{agreement.title}</p>
      <p className="mt-1 text-xs text-neutral-600">
        {intro} Version {agreement.version}.
      </p>
      {/* A calm word before the statutory notice (Lawrence, 26 Oct 2026:
          "WARNING" alone read as alarm). The notice itself is required by
          Tennessee's equine activity law (TCA 44-20-105) and stays verbatim
          in the agreement; this line only frames it. */}
      {/^\s*WARNING\b/.test(agreement.body ?? '') && (
        <p className="mt-2 text-sm text-neutral-600">
          A notice Tennessee law asks us to include in every horseback agreement — please read
          it, then the waiver below.
        </p>
      )}
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
        <label className="block text-sm font-semibold" htmlFor={`signer-${key}`}>
          Signed by (full name)
        </label>
        <input
          id={`signer-${key}`}
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
                name={`signer-role-${key}`}
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
          {pending ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn-outline py-2! text-sm"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        <span className="text-xs text-neutral-600">
          Dated{' '}
          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
    </div>
  );
}

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
  const firstName = person.name.split(' ')[0] || 'the rider';
  // A place ALREADY held that still needs its waiver (0120's view): staff
  // attached our waiver, or named an outside provider, after the signup.
  // The tick that opens the signing box for a new signup never fires for a
  // saved place, so these are asked for here instead.
  const owed = isOn ? person.outstanding?.[activity.id] ?? null : null;
  const owesOurs = Boolean(owed?.ours);
  const owesProvider = Boolean(owed?.provider);

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

  // The waiver alone, for a place already held: the signup is not touched.
  function signForHeldPlace(signature) {
    setError('');
    start(async () => {
      const res = await signActivityWaiver({
        participantId: person.participantId,
        activityId: activity.id,
        signature,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
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
        <WaiverSigningBox
          person={person}
          activity={activity}
          agreement={agreement}
          intro={`${activity.name} needs this waiver signed for ${firstName} before the place is saved.`}
          pending={pending}
          setError={setError}
          onSign={(signature) => toggle(true, slotId, signature)}
          onCancel={() => toggle(false)}
        />
      )}

      {/* A place already held, and the waiver came afterwards (0120). Saving
          signs it and touches nothing else: the place, its time and anything
          acknowledged stay as they are. */}
      {owesOurs && (
        <div className="mt-2 ml-7">
          <p className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            {activity.name} now needs a waiver for {firstName}.
            {!agreement && (
              <span className="font-normal">
                {' '}Camp staff will send it — or email info@luke14ministries.net.
              </span>
            )}
          </p>
          {agreement && (
            <WaiverSigningBox
              person={person}
              activity={activity}
              agreement={agreement}
              intro={`${firstName}'s place on ${activity.name} stays as it is — signing here is all that is needed.`}
              pending={pending}
              setError={setError}
              onSign={signForHeldPlace}
            />
          )}
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
      {/* The same amber line as a waiver of our own (0120), above the upload
          box, while the provider's confirmation is still missing. A REJECTED
          upload (0124) is outstanding too, but the upload box says why itself. */}
      {owesProvider && needsProvider && person.waivers?.[activity.id]?.review_status !== 'rejected' && (
        <p className="mt-2 ml-7 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          {activity.name} now needs a waiver for {firstName}
          <span className="font-normal">
            {' '}— complete {activity.provider_name || 'the provider'}&rsquo;s form, then upload their
            confirmation below.
          </span>
        </p>
      )}
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
    // The anchor the dashboard's "waiver still needed" lines link to.
    <div
      id={`person-${person.participantId}`}
      className="scroll-mt-6 rounded-lg bg-white border border-neutral-200 shadow-xs p-6"
    >
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
