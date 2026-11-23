import 'server-only';

// Inviting another adult to share a household (W75, 0174, 23 Nov 2026). The
// token is random and goes only into the emailed link; the database keeps its
// SHA-256 hash. The invite can be accepted only by a login whose own email is
// the one invited, so the link alone gets nobody in.

import { createHash, randomBytes } from 'node:crypto';
import { sendEmail, emailShell } from '@/lib/email';
import { createAdminClient } from '@/lib/supabase/admin';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function householdInviteEmail({ origin, token, householdName, inviterName, email }) {
  const href = `${origin}/auth/household-invite/?token=${encodeURIComponent(token)}`;
  const who = inviterName ? esc(inviterName) : 'Someone in your family';
  const subject = `${inviterName || 'Your family'} invited you to their Luke 14 Ministries household`;
  const html = emailShell({
    origin,
    title: 'Join your family on the Luke 14 Ministries site',
    bodyHtml: `<p style="margin:0 0 12px;">${who} invited you to share the <strong>${esc(householdName || 'family')}</strong> household on the Luke 14 Ministries site. You'll see the family's registrations, payments and details, and can help keep them up to date, with your own sign-in.</p>
<p style="margin:0 0 12px;">Press the button, then sign in, or create an account, with <strong>${esc(email)}</strong>. The invite works only for that address, and for 7 days.</p>
<p style="margin:0;">If you weren't expecting this, ignore this email and nothing changes.</p>`,
    buttonText: 'Open the invite',
    buttonHref: href,
  });
  return { subject, html };
}

export async function sendHouseholdInvite({ supabase, householdId, email, personId, origin, householdName, inviterName }) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const to = String(email ?? '').trim().toLowerCase();
  const { error } = await supabase.rpc('create_household_invite', {
    p_household_id: householdId,
    p_email: to,
    p_person_id: personId || null,
    p_token_hash: tokenHash,
  });
  if (error) return { ok: false, error: error.message };

  const { subject, html } = householdInviteEmail({ origin, token, householdName, inviterName, email: to });
  const sent = await sendEmail({ to, subject, html });

  // In the household's Emails sent, without its body: the body holds the link.
  const admin = createAdminClient();
  if (admin) {
    const { error: logError } = await admin.from('message_log').insert({
      to_email: to,
      household_id: householdId,
      template_key: 'household_invite',
      subject: String(subject).slice(0, 300),
      status: sent?.ok ? 'sent' : 'failed',
      error: sent?.ok ? null : String(sent?.error ?? '').slice(0, 1000),
      provider_message_id: sent?.id ?? null,
      body_text: '(Invite to share the household. The link is not kept.)',
    });
    if (logError) console.error('household invite log:', logError.message);
  }
  if (!sent?.ok) {
    return { ok: false, error: `The invite to ${to} was saved but the email could not be sent. Cancel it and try again in a minute.` };
  }
  return { ok: true, message: `Invite sent to ${to}. It works for 7 days.` };
}
