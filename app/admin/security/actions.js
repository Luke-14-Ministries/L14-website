'use server';

// Reset a locked-out person's two-factor by their login email (Admin →
// Security). Until 18 Oct 2026 this called the admin-reset-mfa Edge Function,
// which used the service-role key and checked only that the caller was an
// administrator: a password alone (no code) could reset anyone, yourself
// included, with nothing logged. It now goes through admin_reset_mfa()
// (0104), which needs a code-verified session, refuses your own account and
// writes the access log -- the same function the Accounts page uses.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

export async function resetMfaByEmail(email) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admin access required.' };
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) return { ok: false, error: "Please provide the user's email." };

  const supabase = await createClient();
  const { data: found, error: lookupError } = await supabase.rpc('staff_lookup_by_email', { p_email: clean });
  if (lookupError) return { ok: false, error: 'Could not look that account up.' };
  const target = found?.[0];
  if (!target) return { ok: false, error: `No account found for ${clean}.` };

  const { data: removed, error } = await supabase.rpc('admin_reset_mfa', { p_user_id: target.profile_id });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/accounts');
  revalidatePath('/admin/staff/access-log');
  return { ok: true, email: clean, removed: removed ?? 0 };
}
