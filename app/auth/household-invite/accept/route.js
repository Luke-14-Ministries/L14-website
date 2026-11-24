// The Join button on /auth/household-invite/ posts here (W75, 0174). A route,
// not a server action, so the two-factor gate in the proxy leaves it alone;
// accept_household_invite() checks the login's own email against the invite.
//
// Since 0178 (23 Nov 2026) a first join returns the household's contact
// address and the inviter's, and both are told who now shares the household
// (sendJoinNotices). A failed notice never undoes the join.
//
// 23 Nov 2026 (0179, review findings S2-09, S3-14, A5-05, A5-21):
//   * The dashboard's waiting-invite card posts here too, with invite_id
//     instead of token (accept_household_invite_for_me()).
//   * Two-factor: /auth/ is outside the proxy's gate, so this route asks the
//     same question itself. A login with a device that has not entered its
//     code, and whose browser is not remembered, goes to the code step and
//     comes back. The database refuses that session as well (0179).
//   * A refusal travels as a short code (?problem=), never as text: the page
//     used to print whatever ?error= said.
//   * After a join the dashboard says so (?joined=1).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { sendJoinNotices, inviteProblemCode } from '@/lib/householdInvite';
import { siteOrigin } from '@/lib/origin';

// The remembered-browser cookie; the proxy's gate reads the same one
// (lib/supabase/middleware.js).
const TRUST_COOKIE = 'l14_mfa_trust';

// Does this session still owe its two-factor code? The proxy's rule:
// enrolled (nextLevel aal2), not entered this time (aal1), and no remembered
// browser that the database accepts (mark_session_trusted()).
async function owesCode(supabase) {
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) console.error('invite accept, assurance level:', error.message);
  if (!(aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2')) return false;
  const token = (await cookies()).get(TRUST_COOKIE)?.value;
  if (!token) return true;
  const { data: ok, error: trustError } = await supabase.rpc('mark_session_trusted', { p_token: token });
  if (trustError) console.error('invite accept, mark_session_trusted:', trustError.message);
  return ok !== true;
}

export async function POST(request) {
  const { origin } = new URL(request.url);
  let token = '';
  let inviteId = '';
  try {
    const form = await request.formData();
    token = String(form.get('token') ?? '');
    inviteId = String(form.get('invite_id') ?? '');
  } catch {
    /* not a form post */
  }
  const byId = !token && /^[0-9a-f-]{36}$/i.test(inviteId);
  // Where this person came from, and where a refusal is explained.
  const back = byId ? '/account/dashboard/' : `/auth/household-invite/?token=${encodeURIComponent(token)}`;
  const go = (path) => NextResponse.redirect(`${origin}${path}`, { status: 303 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return go(`/account/?next=${encodeURIComponent(back)}`);
  const verify = `/account/?verify=1&next=${encodeURIComponent(back)}`;
  if (await owesCode(supabase)) return go(verify);

  const { data, error } = byId
    ? await supabase.rpc('accept_household_invite_for_me', { p_invite_id: inviteId })
    : await supabase.rpc('accept_household_invite', { p_token: token });
  if (error) {
    // The database's own two-factor refusal (not any permission error, so a
    // missing grant is logged rather than sent round the code step).
    if (error.code === '42501' && /two-factor/i.test(error.message ?? '')) return go(verify);
    const code = inviteProblemCode(error.message);
    if (!code) console.error('accept invite:', error.message);
    const sep = back.includes('?') ? '&' : '?';
    return go(`${back}${sep}${byId ? 'invite' : 'problem'}=${code ?? 'failed'}`);
  }
  const joined = Array.isArray(data) ? data[0] ?? null : null;
  try {
    // The one answer for the site's address (lib/origin.js; 23 Nov 2026, P99).
    await sendJoinNotices({ supabase, origin: await siteOrigin(), joined });
  } catch (e) {
    console.error('household join notice:', e?.message);
  }
  return go('/account/dashboard/?joined=1');
}
