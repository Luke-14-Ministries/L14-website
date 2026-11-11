'use server';

// Staff editing a person from their own page (Lawrence, 11 Nov 2026): until
// now a person could only be edited through one of their registrations, so a
// household member on none could not be corrected by staff at all.
//
// The same grant as the registration page's updatePerson (write:registration)
// and the same rules (lib/staffPersonEdit.js). RLS is still the boundary: the
// request-scoped client writes as the signed-in staff member.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { editPersonAsStaff } from '@/lib/staffPersonEdit';

export async function updatePersonFromPersonPage(personId, fields, options = {}) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) {
    return { ok: false, error: 'You do not have permission to change registrations.' };
  }
  if (!personId) return { ok: false, error: 'Which person is this?' };
  const supabase = await createClient();
  const res = await editPersonAsStaff(supabase, personId, fields, options);
  if (!res.ok) return res;
  revalidatePath(`/admin/people/${personId}`);
  revalidatePath('/admin/rosters');
  revalidatePath('/admin/checkin');
  return { ok: true };
}
