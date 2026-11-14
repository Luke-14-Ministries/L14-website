// VolunteerBadge calls this when a volunteer submits an application
// (Lawrence, 14 Nov 2026: "lets build now", which reverses 0165's decision 1,
// "VB never calls us", and allows this fourth use of the service-role client).
//
// What it does, and nothing more: for a signed application.submitted, find
// our invite by the application id we saved at sending, and write VB's
// volunteer id on it (and invited -> applied). It never links a check, never
// confirms anything and never stores anything else from the body; the check
// is tied and read by refreshRequest() with all its name and birth-date
// rules, started here right after the answer and again by the daily job.
// The rules for the body and the signature are lib/volunteerBadgeWebhook.js.
//
// Register it in VolunteerBadge (Settings -> Webhooks) as
//   https://luke14ministries.net/api/webhooks/volunteerbadge/
// (WITH the final slash: the site's trailingSlash setting answers the bare
// address with a 308 redirect, which a webhook sender may not follow) with
// only application.submitted ticked, and put that endpoint's secret in
// Vercel as VOLUNTEERBADGE_WEBHOOK_SECRET. Without the secret every call is
// refused, and the daily job carries on as before.

import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { volunteerBadge } from '@/lib/volunteerBadge';
import { refreshOne } from '@/lib/volunteerBadgeSync';
import { MAX_BODY_BYTES, signatureOk, readSubmitted } from '@/lib/volunteerBadgeWebhook';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Only an invite still waiting on the volunteer takes the id: not one taken
// back or replaced, and never over a check already tied.
const TAKES_ID = ['invited', 'applied', 'expired'];

const ok = (extra = {}) => Response.json({ ok: true, ...extra });

export async function POST(request) {
  const secret = process.env.VOLUNTEERBADGE_WEBHOOK_SECRET;
  if (!secret) return new Response('Not configured', { status: 503 });

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return new Response('Too large', { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return new Response('Too large', { status: 413 });
  if (!signatureOk(raw, request.headers.get('x-volunteerbadge-signature'), secret)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const ask = readSubmitted(raw, request.headers.get('x-volunteerbadge-event'));
  if (ask.ignore) return ok({ ignored: ask.ignore });

  const admin = createAdminClient();
  if (!admin) {
    console.error('webhooks/volunteerbadge: SUPABASE_SERVICE_ROLE_KEY is not set');
    return Response.json({ ok: false }, { status: 500 });
  }
  const { data: row, error } = await admin
    .from('volunteerbadge_requests')
    .select('id, status, sandbox, vb_volunteer_id, vb_check_id')
    .eq('vb_application_id', ask.applicationId)
    .maybeSingle();
  if (error) {
    console.error('webhooks/volunteerbadge: read failed:', error.message);
    return Response.json({ ok: false }, { status: 500 });
  }
  if (!row) return ok({ ignored: 'not one of our invites' });
  if (row.vb_volunteer_id === ask.volunteerId) return ok({ ignored: 'already noted' });
  if (row.vb_volunteer_id || row.vb_check_id || !TAKES_ID.includes(row.status)) {
    return ok({ ignored: 'invite already settled' });
  }

  const { data: saved, error: saveError } = await admin
    .from('volunteerbadge_requests')
    .update({
      vb_volunteer_id: ask.volunteerId,
      ...(row.status === 'invited' ? { status: 'applied', problem: null } : {}),
    })
    .eq('id', row.id)
    .eq('status', row.status)
    .is('vb_volunteer_id', null)
    .select('id');
  if (saveError) {
    console.error('webhooks/volunteerbadge: save failed:', saveError.message);
    return Response.json({ ok: false }, { status: 500 });
  }
  if (!saved?.length) return ok({ ignored: 'changed meanwhile' });

  // Look for the check now (with auto-run on, VB orders it on submit), after
  // answering: VB waits only 5 seconds. Only with a key of the row's own mode.
  const api = volunteerBadge();
  if (api && api.sandbox === row.sandbox) {
    after(async () => {
      try {
        await refreshOne(admin, api, row.id);
      } catch (e) {
        console.error('webhooks/volunteerbadge: refresh after submit failed:', e?.message);
      }
    });
  }
  return ok({ noted: true });
}
