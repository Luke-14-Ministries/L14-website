import 'server-only';

// Inviting another adult to share a household (W75, 0174, 23 Nov 2026). The
// token is random and goes only into the emailed link; the database keeps its
// SHA-256 hash. The invite can be accepted only by a login whose own email is
// the one invited, so the link alone gets nobody in.
//
// 23 Nov 2026 (security review, 0178): the email goes to an address the
// family typed, so nothing in it is left for the sender to write. The subject
// is fixed, and the inviter's and household's names are cut to 60 characters
// and replaced by plain words when they look like a link. Logging is done as
// the family (logOwnEmail), not with the service-role key. After a join, the
// household's contact address and the inviter hear about it.

import { createHash, randomBytes } from 'node:crypto';
import { sendEmail, emailShell, logOwnEmail } from '@/lib/email';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const INVITE_SUBJECT = 'You are invited to share a household on the Luke 14 Ministries site';

// A name a family typed, safe to put in an email to someone else: at most 60
// characters, and never anything that reads as a link or spans lines (a
// "name" like "Click www.example.com" would otherwise ride in our email).
export function safeName(value, fallback) {
  const s = String(value ?? '').trim();
  if (!s || /https?|www\.|:\/\/|[\r\n]/i.test(s)) return fallback;
  return s.length > 60 ? `${s.slice(0, 59).trimEnd()}…` : s;
}

// "the ___" for a household's name (23 Nov 2026, A5-06): "Jane Smith" reads
// "Jane Smith household", while a name that already ends in household or
// family is left alone, so nothing says "the Smith Household household".
export function householdPhrase(name) {
  const s = String(name ?? '').trim();
  if (!s) return 'family';
  return /\b(household|family)$/i.test(s) ? s : `${s} household`;
}

// Why an invite could not be accepted, as a short code for the URL (23 Nov
// 2026, S3-14). The page used to print whatever ?error= said, so a link could
// put any sentence on our page ("Call this number…"). Now only these codes
// travel, and the page shows the fixed sentence for a code it knows.
const PROBLEM_BY_MESSAGE = [
  [/different email address/i, 'different-address'],
  [/already been used/i, 'used'],
  [/was cancelled/i, 'cancelled'],
  [/has expired/i, 'expired'],
  [/already has a household/i, 'has-household'],
  [/not valid|not complete/i, 'not-valid'],
];

export const INVITE_PROBLEMS = {
  'different-address': 'This invite was sent to a different email address. Sign in with that address to accept it.',
  used: 'This invite has already been used.',
  cancelled: 'This invite was canceled. Ask your family to send a new one from Manage household.',
  expired: 'This invite has expired. Ask your family to send a new one from Manage household.',
  'has-household':
    'Your sign-in already has a household on the site with its own records. Email registration@luke14ministries.net and staff will join the two.',
  'not-valid': 'This invite link is not valid. Open it again from the email, or ask your family to send a new invite.',
  failed: 'The invite could not be accepted. Please try again, or email registration@luke14ministries.net.',
};

// A database message to its code. Anything not on the list is logged by the
// caller and shown as "failed".
export function inviteProblemCode(message) {
  const hit = PROBLEM_BY_MESSAGE.find(([re]) => re.test(String(message ?? '')));
  return hit ? hit[1] : null;
}

// The sentence for a code from the URL, or null for anything else.
export function inviteProblemText(code) {
  return typeof code === 'string' && Object.hasOwn(INVITE_PROBLEMS, code) ? INVITE_PROBLEMS[code] : null;
}

export function householdInviteEmail({ origin, token, householdName, inviterName, email }) {
  const href = `${origin}/auth/household-invite/?token=${encodeURIComponent(token)}`;
  const who = esc(safeName(inviterName, 'Someone in your family'));
  const household = esc(householdPhrase(safeName(householdName, '')));
  const html = emailShell({
    origin,
    title: 'Join your family on the Luke 14 Ministries site',
    bodyHtml: `<p style="margin:0 0 12px;">${who} invited you to share the <strong>${household}</strong> on the Luke 14 Ministries site. You'll see the family's registrations, payments and details, and can help keep them up to date, with your own sign-in.</p>
<p style="margin:0 0 12px;">Press the button, then sign in, or create an account, with <strong>${esc(email)}</strong>. The invite works only for that address, and for 7 days.</p>
<p style="margin:0;">If you weren't expecting this, ignore this email and nothing changes.</p>`,
    buttonText: 'Open the invite',
    buttonHref: href,
  });
  return { subject: INVITE_SUBJECT, html };
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
  await logOwnEmail(supabase, {
    householdId,
    to,
    templateKey: 'household_invite',
    subject,
    sent,
    bodyText: '(Invite to share the household. The link is not kept.)',
  });
  if (!sent?.ok) {
    return { ok: false, error: `The invite to ${to} was saved but the email could not be sent. Cancel it and try again in a minute.` };
  }
  return { ok: true, message: `Invite sent to ${to}. It works for 7 days.` };
}

// The notice after a join (0178): so a login added by mistake, or by someone
// who should not have, does not go unnoticed by the family.
export function householdJoinedEmail({ origin, loginName, loginEmail, householdName }) {
  const who = esc(safeName(loginName, 'A family member'));
  const household = esc(householdPhrase(safeName(householdName, '')));
  const subject = 'Someone new can sign in to your Luke 14 Ministries household';
  const lines = [
    `${safeName(loginName, 'A family member')} (${loginEmail}) now shares the ${householdPhrase(safeName(householdName, ''))} on the Luke 14 Ministries site, with their own sign-in.`,
    'They can see and change the family’s registrations, payments and details.',
    'If you did not expect this, write to registration@luke14ministries.net.',
  ];
  const html = emailShell({
    origin,
    title: 'A new sign-in on your household',
    bodyHtml: `<p style="margin:0 0 12px;"><strong>${who}</strong> (${esc(loginEmail)}) now shares the <strong>${household}</strong> on the Luke 14 Ministries site, with their own sign-in. They can see and change the family's registrations, payments and details.</p>
<p style="margin:0;">If you did not expect this, write to <a href="mailto:registration@luke14ministries.net" style="color:#ffffff;">registration@luke14ministries.net</a>.</p>`,
  });
  return { subject, html, text: lines.join('\n\n') };
}

// Sends the join notice to the household's contact address and, if it is a
// different address, to the person who sent the invite. Called by the accept
// route as the new member (who now belongs to the household, so the log
// accepts it). A failure here is logged and never undoes the join.
export async function sendJoinNotices({ supabase, origin, joined }) {
  if (!joined?.joined) return;
  const login = String(joined.login_email ?? '').toLowerCase();
  const recipients = [...new Set([joined.contact_email, joined.inviter_email].map((e) => String(e ?? '').trim().toLowerCase()))]
    .filter((e) => e && e !== login);
  if (recipients.length === 0) return;
  const { data: hh, error } = await supabase
    .from('households')
    .select('display_name')
    .eq('id', joined.household_id)
    .maybeSingle();
  if (error) console.error('join notice (household name):', error.message);
  const mail = householdJoinedEmail({
    origin,
    loginName: joined.login_name,
    loginEmail: login,
    householdName: hh?.display_name ?? '',
  });
  for (const to of recipients) {
    const sent = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    await logOwnEmail(supabase, {
      householdId: joined.household_id,
      to,
      templateKey: 'household_login_added',
      subject: mail.subject,
      sent,
      bodyText: mail.text,
    });
  }
}
