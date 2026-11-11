'use server';

// How long a background check lasts (0158, Lawrence 9 Nov 2026). The change
// and the recalculation of every expiry happen in one database function, so
// they cannot half-happen; this only checks the grant and passes the number.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { withReason } from '@/lib/dbErrors';
import { isMinor } from '@/lib/format';
import { todayInMorristown } from '@/lib/events';
import { isCamperRole, isVolunteerRole } from '@/lib/roles';

// An adult camper's sex-offender registry search (0161, Lawrence 10 Nov 2026).
// A staff member searches nsopw.gov by hand and records the date and result
// here: provider 'registry_search', reason 'adult_participant'. No SSN and
// nothing from the search is stored, only the date and the ministry's word.
// The expiry follows the date by the same policy as every check (0108/0158).
//
// Refused for anyone who volunteers at a current event (they need the full
// check, and a registry search would not clear them anyway) and over a full
// check that is on file and current (it already covers them, and must not be
// overwritten by a lesser one).
const REGISTRY_RESULTS = ['ok', 'follow_up', 'not_permitted'];

export async function recordRegistrySearch({ personId, date, result, note }) {
  const staff = await getStaff();
  if (!can(staff, 'write:background_checks')) {
    return { ok: false, error: 'Recording a registry search needs the background checks grant.' };
  }
  if (!personId) return { ok: false, error: 'Missing person.' };
  const today = todayInMorristown();
  const day = String(date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: 'Give the date you searched the registry.' };
  if (day > today) return { ok: false, error: 'The search date can’t be in the future.' };
  if (!REGISTRY_RESULTS.includes(result)) return { ok: false, error: 'Choose what the search found.' };
  const why = String(note ?? '').trim().slice(0, 500);
  if (result !== 'ok' && !why) {
    return { ok: false, error: 'Add a note saying what was found, so whoever follows up knows.' };
  }

  const supabase = await createClient();

  // Who they are at current events.
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .gte('ends_on', today)
    .is('archived_at', null);
  if (eventsError) return { ok: false, error: withReason('Could not read the events.', eventsError) };
  const eventIds = (events ?? []).map((e) => e.id);
  if (eventIds.length === 0) return { ok: false, error: 'No upcoming event to screen for.' };

  const { data: places, error: placesError } = await supabase
    .from('registration_participants')
    .select('camp_role, status, people ( date_of_birth ), registrations!inner ( event_id )')
    .eq('person_id', personId)
    .in('registrations.event_id', eventIds)
    .neq('status', 'cancelled');
  if (placesError) return { ok: false, error: withReason('Could not read their registrations.', placesError) };
  const live = places ?? [];
  if (live.some((p) => isVolunteerRole(p.camp_role))) {
    return { ok: false, error: 'They volunteer at an upcoming event, so they need the full background check, not a registry search.' };
  }
  if (!live.some((p) => isCamperRole(p.camp_role))) {
    return { ok: false, error: 'They are not a camper at an upcoming event.' };
  }
  if (isMinor(live[0]?.people?.date_of_birth) === true) {
    return { ok: false, error: 'Campers under 18 are not screened.' };
  }

  const { data: existing, error: existingError } = await supabase
    .from('person_clearances')
    .select('provider, background_check_on_file, expires_on')
    .eq('person_id', personId)
    .maybeSingle();
  if (existingError) return { ok: false, error: withReason('Could not read their check.', existingError) };
  if (
    existing &&
    existing.provider !== 'registry_search' &&
    existing.background_check_on_file &&
    (!existing.expires_on || existing.expires_on >= today)
  ) {
    return { ok: false, error: 'A full background check is on file and current; it already covers them.' };
  }

  const { error } = await supabase.from('person_clearances').upsert(
    {
      person_id: personId,
      provider: 'registry_search',
      screening_reason: 'adult_participant',
      background_check_on_file: true,
      background_check_date: day,
      verdict: result,
      verdict_note: why || null,
      recorded_by: staff.userId,
    },
    { onConflict: 'person_id' }
  );
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
