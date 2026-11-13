'use server';

// Background screening through VolunteerBadge (0165, 13 Nov 2026; Lawrence,
// with Larry's approval of VolunteerBadge). It replaces the Checkr batch file:
// the CSV download, "mark as sent" and the results import were removed in the
// same commit (git history has them). Checkr results already on file stay and
// count until they expire.
//
//   1. prepareVolunteerBadgeBatch: who in the selection can be sent, the
//      template, and the credit guard (below), BEFORE anything is sent.
//   2. sendVolunteerBadgeInvite: one person at a time, called in turn by the
//      screen so each result shows as it happens and VB's 100-a-minute limit
//      holds. The row is written BEFORE VB is called, so a retry or a double
//      click can't invite twice (one open invite per person, per address).
//      The credit guard runs again, here, on every send.
//   3. resendWithoutIdStep: one person's invite again with VB's photo-ID step
//      skipped, for a reason staff give (Lawrence, 13 Nov 2026). It replaces
//      their open invite (marked superseded). Never in a batch.
//   4. refreshVolunteerBadge: the site asks VB (no webhook; VB never calls us).
//   5. confirmVolunteerBadgeClear: a clear result becomes OK to serve only when
//      staff press the button (confirm_volunteerbadge_clear, 0165).
//
// All of it needs Background checks write AND read (0058): sending an invite
// spends the ministry's credits and asks a real person for their SSN, which
// is at least as sensitive as reading a result.

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { withReason } from '@/lib/dbErrors';
import { volunteerBadge, volunteerBadgeTemplateId } from '@/lib/volunteerBadge';
import { VolunteerBadgeError, loadRoster, namesAgree } from '@/lib/volunteerBadgeApi';
import { refreshOne, refreshOpenRequests } from '@/lib/volunteerBadgeSync';
import { loadScreeningCandidates } from '@/lib/screeningCandidates';
import { creditPicture, creditShortfall } from '@/lib/volunteerBadgeCredits';

const NOT_CONNECTED = 'VolunteerBadge isn’t connected yet (no VOLUNTEERBADGE_API_KEY on this site).';
const MAX_BATCH = 50;

async function gate() {
  const staff = await getStaff();
  if (!can(staff, 'write:background_checks') || !can(staff, 'background_checks')) return null;
  return staff;
}

function revalidateScreening() {
  revalidatePath('/admin/background-checks/screening');
  revalidatePath('/admin/background-checks');
  revalidatePath('/admin/volunteers');
}

const vbWords = (err) => (err instanceof VolunteerBadgeError ? err.message : 'VolunteerBadge couldn’t be reached.');

async function defaultTemplateId(api) {
  const set = volunteerBadgeTemplateId();
  if (set) return set;
  const templates = await api.templates();
  return (templates.find((t) => t.isDefault) ?? templates[0])?.id ?? null;
}

// THE CREDIT GUARD (Lawrence, 13 Nov 2026), asked of VB on the server every
// time, never taken from the page: the balance must cover the people in this
// send plus every invite already out and not yet charged
// (lib/volunteerBadgeCredits.js). Returns refusal words, or null to go ahead.
async function guardCredits(supabase, api, sending, { replacing = null } = {}) {
  if (api.sandbox) return null; // test mode spends nothing
  const picture = await creditPicture(supabase, api, { replacing });
  return creditShortfall(picture, sending);
}

export async function prepareVolunteerBadgeBatch(personIds) {
  if (!(await gate())) return { ok: false, error: 'Not permitted.' };
  const api = volunteerBadge();
  if (!api) return { ok: false, error: NOT_CONNECTED };
  if (!Array.isArray(personIds) || personIds.length === 0) return { ok: false, error: 'Nobody was selected.' };
  if (personIds.length > MAX_BATCH) return { ok: false, error: `Send at most ${MAX_BATCH} at a time.` };

  const supabase = await createClient();
  let candidates;
  try {
    ({ candidates } = await loadScreeningCandidates(supabase, { sandbox: api.sandbox }));
  } catch (err) {
    return { ok: false, error: `Nothing was sent: ${err.message}` };
  }
  const byId = new Map(candidates.map((c) => [c.personId, c]));
  const ready = [];
  const refused = [];
  const emailInBatch = new Map();
  for (const id of personIds) {
    const c = byId.get(id);
    if (!c) {
      refused.push({ personId: id, name: 'Someone', why: 'no longer due a background check.' });
    } else if (c.blockedBecause) {
      refused.push({ personId: id, name: c.name, why: c.blockedBecause });
    } else if (emailInBatch.has(c.email)) {
      refused.push({
        personId: id,
        name: c.name,
        why: `same email as ${emailInBatch.get(c.email)} in this batch. VolunteerBadge keeps one record per address, so give one of them their own email first.`,
      });
    } else {
      emailInBatch.set(c.email, c.name);
      ready.push({ personId: id, name: c.name });
    }
  }

  try {
    const templateId = await defaultTemplateId(api);
    if (!templateId) {
      return { ok: false, error: 'VolunteerBadge has no application template yet. Make one under Recruit → Applications.' };
    }
    // Live only: VolunteerBadge keeps one record per address. An address it
    // already has under someone else's first name (or none to compare) would
    // tie that record's checks to this person, so it is refused; and a roster
    // with no addresses at all means no result could ever be matched.
    let sendable = ready;
    if (!api.sandbox && ready.length) {
      const roster = await loadRoster(api);
      if (!roster.hasEmails) {
        return { ok: false, error: 'VolunteerBadge’s volunteer list shows no email addresses, so results couldn’t be matched. Nothing was sent; ask VolunteerBadge.' };
      }
      const { data: people, error: peopleError } = await supabase
        .from('people')
        .select('id, first_name, preferred_name')
        .in('id', ready.map((r) => r.personId));
      if (peopleError) return { ok: false, error: withReason('Nothing was sent: the people couldn’t be read.', peopleError) };
      const personBy = new Map((people ?? []).map((p) => [p.id, p]));
      sendable = [];
      for (const r of ready) {
        const there = roster.find(byId.get(r.personId).email);
        if (there.length > 1 || (there.length === 1 && namesAgree(there[0], personBy.get(r.personId)) !== true)) {
          refused.push({
            personId: r.personId,
            name: r.name,
            why: 'VolunteerBadge already has this email address for someone else. Give them their own email on their details page first.',
          });
        } else {
          sendable.push(r);
        }
      }
    }
    const short = sendable.length ? await guardCredits(supabase, api, sendable.length) : null;
    if (short) return { ok: false, error: short };
    return { ok: true, ready: sendable, refused, sandbox: api.sandbox };
  } catch (err) {
    return { ok: false, error: vbWords(err) };
  }
}

// The row is already written ('sending'); call VB and record the answer.
async function deliver(supabase, api, rowId, { templateId, email, waiveIdReason = null }) {
  try {
    const sent = await api.sendApplication({ templateId, email, waiveIdReason });
    if (sent.sandbox && !api.sandbox) {
      // VB answered in test mode to a key this site reads as live: nothing
      // real happened, and nothing more should be sent until that is sorted.
      await supabase
        .from('volunteerbadge_requests')
        .update({ status: 'cancelled', problem: 'VolunteerBadge answered in test mode, though the key here looks live. Check the key.' })
        .eq('id', rowId);
      return { ok: false, error: 'VolunteerBadge answered in test mode, though the key here looks live. Nothing real was sent; check the key.', stop: true };
    }
    const { error: updateError } = await supabase
      .from('volunteerbadge_requests')
      .update({ status: 'invited', vb_application_id: sent.applicationId, apply_expires_at: sent.expiresAt, problem: null })
      .eq('id', rowId);
    if (updateError) {
      return {
        ok: true,
        warning: withReason('Sent, but the site couldn’t note it as sent. It shows as "sending"; don’t send again.', updateError),
      };
    }
    return { ok: true, email };
  } catch (err) {
    const vbErr = err instanceof VolunteerBadgeError ? err : new VolunteerBadgeError('Something went wrong sending it.', { uncertain: true });
    if (!vbErr.uncertain) {
      // VolunteerBadge said no: nothing went out, so the person can be sent again.
      const { error: markError } = await supabase
        .from('volunteerbadge_requests')
        .update({ status: 'not_sent', problem: vbErr.message.slice(0, 300) })
        .eq('id', rowId);
      return {
        ok: false,
        error: `Not sent: ${vbErr.message}${markError ? ` (The site couldn’t note that: ${markError.message}. It shows as "sending"; take it back once you’ve checked.)` : ''}`,
        stop: [401, 402, 403, 429].includes(vbErr.status) || Boolean(markError),
        definite: !markError,
      };
    }
    // No clean answer: VolunteerBadge may have sent it. Leave it "sending" so
    // nobody re-sends blind; staff check VB and take it back if it didn't go.
    const { error: noteError } = await supabase
      .from('volunteerbadge_requests')
      .update({ problem: 'No clear answer from VolunteerBadge. Look in its Applications list before sending again.' })
      .eq('id', rowId);
    return {
      ok: false,
      error: `Not sure it was sent: ${vbErr.message}${noteError ? ` (and the site couldn’t note it: ${noteError.message})` : ''}`,
      stop: true,
    };
  }
}

// The template is resolved here, on the server (review, 13 Nov 2026): the
// screen passes nothing that VolunteerBadge is told.
export async function sendVolunteerBadgeInvite(personId) {
  if (!(await gate())) return { ok: false, error: 'Not permitted.', stop: true };
  const api = volunteerBadge();
  if (!api) return { ok: false, error: NOT_CONNECTED, stop: true };

  const supabase = await createClient();
  // The page's own rule, read again now: a stale screen can't send.
  let c;
  try {
    const { candidates } = await loadScreeningCandidates(supabase, { sandbox: api.sandbox });
    c = candidates.find((x) => x.personId === personId);
  } catch (err) {
    return { ok: false, error: `Not sent: ${err.message}`, stop: true };
  }
  if (!c) return { ok: false, error: 'Not sent: no longer due a background check.' };
  if (c.blockedBecause) return { ok: false, error: `Not sent: ${c.blockedBecause}` };

  let templateId;
  try {
    const short = await guardCredits(supabase, api, 1);
    if (short) return { ok: false, error: `Not sent: ${short}`, stop: true };
    templateId = await defaultTemplateId(api);
  } catch (err) {
    return { ok: false, error: `Not sent: ${vbWords(err)}`, stop: true };
  }
  if (!templateId) return { ok: false, error: 'Not sent: VolunteerBadge has no application template yet.', stop: true };

  // 1. The record first.
  const { data: row, error: insertError } = await supabase
    .from('volunteerbadge_requests')
    .insert({ person_id: personId, invited_email: c.email, sandbox: api.sandbox })
    .select('id')
    .single();
  if (insertError) {
    if (insertError.code === '23505') {
      return { ok: false, error: 'Not sent: they, or someone at the same email address, already have an open invite.' };
    }
    return { ok: false, error: withReason('Not sent: the invite couldn’t be recorded.', insertError) };
  }
  // 2. Then VolunteerBadge.
  return deliver(supabase, api, row.id, { templateId, email: c.email });
}

// One person's invite again, with VolunteerBadge's photo-ID-and-selfie step
// skipped (Lawrence, 13 Nov 2026: some volunteers balk at it and call Larry).
// The reason goes to VB as idVerificationReason and stays on our row, with who
// sent it and when, so it is visible later that this check ran without ID
// verification. The person's open invite (one nobody has started a check on)
// is marked superseded; VB's old link may still work, and that is fine.
export async function resendWithoutIdStep(personId, reason) {
  if (!(await gate())) return { ok: false, error: 'Not permitted.' };
  const api = volunteerBadge();
  if (!api) return { ok: false, error: NOT_CONNECTED };
  const why = String(reason ?? '').replace(/\s+/g, ' ').trim();
  if (why.length < 10) return { ok: false, error: 'Give a reason of at least 10 characters (it goes to VolunteerBadge).' };
  if (why.length > 300) return { ok: false, error: 'Keep the reason under 300 characters.' };

  const supabase = await createClient();
  let c;
  try {
    const { candidates } = await loadScreeningCandidates(supabase, { sandbox: api.sandbox });
    c = candidates.find((x) => x.personId === personId);
  } catch (err) {
    return { ok: false, error: `Not sent: ${err.message}` };
  }
  if (!c?.resendable) {
    return {
      ok: false,
      error: c?.blockedBecause
        ? `Not sent: ${c.blockedBecause}`
        : 'Not sent: only someone already invited, whose check hasn’t started, can be sent again this way.',
    };
  }

  let templateId;
  try {
    const short = await guardCredits(supabase, api, 1, { replacing: c.openRequestId });
    if (short) return { ok: false, error: `Not sent: ${short}` };
    templateId = await defaultTemplateId(api);
  } catch (err) {
    return { ok: false, error: `Not sent: ${vbWords(err)}` };
  }
  if (!templateId) return { ok: false, error: 'VolunteerBadge has no application template yet.' };

  // 1. Ask VB about the open invite now: our saved status may be a day old,
  //    and replacing an invite they have already used would orphan its check.
  let replaced = null;
  if (c.openRequestId) {
    let now;
    try {
      const fresh = await refreshOne(supabase, api, c.openRequestId);
      if (fresh.problem && fresh.status !== 'invited') {
        revalidateScreening();
        return { ok: false, error: `Not sent: ${fresh.problem}` };
      }
      now = fresh.status;
    } catch (err) {
      return { ok: false, error: `Not sent: ${vbWords(err)}` };
    }
    if (now !== 'invited' && now !== 'applied') {
      revalidateScreening();
      return { ok: false, error: 'Not sent: they have used their invite since this page was loaded (the check has started). Reload the page.' };
    }
    const { data: old, error: oldError } = await supabase
      .from('volunteerbadge_requests')
      .update({ status: 'superseded' })
      .eq('id', c.openRequestId)
      .in('status', ['invited', 'applied'])
      .select('id, status');
    if (oldError) return { ok: false, error: withReason('Not sent: the open invite couldn’t be replaced.', oldError) };
    if (!old?.length) return { ok: false, error: 'Not sent: their invite changed meanwhile. Reload the page.' };
    replaced = { id: c.openRequestId, status: now };
  }
  const { data: row, error: insertError } = await supabase
    .from('volunteerbadge_requests')
    .insert({
      person_id: personId,
      invited_email: c.email,
      sandbox: api.sandbox,
      id_verification_waived: true,
      id_verification_reason: why,
    })
    .select('id')
    .single();
  if (insertError) {
    // Put the old invite back as it was, so the person isn't left with none.
    if (replaced) {
      await supabase.from('volunteerbadge_requests').update({ status: replaced.status }).eq('id', replaced.id).eq('status', 'superseded');
    }
    return { ok: false, error: withReason('Not sent: the new invite couldn’t be recorded.', insertError) };
  }
  const r = await deliver(supabase, api, row.id, { templateId, email: c.email, waiveIdReason: why });
  // VB said no to the new invite: the old one is still theirs, so put it back.
  if (!r.ok && r.definite && replaced) {
    const { error: restoreError } = await supabase
      .from('volunteerbadge_requests')
      .update({ status: replaced.status })
      .eq('id', replaced.id)
      .eq('status', 'superseded');
    if (restoreError) {
      r.error += ` Their earlier invite couldn’t be put back (${restoreError.message}); it shows as replaced, though VolunteerBadge’s link still works.`;
    }
  }
  revalidateScreening();
  return r;
}

// Ask VolunteerBadge about the open invites in this mode (lib/volunteerBadgeSync.js;
// the daily job runs the same routine). How an invite is tied to its result
// is refreshRequest() in lib/volunteerBadgeApi.js.
export async function refreshVolunteerBadge() {
  if (!(await gate())) return { ok: false, error: 'Not permitted.' };
  const api = volunteerBadge();
  if (!api) return { ok: false, error: NOT_CONNECTED };
  const supabase = await createClient();
  const r = await refreshOpenRequests(supabase, api);
  revalidateScreening();
  return {
    ok: r.problems.length === 0,
    checked: r.checked,
    changed: r.changed,
    more: r.more,
    error: r.problems.length ? r.problems.join(' ') : null,
  };
}

export async function confirmVolunteerBadgeClear(requestId) {
  if (!(await gate())) return { ok: false, error: 'Not permitted.' };
  const api = volunteerBadge();
  if (!api) return { ok: false, error: NOT_CONNECTED };
  const supabase = await createClient();
  // Read the check again first: a result VB has since reopened is not clear.
  try {
    const fresh = await refreshOne(supabase, api, requestId);
    if (fresh.status !== 'clear' || fresh.problem) {
      revalidateScreening();
      return {
        ok: false,
        error: fresh.problem
          ? `Not recorded: ${fresh.problem}`
          : 'Not recorded: VolunteerBadge no longer shows this result as clear. Reload the page.',
      };
    }
  } catch (err) {
    return { ok: false, error: `Not recorded: ${vbWords(err)}` };
  }
  const { error } = await supabase.rpc('confirm_volunteerbadge_clear', { p_request_id: requestId });
  if (error) return { ok: false, error: withReason('Not recorded.', error) };
  revalidateScreening();
  revalidatePath('/admin', 'layout');
  return { ok: true };
}

// Take back an invite HERE (it is not cancelled in VolunteerBadge, which has
// no call for that): a send that never got a clear answer and didn't reach VB,
// or an invite staff no longer want answered. Only before anyone has applied.
export async function cancelVolunteerBadgeRequest(requestId) {
  if (!(await gate())) return { ok: false, error: 'Not permitted.' };
  const supabase = await createClient();
  // An invite that has been used since the page loaded is not taken back.
  const api = volunteerBadge();
  if (api) {
    try {
      const { status: now } = await refreshOne(supabase, api, requestId);
      if (now !== 'invited' && now !== 'sending') {
        revalidateScreening();
        return { ok: false, error: 'Not taken back: they have used their invite since this page was loaded. Reload the page.' };
      }
    } catch (err) {
      return { ok: false, error: `Not taken back: ${vbWords(err)}` };
    }
  }
  const { data, error } = await supabase
    .from('volunteerbadge_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .in('status', ['sending', 'invited'])
    .select('id');
  if (error) return { ok: false, error: withReason('Not taken back.', error) };
  if (!data?.length) return { ok: false, error: 'Only an invite nobody has applied to yet can be taken back.' };
  revalidateScreening();
  return { ok: true };
}
