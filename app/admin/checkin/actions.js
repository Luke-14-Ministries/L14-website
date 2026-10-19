'use server';

// Day-of check-in. The set_check_in RPC (migration 0011) is the real gate: it
// permits registrars, coordinators and admins, and it updates ONLY the
// check-in fields -- door duty without broader edit rights.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

// Set an event's medical contact (camp doctor / nurse). Setup write; the
// event_medical_contacts policy (0109) is the real gate. Its own table, so
// only staff, leaders and registered households can read it.
export async function setEventMedicalContact(eventId, name, phone) {
  const staff = await getStaff();
  if (!can(staff, 'write:setup')) {
    return { ok: false, error: 'Only administrators can change the medical contact.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('event_medical_contacts').upsert(
    {
      event_id: eventId,
      name: String(name ?? '').trim() || null,
      phone: String(phone ?? '').trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: staff.userId ?? null,
    },
    { onConflict: 'event_id' }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/checkin');
  revalidatePath('/admin/medical');
  return { ok: true };
}

export async function toggleCheckIn(participantId, checkedIn) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) {
    return { ok: false, error: 'You do not have permission to check people in.' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_check_in', {
    p_participant_id: participantId,
    p_checked_in: checkedIn,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/checkin');
  return { ok: true, checkedInAt: data };
}
