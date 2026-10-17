'use server';

// The per-person support profile -- the dashboard's form, since 16 Oct 2026
// the place details are EDITED (the registration wizard writes them first,
// for campers, before submit).
//
// No migration was needed for the form itself: person_support and its row-
// level security have existed since 0001. The family policy is "this person
// is in a household I belong to", so a parent can fill in their child's
// profile and nobody else's, and the server action does not have to
// re-implement that -- Postgres refuses the write.
//
// What may be written, how blanks and flags are stored, and what a camper
// must answer all live in lib/support.js, shared with the wizard's action.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { supportPatch } from '@/lib/support';

export async function savePersonSupport(personId, fields) {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: 'Your session has expired. Please log in and try again.' };
  }
  if (!personId) return { ok: false, error: 'Missing person.' };

  // The dashboard's "Details on file" status reads this stamp and nothing
  // else. It is set by the two family forms (this one and the wizard) and
  // nowhere else -- inferring completion from content once marked people
  // "done" who had never seen a form.
  const patch = {
    ...supportPatch(fields),
    person_id: personId,
    details_saved_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  const { error } = await supabase
    .from('person_support')
    .upsert(patch, { onConflict: 'person_id' });

  if (error) {
    // The most likely failure is RLS refusing a person outside this family.
    if (/row-level security/i.test(error.message || '')) {
      return { ok: false, error: 'That person is not in your household.' };
    }
    return { ok: false, error: `Could not save: ${error.message}` };
  }

  revalidatePath('/account/dashboard');
  revalidatePath(`/account/details/${personId}`);
  // Staff surfaces that read support details.
  revalidatePath('/admin/medical');
  revalidatePath('/admin/dietary');
  revalidatePath('/admin/checkin');
  return { ok: true };
}
