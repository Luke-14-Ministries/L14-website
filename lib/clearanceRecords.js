// The background check RECORD for a set of people, as the record editor
// (components/ClearanceEditor.jsx) shows it: the clearance row, who marked
// the paperwork and the verdict, and the last few log lines. One loader for
// Background Checks (14 Nov 2026) so its fold shows exactly what Volunteers
// shows. Server side; the caller's client, so RLS decides (the Background
// checks grant). Throws on a failed read.

export const CLEARANCE_RECORD_COLUMNS = `person_id, background_check_on_file, background_check_date, expires_on,
  verdict, verdict_note, verdict_by, verdict_at, paperwork_marked_by, paperwork_marked_at,
  provider, checkr_status, checkr_package, adjudication,
  invitation_sent_at, report_completed_at, invited_email, order_batch`;

// Map(personId -> record), with verdictByName, paperworkByName and log.
export async function loadClearanceRecords(supabase, personIds) {
  const out = new Map();
  const ids = [...new Set((personIds ?? []).filter(Boolean))];
  if (ids.length === 0) return out;
  const { data: rows, error } = await supabase.from('person_clearances').select(CLEARANCE_RECORD_COLUMNS).in('person_id', ids);
  if (error) throw new Error(`Background checks: ${error.message}`);
  const { data: logRows, error: logError } = await supabase
    .from('clearance_review_log')
    .select('person_id, field, old_value, new_value, changed_by, changed_at')
    .in('person_id', ids)
    .order('changed_at', { ascending: false })
    .limit(400);
  if (logError) throw new Error(`Background check history: ${logError.message}`);
  const profileIds = [
    ...new Set([
      ...(rows ?? []).flatMap((c) => [c.verdict_by, c.paperwork_marked_by]),
      ...(logRows ?? []).map((l) => l.changed_by),
    ].filter(Boolean)),
  ];
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase.from('profiles').select('id, first_name, last_name').in('id', profileIds)
    : { data: [], error: null };
  if (profilesError) throw new Error(`Background check reviewers: ${profilesError.message}`);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()]));
  const logBy = new Map();
  for (const l of logRows ?? []) {
    if (!logBy.has(l.person_id)) logBy.set(l.person_id, []);
    if (logBy.get(l.person_id).length < 8) logBy.get(l.person_id).push({ ...l, by: nameOf.get(l.changed_by) ?? 'staff' });
  }
  for (const c of rows ?? []) {
    out.set(c.person_id, {
      ...c,
      verdictByName: nameOf.get(c.verdict_by) ?? null,
      paperworkByName: nameOf.get(c.paperwork_marked_by) ?? null,
      log: logBy.get(c.person_id) ?? [],
    });
  }
  return out;
}

// A VolunteerBadge request in the shape the record's panel reads.
export function vbSummary(r) {
  return r
    ? {
        status: r.status,
        sentAt: r.sent_at,
        email: r.invited_email,
        completedAt: r.completed_at,
        confirmedAt: r.confirmed_at,
        problem: r.problem,
        idWaived: r.id_verification_waived === true,
      }
    : null;
}
