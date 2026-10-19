'use server';

// Staff & Access management. Admin-only. The staff_write RLS policy
// (is_admin() for ALL commands) is the real gate; these checks give friendly
// errors instead of silent failures. Adding staff uses the narrow
// staff_lookup_by_email RPC (migration 0011), because emails live in
// auth.users, which clients cannot read.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { AREA_KEYS, PRESETS, cleanGrants, grantsForPreset } from '@/lib/grants';

const ROLES = ['registrar', 'coordinator', 'admin'];

export async function updateStaffMember(profileId, patch) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (profileId === staff.userId && patch.role && patch.role !== 'admin') {
    return { ok: false, error: 'You cannot remove your own admin role. Ask another admin.' };
  }
  if (profileId === staff.userId && patch.active === false) {
    return { ok: false, error: 'You cannot deactivate yourself. Ask another admin.' };
  }

  const clean = {};
  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role)) return { ok: false, error: 'Unknown role.' };
    clean.role = patch.role;
  }
  if (patch.title !== undefined) clean.title = String(patch.title).trim() || null;
  if (patch.can_view_sensitive !== undefined) clean.can_view_sensitive = !!patch.can_view_sensitive;
  if (patch.can_view_giving !== undefined) clean.can_view_giving = !!patch.can_view_giving;
  if (patch.can_view_background_checks !== undefined) {
    clean.can_view_background_checks = !!patch.can_view_background_checks;
  }
  if (patch.active !== undefined) clean.active = !!patch.active;

  const supabase = await createClient();
  const { error } = await supabase.from('staff').update(clean).eq('profile_id', profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/staff');
  return { ok: true };
}

export async function addStaffMember(email, role) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (!ROLES.includes(role)) return { ok: false, error: 'Unknown role.' };
  const cleanEmail = String(email ?? '').trim();
  if (!cleanEmail) return { ok: false, error: 'Enter an email address.' };

  const supabase = await createClient();
  const { data: found, error: lookupError } = await supabase.rpc('staff_lookup_by_email', {
    p_email: cleanEmail,
  });
  if (lookupError) return { ok: false, error: lookupError.message };
  if (!found || found.length === 0) {
    return {
      ok: false,
      error:
        'No account found with that email. They need to create an account on the site first — then add them here.',
    };
  }

  const person = found[0];
  const { error } = await supabase.from('staff').upsert(
    {
      profile_id: person.profile_id,
      role,
      active: true,
    },
    { onConflict: 'profile_id' }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/staff');
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ') || cleanEmail;
  return { ok: true, name };
}

// Remove someone from the staff list entirely -- for a helper who has moved
// on, as opposed to Deactivate, which parks them for reactivation. Deletes
// ONLY the staff row: their account, family records, and anything they
// recorded as staff (notes, grants -- those reference profiles, not staff)
// are untouched, and they can be re-added later with "Add a staff member".
export async function removeStaffMember(profileId) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (profileId === staff.userId) {
    return { ok: false, error: 'You cannot remove yourself from staff. Ask another admin.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('staff').delete().eq('profile_id', profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/staff');
  return { ok: true };
}

// THE GRANTS MODEL (0100; Luke14-Access-Model-Plan). Set one person's grants
// to exactly what was asked: areas that changed are upserted or removed, so
// the access log (trigger) carries one row per real change and nothing for a
// save that changed nothing. Admin-only; staff_grants_admin_write is the gate.
export async function setStaffGrants(profileId, input) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (!profileId) return { ok: false, error: 'Missing person.' };
  const wanted = cleanGrants(input);

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from('staff_grants')
    .select('area, level')
    .eq('profile_id', profileId);
  if (readError) return { ok: false, error: readError.message };
  const have = new Map((current ?? []).map((g) => [g.area, g.level]));

  const upserts = [];
  const removals = [];
  for (const area of AREA_KEYS) {
    const w = wanted[area] ?? null;
    const h = have.get(area) ?? null;
    if (w === h) continue;
    if (w) {
      upserts.push({
        profile_id: profileId,
        area,
        level: w,
        granted_by: staff.userId,
        granted_at: new Date().toISOString(),
      });
    } else {
      removals.push(area);
    }
  }
  if (upserts.length) {
    const { error } = await supabase.from('staff_grants').upsert(upserts, { onConflict: 'profile_id,area' });
    if (error) return { ok: false, error: error.message };
  }
  if (removals.length) {
    const { error } = await supabase.from('staff_grants').delete().eq('profile_id', profileId).in('area', removals);
    if (error) return { ok: false, error: error.message };
  }
  // The three old staff columns follow the grants on every save. Nothing in
  // the database reads them since 0101 (can_view_sensitive() is
  // has_grant('sensitive', 'read')), but they were only written by a preset,
  // so a Sensitive grant removed by hand left can_view_sensitive = true and
  // the header kept saying "Sensitive access" (Script 5, 18 Oct 2026). The
  // trigger logs a column only when it actually changes.
  const { error: syncError } = await supabase
    .from('staff')
    .update({
      can_view_sensitive: Boolean(wanted.sensitive),
      can_view_giving: Boolean(wanted.giving),
      can_view_background_checks: wanted.background_checks === 'write',
    })
    .eq('profile_id', profileId);
  if (syncError) return { ok: false, error: syncError.message };
  revalidatePath('/admin/staff');
  revalidatePath('/admin/staff/access-log');
  // The saved grants go back to the page so the row shows them at once.
  return { ok: true, changed: upserts.length + removals.length, grants: wanted };
}

// A preset in one click: the grants exactly (Giving left as it is) and the
// role label. setStaffGrants keeps the old Sensitive / Giving /
// Background-checks columns in step with the grants.
export async function applyPreset(profileId, key) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  const p = PRESETS[key];
  if (!p) return { ok: false, error: 'Unknown preset.' };
  if (profileId === staff.userId && p.role !== 'admin') {
    return { ok: false, error: 'You cannot take your own administrator role away. Ask another admin.' };
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from('staff_grants')
    .select('area, level')
    .eq('profile_id', profileId);
  const cur = {};
  for (const g of current ?? []) cur[g.area] = g.level;

  const res = await setStaffGrants(profileId, grantsForPreset(key, cur));
  if (!res.ok) return res;

  const { error } = await supabase.from('staff').update({ role: p.role }).eq('profile_id', profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/staff');
  return { ok: true, label: p.label, role: p.role, grants: res.grants };
}
