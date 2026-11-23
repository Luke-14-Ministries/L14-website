// The Join button on /auth/household-invite/ posts here (W75, 0174). A route,
// not a server action, so the two-factor gate in the proxy leaves it alone;
// accept_household_invite() checks the login's own email against the invite.
//
// Since 0178 (23 Nov 2026) a first join returns the household's contact
// address and the inviter's, and both are told who now shares the household
// (sendJoinNotices). A failed notice never undoes the join.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendJoinNotices } from '@/lib/householdInvite';

const FAMILY_WORDS = /invite|sign in|household|address/i;

export async function POST(request) {
  const { origin } = new URL(request.url);
  let token = '';
  try {
    token = String((await request.formData()).get('token') ?? '');
  } catch {
    /* not a form post */
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_household_invite', { p_token: token });
  if (error) {
    // The function's own sentences are written for families; anything else
    // gets a plain fallback.
    const familyMessage = FAMILY_WORDS.test(error.message ?? '');
    const msg = familyMessage
      ? error.message
      : 'The invite could not be accepted. Please try again, or email registration@luke14ministries.net.';
    if (!familyMessage) console.error('accept invite:', error.message);
    return NextResponse.redirect(
      `${origin}/auth/household-invite/?token=${encodeURIComponent(token)}&error=${encodeURIComponent(msg)}`,
      { status: 303 }
    );
  }
  const joined = Array.isArray(data) ? data[0] ?? null : null;
  try {
    await sendJoinNotices({ supabase, origin: process.env.SITE_URL?.replace(/\/$/, '') || origin, joined });
  } catch (e) {
    console.error('household join notice:', e?.message);
  }
  return NextResponse.redirect(`${origin}/account/dashboard/`, { status: 303 });
}
