'use client';

// Identification photo for one person, with a framing step.
//
// Flow: choose a file -> frame it (drag to position, slider to zoom, live
// square preview) -> save. The framing step replaced a blind centre-crop
// after testing (24 Aug) asked for a way to fix a photo where the face
// wasn't in the middle.
//
// Everything happens IN THE BROWSER before upload. A phone camera produces a
// 4000-pixel, 8MB JPEG; check-in happens on a phone over camp wifi. Every
// photo leaves here as a 512x512 square JPEG, encoded at stepped-down quality
// until it fits ~100KB -- a single fixed-quality pass varies with how busy
// the image is (testing produced a 270KB file from one), so size is now
// enforced, not hoped for.
//
// The bucket is PRIVATE. Reading a photo requires a signed URL minted on the
// server for someone whose row-level security allows it, so a leaked path is
// not a leaked photograph.
//
// The file input carries NO `capture` attribute -- deliberately. capture="user"
// forces Android straight into the camera app with no way to pick an existing
// photo from the gallery (reported 24 Aug). Without it, phones offer both.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { pixelNote } from '@/lib/imageCheck';

// "Is this a touch device that plausibly has a camera in it?" -- asked of the
// browser with matchMedia and read through useSyncExternalStore, because the
// answer lives outside React and does not exist during server rendering. The
// server snapshot is `false` (no camera button in the HTML), the browser's
// real answer replaces it at hydration, and React re-renders if the media
// query ever flips. `pointer: coarse` is the honest question, rather than
// sniffing the user agent, which ages badly. Until 16 September 2026 this was
// a useState set from an effect after mount -- a render and then a correcting
// render, which react-hooks/set-state-in-effect flags.
const COARSE_POINTER = '(pointer: coarse)';
function subscribeCoarsePointer(callback) {
  try {
    const mq = window.matchMedia(COARSE_POINTER);
    mq.addEventListener('change', callback);
    return () => mq.removeEventListener('change', callback);
  } catch {
    return () => {};
  }
}
function readCoarsePointer() {
  try {
    return window.matchMedia(COARSE_POINTER).matches;
  } catch {
    return false;
  }
}

const SIZE = 512;
const PREVIEW = 280;
const TARGET_BYTES = 100 * 1024;
const QUALITY_STEPS = [0.8, 0.65, 0.5, 0.35];

function encode(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image.'))),
      'image/jpeg',
      quality
    );
  });
}

// Draw the framed region of the bitmap into a square canvas of `out` pixels.
// `zoom` >= 1 scales up from "cover"; offsets are fractions (0..1) of the
// pannable range, so the same numbers describe the preview and the export.
function drawFramed(ctx, bitmap, out, zoom, fx, fy) {
  const cover = out / Math.min(bitmap.width, bitmap.height);
  const s = cover * zoom;
  const w = bitmap.width * s;
  const h = bitmap.height * s;
  const dx = -(w - out) * fx;
  const dy = -(h - out) * fy;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, out, out);
  ctx.drawImage(bitmap, dx, dy, w, h);
}

export default function PhotoUpload({ personId, personName, initialUrl = null, onUploaded }) {
  const supabase = createClient();
  const fileRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const dragRef = useRef(null); // { startX, startY, fx, fy }

  const [preview, setPreview] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // "This photo is quite small..." -- shown in the framing step, before the
  // person presses "Use this photo" (lib/imageCheck.js). Advice only: the
  // photo can still be used. No byte limit is checked here, because the
  // chosen file is never sent -- only the 512px square made from it.
  const [sizeNote, setSizeNote] = useState('');
  // Whether to offer a camera button at all. See subscribeCoarsePointer at
  // the top of the file for how this is decided without a flash.
  const isTouchDevice = useSyncExternalStore(
    subscribeCoarsePointer,
    readCoarsePointer,
    () => false
  );

  // The framing session, null when not framing.
  const [framing, setFraming] = useState(null); // { bitmap }
  const [zoom, setZoom] = useState(1);
  const [fx, setFx] = useState(0.5);
  const [fy, setFy] = useState(0.5);

  const objectUrl = useRef(null);
  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  // Redraw the live preview whenever the frame moves.
  useEffect(() => {
    if (!framing || !previewCanvasRef.current) return;
    const ctx = previewCanvasRef.current.getContext('2d');
    drawFramed(ctx, framing.bitmap, PREVIEW, zoom, fx, fy);
  }, [framing, zoom, fx, fy]);

  // A computer's webcam (Lawrence, 4 Nov 2026). Phones keep "Take a photo"
  // (the camera app, through the file input); a computer gets a live preview
  // here and the frame it takes goes into the same framing step as a file.
  // The stream is stopped the moment it is not needed.
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [webcam, setWebcam] = useState(false);
  function stopWebcam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setWebcam(false);
  }
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  async function startWebcam() {
    setError('');
    setNote('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use a camera here. Choose a file instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setWebcam(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'The camera was not allowed. Allow it in your browser’s address bar, or choose a file instead.'
          : 'No camera could be opened. Choose a file instead.'
      );
    }
  }
  async function snapWebcam() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    try {
      const bitmap = await createImageBitmap(c);
      stopWebcam();
      setSizeNote(pixelNote(bitmap.width, bitmap.height, 'photo') ?? '');
      setZoom(1);
      setFx(0.5);
      setFy(0.5);
      setFraming({ bitmap });
    } catch {
      setError('The photo could not be taken. Please try again, or choose a file.');
    }
  }

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setNote('');
    try {
      if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
      const bitmap = await createImageBitmap(file);
      setSizeNote(pixelNote(bitmap.width, bitmap.height, 'photo') ?? '');
      setZoom(1);
      setFx(0.5);
      setFy(0.5);
      setFraming({ bitmap });
    } catch (err) {
      setError(err.message || 'Could not read that image.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Drag to pan. Fractions move with the pointer, scaled to the pannable
  // range at the current zoom so the image tracks the finger 1:1.
  function panStart(e) {
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    dragRef.current = { startX: pt.clientX, startY: pt.clientY, fx, fy };
  }
  function panMove(e) {
    if (!dragRef.current || !framing) return;
    const pt = e.touches ? e.touches[0] : e;
    const { bitmap } = framing;
    const cover = PREVIEW / Math.min(bitmap.width, bitmap.height);
    const s = cover * zoom;
    const rangeX = Math.max(1, bitmap.width * s - PREVIEW);
    const rangeY = Math.max(1, bitmap.height * s - PREVIEW);
    const clamp = (v) => Math.min(1, Math.max(0, v));
    setFx(clamp(dragRef.current.fx - (pt.clientX - dragRef.current.startX) / rangeX));
    setFy(clamp(dragRef.current.fy - (pt.clientY - dragRef.current.startY) / rangeY));
  }
  function panEnd() {
    dragRef.current = null;
  }

  function cancelFraming() {
    framing?.bitmap?.close?.();
    setFraming(null);
    setSizeNote('');
  }

  async function saveFramed() {
    if (!framing) return;
    setBusy(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      drawFramed(canvas.getContext('2d'), framing.bitmap, SIZE, zoom, fx, fy);

      let blob = null;
      for (const q of QUALITY_STEPS) {
        blob = await encode(canvas, q);
        if (blob.size <= TARGET_BYTES) break;
      }

      // One object per person, overwritten on replacement, so repeated
      // uploads leave no orphans in the bucket.
      const path = `${personId}/photo.jpg`;
      const { error: upErr } = await supabase.storage
        .from('person-photos')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      if (upErr) throw new Error(upErr.message);

      const { error: rowErr } = await supabase
        .from('person_photos')
        .upsert(
          { person_id: personId, storage_path: path, uploaded_at: new Date().toISOString() },
          { onConflict: 'person_id' }
        );
      if (rowErr) throw new Error(rowErr.message);

      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(blob);
      setPreview(objectUrl.current);
      setNote(`Saved — ${Math.round(blob.size / 1024)}KB.`);
      cancelFraming();
      // Tell the parent (the details form uses this to stop urging for a
      // photo once one exists).
      onUploaded?.();
    } catch (err) {
      setError(err.message || 'Could not upload that photo.');
    } finally {
      setBusy(false);
    }
  }

  if (framing) {
    return (
      <div>
        <p className="font-semibold text-sm mb-2">
          Frame {personName || 'the'} photo — drag to position, slide to zoom.
        </p>
        <div
          className="relative inline-block touch-none cursor-move rounded-lg overflow-hidden border border-neutral-300"
          onMouseDown={panStart}
          onMouseMove={panMove}
          onMouseUp={panEnd}
          onMouseLeave={panEnd}
          onTouchStart={panStart}
          onTouchMove={panMove}
          onTouchEnd={panEnd}
        >
          <canvas ref={previewCanvasRef} width={PREVIEW} height={PREVIEW} className="block" />
          {/* A circle guide, because the photo renders as a round avatar. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.25)]"
          />
        </div>
        <div className="mt-3 flex items-center gap-3 max-w-[280px]">
          <span className="text-xs text-neutral-500">Zoom</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
          />
        </div>
        {sizeNote && (
          <p role="status" className="mt-2 max-w-sm text-xs text-amber-800">
            {sizeNote}
          </p>
        )}
        <div className="mt-3 flex gap-3">
          <button type="button" onClick={saveFramed} disabled={busy} className="btn-primary py-1.5! text-sm">
            {busy ? 'Saving…' : 'Use this photo'}
          </button>
          <button type="button" onClick={cancelFraming} disabled={busy} className="btn-outline py-1.5! text-sm">
            Cancel
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-neutral-300 bg-neutral-100">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={`${personName || 'Person'}'s photo`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400 text-center px-2">
            No photo yet
          </div>
        )}
      </div>
      <div className="min-w-0">
        {/* TWO inputs, not one -- and this is the second time this control has
            been wrong in opposite directions.
            
            First it carried capture="user", which forced Android straight into
            the camera with no way to reach the gallery. Removing it was
            supposed to let the phone offer both; on a Samsung in Edge it
            offers only files, so the camera became unreachable instead
            (reported 25 Aug). Relying on the browser to present a choice is
            evidently not portable.
            
            So the choice is ours to present: one input with `capture` for the
            camera, one without it for the gallery. Both are plain <input
            type="file"> and behave the same everywhere. On desktop the camera
            button is simply not shown -- `capture` there opens a file dialog
            anyway, which would be two buttons doing one thing. */}
        <div className="flex flex-wrap gap-2">
          <label className="btn-outline py-1.5! text-sm cursor-pointer inline-block">
            {preview ? 'Choose a different file' : 'Choose a file'}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={onPick}
            />
          </label>
          {isTouchDevice ? (
            <label className="btn-outline py-1.5! text-sm cursor-pointer inline-block">
              Take a photo
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="sr-only"
                disabled={busy}
                onChange={onPick}
              />
            </label>
          ) : (
            !webcam && (
              <button type="button" onClick={startWebcam} disabled={busy} className="btn-outline py-1.5! text-sm">
                Use webcam
              </button>
            )
          )}
        </div>
        {webcam && (
          <div className="mt-3 max-w-sm rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            {/* Mirrored, as a selfie view is; the photo taken is not. */}
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full rounded-sm bg-black"
              style={{ transform: 'scaleX(-1)' }}
            />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={snapWebcam} className="btn-primary py-1.5! text-sm">
                Take photo
              </button>
              <button type="button" onClick={stopWebcam} className="text-sm text-neutral-600 underline">
                Cancel
              </button>
            </div>
          </div>
        )}
        {/* A website cannot open the phone's full camera app with its
            modes (Lawrence, 4 Nov 2026), so the way to a portrait-mode photo
            is said here. */}
        {isTouchDevice && (
          <p className="mt-2 text-xs text-neutral-600 max-w-sm">
            For a portrait-mode photo, take it in your Camera app first, then choose it here.
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500 max-w-sm">
          A clear photo of {personName || 'this person'}&rsquo;s face helps staff greet them by
          name at check-in. You&rsquo;ll get to frame it after choosing, and it is resized on
          your device before it is sent. Camp staff can see it; it is never published and never
          leaves the ministry.
        </p>
        {note && <p className="mt-1 text-xs text-green-700 font-semibold">{note}</p>}
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
