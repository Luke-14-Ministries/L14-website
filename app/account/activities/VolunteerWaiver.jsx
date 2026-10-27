'use client';

// A volunteer's own copy of the ministry's waiver for one activity (26 Oct
// 2026). Volunteers do not choose activities -- they go where their camper
// goes -- so there is no tick and no place to hold. Signing now only means
// they are ready in case their camper chooses it, the way a volunteer
// uploads an outside provider's form. Signed: who and when. Not yet: the same
// signing box campers get (WaiverSigningBox), behind a button so the card is
// not a wall of agreement text.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { signActivityWaiver } from './actions';
import { WaiverSigningBox } from './ActivityPicker';
import { dayInMorristown } from '@/lib/events';

export default function VolunteerWaiver({ volunteer, activity, signed }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const firstName = volunteer.name.split(' ')[0] || 'the volunteer';

  function sign(signature) {
    setError('');
    start(async () => {
      const res = await signActivityWaiver({
        participantId: volunteer.participantId,
        activityId: activity.id,
        signature,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <p className="text-sm">
        <span className="font-semibold">{activity.name}</span> — {activity.agreement.title}
      </p>
      {signed ? (
        <p className="mt-1 rounded-sm border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Signed {dayInMorristown(signed.signed_at)} by {signed.signer_name}.
        </p>
      ) : open ? (
        <WaiverSigningBox
          person={volunteer}
          activity={activity}
          agreement={activity.agreement}
          intro={`If ${firstName}'s camper chooses ${activity.name}, ${firstName} goes too, so this waiver is signed for ${firstName} ahead of time.`}
          pending={pending}
          onSign={sign}
          onCancel={() => setOpen(false)}
          setError={setError}
        />
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>Not signed yet.</span>
          <button type="button" className="btn-outline py-1! text-xs" onClick={() => setOpen(true)}>
            Read and sign the waiver
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
    </div>
  );
}
