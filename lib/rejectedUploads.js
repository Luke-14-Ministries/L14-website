// Rejected outfitter confirmations the activity_waivers_outstanding view
// cannot see (26 Oct 2026). The view is built from activity signups, but a
// volunteer or buddy uploads the outfitter's form "ready in case" with no
// signup of their own -- so when staff rejected one, neither the family's
// dashboard nor Awaiting Review's "Waiver outstanding" tab said so (Lawrence:
// "add rejected volunteers to that tab too").
//
// rejectedOutsideView(supabase, viewRows, { registrationIds }) returns rows in
// the view's own shape (registration_participant_id, registration_id,
// household_id, person_id, activity_id, activity_name, kind 'provider',
// upload_status 'rejected', review_note), only for active people and active
// activities, and only those the view did not already list. `registrationIds`
// narrows the read; without it every registration is read (staff pages).
// Throws on a failed read (CLAUDE.md: never an empty list for an error).

export async function rejectedOutsideView(supabase, viewRows, { registrationIds = null } = {}) {
  if (registrationIds && registrationIds.length === 0) return [];
  let q = supabase
    .from('activity_waiver_uploads')
    .select(
      `registration_participant_id, activity_id, review_note,
       activities ( name, active ),
       registration_participants!inner ( registration_id, person_id, status, registrations ( household_id ) )`
    )
    .eq('review_status', 'rejected')
    .neq('registration_participants.status', 'cancelled');
  if (registrationIds) q = q.in('registration_participants.registration_id', registrationIds);
  const { data, error } = await q;
  if (error) throw new Error(`Rejected confirmations: ${error.message}`);

  const seen = new Set(
    (viewRows ?? [])
      .filter((o) => o.kind === 'provider')
      .map((o) => `${o.registration_participant_id}:${o.activity_id}`)
  );
  return (data ?? [])
    .filter((u) => u.activities?.active !== false && !seen.has(`${u.registration_participant_id}:${u.activity_id}`))
    .map((u) => ({
      registration_participant_id: u.registration_participant_id,
      registration_id: u.registration_participants?.registration_id,
      household_id: u.registration_participants?.registrations?.household_id ?? null,
      person_id: u.registration_participants?.person_id,
      activity_id: u.activity_id,
      activity_name: u.activities?.name ?? 'An activity',
      kind: 'provider',
      agreement_title: null,
      upload_status: 'rejected',
      review_note: u.review_note,
    }));
}
