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
import { verifyTurnstile, turnstileConfigured } from '@/lib/turnstile';
import { siteOrigin } from '@/lib/origin';
import { site } from '@/lib/site';
import {
  PRAYER_FROM,
  PRAYER_REPLY_TO,
  PRAYER_MAX,
  PRAYER_REMOVED_BY_STAFF,
  prayerConfirmEmail,
  prayerAlreadyOnListEmail,
  prayerRemovedByStaffEmail,
} from '@/lib/prayer';

const NOT_ON = `The prayer email list sign-up is not switched on yet. Please write to ${site.emails.pray} and the prayer team will add you.`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One confirmation email per address per ten minutes, so the form cannot be
// used to fill someone's inbox.
const RESEND_AFTER_MS = 10 * 60 * 1000;

export async function signUpForPrayerList(form) {
  const name = String(form?.name ?? '').trim().slice(0, PRAYER_MAX.name);
  const email = String(form?.email ?? '').trim().toLowerCase().slice(0, PRAYER_MAX.email);
  if (!emailLooksValid(email)) {
    return { ok: false, error: 'That email address doesn’t look right. Please check it.' };
  }

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  // Shut on the live site when the check cannot run (23 Nov 2026): this form
  // sends an email to whatever address is typed. Contact stays open.
  // Shut only when the check is set up and still cannot run (Cloudflare down).
  // With the keys missing it stays open as before, logs loudly, and Setup's
  // health line says NOT RUNNING (24 Nov 2026: the live keys could not be
  // confirmed after the review's push, and a missing key would have turned
  // every gift away; a guess, flagged for Lawrence).
  const check = await verifyTurnstile(form?.captchaToken, ip, {
    failOpen: process.env.VERCEL_ENV !== 'production' || !turnstileConfigured(),
    action: 'prayer',
  });
  if (check.unavailable) {
    return {
      ok: false,
      error: `The sign-up is having trouble just now. Please try again in a few minutes, or write to ${site.emails.pray} and the prayer team will add you.`,
    };
  }
  if (!check.ok) {
    return { ok: false, error: 'That check timed out. Please check the box again and resend.', retryCaptcha: true };
  }

  const db = createAdminClient();
  if (!db) return { ok: false, error: NOT_ON };

  const { data: row, error: readError } = await db
    .from('prayer_list_subscribers')
    .select('id, token, confirmed_at, unsubscribed_at, confirm_sent_at, removed_by_staff_at')
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
    const again = prayerAlreadyOnListEmail({ origin: await siteOrigin(), token: row.token });
    const sentAgain = await sendEmail({ to: email, from: PRAYER_FROM, replyTo: PRAYER_REPLY_TO, ...again });
    if (!sentAgain.ok) console.error('prayer sign-up (already on, email):', sentAgain.error);
    return { ok: true };
  }

  // Taken off by the prayer team (0181, 23 Nov 2026): not signed up again.
  // The form gives its usual answer, so a visitor learns nothing about the
  // address; the mailbox owner is told to write to pray@ to rejoin. Stamped
  // first, so this too goes at most once per ten minutes.
  if (row?.removed_by_staff_at) {
    const { error: stampError } = await db
      .from('prayer_list_subscribers')
      .update({ confirm_sent_at: new Date().toISOString() })
      .eq('id', row.id);
    if (stampError) {
      console.error('prayer sign-up (removed by staff, stamp):', stampError.message);
      return { ok: true };
    }
    const told = await sendEmail({
      to: email,
      from: PRAYER_FROM,
      replyTo: PRAYER_REPLY_TO,
      ...prayerRemovedByStaffEmail({ origin: await siteOrigin() }),
    });
    if (!told.ok) console.error('prayer sign-up (removed by staff, email):', told.error);
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

  const mail = prayerConfirmEmail({ origin: await siteOrigin(), token: saved.token });
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
  // An address the prayer team took off stays off (0181, 23 Nov 2026), even
  // from an old confirmation link still in the inbox. The update repeats the
  // test, so a removal between the read and the write still wins.
  const { data: found, error: readError } = await db
    .from('prayer_list_subscribers')
    .select('removed_by_staff_at')
    .eq('token', token)
    .maybeSingle();
  if (readError) {
    console.error('prayer confirm (read):', readError.message);
    return { ok: false, error: 'Sorry, that did not save. Please try again in a moment.' };
  }
  if (!found) return { ok: false, error: 'This link is no longer valid. Please sign up again on the Pray page.' };
  if (found.removed_by_staff_at) return { ok: false, error: PRAYER_REMOVED_BY_STAFF };
  const { data, error } = await db
    .from('prayer_list_subscribers')
    .update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null })
    .eq('token', token)
    .is('removed_by_staff_at', null)
    .select('email');
  if (error) {
    console.error('prayer confirm:', error.message);
    return { ok: false, error: 'Sorry, that did not save. Please try again in a moment.' };
  }
  if (!data?.length) return { ok: false, error: PRAYER_REMOVED_BY_STAFF };
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
