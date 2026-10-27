// The daily automatic emails (27 Oct 2026; lib/reminders/run.js).
//
// Called by Vercel Cron every morning (vercel.json: 13:00 UTC, 8 or 9 am in
// Morristown). Vercel sends "Authorization: Bearer <CRON_SECRET>" when the
// project has a CRON_SECRET environment variable; anything else is refused.
// That is Vercel's CRON_SECRET, set in Vercel -- not the Supabase function
// secret of the same name.
//
// By hand, for a test (the same secret, from the vault):
//   ?dry=1             say what would be sent today, send nothing
//   ?date=YYYY-MM-DD   run as if it were that day (test mode only, never
//                      once REMINDERS_MODE=live)

import { createAdminClient } from '@/lib/supabase/admin';
import { todayInMorristown } from '@/lib/events';
import { runReminders, reminderMode } from '@/lib/reminders/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return Response.json(
      { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Vercel, so the reminders cannot read registrations.' },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const mode = reminderMode();
  const asked = url.searchParams.get('date');
  if (asked && mode === 'live') {
    return Response.json({ ok: false, error: 'A date can be chosen only in test mode.' }, { status: 400 });
  }
  if (asked && !/^\d{4}-\d{2}-\d{2}$/.test(asked)) {
    return Response.json({ ok: false, error: 'date must be YYYY-MM-DD.' }, { status: 400 });
  }
  const today = asked || todayInMorristown();
  const origin = process.env.SITE_URL || url.origin;

  try {
    const report = await runReminders(admin, { today, origin, dry: url.searchParams.get('dry') === '1', mode });
    return Response.json(report);
  } catch (e) {
    console.error('cron/reminders:', e?.message);
    return Response.json({ ok: false, error: e?.message ?? 'failed' }, { status: 500 });
  }
}
