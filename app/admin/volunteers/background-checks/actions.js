'use server';

// How long a background check lasts (0158, Lawrence 9 Nov 2026). The change
// and the recalculation of every expiry happen in one database function, so
// they cannot half-happen; this only checks the grant and passes the number.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { withReason } from '@/lib/dbErrors';

// A sex-offender registry search for an adult who isn't a volunteer (0161,
// widened to every non-volunteer role in 0162; Lawrence 10-11 Nov 2026). A
// staff member searches nsopw.gov by hand and records the date and result.
// No SSN and nothing from the search is stored, only the date and the
// ministry's word; the expiry follows the date (0158).
//
// The rules live in record_registry_search() (0162): the background-checks
// write grant, a place at an upcoming event where they are 18 or older on its
// first day, no volunteer place, and never over a current full check. Its
// refusals are written for staff and shown as they are.
const REGISTRY_RESULTS = ['ok', 'follow_up', 'not_permitted'];

export async function recordRegistrySearch({ personId, date, result, note }) {
  const staff = await getStaff();
  if (!can(staff, 'write:background_checks')) {
    return { ok: false, error: 'Recording a registry search needs the background checks grant.' };
  }
  if (!personId) return { ok: false, error: 'Missing person.' };
  const day = String(date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Give the date you searched the registry.' };
  if (!REGISTRY_RESULTS.includes(result)) return { ok: false, error: 'Choose what the search found.' };
  const why = String(note ?? '').trim().slice(0, 500);
  if (result !== 'ok' && !why) {
    return { ok: false, error: 'Add a note saying what was found, so whoever follows up knows.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('record_registry_search', {
    p_person_id: personId,
    p_date: day,
    p_result: result,
    p_note: why || null,
  });
  if (error) return { ok: false, error: withReason('The registry search could not be saved.', error) };

  revalidatePath('/admin/volunteers', 'layout');
  revalidatePath('/admin/registrations', 'layout');
  return { ok: true };
}

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
