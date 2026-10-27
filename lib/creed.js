// The Apostles' Creed flag, read from the creed_status view (0130) -- no
// money, so everyone with Registration read sees it (Lawrence, 26 Oct 2026:
// "creed flag should not be tied to money").
//
// A volunteer who has not affirmed the Creed is either
//   pending  -- nobody has recorded talking with Larry about them under the
//               name they have now (never recorded, added since, or renamed
//               since: "should re-open if someone is added (or major change,
//               like name)"), or
//   covered  -- a conversation is on file for them under their current name.
//
// creedByRegistration(rows) -> Map(registration_id -> { pending, covered });
// a registration with nobody unaffirmed is not in the map.

const nameOf = (r) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || 'Someone';

export function creedByRegistration(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    if (r.creed_affirmed) continue;
    if (!out.has(r.registration_id)) out.set(r.registration_id, { pending: [], covered: [] });
    const entry = out.get(r.registration_id);
    if (r.discussed_current) {
      entry.covered.push({
        personId: r.person_id,
        name: nameOf(r),
        at: r.discussed_at,
        byId: r.discussed_by ?? null,
        note: r.discussed_note ?? null,
      });
    } else {
      entry.pending.push({
        personId: r.person_id,
        name: nameOf(r),
        // Recorded under another name: the flag re-opened on a rename.
        renamedFrom: r.discussed_at && r.discussed_name ? r.discussed_name : null,
      });
    }
  }
  return out;
}

export const CREED_COLUMNS =
  'registration_id, person_id, first_name, last_name, creed_affirmed, discussed_name, discussed_at, discussed_by, discussed_note, discussed_current';
