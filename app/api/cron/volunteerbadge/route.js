// The daily VolunteerBadge check (0165; Lawrence, 13 Nov 2026: "a Refresh
// button plus a daily job", and yes to the service-role client for it).
//
// Called by Vercel Cron each morning (vercel.json, 12:30 UTC), half an hour
// before the reminders. Vercel sends "Authorization: Bearer <CRON_SECRET>";
// anything else is refused. It does what Refresh on Background screening does
// (lib/volunteerBadgeSync.js) and nothing more: it reads open
// volunteerbadge_requests and writes VolunteerBadge's status words back to
// them. It never confirms a result (that is staff's button) and never sends.
// With no VOLUNTEERBADGE_API_KEY it does nothing.

import { createAdminClient } from '@/lib/supabase/admin';
import { volunteerBadge } from '@/lib/volunteerBadge';
import { refreshOpenRequests } from '@/lib/volunteerBadgeSync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const api = volunteerBadge();
  if (!api) return Response.json({ ok: true, skipped: 'VolunteerBadge is not connected (no key).' });
  const admin = createAdminClient();
  if (!admin) {
    return Response.json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Vercel.' }, { status: 500 });
  }
  try {
    // Up to 100 invites a morning, at VolunteerBadge's pace.
    const r = await refreshOpenRequests(admin, api, { limit: 100 });
    if (r.problems.length) console.error('cron/volunteerbadge:', r.problems.join(' '));
    return Response.json({ ok: r.problems.length === 0, ...r });
  } catch (e) {
    console.error('cron/volunteerbadge:', e?.message);
    return Response.json({ ok: false, error: e?.message ?? 'failed' }, { status: 500 });
  }
}
