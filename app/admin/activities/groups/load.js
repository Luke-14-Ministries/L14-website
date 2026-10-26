// Everything the groups board, its print sheet and its CSV read, in one
// place so the three cannot disagree (0125). Server only: called from server
// components and a route handler with the caller's own Supabase client, so
// RLS decides what comes back. Every query error is thrown, never turned
// into an empty list.
//
// WHAT IT DELIBERATELY DOES NOT CARRY: support narrative. The support FLAG
// only (allergies, seizures, rescue medication, a buddy required) -- the same
// line as the activity print sheet (app/admin/activities/print/page.jsx):
// "ask the coordinator", and the detail stays on Medical & Support. The flag
// columns are read through person_support, so they arrive only for staff
// with Sensitive read; for everyone else `ask` is false and the board says
// that flags are not shown to them.

import { ageAt } from '@/lib/programs';
import { buildUnits } from '@/lib/activityGroups';

function fail(what, error) {
  throw new Error(`Activity groups — ${what}: ${error.message}`);
}

export async function loadActivityGroups(supabase, activityId) {
  const { data: activity, error: actError } = await supabase
    .from('activities')
    .select(
      'id, event_id, name, min_age, active, provider_name, provider_url, events ( id, name, starts_on, ends_on )'
    )
    .eq('id', activityId)
    .maybeSingle();
  if (actError) fail('the activity', actError);
  if (!activity) return null;
  const event = activity.events ?? null;
  const eventId = activity.event_id;

  const [signupRes, partRes, pairRes, groupRes, memberRes, owedRes, reqRes, progRes] =
    await Promise.all([
      supabase
        .from('activity_signups')
        .select('registration_participant_id, status')
        .eq('activity_id', activityId)
        .neq('status', 'cancelled'),
      supabase
        .from('registration_participants')
        .select(
          `id, camp_role, status, program_id,
           people ( id, first_name, last_name, preferred_name, date_of_birth,
             person_support ( has_allergies, has_seizures, has_rescue_medication, buddy_required ) ),
           registrations!inner ( id, event_id, household_id, households ( display_name ) )`
        )
        .eq('registrations.event_id', eventId)
        .neq('status', 'cancelled'),
      supabase
        .from('buddy_assignments')
        .select('camper_participant_id, buddy_participant_id')
        .eq('event_id', eventId)
        .is('ended_at', null),
      supabase
        .from('activity_groups')
        .select('id, name, capacity, sort_order, created_at')
        .eq('activity_id', activityId)
        .order('sort_order')
        .order('created_at'),
      supabase
        .from('activity_group_members')
        .select('group_id, registration_participant_id')
        .eq('activity_id', activityId),
      // Whose waiver is still needed: the one place that answers it (0120).
      supabase
        .from('activity_waivers_outstanding')
        .select('registration_participant_id, kind')
        .eq('activity_id', activityId),
      supabase
        .from('agreement_requirements')
        .select('agreement_id, agreements ( id, delivery )')
        .eq('activity_id', activityId)
        .eq('is_required', true),
      supabase.from('programs').select('id, name, sort_order').order('sort_order'),
    ]);
  if (signupRes.error) fail('sign-ups', signupRes.error);
  if (partRes.error) fail('the roster', partRes.error);
  if (pairRes.error) fail('buddy pairings', pairRes.error);
  if (groupRes.error) fail('groups', groupRes.error);
  if (memberRes.error) fail('group members', memberRes.error);
  if (owedRes.error) fail('outstanding waivers', owedRes.error);
  if (reqRes.error) fail('the activity waiver', reqRes.error);
  if (progRes.error) fail('programs', progRes.error);

  const rows = partRes.data ?? [];
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // Signed up = an active signup on a participant still on the roster.
  const statusById = new Map();
  for (const s of signupRes.data ?? []) {
    if (rowById.has(s.registration_participant_id)) {
      statusById.set(s.registration_participant_id, s.status);
    }
  }
  const pairs = (pairRes.data ?? [])
    .filter((p) => rowById.has(p.camper_participant_id) && rowById.has(p.buddy_participant_id))
    .map((p) => ({ camperId: p.camper_participant_id, buddyId: p.buddy_participant_id }));
  const units = buildUnits([...statusById.keys()], pairs);

  // Who in a unit is the buddy of whom, for "Paired with".
  const pairedWith = new Map();
  const goingIds = new Set(units.flat());
  for (const p of pairs) {
    if (!goingIds.has(p.camperId) || !statusById.has(p.camperId)) continue;
    if (!pairedWith.has(p.camperId)) pairedWith.set(p.camperId, new Set());
    if (!pairedWith.has(p.buddyId)) pairedWith.set(p.buddyId, new Set());
    pairedWith.get(p.camperId).add(p.buddyId);
    pairedWith.get(p.buddyId).add(p.camperId);
  }
  const buddyIds = new Set(
    pairs.filter((p) => statusById.has(p.camperId)).map((p) => p.buddyId)
  );

  // ---- Waivers ------------------------------------------------------------
  // Does the activity carry one at all? Ours (a required internal agreement)
  // or the outfitter's (a provider named), the two kinds the view knows.
  const hasProvider = Boolean(
    String(activity.provider_name ?? '').trim() || String(activity.provider_url ?? '').trim()
  );
  const ourAgreementIds = (reqRes.data ?? [])
    .filter((r) => r.agreements?.delivery === 'internal_document')
    .map((r) => r.agreement_id);
  const hasWaiver = hasProvider || ourAgreementIds.length > 0;
  const owed = new Set((owedRes.data ?? []).map((o) => o.registration_participant_id));

  // A buddy riding with their camper WITHOUT a signup of their own is not on
  // activity_waivers_outstanding -- the view is built from signups. For them
  // alone the page asks the two facts the view asks (an uploaded outfitter
  // confirmation; a signature of our waiver on this registration), so the
  // raft list does not show a buddy as "on file" by silence.
  // A REJECTED upload counts as missing, as it does in the view since 0124.
  const unsignedBuddies = [...buddyIds].filter((id) => !statusById.has(id));
  const buddyUpload = new Set();
  const buddySigned = new Set();
  if (hasWaiver && unsignedBuddies.length > 0) {
    if (hasProvider) {
      const { data, error } = await supabase
        .from('activity_waiver_uploads')
        .select('registration_participant_id')
        .eq('activity_id', activityId)
        .neq('review_status', 'rejected')
        .in('registration_participant_id', unsignedBuddies);
      if (error) fail('buddy waiver uploads', error);
      for (const u of data ?? []) buddyUpload.add(u.registration_participant_id);
    }
    if (ourAgreementIds.length > 0) {
      const personIds = unsignedBuddies.map((id) => rowById.get(id)?.people?.id).filter(Boolean);
      const { data, error } = await supabase
        .from('agreement_signatures')
        .select('agreement_id, person_id, registration_id')
        .in('agreement_id', ourAgreementIds)
        .in('person_id', personIds);
      if (error) fail('buddy waiver signatures', error);
      const sig = new Set((data ?? []).map((s) => `${s.agreement_id}:${s.person_id}:${s.registration_id}`));
      for (const id of unsignedBuddies) {
        const r = rowById.get(id);
        const all = ourAgreementIds.every((a) =>
          sig.has(`${a}:${r?.people?.id}:${r?.registrations?.id}`)
        );
        if (all) buddySigned.add(id);
      }
    }
  }
  const waiverOf = (id) => {
    if (!hasWaiver) return null;
    if (statusById.has(id)) return owed.has(id) ? 'needed' : 'on_file';
    const uploadOk = !hasProvider || buddyUpload.has(id);
    const signOk = ourAgreementIds.length === 0 || buddySigned.has(id);
    return uploadOk && signOk ? 'on_file' : 'needed';
  };

  // ---- People ---------------------------------------------------------------
  const programName = new Map((progRes.data ?? []).map((p) => [p.id, p.name]));
  const minAge = activity.min_age ?? null;
  const members = memberRes.data ?? [];
  const groupOf = new Map(members.map((m) => [m.registration_participant_id, m.group_id]));

  const shapePerson = (id) => {
    const r = rowById.get(id);
    const pe = r?.people;
    const s = Array.isArray(pe?.person_support) ? pe.person_support[0] : pe?.person_support;
    const age = ageAt(pe?.date_of_birth, event?.starts_on);
    const preferred =
      pe?.preferred_name && pe.preferred_name !== pe.first_name ? pe.preferred_name : null;
    return {
      participantId: id,
      name: `${pe?.first_name ?? ''} ${pe?.last_name ?? ''}`.trim() || 'Unnamed',
      preferred,
      household: r?.registrations?.households?.display_name ?? '',
      householdId: r?.registrations?.household_id ?? null,
      role: r?.camp_role ?? null,
      programId: r?.program_id ?? null,
      program: r?.program_id ? programName.get(r.program_id) ?? '' : '',
      age,
      under: minAge != null && age != null && age < minAge,
      ageUnknown: minAge != null && age == null,
      ask: Boolean(s?.has_allergies || s?.has_seizures || s?.has_rescue_medication || s?.buddy_required),
      waiver: waiverOf(id),
      // 'signed_up' | 'interested' | null (riding along as a buddy)
      signup: statusById.get(id) ?? null,
      isBuddy: buddyIds.has(id),
      pairedWith: [...(pairedWith.get(id) ?? [])],
      groupId: groupOf.get(id) ?? null,
      // Placed, but neither signed up nor a going camper's buddy any more
      // (a cancelled signup, an ended pairing). Shown, never hidden.
      stray: !goingIds.has(id),
    };
  };

  const people = {};
  for (const id of goingIds) people[id] = shapePerson(id);
  for (const m of members) {
    const id = m.registration_participant_id;
    if (!people[id] && rowById.has(id)) people[id] = shapePerson(id);
  }
  const names = (ids) => ids.map((i) => people[i]?.name ?? '');
  for (const p of Object.values(people)) p.pairedWithNames = names(p.pairedWith);

  // Units, camper first then their buddies, then by name; strays as units of
  // one so a group card can list them.
  const orderUnit = (u) =>
    [...u].sort((a, b) => {
      const pa = people[a];
      const pb = people[b];
      const rank = (p) => (p.isBuddy && !p.signup ? 2 : p.isBuddy ? 1 : 0);
      return rank(pa) - rank(pb) || pa.name.localeCompare(pb.name);
    });
  const allUnits = [
    ...units.map(orderUnit),
    ...members
      .map((m) => m.registration_participant_id)
      .filter((id) => people[id]?.stray)
      .map((id) => [id]),
  ];

  const groups = (groupRes.data ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    capacity: g.capacity,
    sortOrder: g.sort_order,
    memberIds: members.filter((m) => m.group_id === g.id).map((m) => m.registration_participant_id),
  }));

  return {
    activity: {
      id: activity.id,
      name: activity.name,
      minAge,
      active: activity.active !== false,
      eventId,
      hasWaiver,
      hasProvider,
    },
    event: event
      ? { id: event.id, name: event.name, startsOn: event.starts_on, endsOn: event.ends_on }
      : null,
    people,
    units: allUnits,
    groups,
    programs: (progRes.data ?? []).map((p) => ({ id: p.id, name: p.name })),
  };
}
