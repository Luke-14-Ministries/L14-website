'use server';

// Staff-side volunteer actions. Registrar-gated here AND by row-level
// security (volunteer_applications_update allows registrars; the
// person_clearances policy needs the Background-checks grant in both directions).

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export async function reviewVolunteerApplication(participantId, decision) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) return { ok: false, error: 'Not permitted.' };
  if (!['approved', 'declined', 'applied'].includes(decision)) {
    return { ok: false, error: 'Unknown decision.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('volunteer_applications')
    .update({ status: decision, reviewed_by: staff.userId, reviewed_at: new Date().toISOString() })
    .eq('registration_participant_id', participantId);

  if (error) {
    console.error('reviewVolunteerApplication:', error.message);
    return { ok: false, error: 'Could not save the decision.' };
  }
  revalidatePath('/admin/volunteers');
  return { ok: true };
}

// The manual record (0091, 15 Oct 2026). Needs the Background-checks grant,
// the same one that orders and imports checks: reading the result and
// recording what the ministry concluded are the same kind of knowledge.
// The check date is required once paperwork is on file -- the expiry is
// worked out from it by policy in the database, never typed here -- and a
// verdict needs paperwork to be on file to be a verdict about anything.
// Who and when are stamped by trigger; the log fills itself.
const VERDICTS = ['ok', 'follow_up', 'not_permitted'];

export async function setVolunteerClearance({ personId, onFile, date, verdict, note }) {
  const staff = await getStaff();
  if (!can(staff, 'background_checks')) {
    return { ok: false, error: 'Recording a background check needs the Background-checks grant.' };
  }
  if (!personId) return { ok: false, error: 'Missing person.' };
  const isOn = Boolean(onFile);
  if (isOn && !date) return { ok: false, error: 'Give the date of the check — the expiry is worked out from it.' };
  const v = verdict ? String(verdict) : null;
  if (v && !VERDICTS.includes(v)) return { ok: false, error: 'Unknown verdict.' };
  if (v && !isOn) return { ok: false, error: 'A verdict needs the paperwork on file first.' };

  const supabase = await createClient();
  const { error } = await supabase.from('person_clearances').upsert(
    {
      person_id: personId,
      background_check_on_file: isOn,
      background_check_date: date || null,
      verdict: v,
      verdict_note: (note ?? '').trim().slice(0, 500) || null,
      recorded_by: staff.userId,
    },
    { onConflict: 'person_id' }
  );

  if (error) {
    console.error('setVolunteerClearance:', error.message);
    return { ok: false, error: error.message || 'Could not save the record.' };
  }
  revalidatePath('/admin/volunteers');
  return { ok: true };
}
