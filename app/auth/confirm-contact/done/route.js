// The button on /auth/confirm-contact/ posts here (0171). A route, not a
// server action: a server action is held to the two-factor code step by the
// proxy, and this link must work for whoever holds it, signed in or not.
// confirm_household_email_change() takes the anonymous role on purpose.
//
// Since 0178 (23 Nov 2026) the function also says which household and which
// address it replaced, and this route emails that old address one notice
// (logged through log_contact_change_notice(), which needs this same token).
// Neither address goes into the redirect.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { noticeAfterConfirm } from '@/lib/contactEmail';

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
    const row = Array.isArray(data) ? data[0] ?? null : null;
    ok = Boolean(row?.new_email);
    if (ok) {
      // A failed notice never undoes the change, and never shows as a failure.
      try {
        await noticeAfterConfirm({
          supabase,
          origin: process.env.SITE_URL?.replace(/\/$/, '') || origin,
          token,
          newEmail: row.new_email,
          previousEmail: row.previous_email,
        });
      } catch (e) {
        console.error('contact email change notice:', e?.message);
      }
    }
  }
  // 303 so the browser follows with a GET. The address is never put in the URL.
  return NextResponse.redirect(`${origin}/auth/confirm-contact/?status=${ok ? 'ok' : 'expired'}`, { status: 303 });
}
