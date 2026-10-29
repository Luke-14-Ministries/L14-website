// WHAT each automatic email says (27 Oct 2026). The words are the draft's
// (01 Plans and Decisions\Luke14-Automatic-Emails-Draft.pdf, §2-§5), still
// for Ellen and Katie to mark up: change them here, in one place.
//
// A family gets at most one email a day (draft §1), so each kind is a
// SECTION -- a heading, a paragraph or two, a link -- and composeFamilyEmail()
// puts a day's sections into one email. Every section has an HTML and a
// plain-text form: the plain text goes with the email and is what
// message_log keeps under "What it said" (0134).

import { emailShell } from '../email.js';
import { dollars } from '../payments.js';
import { formatDueDate, formatDueDateShort } from '../events.js';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const link = (href, text) => `<a href="${esc(href)}" style="color:#ffffff;text-decoration:underline;">${esc(text)}</a>`;
const names = (list) =>
  list.length <= 1 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;

// Each returns { subject, heading, html, text }. `o` is the site's origin.
const SECTIONS = {
  // §2.1 -- 1 week before each automatic payment (10 days for a bank account).
  plan_upcoming: (i, o) => ({
    subject: `Your next payment for ${i.eventName} — ${formatDueDateShort(i.dueOn)}`,
    heading: `Your next payment — ${i.eventName}`,
    text:
      `Your next payment-plan payment for ${i.eventName} will be taken on ${formatDueDate(i.dueOn)}: about ` +
      `${dollars(i.amountCents)}${i.methodLabel ? ` from ${i.methodLabel}` : ''}. The exact amount is worked out that ` +
      `morning from what is still owed, so a scholarship or an extra payment makes it smaller. Nothing to do if ` +
      `that card or account is still right. To use a different one, open your family dashboard and choose ` +
      `"Change card or bank account": ${o}/account/dashboard/`,
    html:
      `<p>Your next payment-plan payment for <strong>${esc(i.eventName)}</strong> will be taken on ` +
      `<strong>${esc(formatDueDate(i.dueOn))}</strong>: about <strong>${dollars(i.amountCents)}</strong>` +
      `${i.methodLabel ? ` from ${esc(i.methodLabel)}` : ''}.</p>` +
      `<p>The exact amount is worked out that morning from what is still owed, so a scholarship or an extra ` +
      `payment makes it smaller. Nothing to do if that card or account is still right. To use a different one, ` +
      `open your ${link(`${o}/account/dashboard/`, 'family dashboard')} and choose <em>Change card or bank account</em>.</p>`,
  }),

  // §2.2 -- the morning after the plan's last payment.
  plan_finished: (i, o) => ({
    subject: `Paid in full — ${i.eventName}`,
    heading: `Paid in full — ${i.eventName}`,
    text:
      `Your last payment-plan payment came through, so ${i.eventName} is paid in full. Thank you — and thank you ` +
      `for spreading it out the way that worked for your family. Your statement, with every payment, is on your ` +
      `family dashboard: ${o}/account/dashboard/`,
    html:
      `<p>Your last payment-plan payment came through, so <strong>${esc(i.eventName)}</strong> is paid in full. ` +
      `Thank you — and thank you for spreading it out the way that worked for your family.</p>` +
      `<p>Your statement, with every payment, is on your ${link(`${o}/account/dashboard/`, 'family dashboard')}.</p>`,
  }),

  // §2.3 -- the plan's card expires before its last payment.
  card_expiring: (i, o) => ({
    subject: 'The card for your payment plan expires soon',
    heading: 'Your payment-plan card expires soon',
    text:
      `The card your payment plan uses for ${i.eventName} (${i.cardLabel}) expires at the end of ${i.expiryMonth}, ` +
      `before your last payment on ${formatDueDateShort(i.finalOn)}. To keep the payments going, open your family ` +
      `dashboard and choose "Change card or bank account" — it takes about a minute: ${o}/account/dashboard/`,
    html:
      `<p>The card your payment plan uses for <strong>${esc(i.eventName)}</strong> (${esc(i.cardLabel)}) expires ` +
      `at the end of <strong>${esc(i.expiryMonth)}</strong>, before your last payment on ` +
      `${esc(formatDueDateShort(i.finalOn))}.</p>` +
      `<p>To keep the payments going, open your ${link(`${o}/account/dashboard/`, 'family dashboard')} and choose ` +
      `<em>Change card or bank account</em> — it takes about a minute.</p>`,
  }),

  // §3.1 -- the deposit is still owed.
  deposit: (i, o) => ({
    subject: `One step left: the deposit for ${i.eventName}`,
    heading: `The deposit for ${i.eventName}`,
    text:
      `Thank you for registering for ${i.eventName}. Camp staff approve a registration once its deposit arrives: ` +
      `${dollars(i.depositCents)} for your family${i.heads > 1 ? ` (${dollars(i.perPersonCents)} for each person registered)` : ''}. ` +
      `You can pay it, set up a payment plan (no extra fee), or ask for help with the fee from Ways to pay on your ` +
      `family dashboard: ${o}/account/finish/${i.registrationId}/`,
    html:
      `<p>Thank you for registering for <strong>${esc(i.eventName)}</strong>. Camp staff approve a registration ` +
      `once its deposit arrives: <strong>${dollars(i.depositCents)}</strong> for your family` +
      `${i.heads > 1 ? ` (${dollars(i.perPersonCents)} for each person registered)` : ''}.</p>` +
      `<p>You can pay it, set up a payment plan (no extra fee), or ask for help with the fee from ` +
      `${link(`${o}/account/finish/${i.registrationId}/`, 'Ways to pay')}.</p>`,
  }),

  // §3.2 -- a balance is still owed (not on a plan).
  balance: (i, o) => ({
    subject: `Your balance for ${i.eventName}${i.dueOn ? ` — due ${formatDueDateShort(i.dueOn)}` : ''}`,
    heading: `Your balance for ${i.eventName}`,
    text:
      `A friendly reminder that ${dollars(i.balanceCents)} is still owed for ${i.eventName}` +
      `${i.dueOn ? `, due by ${formatDueDate(i.dueOn)}` : ''}. You can pay it all at once, pay part now, or spread ` +
      `it over a payment plan at no extra cost — paying from a bank account sends more of every dollar to camp. ` +
      `If the cost is a worry, you can ask for help from the same page, and staff will be in touch: ` +
      `${o}/account/finish/${i.registrationId}/`,
    html:
      `<p>A friendly reminder that <strong>${dollars(i.balanceCents)}</strong> is still owed for ` +
      `<strong>${esc(i.eventName)}</strong>${i.dueOn ? `, due by <strong>${esc(formatDueDate(i.dueOn))}</strong>` : ''}. ` +
      `You can pay it all at once, pay part now, or spread it over a payment plan at no extra cost — paying from a ` +
      `bank account sends more of every dollar to camp.</p>` +
      `<p>If the cost is a worry, you can ask for help from the same page, and staff will be in touch. ` +
      `${link(`${o}/account/finish/${i.registrationId}/`, 'Ways to pay')}</p>`,
  }),

  // §3.3 -- weekly after the due date.
  past_due: (i, o) => ({
    subject: `Your balance for ${i.eventName} is past due`,
    heading: `Your balance for ${i.eventName} is past due`,
    text:
      `Our records show ${dollars(i.balanceCents)} still owed for ${i.eventName}, which was due on ` +
      `${formatDueDate(i.dueOn)}. If a payment is already on its way, thank you, and please ignore this. If ` +
      `something has changed, reply to this email or call (423) 748-4954 — we would much rather talk than have ` +
      `anyone miss camp. Ways to pay: ${o}/account/finish/${i.registrationId}/`,
    html:
      `<p>Our records show <strong>${dollars(i.balanceCents)}</strong> still owed for <strong>${esc(i.eventName)}</strong>, ` +
      `which was due on ${esc(formatDueDate(i.dueOn))}. If a payment is already on its way, thank you, and please ` +
      `ignore this.</p><p>If something has changed, reply to this email or call (423) 748-4954 — we would much ` +
      `rather talk than have anyone miss camp. ${link(`${o}/account/finish/${i.registrationId}/`, 'Ways to pay')}</p>`,
  }),

  // §4 -- what is still needed, one line each with its own link.
  missing_details: (i) => ({
    subject: `A few things still needed for ${i.eventName}`,
    heading: `Still needed for ${i.eventName}`,
    text:
      `Before camp, we still need:\n` +
      i.lines.map((l) => `- ${l.text}${l.href ? ` (${l.href})` : ''}`).join('\n') +
      `\nEach takes a few minutes. If you are stuck on any of it, reply to this email and we will help.`,
    html:
      `<p>Before camp, we still need:</p><ul style="margin:0 0 12px 18px;padding:0;">` +
      i.lines.map((l) => `<li style="margin:0 0 6px;">${esc(l.text)}${l.href ? ` — ${link(l.href, l.action ?? 'open it')}` : ''}</li>`).join('') +
      `</ul><p>Each takes a few minutes. If you are stuck on any of it, reply to this email and we will help.</p>`,
  }),

  // §5.1 -- staff confirmed someone.
  confirmed: (i) => ({
    subject: `${names(i.names)} ${i.names.length > 1 ? 'are' : 'is'} confirmed for ${i.eventName}`,
    heading: `Confirmed for ${i.eventName}`,
    text:
      `Good news: ${names(i.names)} ${i.names.length > 1 ? 'are' : 'is'} confirmed for ${i.eventName}.` +
      `${i.balanceCents > 0 && i.dueOn ? ` The balance of ${dollars(i.balanceCents)} is due by ${formatDueDate(i.dueOn)}.` : ''} ` +
      `We will send what you need to know before camp nearer the time.`,
    html:
      `<p>Good news: <strong>${esc(names(i.names))}</strong> ${i.names.length > 1 ? 'are' : 'is'} confirmed for ` +
      `<strong>${esc(i.eventName)}</strong>.` +
      `${i.balanceCents > 0 && i.dueOn ? ` The balance of ${dollars(i.balanceCents)} is due by ${esc(formatDueDate(i.dueOn))}.` : ''}` +
      ` We will send what you need to know before camp nearer the time.</p>`,
  }),

  // §5.2 -- off the waitlist.
  off_waitlist: (i) => ({
    subject: `A place has opened for ${names(i.names)} — ${i.eventName}`,
    heading: `A place has opened — ${i.eventName}`,
    text:
      `A place has opened at ${i.eventName}, and ${names(i.names)} ${i.names.length > 1 ? 'are' : 'is'} now ` +
      `confirmed. If plans have changed and ${i.names.length > 1 ? 'they' : names(i.names)} can no longer come, ` +
      `please let us know from your dashboard so the place can go to someone else.`,
    html:
      `<p>A place has opened at <strong>${esc(i.eventName)}</strong>, and <strong>${esc(names(i.names))}</strong> ` +
      `${i.names.length > 1 ? 'are' : 'is'} now confirmed. If plans have changed and ` +
      `${esc(i.names.length > 1 ? 'they' : names(i.names))} can no longer come, please let us know from your ` +
      `dashboard so the place can go to someone else.</p>`,
  }),

  // §5.3 -- started, not submitted.
  not_submitted: (i, o) => ({
    subject: `Your registration for ${i.eventName} isn't finished yet`,
    heading: `Your registration for ${i.eventName}`,
    text:
      `You started registering for ${i.eventName} but haven't submitted it yet. Everything you entered is saved — ` +
      `pick up where you left off from your dashboard. You can submit your completed registration without payment ` +
      `(but the deposit must be paid for your registration to be accepted). ${o}/account/dashboard/`,
    html:
      `<p>You started registering for <strong>${esc(i.eventName)}</strong> but haven't submitted it yet. Everything ` +
      `you entered is saved — pick up where you left off from your ${link(`${o}/account/dashboard/`, 'dashboard')}.</p>` +
      `<p>You can submit your completed registration without payment (but the deposit must be paid for your ` +
      `registration to be accepted).</p>`,
  }),
};

export const REMINDER_KINDS = Object.keys(SECTIONS);

// One family's email for the day: one section per item, the household's name
// at the top, one button to the dashboard. A single item keeps its own
// subject; several share a plain one.
export function composeFamilyEmail({ origin, householdName, items }) {
  const parts = items.map((i) => ({ kind: i.kind, ...SECTIONS[i.kind](i, origin) }));
  const events = [...new Set(items.map((i) => i.eventName).filter(Boolean))];
  const subject =
    parts.length === 1
      ? parts[0].subject
      : events.length === 1
        ? `A few things for ${events[0]}`
        : 'A few things from Luke 14 Ministries';
  const hello = householdName ? `Hello ${householdName},` : 'Hello,';
  const many = parts.length > 1;
  const bodyHtml =
    `<p>${esc(hello)}</p>` +
    parts
      .map((p) => (many ? `<h2 style="margin:20px 0 6px;font-size:17px;color:#ffffff;">${esc(p.heading)}</h2>${p.html}` : p.html))
      .join('');
  const text =
    `${hello}\n\n` +
    parts.map((p) => (many ? `${p.heading}\n${p.text}` : p.text)).join('\n\n') +
    `\n\nQuestions? Reply to this email or call (423) 748-4954.\nLuke 14 Ministries`;
  const html = emailShell({
    origin,
    title: many ? subject : parts[0].heading,
    bodyHtml,
    buttonText: 'Open my dashboard',
    buttonHref: `${origin}/account/dashboard/`,
  });
  return { subject, html, text };
}

// §5.6 -- the Monday summary for staff.
export function composeStaffSummary({ origin, counts, upcoming }) {
  const rows = [
    ['Waiting on staff (people to review)', counts.waitingOnStaff],
    ['Families who wrote back, unread', counts.familyReplies],
    ['Payment plan problems', counts.planProblems],
    ['Waiver confirmations to check', counts.waiversToCheck],
    ['Scholarship requests to decide', counts.scholarships],
    ['Refunds pending over 10 days', counts.staleRefunds],
  ];
  const subject = `This week: ${counts.waitingOnStaff} ${counts.waitingOnStaff === 1 ? 'person' : 'people'} waiting on staff`;
  const text =
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nAutomatic emails due in the next 7 days: ${upcoming}.\nStaff area: ${origin}/admin/`;
  const bodyHtml =
    `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;">` +
    rows
      .map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#e7efed;">${esc(k)}</td><td style="padding:3px 0;font-weight:bold;">${v}</td></tr>`)
      .join('') +
    `</table><p style="margin-top:14px;">Automatic emails due to families in the next 7 days: <strong>${upcoming}</strong>.</p>`;
  return {
    subject,
    text,
    html: emailShell({ origin, title: 'The week ahead', bodyHtml, buttonText: 'Open the staff area', buttonHref: `${origin}/admin/` }),
  };
}
