// Security headers (security audit, 18 Oct 2026). Before this the site sent
// none beyond Vercel's default HSTS: /admin (refunds, "Approve all") could be
// framed by another site and clicked through invisibly.
//
// The content security policy is REPORT-ONLY for now: browsers log what it
// would block (DevTools console) and block nothing. It lists what the site
// really loads -- Turnstile, the YouTube embeds on Camp Memories, Supabase
// (API, realtime, signed photo links), Vercel Analytics (same-origin
// /_vercel/*). Stripe Checkout is a full-page redirect, so it needs no entry.
// Enforce it (rename the header to Content-Security-Policy) once a round of
// testing shows no reports. Vercel's preview toolbar (vercel.live) is not
// listed; on previews it will show up in the reports.
// `npm run dev` also reports eval and va.vercel-scripts.com debug scripts --
// development-only; production uses neither.
const SUPABASE = 'https://nnbcxqxwkivadzognpno.supabase.co';
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SUPABASE}`,
  `connect-src 'self' ${SUPABASE} wss://nnbcxqxwkivadzognpno.supabase.co`,
  'frame-src https://challenges.cloudflare.com https://www.youtube.com',
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  // Add 'upgrade-insecure-requests' when enforcing; report-only ignores it
  // and logs an error on every page.
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy-Report-Only', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // No includeSubDomains until the Microsoft 365 subdomains have been checked.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `trailingSlash` is a URL preference, not a hosting accommodation. It keeps
  // every route ending in a slash (/about/ rather than /about), which is how
  // every existing link in this site is written. It stays.
  trailingSlash: true,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

// Removed 5 August 2026, when the site moved to Vercel and GitHub Pages was
// retired. See DECISIONS.md for the full reasoning. In short:
//
//   output: 'export'           Compiled the site to flat HTML files. That
//                              disables all server code -- no API routes, no
//                              server actions, no database calls, no Stripe.
//                              Every item in Phase 1 was blocked until it went.
//
//   basePath                   Let GitHub Pages serve the site from a subfolder.
//                              NEXT_PUBLIC_BASE_PATH must stay UNSET on Vercel:
//                              setting it breaks every link and every image, and
//                              it fails in a way that looks like a CSS problem.
//
//   images: { unoptimized }    A static export cannot run Next's image
//                              optimiser. Nothing here uses next/image anyway.

export default nextConfig;
