'use client';

// Upload the outside provider's confirmation for one person and one activity
// (14 Oct 2026: "do not accept word of mouth"). A screenshot, a photo of the
// signed form, or the PDF the outfitter emailed -- JPG, PNG or PDF, up to
// 8 MB. One file per person per activity; uploading again replaces it.
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
      const { data: userData } = await supabase.auth.getUser();
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
      setDone({ storage_path: path, uploaded_at: row.uploaded_at });
      setSizeNote(check?.message ?? '');
      router.refresh();
    } catch (err) {
      setError(`That could not be saved: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 ml-7 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
      {done ? (
        <p className="text-green-800">
          <span className="font-semibold">Confirmation received</span> — uploaded{' '}
          {done.uploaded_at ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(done.uploaded_at)) : ''}. Staff can see it.{' '}
          <label className="cursor-pointer underline">
            Replace
            <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden" onChange={onPick} disabled={busy} />
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
            <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" className="hidden" onChange={onPick} disabled={busy} />
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
