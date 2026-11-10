'use server';

// How long a background check lasts (0158, Lawrence 9 Nov 2026). The change
// and the recalculation of every expiry happen in one database function, so
// they cannot half-happen; this only checks the grant and passes the number.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { withReason } from '@/lib/dbErrors';

export async function setCheckLength(months) {
  const staff = await getStaff();
  if (!can(staff, 'write:background_checks')) {
    return { ok: false, error: 'Changing how long a check lasts needs the background checks grant.' };
  }
  const n = Number(String(months ?? '').trim());
  if (!Number.isInteger(n) || n < 1 || n > 60) {
    return { ok: false, error: 'Enter a whole number of months, from 1 to 60.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_clearance_interval_months', { p_months: n });
  if (error) return { ok: false, error: withReason('The length could not be changed.', error) };

  revalidatePath('/admin/volunteers', 'layout');
  return { ok: true, recalculated: data ?? 0 };
}
