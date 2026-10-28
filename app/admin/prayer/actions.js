'use server';

// Sending the prayer email (0141, 28 Oct 2026). Prayer write only, checked
// here and again by the send log's insert policy. The recipients and their
// unsubscribe tokens are read with the service role: staff may see who is on
// the list but never the tokens (the migration's column grants), and every
// copy needs its own token for its unsubscribe link.

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail, sendEmailBatch } from '@/lib/email';
import { PRAYER_FROM, PRAYER_REPLY_TO, PRAYER_MAX, prayerListEmail } from '@/lib/prayer';

async function siteOrigin() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

function cleanMessage(input) {
  const subject = String(input?.subject ?? '').trim().slice(0, PRAYER_MAX.subject);
  const body = String(input?.body ?? '').trim().slice(0, PRAYER_MAX.body);
  if (!subject) return { error: 'Please give the email a subject.' };
  if (!body) return { error: 'Please write the prayer email.' };
  return { subject, body };
}

// Take someone off the list by hand (28 Oct 2026): for "please take me off"
// written to pray@ rather than pressed. The same stamp as their own
// unsubscribe, so they are never emailed again unless they sign up afresh.
// Service role, because no signed-in role writes the list (0141).
export async function removeFromPrayerList(id) {
  const staff = await getStaff();
  if (!can(staff, 'write:prayer')) return { ok: false, error: 'Changing the prayer list needs Prayer list write.' };
  const db = createAdminClient();
  if (!db) return { ok: false, error: 'The site’s server key (SUPABASE_SERVICE_ROLE_KEY) is not set in Vercel, so the list cannot be changed.' };
  const { error } = await db
    .from('prayer_list_subscribers')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('id', String(id ?? ''))
    .is('unsubscribed_at', null);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/prayer/');
  return { ok: true };
}

// A copy to the person writing it, to see how it looks in an inbox. Its
// unsubscribe link goes to a page that says it is a test.
export async function sendPrayerTest(input) {
  const staff = await getStaff();
  if (!can(staff, 'write:prayer')) return { ok: false, error: 'Sending to the prayer list needs Prayer list write.' };
  const msg = cleanMessage(input);
  if (msg.error) return { ok: false, error: msg.error };
  if (!staff.email) return { ok: false, error: 'Your login has no email address to send a test to.' };
  const mail = prayerListEmail({ origin: await siteOrigin(), subject: `[Test] ${msg.subject}`, body: msg.body, token: null });
  const sent = await sendEmail({ to: staff.email, from: PRAYER_FROM, replyTo: PRAYER_REPLY_TO, ...mail });
  return sent.ok ? { ok: true, to: staff.email } : { ok: false, error: sent.error };
}

export async function sendPrayerEmail(input) {
  const staff = await getStaff();
  if (!can(staff, 'write:prayer')) return { ok: false, error: 'Sending to the prayer list needs Prayer list write.' };
  const msg = cleanMessage(input);
  if (msg.error) return { ok: false, error: msg.error };

  const db = createAdminClient();
  if (!db) {
    return {
      ok: false,
      error: 'The prayer list cannot send yet: the site’s server key (SUPABASE_SERVICE_ROLE_KEY) is not set in Vercel. Nothing was sent.',
    };
  }
  const { data: people, error: readError } = await db
    .from('prayer_list_subscribers')
    .select('email, token')
    .not('confirmed_at', 'is', null)
    .is('unsubscribed_at', null);
  // CLAUDE.md: a failed read is said, never sent to nobody.
  if (readError) return { ok: false, error: `Could not read the list: ${readError.message}. Nothing was sent.` };
  if (!people?.length) return { ok: false, error: 'Nobody has confirmed a place on the list yet, so there is no one to send to.' };
  // The page shows how many it will send to; a list that grew or shrank since
  // the page loaded is fine, but say so.
  const expected = Number(input?.expected ?? 0);

  const origin = await siteOrigin();
  const result = await sendEmailBatch(
    people.map((p) => ({
      to: p.email,
      from: PRAYER_FROM,
      replyTo: PRAYER_REPLY_TO,
      ...prayerListEmail({ origin, subject: msg.subject, body: msg.body, token: p.token }),
    }))
  );

  // The record of the send, as the staff member themselves (the insert
  // policy checks Prayer write and that sent_by is them).
  const supabase = await createClient();
  const { error: logError } = await supabase.from('prayer_list_sends').insert({
    subject: msg.subject,
    body: msg.body,
    sent_by: staff.userId,
    recipient_count: result.sent,
    failed_count: result.failed,
    error: result.error,
  });
  if (logError) console.error('prayer send log:', logError.message);
  revalidatePath('/admin/prayer/');

  if (!result.sent) return { ok: false, error: result.error ?? 'Nothing was sent.' };
  return {
    ok: true,
    sent: result.sent,
    failed: result.failed,
    error: result.error,
    changed: expected && expected !== people.length ? people.length : null,
    logError: logError ? `The email went, but recording it failed: ${logError.message}` : null,
  };
}
