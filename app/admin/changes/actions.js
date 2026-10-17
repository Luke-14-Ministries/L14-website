'use server';

// Mark family-made changes as reviewed. Registrar-gated; the
// family_change_log_update RLS policy is the real gate (and it hides
// support-detail rows from staff without the sensitive grant).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { holdRegistration } from '@/app/admin/registrations/[id]/actions';

export async function markChangesReviewed(ids) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) {
    return { ok: false, error: 'You do not have permission to review changes.' };
  }
  if (!Array.isArray(ids) || ids.length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from('family_change_log')
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: staff.userId })
    .in('id', ids)
    .is('reviewed_at', null);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/changes');
  return { ok: true };
}

// Put the registration(s) a logged change touches on hold (0098; Larry and
// Ellen, 15-16 Oct 2026): the person's current registrations where they are
// confirmed or waitlisted, or every current one of the household's when the
// change is to the household itself. The change row stays unreviewed -- the
// hold is what a reviewer does with it, and "Reviewed" is a separate click.
export async function holdFromChange(changeId, reason) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) {
    return { ok: false, error: 'You do not have permission to put a registration on hold.' };
  }
  const supabase = await createClient();
  const { data: row, error: rowError } = await supabase
    .from('family_change_log')
    .select('id, person_id, household_id')
    .eq('id', changeId)
    .maybeSingle();
  if (rowError) return { ok: false, error: rowError.message };
  if (!row) return { ok: false, error: 'That change is no longer here.' };

  const today = new Date().toISOString().slice(0, 10);
  let q = supabase
    .from('registration_participants')
    .select('registration_id, status, registrations!inner ( id, household_id, events ( name, ends_on ) )')
    .in('status', ['confirmed', 'waitlisted']);
  q = row.person_id ? q.eq('person_id', row.person_id) : q.eq('registrations.household_id', row.household_id);
  const { data: parts, error } = await q;
  if (error) return { ok: false, error: error.message };

  const regs = new Map();
  for (const p of parts ?? []) {
    const r = p.registrations;
    if (!r || (r.events?.ends_on ?? '9999-12-31') < today) continue;
    regs.set(r.id, r.events?.name ?? 'event');
  }
  if (regs.size === 0) {
    return {
      ok: false,
      error: 'Nobody on a current registration is confirmed or waitlisted for this change — there is nothing to hold.',
    };
  }
  const held = [];
  for (const [id, name] of regs) {
    const res = await holdRegistration(id, reason);
    if (!res.ok) return res;
    held.push(name);
  }
  revalidatePath('/admin/changes');
  revalidatePath('/admin/review');
  return { ok: true, message: `On hold: ${held.join(', ')}. The family sees your reason on their dashboard.` };
}
