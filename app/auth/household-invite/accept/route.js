// The Join button on /auth/household-invite/ posts here (W75, 0174). A route,
// not a server action, so the two-factor gate in the proxy leaves it alone;
// accept_household_invite() checks the login's own email against the invite.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request) {
  const { origin } = new URL(request.url);
  let token = '';
  try {
    token = String((await request.formData()).get('token') ?? '');
  } catch {
    /* not a form post */
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('accept_household_invite', { p_token: token });
  if (error) {
    // The function's own sentences are written for families; anything else
    // gets a plain fallback.
    const msg = /invite|sign in|household|address/i.test(error.message ?? '')
      ? error.message
      : 'The invite could not be accepted. Please try again, or email registration@luke14ministries.net.';
    if (!/invite|sign in|household|address/i.test(error.message ?? '')) console.error('accept invite:', error.message);
    return NextResponse.redirect(
      `${origin}/auth/household-invite/?token=${encodeURIComponent(token)}&error=${encodeURIComponent(msg)}`,
      { status: 303 }
    );
  }
  return NextResponse.redirect(`${origin}/account/dashboard/`, { status: 303 });
}
