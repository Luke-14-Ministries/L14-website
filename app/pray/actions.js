'use server';

// The prayer list's public side (0141, Lawrence 28 Oct 2026): sign up,
// confirm, unsubscribe. All three run with the service role
// (lib/supabase/admin.js) because they work through the row's token, which
// no visitor's role may read -- see the migration for why. Each validates
// its own input: a server action is a public endpoint whatever the page in
// front of it does.

import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { emailLooksValid } from '@/lib/format';
import { verifyTurnstile } from '@/lib/turnstile';
import { site } from '@/lib/site';
import { PRAYER_FROM, PRAYER_REPLY_TO, PRAYER_MAX, prayerConfirmEmail, prayerAlreadyOnListEmail } from '@/lib/prayer';

const NOT_ON = `The prayer email list sign-up is not switched on yet. Please write to ${site.emails.pray} and the prayer team will add you.`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One confirmation email per address per ten minutes, so the form cannot be
// used to fill someone's inbox.
const RESEND_AFTER_MS = 10 * 60 * 1000;

async function siteOrigin() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}

export async function signUpForPrayerList(form) {
  const name = String(form?.name ?? '').trim().slice(0, PRAYER_MAX.name);
  const email = String(form?.email ?? '').trim().toLowerCase().slice(0, PRAYER_MAX.email);
  if (!emailLooksValid(email)) {
    return { ok: false, error: 'That email address doesn’t look right. Please check it.' };
  }

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  const check = await verifyTurnstile(form?.captchaToken, ip);
  if (!check.ok) {
    return { ok: false, error: 'That check timed out. Please check the box again and resend.', retryCaptcha: true };
  }

  const db = createAdminClient();
  if (!db) return { ok: false, error: NOT_ON };

  const { data: row, error: readError } = await db
    .from('prayer_list_subscribers')
    .select('id, token, name, confirmed_at, unsubscribed_at, confirm_sent_at')
    .eq('email', email)
    .maybeSingle();
  if (readError) {
    console.error('prayer sign-up (read):', readError.message);
    return { ok: false, error: 'Sorry, the sign-up could not be saved. Please try again in a moment.' };
  }

  // At most one email per address per ten minutes, whichever kind.
  if (row?.confirm_sent_at && Date.now() - Date.parse(row.confirm_sent_at) < RESEND_AFTER_MS) return { ok: true };

  // Already on the list: the form's answer is the same as for a new sign-up,
  // so it never tells anyone who else is on the list. The address itself gets
  // a short "you're already on it" (23 Nov 2026), so its owner isn't left
  // waiting for a confirmation that will never come. A failed send is only
  // logged: the person is on the list either way.
  if (row?.confirmed_at && !row.unsubscribed_at) {
    const { error: stampError } = await db
      .from('prayer_list_subscribers')
      .update({ confirm_sent_at: new Date().toISOString() })
      .eq('id', row.id);
    if (stampError) {
      console.error('prayer sign-up (already on, stamp):', stampError.message);
      return { ok: true };
    }
    // The name on file, never the one just typed: anyone can type into the
    // form, and this email goes to someone already on the list.
    const again = prayerAlreadyOnListEmail({ origin: await siteOrigin(), name: row.name ?? '', token: row.token });
    const sentAgain = await sendEmail({ to: email, from: PRAYER_FROM, replyTo: PRAYER_REPLY_TO, ...again });
    if (!sentAgain.ok) console.error('prayer sign-up (already on, email):', sentAgain.error);
    return { ok: true };
  }

  const now = new Date().toISOString();
  let saved = row;
  if (row) {
    const { error } = await db
      .from('prayer_list_subscribers')
      .update({ confirm_sent_at: now, ...(name ? { name } : {}) })
      .eq('id', row.id);
    if (error) {
      console.error('prayer sign-up (update):', error.message);
      return { ok: false, error: 'Sorry, the sign-up could not be saved. Please try again in a moment.' };
    }
  } else {
    const { data, error } = await db
      .from('prayer_list_subscribers')
      .insert({ email, name: name || null, confirm_sent_at: now })
      .select('id, token')
      .single();
    if (error) {
      console.error('prayer sign-up (insert):', error.message);
      return { ok: false, error: 'Sorry, the sign-up could not be saved. Please try again in a moment.' };
    }
    saved = data;
  }

  const mail = prayerConfirmEmail({ origin: await siteOrigin(), name, token: saved.token });
  const sent = await sendEmail({ to: email, from: PRAYER_FROM, replyTo: PRAYER_REPLY_TO, ...mail });
  // The email is the whole point here: without it the person cannot confirm,
  // so a failed send is said, not swallowed (like the contact form).
  if (!sent.ok) {
    return { ok: false, error: `Sorry, the confirmation email could not be sent. Please try again, or write to ${site.emails.pray}.` };
  }
  return { ok: true };
}

export async function confirmPrayerList(token) {
  if (!UUID.test(String(token ?? ''))) return { ok: false, error: 'This link is not complete. Please open it from the email again.' };
  const db = createAdminClient();
  if (!db) return { ok: false, error: NOT_ON };
  const { data, error } = await db
    .from('prayer_list_subscribers')
    .update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null })
    .eq('token', token)
    .select('email');
  if (error) {
    console.error('prayer confirm:', error.message);
    return { ok: false, error: 'Sorry, that did not save. Please try again in a moment.' };
  }
  if (!data?.length) return { ok: false, error: 'This link is no longer valid. Please sign up again on the Pray page.' };
  return { ok: true, email: data[0].email };
}

export async function unsubscribePrayerList(token) {
  if (!UUID.test(String(token ?? ''))) return { ok: false, error: 'This link is not complete. Please open it from the email again.' };
  const db = createAdminClient();
  if (!db) return { ok: false, error: NOT_ON };
  const { data, error } = await db
    .from('prayer_list_subscribers')
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq('token', token)
    .select('email');
  if (error) {
    console.error('prayer unsubscribe:', error.message);
    return { ok: false, error: 'Sorry, that did not save. Please try again in a moment.' };
  }
  if (!data?.length) return { ok: false, error: 'This link is no longer valid. The address may already be off the list.' };
  return { ok: true, email: data[0].email };
}
