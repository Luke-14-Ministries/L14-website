// The prayer list's emails (0141, Lawrence 28 Oct 2026): the "please
// confirm" email a sign-up gets, and the prayer email the team sends to the
// list. Plain module (no server-only imports), so the staff page's preview
// and the send use the same words.
//
// Sent from the prayer team's own address and replying to it, so a reply
// reaches the people who pray (lib/site.js, emails.pray). Every list email
// carries its own unsubscribe link in the footer AND in the List-Unsubscribe
// headers, which is what puts an "Unsubscribe" button in Gmail and Outlook
// (RFC 8058 one-click: a POST to /api/prayer/unsubscribe/, so a mail scanner
// fetching the link cannot unsubscribe anyone).

import { emailShell } from '@/lib/email';
import { site } from '@/lib/site';

export const PRAYER_FROM = `Luke 14 Prayer Team <${site.emails.pray}>`;
export const PRAYER_REPLY_TO = site.emails.pray;

export const PRAYER_MAX = { subject: 200, body: 20000, name: 120, email: 200 };

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Typed text to email HTML: a blank line starts a paragraph, a single line
// break stays a line break, and web addresses become links. Escaped first,
// so nothing typed can become markup.
export function prayerBodyHtml(body) {
  return String(body ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const html = esc(para)
        .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#F7B32B;">$1</a>')
        .replace(/\n/g, '<br/>');
      return `<p style="margin:0 0 12px;">${html}</p>`;
    })
    .join('');
}

export const unsubscribeUrl = (origin, token) => `${origin}/pray/unsubscribe/?t=${token}`;
export const oneClickUrl = (origin, token) => `${origin}/api/prayer/unsubscribe/?t=${token}`;

// One copy of the prayer email, for one person. `token` is null for a test
// send to a staff member, whose unsubscribe link then goes nowhere harmful.
export function prayerListEmail({ origin, subject, body, token }) {
  const unsub = token ? unsubscribeUrl(origin, token) : `${origin}/pray/unsubscribe/`;
  const footerHtml = `You are receiving this because you joined the Luke 14 Ministries prayer email list.
    <a href="${unsub}" style="color:#737373;">Unsubscribe</a> · Prayer requests: ${esc(site.emails.pray)}`;
  return {
    subject,
    html: emailShell({ origin, title: esc(subject), bodyHtml: prayerBodyHtml(body), footerHtml }),
    text: `${String(body ?? '').trim()}\n\n--\nYou are receiving this because you joined the Luke 14 Ministries prayer email list.\nUnsubscribe: ${unsub}\nPrayer requests: ${site.emails.pray}\n`,
    headers: token
      ? {
          'List-Unsubscribe': `<${oneClickUrl(origin, token)}>, <mailto:${site.emails.pray}?subject=Unsubscribe>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }
      : undefined,
  };
}

// The confirmation a new sign-up gets. Until it is pressed nothing else is
// sent, so nobody can put someone else on the list.
export function prayerConfirmEmail({ origin, name, token }) {
  const href = `${origin}/pray/confirm/?t=${token}`;
  const hello = name ? `Hello ${esc(name)},` : 'Hello,';
  return {
    subject: 'Please confirm: the Luke 14 Ministries prayer email list',
    html: emailShell({
      origin,
      title: 'Confirm your place on the prayer email list',
      bodyHtml: `<p style="margin:0 0 12px;">${hello}</p>
        <p style="margin:0 0 12px;">Thank you for joining the Luke 14 Ministries prayer email list. Press the button below to confirm, and the prayer emails will start coming to this address.</p>
        <p style="margin:0 0 12px;">If you did not sign up, ignore this email and nothing more will be sent.</p>`,
      buttonText: 'Yes, add me to the prayer email list',
      buttonHref: href,
      footerHtml: `Prayer requests: ${esc(site.emails.pray)}`,
    }),
    text: `${name ? `Hello ${name},` : 'Hello,'}\n\nThank you for joining the Luke 14 Ministries prayer email list. Open this link to confirm:\n${href}\n\nIf you did not sign up, ignore this email and nothing more will be sent.\n`,
  };
}
