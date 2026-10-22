// Identification photos for STAFF pages (Ellen, Script 5 item 2.5; Lawrence
// approved 22 Oct 2026): a face beside a name, the way Check-In shows it.
//
// Server-side only -- pass in the request's Supabase client.
//
// WHO MAY SEE THEM. The rule is the database's, and this helper only mirrors
// it so the page does not ask for what it will not get:
//   - person_photos rows: staff need the Sensitive READ grant (0101's mapping
//     table replaced 0033's "any staff" with has_grant('sensitive', 'read'));
//   - the storage objects in the private `person-photos` bucket: the same
//     grant (0105, audit finding F6).
// A family's photo-permission (media) answer is NOT a gate: it is about
// published photos, not the identification thumbnail, and Check-In shows
// the thumbnail together with its "no photos" badge.
//
// WHAT FAILS HOW. A failed read of person_photos is thrown -- never turned
// into "nobody has a photo" (CLAUDE.md). Signing is different: a link that
// cannot be minted, for one photo or for all of them, leaves that face out
// and the page carries on with names only, which is how a person without a
// photo looks anyway.
//
// Links last 15 minutes (Script 5, 18 Oct 2026): a child's photo link should
// not outlive the visit. Every page load signs fresh ones, in ONE request.

export const PHOTO_LINK_SECONDS = 900;

// Returns Map(person_id -> signed URL). People without a photo, or whose
// link could not be signed, are simply absent.
export async function signedPhotoUrls(supabase, staffCanSeePhotos, personIds) {
  const urls = new Map();
  const ids = [...new Set((personIds ?? []).filter(Boolean))];
  if (!staffCanSeePhotos || ids.length === 0) return urls;

  const { data: rows, error } = await supabase
    .from('person_photos')
    .select('person_id, storage_path')
    .in('person_id', ids);
  if (error) throw new Error(`Photo lookup failed: ${error.message}`);

  const withPath = (rows ?? []).filter((r) => r.storage_path);
  if (withPath.length === 0) return urls;

  const { data: signed, error: signError } = await supabase.storage
    .from('person-photos')
    .createSignedUrls(
      withPath.map((r) => r.storage_path),
      PHOTO_LINK_SECONDS
    );
  if (signError) {
    // Logged for whoever reads the server logs; the page shows names only.
    console.error(`Photo links could not be signed: ${signError.message}`);
    return urls;
  }

  const personByPath = new Map(withPath.map((r) => [r.storage_path, r.person_id]));
  for (const s of signed ?? []) {
    if (s?.error || !s?.signedUrl) continue;
    const personId = personByPath.get(s.path);
    if (personId) urls.set(personId, s.signedUrl);
  }
  return urls;
}
