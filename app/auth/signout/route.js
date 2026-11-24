// Logging out.
//
// This is a POST, and the Log Out control is a real form rather than a link,
// on purpose. A GET link that logs you out can be fired by anything that can
// make the browser fetch a URL -- an image tag in an email, a link on another
// site -- which is how people end up mysteriously logged out mid-registration.
//
// THIS BROWSER, OR EVERYWHERE (23 Nov 2026)
//
// Log Out ends this browser's session only (scope 'local'): Supabase revokes
// that session's refresh token and the cookies are cleared, so it is dead
// server-side too, not just forgotten here. Until 23 Nov 2026 it used
// Supabase's default, which is 'global': logging out on the office computer
// also logged out the same person's phone, mid-form. "Log out everywhere" on
// the Security page posts scope=global, for a lost phone or a shared password.
// Any other value is treated as this browser only.
//
// A cross-site form cannot use this to log someone out everywhere: the
// session cookies are SameSite=Lax, so a POST from another site arrives
// without them and there is no session to end.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request) {
  const supabase = await createClient();

  let scope = 'local';
  try {
    const form = await request.formData();
    if (form.get('scope') === 'global') scope = 'global';
  } catch {
    /* no form body (an old cached page): this browser only */
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { error } = await supabase.auth.signOut({ scope });
    // Logged, never hidden: on an error Supabase keeps the session (the
    // cookies stay), so the person may still be signed in somewhere.
    if (error) console.error('signOut', scope, error.message);
  }

  const { origin } = new URL(request.url);
  // 303 tells the browser to follow up with a GET. Without it, some browsers
  // re-POST to the destination.
  return NextResponse.redirect(`${origin}/account/${scope === 'global' ? '?signedout=everywhere' : ''}`, {
    status: 303,
  });
}
