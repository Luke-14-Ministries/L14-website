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

import { createHash } from 'crypto';
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

// After the code step, with the device row already written by the form.
export async function rememberBrowser(token, expiresIso) {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return { ok: false };
  const expires = new Date(expiresIso);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) return { ok: false };
  const jar = await cookies();
  jar.set(NAME, token, cookieOptions(expires));
  return { ok: true };
}

// At login: is this browser remembered for the signed-in person? The cookie
// first; then any token the form still holds from the old localStorage
// scheme (moved into the cookie here when it proves valid, so the middleware
// -- which trusts only the cookie -- agrees with the form). The database
// decides (mark_session_trusted, 0104): the token's hash must be this
// person's own unexpired device, within the 7-day staff limit, and the call
// registers this session as trusted.
export async function trustedBrowserCheck(legacyTokens = []) {
  const jar = await cookies();
  const fromCookie = jar.get(NAME)?.value;
  const candidates = [];
  if (fromCookie && TOKEN_SHAPE.test(fromCookie)) candidates.push({ token: fromCookie, legacy: false });
  for (const t of Array.isArray(legacyTokens) ? legacyTokens.slice(0, 3) : []) {
    if (typeof t === 'string' && TOKEN_SHAPE.test(t)) candidates.push({ token: t, legacy: true });
  }
  if (candidates.length === 0) return false;

  const supabase = await createClient();
  for (const c of candidates) {
    const { data: ok } = await supabase.rpc('mark_session_trusted', { p_token: c.token });
    if (ok !== true) continue;
    if (c.legacy) {
      const hash = createHash('sha256').update(c.token).digest('hex');
      const { data: device } = await supabase
        .from('mfa_trusted_devices')
        .select('expires_at')
        .eq('token_hash', hash)
        .maybeSingle();
      if (device?.expires_at) jar.set(NAME, c.token, cookieOptions(new Date(device.expires_at)));
    }
    return true;
  }
  return false;
}
