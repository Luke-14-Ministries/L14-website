// Ask VolunteerBadge about open invites and save what changed (0165). One
// routine for the Refresh button (staff's own session) and the daily job
// (app/api/cron/volunteerbadge/, the service-role client; Lawrence, 13 Nov
// 2026). Server side; it takes the caller's Supabase client and a client from
// lib/volunteerBadge.js. How an invite is tied to its result is
// refreshRequest() in lib/volunteerBadgeApi.js.

import { VolunteerBadgeError, OPEN_STATUSES, loadRoster, refreshRequest } from '@/lib/volunteerBadgeApi';

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
      'id, person_id, invited_email, status, vb_volunteer_id, vb_check_id, vb_check_status, vb_result, apply_expires_at, completed_at, problem, sent_at, people ( first_name, preferred_name )'
    )
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw new Error(`That invite couldn’t be read: ${error.message}`);
  if (!row) throw new Error('That invite wasn’t found.');
  if (!OPEN_STATUSES.includes(row.status) && row.status !== 'clear') return { status: row.status, problem: row.problem };
  const roster = row.vb_check_id ? null : await loadRoster(api);
  const req = { ...row, first_name: row.people?.first_name ?? '', preferred_name: row.people?.preferred_name ?? '' };
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
  const { data: rows, error } = await supabase
    .from('volunteerbadge_requests')
    .select(
      'id, person_id, invited_email, status, vb_volunteer_id, vb_check_id, vb_check_status, vb_result, apply_expires_at, completed_at, problem, sent_at, people ( first_name, preferred_name )'
    )
    .eq('sandbox', api.sandbox)
    .or(`status.in.(invited,applied,processing,in_review),and(status.eq.sending,sent_at.lt."${stuckBefore}")`)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) return { checked: 0, changed: 0, more: false, problems: [`The open invites couldn’t be read: ${error.message}`] };

  let roster = null;
  let changed = 0;
  let checked = 0;
  const problems = [];
  for (const row of rows ?? []) {
    try {
      // Only rows still waiting to be tied to a check need the roster.
      if (!row.vb_check_id && !roster) roster = await loadRoster(api);
      const req = { ...row, first_name: row.people?.first_name ?? '', preferred_name: row.people?.preferred_name ?? '' };
      delete req.people;
      const patch = await refreshRequest(req, api, roster);
      // Only while it is still open: a Take back or a resend made meanwhile
      // must not be undone by this answer.
      const { error: updateError } = await supabase
        .from('volunteerbadge_requests')
        .update({ ...(patch ?? {}), last_checked_at: new Date().toISOString() })
        .eq('id', row.id)
        .in('status', OPEN_STATUSES);
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
            .in('status', OPEN_STATUSES);
        }
      } else if (patch) changed += 1;
      checked += 1;
    } catch (err) {
      problems.push(err instanceof VolunteerBadgeError ? err.message : 'VolunteerBadge couldn’t be reached.');
      // A refused key, a paused account or "slow down": stop, don't hammer.
      if (err instanceof VolunteerBadgeError && [401, 403, 429].includes(err.status)) break;
    }
  }
  if (roster && !roster.complete) problems.push('VolunteerBadge’s volunteer list was longer than this site reads at once, so nothing was marked expired.');
  return { checked, changed, more: (rows?.length ?? 0) === limit, problems: [...new Set(problems)] };
}
