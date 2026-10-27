// The site's ONE service-role client (27 Oct 2026), for the automatic emails
// (lib/reminders/) and nothing else.
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
