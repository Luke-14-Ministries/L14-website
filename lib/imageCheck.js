// "Is this picture a sensible size?" -- one answer for every upload a person
// makes (Lawrence, 22 Oct 2026, after headshots of 237x237 and 280x320 looked
// poor on the Leadership page). Browser only: it reads the pixel size with
// createImageBitmap, or an <img> where that is missing. No dependency.
//
// What it says, and why it is a NOTE rather than a refusal: a small or huge
// picture still works, it just may look poor or take a while. The one hard
// stop is a file over the bucket's own limit, because Supabase would refuse it
// anyway and a plain sentence beats a storage error.
//
// Nothing is resized here. Person photos are already framed and shrunk to
// 512x512 by components/PhotoUpload.jsx; documents are uploaded as chosen.

// Each bucket's file_size_limit, copied from the migration that created it.
// Change one there (a new migration) and here together.
export const BUCKET_LIMIT_BYTES = {
  'person-photos': 524288, // 0032 -- 512 KB, after PhotoUpload's resize
  'waiver-confirmations': 8388608, // 0087 -- 8 MB, uploaded as chosen
};

// Below this shorter side a picture is "small"; above this longer side it is
// "very large". A person's photo becomes a 512px square, so 400 is where it
// starts to blur; a document has to stay readable, so it needs more.
const SMALL_SHORT_SIDE = { photo: 400, document: 800 };
const LARGE_LONG_SIDE = 6000;

// 8388608 -> "8", 14680064 -> "14", 8.3 MB -> "8.4" (rounded up, so a file
// just over the limit never reads as equal to it).
function megabytes(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return String(Math.ceil(mb));
  const tenths = Math.ceil(mb * 10) / 10;
  return Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1);
}

// The refusal for a file over the limit, or null. Applies to any file,
// a PDF included.
export function overLimitMessage(file, maxBytes) {
  if (!file || !maxBytes || file.size <= maxBytes) return null;
  return `This file is ${megabytes(file.size)} MB; the most we can take is ${megabytes(maxBytes)} MB.`;
}

// The note for a picture of width x height, or null when it is fine.
// kind: 'photo' (a person's photo) or 'document' (a photo of a form).
export function pixelNote(width, height, kind = 'photo') {
  if (!width || !height) return null;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const dims = `${width} × ${height}`;
  if (kind === 'document') {
    if (short < SMALL_SHORT_SIDE.document) {
      return `This picture is small (${dims} pixels) and the writing may be hard to read. Please make sure the names and dates are clear.`;
    }
    if (long > LARGE_LONG_SIDE) {
      return `This picture is very large (${dims}); it will upload, but a smaller copy works just as well.`;
    }
    return null;
  }
  if (short < SMALL_SHORT_SIDE.photo) {
    return `This photo is quite small (${dims} pixels), so it may look blurry. A photo taken on a phone is usually fine — try a closer, clearer one if you have it.`;
  }
  if (long > LARGE_LONG_SIDE) {
    return `This photo is very large (${dims}); it will upload, but a smaller copy works just as well.`;
  }
  return null;
}

// Pixel size of an image File, or null if the browser cannot read it (the
// upload then goes ahead without a note -- the check is advice, not a gate).
export async function readImageSize(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size;
    } catch {
      // fall through to the <img> route
    }
  }
  if (typeof Image !== 'function' || typeof URL === 'undefined') return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The whole check for one File.
// Returns null (fine), { refuse: true, message } (over the limit: do not
// upload) or { refuse: false, message } (a note to show in amber).
// Not an image (a PDF) -> only the size limit is checked.
export async function checkImageFile(file, { kind = 'photo', maxBytes = null } = {}) {
  if (!file) return null;
  const over = overLimitMessage(file, maxBytes);
  if (over) return { refuse: true, message: over };
  if (!file.type?.startsWith('image/')) return null;
  const size = await readImageSize(file);
  const note = size ? pixelNote(size.width, size.height, kind) : null;
  return note ? { refuse: false, message: note } : null;
}
