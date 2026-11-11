'use server';

// Staff-side volunteer actions. Registrar-gated here AND by row-level
// security (volunteer_applications_update allows registrars; the
// person_clearances policy needs the Background-checks grant in both directions).

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { setParticipantStatus } from '../registrations/[id]/actions';

export async function reviewVolunteerApplication(participantId, decision, { override = false } = {}) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) return { ok: false, error: 'Not permitted.' };
  if (!['approved', 'declined', 'applied'].includes(decision)) {
    return { ok: false, error: 'Unknown decision.' };
  }

  const supabase = await createClient();
  const { data: part, error: partError } = await supabase
    .from('registration_participants')
    .select('id, registration_id, status')
    .eq('id', participantId)
    .maybeSingle();
  if (partError) return { ok: false, error: partError.message };
  if (!part) return { ok: false, error: 'That volunteer is no longer on the registration.' };

  // One decision (0152, Lawrence 4 Nov 2026). Approving a volunteer whose
  // place is not yet confirmed confirms it through the registration page's
  // own status change -- the deposit check, the discount recalcs and the
  // hold rule -- and the database then approves the application. The
  // background-check rule is the database's, and its words come back as-is.
  if (decision === 'approved' && part.status !== 'confirmed') {
    const res = await setParticipantStatus(part.registration_id, participantId, 'confirmed', { override });
    if (!res.ok) return res;
    revalidatePath('/admin/volunteers');
    return { ok: true };
  }

  const { error } = await supabase
    .from('volunteer_applications')
    .update({ status: decision, reviewed_by: staff.userId, reviewed_at: new Date().toISOString() })
    .eq('registration_participant_id', participantId);
  if (error) {
    console.error('reviewVolunteerApplication:', error.message);
    return { ok: false, error: error.message };
  }

  // Declining takes the place too: onto the waitlist, with a reason the
  // family reads, so it can be undone by approving later.
  if (decision === 'declined' && ['confirmed', 'submitted'].includes(part.status)) {
    const res = await setParticipantStatus(part.registration_id, participantId, 'waitlisted', {
      reason: 'Volunteer application not approved. The office will be in touch.',
    });
    if (!res.ok) return { ok: false, error: `The application is declined, but the place did not move: ${res.error}` };
  }

  revalidatePath('/admin/volunteers');
  revalidatePath(`/admin/registrations/${part.registration_id}`);
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
  if (isOn && !date) return { ok: false, error: 'Give the date of the background check. The expiry is based on it.' };
  const v = verdict ? String(verdict) : null;
  if (v && !VERDICTS.includes(v)) return { ok: false, error: 'Unknown verdict.' };
  if (v && !isOn) return { ok: false, error: 'A verdict needs the paperwork on file first.' };

  const supabase = await createClient();
  // A check entered here is a volunteer's full check. Over a camper's
  // registry search (0161) the row must stop saying 'registry_search', or the
  // approval gate would go on refusing a check that is really on file.
  const { data: existing, error: existingError } = await supabase
    .from('person_clearances')
    .select('provider')
    .eq('person_id', personId)
    .maybeSingle();
  if (existingError) return { ok: false, error: existingError.message || 'Could not read the record.' };
  const fromRegistry = existing?.provider === 'registry_search';

  const { error } = await supabase.from('person_clearances').upsert(
    {
      person_id: personId,
      background_check_on_file: isOn,
      background_check_date: date || null,
      verdict: v,
      verdict_note: (note ?? '').trim().slice(0, 500) || null,
      recorded_by: staff.userId,
      ...(fromRegistry ? { provider: 'manual', screening_reason: 'volunteer' } : {}),
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
