'use server';

// Email the families of an event, or of one activity, about a change
// (Lawrence, 22 Oct 2026).
//
// STAFF-PRESSED, NEVER AUTOMATIC. Nothing on the site emails families because
// an activity was edited: a coordinator fixing a typo in a description must
// not reach forty inboxes. What happens instead is that the Activities editor,
// after a save that put a waiver or an outside provider on an activity with
// people already signed up, offers a link here with everything chosen; a
// person with Registration write reads the preview and presses Send.
//
// One email per household, to the household's email (households.email);
// a household without one is skipped and listed. Each send goes through
// lib/email.js (fire-and-tolerate: a mail failure is a result on screen and
// in the log, never a thrown error) and is logged to message_log through
// log_family_email() (0120) -- the table itself is read-only for staff since
// 0113. Addresses never leave the server: the preview carries names and a
// yes/no for "has an email", and the URL carries only ids.

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { sendEmail, familyUpdateEmail } from '@/lib/email';

const SUBJECT_MAX = 150;
const MESSAGE_MAX = 5000;
// Resend accepts a couple of requests a second; a pause between sends keeps a
// sixty-family list from being refused halfway down.
const PAUSE_MS = 600;

async function requireWriter() {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) {
    return { error: 'Emailing families needs Registration write.' };
  }
  return { staff };
}

// Who a send reaches, worked out on the server every time -- the preview and
// the send ask the same function, and the send never trusts a list from the
// browser. Returns { households, peopleCount, eventName, activityName } or
// { error }. A household is in when one of its people (any status but
// cancelled) is registered for the event and, if an activity is chosen, holds
// an active place on it (interested or signed up) and, if "only waiver
// outstanding", has a row in activity_waivers_outstanding.
async function familyAudience(supabase, { eventId, activityId, outstandingOnly }) {
  if (!eventId) return { error: 'Choose an event.' };

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError) return { error: `The event could not be read: ${eventError.message}` };
  if (!event) return { error: 'That event no longer exists.' };

  let activity = null;
  if (activityId) {
    const { data, error } = await supabase
      .from('activities')
      .select('id, name, event_id')
      .eq('id', activityId)
      .maybeSingle();
    if (error) return { error: `The activity could not be read: ${error.message}` };
    if (!data || data.event_id !== eventId) return { error: 'That activity is not on this event.' };
    activity = data;
  }

  const { data: regs, error: regError } = await supabase
    .from('registrations')
    .select(
      `id, household_id, households ( id, display_name, email ),
       registration_participants ( id, status, person_id, people ( first_name, last_name ) )`
    )
    .eq('event_id', eventId);
  if (regError) return { error: `The registrations could not be read: ${regError.message}` };

  let onActivity = null;
  if (activity) {
    const { data, error } = await supabase
      .from('activity_signups')
      .select('registration_participant_id')
      .eq('activity_id', activity.id)
      .in('status', ['interested', 'signed_up']);
    if (error) return { error: `The activity's sign-ups could not be read: ${error.message}` };
    onActivity = new Set((data ?? []).map((s) => s.registration_participant_id));
  }

  let owedByParticipant = null;
  if (outstandingOnly) {
    let q = supabase
      .from('activity_waivers_outstanding')
      .select('registration_participant_id, activity_name, kind, agreement_title, upload_status, review_note')
      .eq('event_id', eventId);
    if (activity) q = q.eq('activity_id', activity.id);
    const { data, error } = await q;
    if (error) return { error: `The outstanding waivers could not be read: ${error.message}` };
    owedByParticipant = new Map();
    for (const o of data ?? []) {
      if (!owedByParticipant.has(o.registration_participant_id)) {
        owedByParticipant.set(o.registration_participant_id, []);
      }
      owedByParticipant.get(o.registration_participant_id).push(o);
    }
  }

  const households = [];
  const people = new Set();
  for (const r of regs ?? []) {
    const parts = (r.registration_participants ?? []).filter(
      (p) =>
        p.status !== 'cancelled' &&
        (!onActivity || onActivity.has(p.id)) &&
        (!owedByParticipant || owedByParticipant.has(p.id))
    );
    if (parts.length === 0) continue;
    for (const p of parts) people.add(p.person_id);
    const items = owedByParticipant
      ? parts
          .flatMap((p) =>
            owedByParticipant.get(p.id).map((o) => ({
              activityName: o.activity_name,
              personName: p.people?.first_name ?? '',
              kind: o.kind,
              agreementTitle: o.agreement_title ?? null,
              uploadStatus: o.upload_status ?? null,
              reviewNote: o.review_note ?? null,
            }))
          )
          .sort((a, b) => `${a.activityName} ${a.personName}`.localeCompare(`${b.activityName} ${b.personName}`))
      : [];
    households.push({
      householdId: r.household_id,
      registrationId: r.id,
      name: r.households?.display_name ?? 'Household',
      email: String(r.households?.email ?? '').trim(),
      people: parts
        .map((p) => `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim())
        .sort(),
      items,
    });
  }
  households.sort((a, b) => a.name.localeCompare(b.name));
  return { households, peopleCount: people.size, eventName: event.name, activityName: activity?.name ?? null };
}

// The preview: who, and how many -- never an address.
export async function previewFamilyEmail({ eventId, activityId = null, outstandingOnly = false }) {
  const { error: authError } = await requireWriter();
  if (authError) return { ok: false, error: authError };
  const supabase = await createClient();
  const aud = await familyAudience(supabase, { eventId, activityId, outstandingOnly: Boolean(outstandingOnly) });
  if (aud.error) return { ok: false, error: aud.error };
  return {
    ok: true,
    eventName: aud.eventName,
    activityName: aud.activityName,
    peopleCount: aud.peopleCount,
    households: aud.households.map((h) => ({
      householdId: h.householdId,
      registrationId: h.registrationId,
      name: h.name,
      hasEmail: Boolean(h.email),
      people: h.people,
      items: h.items,
    })),
  };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The send. `expectedFamilies` is the number the staff member confirmed
// ("Send to N families?"); if the list has changed since the preview, nothing
// is sent and they are asked to look again.
export async function sendFamilyEmail({
  eventId,
  activityId = null,
  outstandingOnly = false,
  subject,
  message,
  expectedFamilies,
}) {
  const { error: authError } = await requireWriter();
  if (authError) return { ok: false, error: authError };

  const subj = String(subject ?? '').trim();
  const body = String(message ?? '').trim();
  if (!subj) return { ok: false, error: 'Write a subject.' };
  if (subj.length > SUBJECT_MAX) return { ok: false, error: `Keep the subject under ${SUBJECT_MAX} characters.` };
  if (!body) return { ok: false, error: 'Write the message.' };
  if (body.length > MESSAGE_MAX) return { ok: false, error: `Keep the message under ${MESSAGE_MAX} characters.` };

  const supabase = await createClient();
  const aud = await familyAudience(supabase, { eventId, activityId, outstandingOnly: Boolean(outstandingOnly) });
  if (aud.error) return { ok: false, error: aud.error };
  const sendable = aud.households.filter((h) => h.email);
  if (sendable.length === 0) return { ok: false, error: 'Nobody on this list has an email on file.' };
  if (sendable.length !== Number(expectedFamilies)) {
    return {
      ok: false,
      error: `The list changed since the preview — it is now ${sendable.length} ${sendable.length === 1 ? 'family' : 'families'}. Check it and send again.`,
    };
  }

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host');
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const origin = host ? `${proto}://${host}` : '';
  const templateKey = outstandingOnly ? 'waiver_needed' : 'family_update';

  const results = [];
  for (const h of aud.households) {
    if (!h.email) {
      results.push({ householdId: h.householdId, name: h.name, status: 'skipped', error: 'No email on file.' });
      continue;
    }
    if (results.some((r) => r.status !== 'skipped')) await pause(PAUSE_MS);
    const activitiesUrl = outstandingOnly && origin ? `${origin}/account/activities/?registration=${h.registrationId}#reg-${h.registrationId}` : null;
    const mail = familyUpdateEmail({ origin, subject: subj, message: body, items: h.items, activitiesUrl });
    // Fire-and-tolerate (lib/email.js): a failure is a result, not a throw.
    const sent = await sendEmail({ to: h.email, subject: mail.subject, html: mail.html, text: mail.text });
    const status = sent.ok ? 'sent' : 'failed';
    const { error: logError } = await supabase.rpc('log_family_email', {
      p_household_id: h.householdId,
      p_registration_id: h.registrationId,
      p_to_email: h.email,
      p_template_key: templateKey,
      p_subject: subj,
      p_status: status,
      p_error: sent.ok ? null : sent.error ?? 'Not sent.',
      p_provider_message_id: sent.ok ? sent.id ?? null : null,
    });
    if (logError) console.error('log_family_email:', logError.message);
    results.push({
      householdId: h.householdId,
      name: h.name,
      status,
      error: sent.ok ? null : sent.error ?? 'Not sent.',
      // Never swallowed: a send that could not be logged says so on screen.
      logError: logError ? logError.message : null,
    });
  }
  return { ok: true, results };
}
