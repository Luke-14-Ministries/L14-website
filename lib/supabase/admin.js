// The site's ONE service-role client (27 Oct 2026). Every file that imports
// it, and why (checked 23 Nov 2026; keep this list and CLAUDE.md's in step):
//
//   app/api/cron/reminders/route.js  -> lib/reminders/run.js: the automatic
//       emails and their housekeeping (no signed-in person).
//   app/admin/email-families/page.jsx: the 7-day preview of those emails
//       (Registration write checked first).
//   app/pray/actions.js: the prayer list's sign-up, confirm and unsubscribe
//       (0141); they work through the row's secret token, which no signed-in
//       or anonymous role may read.
//   app/admin/prayer/actions.js: the prayer send and removal (Prayer list
//       write checked first).
//   app/api/cron/volunteerbadge/route.js: the daily VolunteerBadge check
//       (0165, 13 Nov 2026: reads and updates volunteerbadge_requests only).
//   app/api/webhooks/volunteerbadge/route.js: VB's signed
//       application.submitted webhook (14 Nov 2026: writes VB's volunteer id
//       on one invite).
//
// Nothing else. Family emails sent from a family's own action (the wizard's
// confirmation, invites, contact-email links and notices, feedback notes)
// used to be logged through it; since 0178 they are logged as the family
// through log_own_household_email() (lib/email.js, logOwnEmail).
//
// The service-role key bypasses row-level security entirely (CLAUDE.md,
// security rules), which is why the site went without one until now: every
// page reads as the signed-in person. The daily reminder job has no
// signed-in person -- it reads every family's registrations to decide who is
// owed a reminder -- so it is the one place the key is genuinely required.
//
// Server only: 'server-only' makes the build fail if this module is ever
// imported into browser code. The key comes from Vercel's environment
// (SUPABASE_SERVICE_ROLE_KEY; Lawrence sets it, never pasted anywhere) and is
// never sent to the browser. Returns null when the key is not set, so callers
// can say "not configured" instead of failing.

import 'server-only';
import { createClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
