import 'server-only';

// A family's contact email (households.email), confirmed before it is used
// (0171, Lawrence 23 Nov 2026). Reminders, staff emails and checkout receipts
// all go to that address, so a typo there used to mean a family silently
// missed everything. Now a new address gets a link, and the old one keeps
// getting mail until the link is pressed. The family's own login email needs
// no link: Supabase confirmed it at sign-up.
//
// The token is random and goes only into the emailed link; the database keeps
// its SHA-256 hash, so a leaked table row confirms nothing.
//
// 23 Nov 2026 (security review, 0178): at most 5 links a household a day (the
// database refuses the sixth); each send is logged as the family
// (logOwnEmail), not with the service-role key; and once an address changes,
// the address it replaced gets one notice, so a change nobody in the family
// made does not go unnoticed.

import { createHash, randomBytes } from 'node:crypto';
import { sendEmail, emailShell, logOwnEmail } from '@/lib/email';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function contactEmailConfirmEmail({ origin, token, newEmail, oldEmail }) {
  const href = `${origin}/auth/confirm-contact/?token=${encodeURIComponent(token)}`;
  const subject = 'Please confirm your contact email for Luke 14 Ministries';
  const html = emailShell({
    origin,
    title: 'Confirm your contact email',
    bodyHtml: `<p style="margin:0 0 12px;">Someone signed in to a Luke 14 Ministries family account asked to use <strong>${esc(newEmail)}</strong> as the household's contact email. That is where camp reminders and payment receipts go.</p>
<p style="margin:0 0 12px;">Press the button to confirm. ${
      oldEmail
        ? `Until you do, email keeps going to ${esc(oldEmail)}.`
        : 'Until you do, email goes to the address the account signs in with.'
    } The link works for 3 days.</p>
<p style="margin:0;">If this wasn't you, ignore this email and nothing changes.</p>`,
    buttonText: 'Confirm this email',
    buttonHref: href,
  });
  return { subject, html };
}

// The notice to the address that was replaced (0178).
export function contactEmailChangedEmail({ origin, newEmail }) {
  const subject = 'Your Luke 14 Ministries contact email was changed';
  const text = [
    `The contact email for your family's account on the Luke 14 Ministries site is now ${newEmail}.`,
    'Camp reminders and payment receipts go there from now on, not to this address.',
    'If you did not expect this, write to registration@luke14ministries.net.',
  ].join('\n\n');
  const html = emailShell({
    origin,
    title: 'Your contact email was changed',
    bodyHtml: `<p style="margin:0 0 12px;">The contact email for your family's account on the Luke 14 Ministries site is now <strong>${esc(newEmail)}</strong>. Camp reminders and payment receipts go there from now on, not to this address.</p>
<p style="margin:0;">If you did not expect this, write to <a href="mailto:registration@luke14ministries.net" style="color:#ffffff;">registration@luke14ministries.net</a>.</p>`,
  });
  return { subject, html, text };
}

const sameAddress = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// After a link is pressed on the signed-out confirm page. Logged through
// log_contact_change_notice(), which needs the link's own token and writes
// once. A failure is noted and never undoes the change.
export async function noticeAfterConfirm({ supabase, origin, token, newEmail, previousEmail }) {
  if (!previousEmail || sameAddress(previousEmail, newEmail)) return;
  const mail = contactEmailChangedEmail({ origin, newEmail });
  const sent = await sendEmail({ to: previousEmail, subject: mail.subject, html: mail.html, text: mail.text });
  const { error } = await supabase.rpc('log_contact_change_notice', {
    p_token: token,
    p_status: sent?.ok ? 'sent' : 'failed',
    p_provider_message_id: sent?.id ?? null,
    p_error: sent?.ok ? null : String(sent?.error ?? '').slice(0, 1000),
  });
  if (error) console.error('contact email change notice log:', error.message);
}

// Ask for a new contact address. Returns { ok, status, error }:
//   status 'unchanged' -- it is already the contact email;
//   status 'applied'   -- it is the login email, set straight away;
//   status 'pending'   -- a link was emailed to it.
export async function requestContactEmailChange({ supabase, householdId, email, origin, oldEmail }) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const { data: status, error } = await supabase.rpc('request_household_email_change', {
    p_household_id: householdId,
    p_email: email,
    p_token_hash: tokenHash,
  });
  if (error) return { ok: false, error: error.message };
  if (status === 'applied' && oldEmail && !sameAddress(oldEmail, email)) {
    // Their own login email, set at once: tell the address it replaced.
    const newEmail = String(email).trim().toLowerCase();
    const mail = contactEmailChangedEmail({ origin, newEmail });
    const sent = await sendEmail({ to: oldEmail, subject: mail.subject, html: mail.html, text: mail.text });
    await logOwnEmail(supabase, {
      householdId,
      to: oldEmail,
      templateKey: 'contact_email_changed',
      subject: mail.subject,
      sent,
      bodyText: mail.text,
    });
  }
  if (status !== 'pending') return { ok: true, status };

  const to = String(email).trim().toLowerCase();
  const { subject, html } = contactEmailConfirmEmail({ origin, token, newEmail: to, oldEmail });
  const sent = await sendEmail({ to, subject, html });

  // In the family's Emails sent like every other email to a family. The body
  // is left out on purpose: it carries the link, and a stored link would
  // confirm the address for whoever read the log.
  await logOwnEmail(supabase, {
    householdId,
    to,
    templateKey: 'contact_email_confirm',
    subject,
    sent,
    bodyText: '(Confirmation link for a new contact email. The link is not kept.)',
  });

  if (!sent?.ok) {
    return {
      ok: false,
      status,
      error: `The confirmation email to ${to} could not be sent. Please try again in a minute, or write to registration@luke14ministries.net.`,
    };
  }
  return { ok: true, status };
}

// The address Stripe's checkout starts with, so the receipt goes where the
// family's other camp email goes (Lawrence, 23 Nov 2026). The household's
// confirmed contact email, else the login's. The payer can still change it
// in checkout (a grandparent paying), and the webhook records what was used.
export async function checkoutEmail(supabase, registrationId, loginEmail) {
  const { data, error } = await supabase
    .from('registrations')
    .select('households ( email )')
    .eq('id', registrationId)
    .maybeSingle();
  if (error) console.error('checkout email (household):', error.message);
  return (data?.households?.email ?? '').trim() || loginEmail || undefined;
}
