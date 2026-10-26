'use server';

// The groups board's writes (0125): add, rename, resize and delete a group;
// place and unplace a unit. Activities write -- the placements area in 0101's
// mapping; RLS refuses anyone else too. Every database error comes back to
// the board with its own words, never as an empty success.
//
// Placing works out the unit again HERE, from the database, rather than
// trusting the list the browser holds: a buddy goes wherever their camper
// goes (Lawrence, 26 Oct 2026), and a stale page must not leave one behind.
//
// Deleting a group that still has people in it sends them back to "To place"
// (the member rows cascade). The board asks first and says how many.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { buildUnits, unitOf, nextGroupName } from '@/lib/activityGroups';

async function requireWrite() {
  const staff = await getStaff();
  return can(staff, 'write:activities') ? null : 'Changing groups needs Activities write.';
}

function revalidate() {
  revalidatePath('/admin/activities/groups');
  revalidatePath('/admin/activities/groups/print');
}

const dbWords = (error) =>
  error?.code === '23505'
    ? 'That name is already used by another group on this activity.'
    : error?.message || 'The database refused it.';

// The unit holding one person, from the database: active signups on the
// activity, live buddy pairings on its event, both people still on the roster.
async function unitFromDb(supabase, activityId, eventId, participantId) {
  const [signups, pairsRes] = await Promise.all([
    supabase
      .from('activity_signups')
      .select('registration_participant_id, registration_participants!inner ( status )')
      .eq('activity_id', activityId)
      .neq('status', 'cancelled')
      .neq('registration_participants.status', 'cancelled'),
    supabase
      .from('buddy_assignments')
      .select('camper_participant_id, buddy_participant_id')
      .eq('event_id', eventId)
      .is('ended_at', null),
  ]);
  if (signups.error) return { error: `Sign-ups could not be read: ${signups.error.message}` };
  if (pairsRes.error) return { error: `Buddy pairings could not be read: ${pairsRes.error.message}` };

  const pairIds = [
    ...new Set((pairsRes.data ?? []).flatMap((p) => [p.camper_participant_id, p.buddy_participant_id])),
  ];
  let live = new Set();
  if (pairIds.length > 0) {
    const { data, error } = await supabase
      .from('registration_participants')
      .select('id')
      .in('id', pairIds)
      .neq('status', 'cancelled');
    if (error) return { error: `The roster could not be read: ${error.message}` };
    live = new Set((data ?? []).map((r) => r.id));
  }
  const pairs = (pairsRes.data ?? [])
    .filter((p) => live.has(p.camper_participant_id) && live.has(p.buddy_participant_id))
    .map((p) => ({ camperId: p.camper_participant_id, buddyId: p.buddy_participant_id }));
  const units = buildUnits((signups.data ?? []).map((s) => s.registration_participant_id), pairs);
  return { unit: unitOf(participantId, units) };
}

async function readGroup(supabase, groupId) {
  const { data, error } = await supabase
    .from('activity_groups')
    .select('id, activity_id, name, activities ( event_id, name )')
    .eq('id', groupId)
    .maybeSingle();
  if (error) return { error: `The group could not be read: ${error.message}` };
  if (!data) return { error: 'That group no longer exists — reload the page.' };
  return { group: data };
}

export async function createGroup({ activityId }) {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const supabase = await createClient();
  const [{ data: activity, error: actError }, { data: existing, error: exError }] = await Promise.all([
    supabase.from('activities').select('id, name').eq('id', activityId).maybeSingle(),
    supabase.from('activity_groups').select('name, sort_order').eq('activity_id', activityId),
  ]);
  if (actError) return { ok: false, error: `The activity could not be read: ${actError.message}` };
  if (!activity) return { ok: false, error: 'That activity no longer exists.' };
  if (exError) return { ok: false, error: `The groups could not be read: ${exError.message}` };

  const rows = existing ?? [];
  const { data: made, error } = await supabase
    .from('activity_groups')
    .insert({
      activity_id: activityId,
      name: nextGroupName(activity.name, rows.map((r) => r.name)),
      capacity: 6,
      sort_order: rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0) + 1,
    })
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: `That could not be added: ${dbWords(error)}` };
  if (!made) return { ok: false, error: 'Nothing was added — you may not have permission.' };
  revalidate();
  return { ok: true };
}

export async function updateGroup({ groupId, name, capacity }) {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  if (!groupId) return { ok: false, error: 'Which group?' };

  const cleanName = String(name ?? '').trim();
  if (!cleanName) return { ok: false, error: 'A group needs a name.' };
  if (cleanName.length > 60) return { ok: false, error: 'Keep the name under 60 characters.' };
  const size = Number(String(capacity ?? '').trim());
  if (!Number.isInteger(size) || size < 1 || size > 200) {
    return { ok: false, error: 'Size has to be a whole number, 1 or more.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activity_groups')
    .update({ name: cleanName, capacity: size })
    .eq('id', groupId)
    .select('id');
  if (error) return { ok: false, error: `That could not be saved: ${dbWords(error)}` };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Nothing was saved — the group may be gone, or you may not have permission.' };
  }
  revalidate();
  return { ok: true };
}

export async function deleteGroup({ groupId }) {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  if (!groupId) return { ok: false, error: 'Which group?' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('activity_groups')
    .delete()
    .eq('id', groupId)
    .select('id');
  if (error) return { ok: false, error: `That could not be deleted: ${dbWords(error)}` };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Nothing was deleted — the group may be gone, or you may not have permission.' };
  }
  revalidate();
  return { ok: true };
}

// Place the unit holding `participantId` in a group: every member, moving any
// who are in another group of the same activity (one row per person per
// activity -- the upsert changes their group).
export async function placeUnit({ groupId, participantId }) {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  if (!groupId || !participantId) return { ok: false, error: 'Pick both a person and a group.' };

  const supabase = await createClient();
  const { group, error: gError } = await readGroup(supabase, groupId);
  if (gError) return { ok: false, error: gError };

  const { unit, error: uError } = await unitFromDb(
    supabase,
    group.activity_id,
    group.activities?.event_id,
    participantId
  );
  if (uError) return { ok: false, error: uError };

  const { data, error } = await supabase
    .from('activity_group_members')
    .upsert(
      unit.map((id) => ({
        group_id: group.id,
        activity_id: group.activity_id,
        registration_participant_id: id,
      })),
      { onConflict: 'registration_participant_id,activity_id' }
    )
    .select('registration_participant_id');
  if (error) return { ok: false, error: `That could not be placed: ${dbWords(error)}` };
  if (!data || data.length !== unit.length) {
    return {
      ok: false,
      error: `Only ${data?.length ?? 0} of ${unit.length} were placed — reload the page and check ${group.name}.`,
    };
  }
  revalidate();
  return { ok: true, placed: unit.length };
}

// Take the unit holding `participantId` out of every group of the activity:
// back to "To place". The buddy comes back with the camper.
export async function unplaceUnit({ activityId, participantId }) {
  const denied = await requireWrite();
  if (denied) return { ok: false, error: denied };
  if (!activityId || !participantId) return { ok: false, error: 'Nothing to remove.' };

  const supabase = await createClient();
  const { data: activity, error: actError } = await supabase
    .from('activities')
    .select('id, event_id')
    .eq('id', activityId)
    .maybeSingle();
  if (actError) return { ok: false, error: `The activity could not be read: ${actError.message}` };
  if (!activity) return { ok: false, error: 'That activity no longer exists.' };

  const { unit, error: uError } = await unitFromDb(supabase, activityId, activity.event_id, participantId);
  if (uError) return { ok: false, error: uError };
  // A person placed earlier who is no longer part of the unit (a pairing
  // ended) is still removed when they are the one pressed.
  const ids = unit.includes(participantId) ? unit : [...unit, participantId];

  const { data, error } = await supabase
    .from('activity_group_members')
    .delete()
    .eq('activity_id', activityId)
    .in('registration_participant_id', ids)
    .select('registration_participant_id');
  if (error) return { ok: false, error: `That could not be removed: ${dbWords(error)}` };
  if (!data || data.length === 0) {
    return { ok: false, error: 'Nothing was removed — they may already be off, or you may not have permission.' };
  }
  revalidate();
  return { ok: true };
}
