'use client';

// Vercel Web Analytics and Speed Insights, for the PUBLIC pages only.
//
// Both report the page address. On staff and family pages that address
// carries a person's or registration's id, and staff searches put children's
// names in it (/admin/search/?q=...). Nothing on those pages needs counting,
// so their events are dropped before they leave the browser (security audit
// L5, 18 Oct 2026). A function prop cannot cross from a server component,
// hence this small client wrapper around the two components.
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

const PRIVATE = ['/admin', '/account', '/register/family', '/register/volunteer', '/auth'];

function publicOnly(event) {
  try {
    const { pathname } = new URL(event.url);
    if (PRIVATE.some((p) => pathname.startsWith(p))) return null;
    // Public pages: keep the path, drop any query string.
    return { ...event, url: event.url.split('?')[0] };
  } catch {
    return null;
  }
}

export default function SiteAnalytics() {
  return (
    <>
      <Analytics beforeSend={publicOnly} />
      <SpeedInsights beforeSend={publicOnly} />
    </>
  );
}
