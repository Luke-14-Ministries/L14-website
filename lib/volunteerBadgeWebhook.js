// VolunteerBadge's webhook, the parts that need no server (Lawrence, 14 Nov
// 2026: "lets build now"). The route is app/api/webhooks/volunteerbadge/.
//
// Only one event is used: application.submitted, which VB documents as
// { applicationId, volunteerId, templateId, submittedAt }. The applicationId
// is the one POST /applications gave us at sending (vb_application_id), so it
// names exactly which invite the volunteer used, with no address matching.
// Every other event is answered and ignored: check results are still read
// with GET /checks/{id} (the daily job and Refresh), and volunteer.created
// carries a phone number, which this site never takes in.
//
// VB signs each delivery: X-VolunteerBadge-Signature is the hex HMAC-SHA256
// of the raw body with the endpoint's secret (VOLUNTEERBADGE_WEBHOOK_SECRET,
// set in Vercel by Lawrence, never pasted anywhere). VB has no replay window
// and never retries, so the handler is idempotent and the daily job stays
// the backstop. No server-only imports, so `npm run test:lib` loads it.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_BODY_BYTES = 64 * 1024;
const IDISH = /^[A-Za-z0-9_-]{1,100}$/;

// Is this body signed with our secret? Never throws.
export function signatureOk(rawBody, header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const given = header.trim().toLowerCase().replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const want = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(given, 'hex');
  const b = Buffer.from(want, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// What a (signed) delivery asks of us: { applicationId, volunteerId } for an
// application.submitted with both ids, or { ignore: why }. Reads nothing
// else from the body.
export function readSubmitted(rawBody, eventHeader) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ignore: 'not JSON' };
  }
  const event = String(body?.event ?? eventHeader ?? '');
  if (event !== 'application.submitted') return { ignore: 'not an event this site uses' };
  if (eventHeader && eventHeader !== event) return { ignore: 'event header and body disagree' };
  const applicationId = String(body?.data?.applicationId ?? '');
  const volunteerId = String(body?.data?.volunteerId ?? '');
  if (!IDISH.test(applicationId) || !IDISH.test(volunteerId)) return { ignore: 'no application or volunteer id' };
  return { applicationId, volunteerId };
}
