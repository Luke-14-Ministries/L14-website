// The VolunteerBadge credit guard (Lawrence, 13 Nov 2026). Before any send (a
// batch, one invite, or a resend without the ID step) the balance must cover
// the people in this send PLUS every invite already out and not yet charged.
// VB most likely spends the credit when the volunteer submits and the check
// starts, not when the invite goes; so an invite out is a credit promised,
// and inviting more people than the balance covers would leave someone
// unable to finish.
//
// "Not yet charged" = sending, invited, or applied with no check started; and
// an invite taken back here or replaced by a resend, until its link expires,
// because VB's link still works and VB can still charge it (review, 13 Nov
// 2026). Once a check runs (processing, in_review) its credit is spent; an
// error or refund returns it. Asked of VB on the server each time; never the page's
// number. No server-only imports, so `npm run test:lib` loads it.

import { creditsFrom } from './volunteerBadgeApi.js';

export const UNCHARGED_STATUSES = ['sending', 'invited', 'applied'];

// { credits (number or null), outstanding } for live invites. `replacing`
// is an open invite this send replaces (a resend), not counted.
export async function creditPicture(supabase, api, { replacing = null } = {}) {
  const credits = await api.credits();
  const nowIso = new Date().toISOString();
  let q = supabase
    .from('volunteerbadge_requests')
    .select('id', { count: 'exact', head: true })
    .eq('sandbox', false)
    .or(
      `status.in.(${UNCHARGED_STATUSES.join(',')}),and(status.in.(cancelled,superseded),vb_application_id.not.is.null,or(apply_expires_at.is.null,apply_expires_at.gt."${nowIso}"))`
    );
  if (replacing) q = q.neq('id', replacing);
  const { count, error } = await q;
  if (error) throw new Error(`The invites already out couldn’t be counted: ${error.message}`);
  if (typeof count !== 'number') throw new Error('The invites already out couldn’t be counted.');
  return { credits: typeof credits === 'number' ? credits : creditsFrom(credits), outstanding: count };
}

// Refusal words, or null when the balance covers it.
export function creditShortfall({ credits, outstanding }, sending) {
  if (credits == null) {
    return 'VolunteerBadge didn’t say how many credits are left, so nothing was sent. Check its Billing page, then try again.';
  }
  const need = sending + outstanding;
  if (credits >= need) return null;
  const has = `VolunteerBadge has ${credits} ${credits === 1 ? 'credit' : 'credits'}.`;
  const why =
    outstanding > 0
      ? `this needs ${need}: ${sending} to send now and ${outstanding} ${outstanding === 1 ? 'invite' : 'invites'} already out that ${outstanding === 1 ? 'hasn’t' : 'haven’t'} been charged yet`
      : `this ${sending === 1 ? 'invite needs' : `batch needs ${sending}`}${sending === 1 ? ' 1' : ''}`;
  return `${has} Buy credits in VolunteerBadge before sending invites (${why}).`;
}

// How many more invites the balance covers now (for the page's button).
export function creditsFree({ credits, outstanding }) {
  return credits == null ? null : Math.max(0, credits - outstanding);
}
