// The button on /auth/confirm-contact/ posts here (0171). A route, not a
// server action: a server action is held to the two-factor code step by the
// proxy, and this link must work for whoever holds it, signed in or not.
// confirm_household_email_change() takes the anonymous role on purpose.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request) {
  const { origin } = new URL(request.url);
  let token = '';
  try {
    token = String((await request.formData()).get('token') ?? '');
  } catch {
    /* not a form post: treated as an unknown link below */
  }
  let ok = false;
  if (token) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('confirm_household_email_change', { p_token: token });
    if (error) console.error('confirm contact email:', error.message);
    ok = Boolean(data);
  }
  // 303 so the browser follows with a GET. The address is never put in the URL.
  return NextResponse.redirect(`${origin}/auth/confirm-contact/?status=${ok ? 'ok' : 'expired'}`, { status: 303 });
}
