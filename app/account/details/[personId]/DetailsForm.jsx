'use client';

// The support profile on the dashboard: the photo, then the same questions
// the registration wizard asks (components/SupportDetailsFields.jsx), with a
// save button of its own.
//
// Since 16 October 2026 a camper's details are REQUIRED before the wizard
// submits, so for most families this page is where details are edited and
// where the photo is added, not where they are first written. It still has to
// work as a first write: a person added to a household outside registration,
// or a row from before that date, arrives here empty.

import { useState } from 'react';
import Link from 'next/link';
import PhotoUpload from '@/components/PhotoUpload';
import SaveButton from '@/components/SaveButton';
import SupportDetailsFields from '@/components/SupportDetailsFields';
import { emptySupport, hasFullerDetail, supportProblems } from '@/lib/support';
import { savePersonSupport } from './actions';

function Card({ n, title, subtitle, children }) {
  return (
    <section className="rounded-lg border border-neutral-200 shadow-xs bg-white p-6 sm:p-8">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white text-sm font-bold">
          {n}
        </span>
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {subtitle && <p className="text-sm text-neutral-600 mb-4 ml-10">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

export default function DetailsForm({
  person,
  support,
  photoUrl = null,
  backHref = '/account/dashboard/',
  isCamper = true,
  roles = [],
}) {
  const [f, setFState] = useState(() => emptySupport(support));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  // Whether a photo exists for this person -- seeded from the server, flipped
  // by PhotoUpload's onUploaded. Drives the strong urging in save().
  const [hasPhoto, setHasPhoto] = useState(Boolean(photoUrl));

  // HOW MUCH TO ASK. Decided 25 Aug: asking a parent/guardian and a
  // four-year-old sibling for a full seizure plan reads as absurd, gets
  // skipped, and teaches families that this form is noise. Campers get the
  // full profile; everyone else gets allergies, diet and an emergency contact,
  // and can open the rest. Anyone who ALREADY has detail saved in the fuller
  // sections sees them open, whatever their role.
  const [showAll, setShowAll] = useState(isCamper || hasFullerDetail(emptySupport(support)));

  // Any edit flips the button back from "Saved" to "Save".
  const setF = (updater) => {
    setSaved(false);
    setFState(updater);
  };

  const name = person?.preferred_name || person?.first_name || 'this person';
  const roleNote = roles.length
    ? roles.includes('camper')
      ? 'Registered as a camper, so the full form is required.'
      : 'Not registered as a camper, so this is the short version.'
    : null;

  async function save() {
    // What a camper must answer, and the detail behind any "yes", is the same
    // rule the wizard applies (lib/support.js).
    const missing = supportProblems(f, { isCamper });
    if (missing.length > 0) {
      setError(
        `Please fill in: ${missing.join('; ')}. "None" or "N/A" is a fine answer — staff read every one.`
      );
      return;
    }
    // The photo is REQUIRED policy (Larry, 24 Aug) -- enforced as a strong,
    // explained urging rather than a hard block: a determined person can
    // upload any nonsense picture, so a hard wall buys no real verification
    // and costs the family that genuinely has no good photo to hand tonight.
    if (!hasPhoto) {
      const ok = window.confirm(
        `Save without a photo of ${name}?\n\n` +
          `A photo is required for camp: staff use it to greet ${name} by name at ` +
          `check-in and to confirm the right person is with the right family. ` +
          `Any clear photo of their face works, straight from your phone.\n\n` +
          `Press Cancel to add one now (it takes about a minute), or OK to save ` +
          `and add it another day.`
      );
      if (!ok) return;
    }
    // For everyone who is not a camper the emergency contact is soft-required:
    // one confirm, then their call. (A camper's is required above.)
    if (
      !isCamper &&
      !(f.emergency_contact_name ?? '').trim() &&
      !(f.emergency_contact_phone ?? '').trim()
    ) {
      const ok = window.confirm(
        `Save without an emergency contact?\n\n` +
          `Camp staff need someone they can reach during the event who is NOT attending it — ` +
          `if there is an accident or someone becomes unwell, this is who gets the call.\n\n` +
          `Press Cancel to add it now; it takes about twenty seconds.`
      );
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await savePersonSupport(person.id, f);
      if (res?.ok) setSaved(true);
      else setError(res?.error || 'Something went wrong. Please try again.');
    } catch {
      setError('Something went wrong saving this form. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card n={1} title={`A photo of ${name}`} subtitle="Required for camp. Any clear photo of their face works, straight from your phone.">
        {/* CampSite blocks registration until a photo is uploaded. Ours is
            also required (Larry, 24 Aug) but enforced as a strong urging at
            save time rather than a wall. */}
        <p className="mb-3 text-sm text-neutral-600">
          Staff use it to greet {name} by name at check-in and to confirm the right person is
          with the right family.
        </p>
        <PhotoUpload
          personId={person.id}
          personName={name}
          initialUrl={photoUrl}
          onUploaded={() => setHasPhoto(true)}
        />
      </Card>

      <Card
        n={2}
        title={`About ${name}`}
        subtitle={
          roleNote ??
          'Answer what you can — a blank tells us as much as a guess, and you can come back and add to this at any time.'
        }
      >
        <SupportDetailsFields
          f={f}
          setF={setF}
          name={name}
          isCamper={isCamper}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
        />
      </Card>

      {error && (
        <p role="alert" className="rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 z-20 -mx-4 sm:mx-0 border-t border-neutral-200 bg-white/95 backdrop-blur-sm px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-neutral-600">
            {isCamper
              ? 'The marked boxes are required for a camper — "N/A" is an answer. Come back and add to it any time.'
              : 'Most of this is optional — fill in whatever applies. The emergency contact is the one we ask of everyone.'}
          </p>
          <div className="flex items-center gap-4">
            <Link
              href={backHref}
              className="text-neutral-500 font-semibold hover:text-neutral-700 hover:underline"
            >
              {saved ? 'Back to dashboard' : 'Cancel'}
            </Link>
            {/* The button carries the state -- Save -> Saving... -> Saved,
                flipping back to Save when anything changes. */}
            <SaveButton
              busy={busy}
              saved={saved}
              onClick={save}
              label="Save details"
              className="py-2!"
            />
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-neutral-500 pb-2">
        Only camp staff who need it can see this — the same small group who handle medical and
        support information. It is never shown on rosters or shared outside the ministry.
      </p>
    </div>
  );
}
