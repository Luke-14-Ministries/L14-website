'use client';

// Upload the outside provider's confirmation for one person and one activity
// (14 Oct 2026: "do not accept word of mouth"). A screenshot, a photo of the
// signed form, or the PDF the outfitter emailed -- JPG, PNG or PDF, up to
// 8 MB. One file per person per activity; uploading again replaces it.
//
// Camp staff then look at it (0124): until they do it is "awaiting check";
// they accept it, or reject it with a reason (wrong file, can't read it...),
// and then the family is asked to upload again -- the box opens to replace it,
// and the new file goes back to awaiting check by itself (the database resets
// the review whenever the file changes).
//
// The file goes straight to the private waiver-confirmations bucket from the
// browser, under <participant>/<activity>.<ext>, and a row in
// activity_waiver_uploads records it. Both are gated by row-level security
// to the family's own registrations (0087), so there is nothing a server
// action would add here except a second place to get the check wrong.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BUCKET_LIMIT_BYTES, checkImageFile } from '@/lib/imageCheck';
import { dayInMorristown } from '@/lib/events';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

export default function WaiverUpload({ participantId, activityId, providerName, existing = null }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(existing);
  // A picture too small to read (lib/imageCheck.js). The upload starts on
  // choosing, so this shows AFTER it, with the file kept -- a warning, not a
  // refusal. Only a file over the bucket's limit is refused, before upload.
  const [sizeNote, setSizeNote] = useState('');

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setSizeNote('');
    const ext = EXT[file.type];
    if (!ext) {
      setError('Please choose a JPG, PNG or PDF.');
      return;
    }
    setBusy(true);
    const check = await checkImageFile(file, {
      kind: 'document',
      maxBytes: BUCKET_LIMIT_BYTES['waiver-confirmations'],
    });
    if (check?.refuse) {
      setError(`${check.message} A screenshot or a photo of the page is plenty.`);
      setBusy(false);
      return;
    }
    try {
      const path = `${participantId}/${activityId}.${ext}`;
      // Replace any earlier upload with a different extension, so one person
      // never has two files for one activity.
      for (const old of Object.values(EXT)) {
        if (old !== ext) await supabase.storage.from('waiver-confirmations').remove([`${participantId}/${activityId}.${old}`]);
      }
      const { error: upErr } = await supabase.storage
        .from('waiver-confirmations')
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
      if (upErr) throw new Error(upErr.message);
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw new Error(userErr.message);
      const row = {
        activity_id: activityId,
        registration_participant_id: participantId,
        storage_path: path,
        content_type: file.type,
        uploaded_at: new Date().toISOString(),
        uploaded_by: userData?.user?.id ?? null,
      };
      const { error: rowErr } = await supabase
        .from('activity_waiver_uploads')
        .upsert(row, { onConflict: 'activity_id,registration_participant_id' });
      if (rowErr) throw new Error(rowErr.message);
      // A new file is awaiting check again, whatever the last one's review.
      setDone({ storage_path: path, uploaded_at: row.uploaded_at, review_status: 'pending', review_note: null });
      setSizeNote(check?.message ?? '');
      router.refresh();
    } catch (err) {
      setError(`That could not be saved: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const status = done?.review_status ?? 'pending';
  const fileInput = (
    <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden" onChange={onPick} disabled={busy} />
  );
  const tone = !done || status === 'rejected'
    ? 'border-amber-200 bg-amber-50'
    : status === 'accepted'
      ? 'border-green-200 bg-green-50'
      : 'border-blue-200 bg-blue-50';

  return (
    <div className={`mt-2 ml-7 rounded-sm border px-3 py-2 text-sm ${tone}`}>
      {done && status === 'accepted' ? (
        <p className="text-green-800">
          <span className="font-semibold">Accepted by camp staff ✓</span>{' '}
          <label className="cursor-pointer text-xs text-neutral-600 underline">
            Replace
            {fileInput}
          </label>
        </p>
      ) : done && status === 'rejected' ? (
        <p className="text-amber-900">
          <span className="font-semibold">
            Camp staff couldn&rsquo;t accept this: {done.review_note || 'no reason given'}.
          </span>{' '}
          Please upload the confirmation again — a screenshot, a photo of the signed page, or the
          PDF {providerName || 'the provider'} sent.{' '}
          <label className="btn-outline py-1! px-2! cursor-pointer text-xs">
            {busy ? 'Uploading…' : 'Choose file'}
            {fileInput}
          </label>
        </p>
      ) : done ? (
        <p className="text-blue-900">
          <span className="font-semibold">Uploaded {dayInMorristown(done.uploaded_at)}</span> — camp
          staff will check it.{' '}
          <label className="cursor-pointer underline">
            Replace
            {fileInput}
          </label>
        </p>
      ) : (
        <p className="text-amber-900">
          <span className="font-semibold">
            Once you have completed the form for {providerName || 'the provider'}, upload their confirmation
          </span>{' '}
          — a screenshot, a photo of the signed page, or the PDF they sent. Staff need this before
          the day; a verbal &ldquo;done&rdquo; is not enough.{' '}
          <label className="btn-outline py-1! px-2! cursor-pointer text-xs">
            {busy ? 'Uploading…' : 'Choose file'}
            {fileInput}
          </label>
        </p>
      )}
      {sizeNote && (
        <p role="status" className="mt-1 text-amber-800">
          {sizeNote}
        </p>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
