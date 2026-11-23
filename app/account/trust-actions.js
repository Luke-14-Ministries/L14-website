'use server';

// The "remember this browser" cookie, set and read on the SERVER so the
// browser's own scripts can never see it (HttpOnly).
//
// Until 21 Oct 2026 the login form wrote the cookie itself with
// document.cookie, which means any script running on the page could read the
// token -- and a token is seven days (staff) or thirty (families) of skipping
// the two-factor code. The content security policy still allows inline
// scripts, so a cross-site-scripting slip anywhere would have handed the
// token over. An HttpOnly cookie is invisible to scripts; only the server
// (the middleware, and these two actions) can read it. Security audit,
// "think like a hacker" round.

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

const NAME = 'l14_mfa_trust';
// 32 random bytes as hex (LoginForm.jsx makes it): 64 hex characters.
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

function cookieOptions(expires) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires,
  };
}

// After the code step, with the device row already written by
// remember_this_browser() (0176), which also chose `expiresIso`.
export async function rememberBrowser(token, expiresIso) {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return { ok: false };
  const expires = new Date(expiresIso);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) return { ok: false };
  const jar = await cookies();
  jar.set(NAME, token, cookieOptions(expires));
  return { ok: true };
}

// At login: is this browser remembered for the signed-in person? Only the
// HttpOnly cookie counts (the old localStorage fallback went on 23 Nov 2026,
// 0176). The database decides (mark_session_trusted, 0104): the token's hash
// must be this person's own unexpired device, within the 7-day staff limit,
// and the call registers this session as trusted.
export async function trustedBrowserCheck() {
  const jar = await cookies();
  const token = jar.get(NAME)?.value;
  if (!token || !TOKEN_SHAPE.test(token)) return false;

  const supabase = await createClient();
  const { data: ok, error: trustError } = await supabase.rpc('mark_session_trusted', { p_token: token });
  // Logged, then treated as "not remembered": the form asks for the code,
  // which fails closed. Throwing here would stop the login altogether.
  if (trustError) console.error('trustedBrowserCheck:', trustError.message);
  return ok === true;
}
