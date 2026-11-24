import 'server-only';

// The site's own address, for every link the server builds into an email or
// hands to Stripe as a return address (23 Nov 2026, security review).
//
// Until now eleven places worked it out for themselves, most from the
// request's Host or X-Forwarded-Host header alone. Those headers come from
// whoever sent the request, so a link in a family's email could name an
// address the ministry does not own. One function, three answers in order:
//
//   1. SITE_URL, when it is set (Vercel Production and the function secrets
//      name https://luke14ministries.net since Stage C, 12 Nov 2026);
//   2. https://luke14ministries.net on Vercel's Production environment even
//      if SITE_URL goes missing, so a forgotten variable can never turn the
//      live site's links into the request's own host;
//   3. otherwise the request's host: a preview deployment or a laptop, where
//      the link has to come back to the copy being tested.
//
// 'server-only': it reads headers() and environment variables, and has no
// business in browser code.

import { headers } from 'next/headers';

const LIVE_ORIGIN = 'https://luke14ministries.net';

export async function siteOrigin() {
  const fromEnv = process.env.SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (process.env.VERCEL_ENV === 'production') return LIVE_ORIGIN;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : '';
}
