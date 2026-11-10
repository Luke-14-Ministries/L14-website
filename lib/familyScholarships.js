// Family scholarship requests (0159, Lawrence 10 Nov 2026): one request for a
// whole registration, decided in one go and split over the people by each
// person's fee. Loaded here once for the two staff screens that show them --
// the Scholarship Requests queue and the registration page -- so a family
// request reads the same on both.
//
// Server-only in practice (it takes the caller's Supabase client); no
// 'use client' import, so a server component may call it (CLAUDE.md).

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent / guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  volunteer_child: 'Volunteer child (under 16)',
  childcare: 'Childcare',
  support_team: 'Support team',
};

// What a person still owes after every discount, before any scholarship --
// the figure the database splits on. null when the money row is not visible
// (no Payments read): never 0.
export function owesBeforeScholarship(money) {
  if (!money) return null;
  return Math.max(
    0,
    (money.fee_cents ?? 0) -
      (money.discount_cents ?? 0) -
      (money.early_discount_cents ?? 0) -
      (money.family_discount_cents ?? 0)
  );
}

// Is this family request work for staff? Waiting on a decision, or decided
// and then flagged because someone was added or removed.
export function familyRequestOpen(row) {
  return row.status === 'requested' || (row.status === 'granted' && Boolean(row.needsReviewSince));
}

// Load and shape family requests. Pass registrationIds to limit them (the
// registration page); leave it out for every request (the queue). Throws on
// a failed read -- an empty list must mean "none", never "the query failed".
export async function loadFamilyScholarshipRows(supabase, { registrationIds } = {}) {
  if (registrationIds && registrationIds.length === 0) return [];
  let q = supabase
    .from('family_scholarship_requests')
    .select(
      `id, registration_id, ask_kind, ask_percent, ask_cents, family_statement, status,
       granted_cents, staff_note, reviewed_by, reviewed_at, needs_review_since,
       needs_review_reason, created_at,
       registrations!inner (
         id,
         households ( display_name ),
         events ( id, name, starts_on, ends_on, archived_at ),
         registration_participants (
           id, camp_role, status, created_at,
           participant_money ( fee_cents, discount_cents, early_discount_cents, family_discount_cents, scholarship_cents ),
           people ( first_name, last_name ),
           scholarships ( requested_cents, granted_cents, status, family_request_id )
         )
       )`
    )
    .order('created_at', { ascending: true });
  if (registrationIds) q = q.in('registration_id', registrationIds);
  const { data, error } = await q;
  if (error) throw new Error(`Family scholarship requests: ${error.message}`);

  const reviewerIds = [...new Set((data ?? []).map((r) => r.reviewed_by).filter(Boolean))];
  let names = new Map();
  if (reviewerIds.length) {
    const { data: profs, error: profsError } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', reviewerIds);
    if (profsError) throw new Error(`Reviewer names: ${profsError.message}`);
    names = new Map((profs ?? []).map((p) => [p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()]));
  }

  return (data ?? []).map((r) => {
    const reg = r.registrations ?? {};
    const people = (reg.registration_participants ?? [])
      .filter((p) => p.status !== 'cancelled')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id))
      .map((p) => {
        const m = p.participant_money ?? null;
        const s = [].concat(p.scholarships ?? [])[0] ?? null;
        const covered = s?.family_request_id === r.id;
        return {
          participantId: p.id,
          name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim() || 'Person',
          roleLabel: ROLE_LABEL[p.camp_role] ?? p.camp_role ?? '',
          feeCents: m?.fee_cents ?? null,
          owesCents: owesBeforeScholarship(m),
          scholarshipCents: m?.scholarship_cents ?? null,
          covered,
          shareCents: covered ? (s.status === 'granted' ? s.granted_cents : s.requested_cents) : null,
        };
      });
    const moneyKnown = people.every((p) => p.owesCents != null);
    return {
      id: r.id,
      registrationId: r.registration_id,
      household: reg.households?.display_name ?? '',
      event: reg.events ?? null,
      eventName: reg.events?.name ?? '',
      askKind: r.ask_kind,
      askPercent: r.ask_percent,
      askCents: r.ask_cents,
      statement: r.family_statement ?? '',
      status: r.status,
      grantedCents: r.granted_cents ?? 0,
      staffNote: r.staff_note ?? '',
      requestedAt: r.created_at,
      reviewedAt: r.reviewed_at,
      reviewedBy: names.get(r.reviewed_by) ?? null,
      needsReviewSince: r.needs_review_since,
      needsReviewReason: r.needs_review_reason ?? '',
      people,
      // What the family owes in all, before any scholarship. null when this
      // staffer may not read money.
      familyOwesCents: moneyKnown ? people.reduce((t, p) => t + (p.owesCents ?? 0), 0) : null,
    };
  });
}
