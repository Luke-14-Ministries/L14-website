// Ask VolunteerBadge about open invites and save what changed (0165). One
// routine for the Refresh button (staff's own session) and the daily job
// (app/api/cron/volunteerbadge/, the service-role client; Lawrence, 13 Nov
// 2026). Server side; it takes the caller's Supabase client and a client from
// lib/volunteerBadge.js. How an invite is tied to its result is
// refreshRequest() in lib/volunteerBadgeApi.js.

import { VolunteerBadgeError, OPEN_STATUSES, LATE_RESULT_DAYS, loadRoster, refreshRequest } from '@/lib/volunteerBadgeApi';

// About 2 VB calls a row plus the roster pages, at VB's pace, inside a
// 60-second page.
export const REFRESH_LIMIT = 20;

// One request, asked now (before a resend, a take back or a confirm acts on
// our last-saved status). Returns { status, problem } after the answer, or
// throws. A problem means VB's answer couldn't be matched to this invite.
export async function refreshOne(supabase, api, requestId) {
  const { data: row, error } = await supabase
    .from('volunteerbadge_requests')
    .select(
      'id, person_id, invited_email, status, vb_volunteer_id, vb_check_id, vb_check_status, vb_result, apply_expires_at, completed_at, problem, sent_at, people ( first_name, preferred_name, last_name, date_of_birth )'
    )
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new Error(`That invite couldn’t be read: ${error.message}`);
  if (!row) throw new Error('That invite wasn’t found.');
  if (!OPEN_STATUSES.includes(row.status) && row.status !== 'clear') return { status: row.status, problem: row.problem };
  const roster = row.vb_check_id ? null : await loadRoster(api);
  const req = {
      ...row,
      first_name: row.people?.first_name ?? '',
      preferred_name: row.people?.preferred_name ?? '',
      last_name: row.people?.last_name ?? '',
      date_of_birth: row.people?.date_of_birth ?? null,
    };
  delete req.people;
  const patch = row.status === 'clear' && row.vb_check_id
    ? await refreshRequest(req, api, null)
    : await refreshRequest(req, api, roster);
  if (patch) {
    const { error: updateError } = await supabase
      .from('volunteerbadge_requests')
      .update({ ...patch, last_checked_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', row.status);
    if (updateError) throw new Error(`That invite couldn’t be updated: ${updateError.message}`);
  }
  return {
    status: patch?.status ?? row.status,
    problem: patch && 'problem' in patch ? patch.problem : row.problem,
  };
}

export async function refreshOpenRequests(supabase, api, { limit = REFRESH_LIMIT } = {}) {
  // A send with no answer for two minutes is included: if VB did get it, its
  // result is found the same way (and it is never expired).
  const stuckBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  // An expired invite is looked at for a late check for LATE_RESULT_DAYS
  // after its link ran out (Fable review, 14 Nov 2026).
  const lateSince = new Date(Date.now() - LATE_RESULT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: found, error } = await supabase
    .from('volunteerbadge_requests')
    .select(
      'id, person_id, invited_email, status, vb_volunteer_id, vb_check_id, vb_check_status, vb_result, apply_expires_at, completed_at, problem, sent_at, people ( first_name, preferred_name, last_name, date_of_birth )'
    )
    .eq('sandbox', api.sandbox)
    .or(
      `status.in.(invited,applied,processing,in_review),and(status.eq.sending,sent_at.lt."${stuckBefore}"),and(status.eq.expired,vb_check_id.is.null,apply_expires_at.gt."${lateSince}")`
    )
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) return { checked: 0, changed: 0, more: false, problems: [`The open invites couldn’t be read: ${error.message}`] };
  // Not an expired invite whose person has been sent a newer one: that one
  // answers now (and the one-open-invite rule would refuse the old one).
  let rows = found ?? [];
  const lateFor = [...new Set(rows.filter((r) => r.status === 'expired').map((r) => r.person_id))];
  if (lateFor.length > 0) {
    const { data: since, error: sinceError } = await supabase
      .from('volunteerbadge_requests')
      .select('person_id, sent_at')
      .eq('sandbox', api.sandbox)
      .in('person_id', lateFor);
    const skip = rows.filter(
      (r) =>
        r.status === 'expired' &&
        (sinceError || (since ?? []).some((s) => s.person_id === r.person_id && new Date(s.sent_at) > new Date(r.sent_at)))
    );
    if (skip.length > 0) {
      rows = rows.filter((r) => !skip.includes(r));
      // Stamped as looked at, so they go to the back of the queue instead of
      // taking the first places every time.
      await supabase
        .from('volunteerbadge_requests')
        .update({ last_checked_at: new Date().toISOString() })
        .in('id', skip.map((r) => r.id))
        .eq('status', 'expired');
    }
  }

  let roster = null;
  let changed = 0;
  let checked = 0;
  const problems = [];
  for (const [i, row] of rows.entries()) {
    try {
      // Only rows still waiting to be tied to a check need the roster.
      if (!row.vb_check_id && !roster) roster = await loadRoster(api);
      const req = {
      ...row,
      first_name: row.people?.first_name ?? '',
      preferred_name: row.people?.preferred_name ?? '',
      last_name: row.people?.last_name ?? '',
      date_of_birth: row.people?.date_of_birth ?? null,
    };
      delete req.people;
      const patch = await refreshRequest(req, api, roster);
      // Only while it is still open (or still expired, for a late check): a
      // Take back or a resend made meanwhile must not be undone by this answer.
      const stillAs = row.status === 'expired' ? ['expired'] : OPEN_STATUSES;
      const { error: updateError } = await supabase
        .from('volunteerbadge_requests')
        .update({ ...(patch ?? {}), last_checked_at: new Date().toISOString() })
        .eq('id', row.id)
        .in('status', stillAs);
      if (updateError) {
        problems.push(`An update couldn’t be saved: ${updateError.message}`);
        // The one-check-per-invite index (0165): say so on the row itself.
        if (updateError.code === '23505' && String(updateError.message).includes('one_check')) {
          await supabase
            .from('volunteerbadge_requests')
            .update({
              problem: 'VolunteerBadge’s check here is already tied to another invite. Check it in VolunteerBadge and record the result by hand.',
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', row.id)
            .in('status', stillAs);
        }
      } else if (patch) changed += 1;
      checked += 1;
    } catch (err) {
      problems.push(err instanceof VolunteerBadgeError ? err.message : 'VolunteerBadge couldn’t be reached.');
      // A refused key, a paused account or "slow down": stop, don't hammer.
      // No answer or a fault on VB's side: stop too, rather than wait out
      // every row's timeout (Fable review, 14 Nov 2026).
      if (!(err instanceof VolunteerBadgeError) || [401, 403, 429].includes(err.status) || err.uncertain) {
        if (i + 1 < rows.length) problems.push('The rest weren’t checked this time; try again later.');
        break;
      }
    }
  }
  if (roster && !roster.complete) problems.push('VolunteerBadge’s volunteer list was longer than this site reads at once, so nothing was marked expired.');
  return { checked, changed, more: (found?.length ?? 0) === limit, problems: [...new Set(problems)] };
}
