// The words of a staff email to families (/admin/email-families, 22 Oct 2026).
//
// Pure -- no server code, no secrets -- so the page's preview (in the
// browser) and the send (lib/email.js familyUpdateEmail, on the server) build
// the message from the same function, and what staff read before pressing
// Send is exactly what each family receives.
//
// The email is: the staff member's message, as typed (blank lines make
// paragraphs); then, for a "waiver outstanding" send, one line per person
// still owing a waiver and the link to the family's Activities page; then
// "Luke 14 Ministries".

export const FAMILY_EMAIL_SIGNOFF = 'Luke 14 Ministries';

// One person's outstanding waiver, in the family's words. `item` is a row of
// activity_waivers_outstanding (0120) with the person's first name added:
// { activityName, personName, kind: 'ours' | 'provider', agreementTitle,
//   uploadStatus: 'missing' | 'rejected' (provider rows, 0124), reviewNote }.
export function waiverLine(item) {
  const who = item.personName || 'Someone';
  if (item.kind === 'provider' && item.uploadStatus === 'rejected') {
    return `${item.activityName}: camp staff couldn't accept the confirmation uploaded for ${who} (${item.reviewNote || 'no reason given'}). Please upload it again.`;
  }
  if (item.kind === 'provider') {
    return `${item.activityName}: ${who} needs the outfitter's confirmation uploaded.`;
  }
  return `${item.activityName}: ${who} needs ${item.agreementTitle ? `the ${item.agreementTitle}` : 'the waiver'} signed.`;
}

export function familyEmailParts({ message, items = [], activitiesUrl = null }) {
  const paragraphs = String(message ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const lines = items.map(waiverLine);
  const linesHeading = lines.length ? 'Still needed:' : '';
  const linkIntro = activitiesUrl ? 'You can sign or upload on your Activities page' : '';
  const text = [
    ...paragraphs,
    lines.length ? [linesHeading, ...lines].join('\n') : null,
    activitiesUrl ? `${linkIntro}: ${activitiesUrl}` : null,
    FAMILY_EMAIL_SIGNOFF,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { paragraphs, lines, linesHeading, linkIntro, signoff: FAMILY_EMAIL_SIGNOFF, text };
}
