'use server';

// Activities, edited by the people who run them.
//
// Until now every activity in the ministry was seeded by migration. Adding
// one, correcting a capacity, or taking one off an event meant asking the web
// admin — which testing (25 Aug) named for what it is: not sensible. Camp
// changes what it offers between weeks, sometimes between years, and nobody
// should have to file a request to say so.
//
// Writes are gated by has_grant('setup', 'write') in RLS (0039, 0101). The
// checks here are the friendly half; Postgres is the boundary.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

const MODES = ['interest', 'signup'];

// The waiver decision that rides along with an activity's fields (21 Oct
// 2026). One choice, three answers: nothing, the outside provider's own form
// (provider_name / provider_url), or the ministry's own waiver signed on the
// site (an agreement_requirements row on the activity, 0116). For the third:
//   keep    -- leave what is attached;
//   reuse   -- attach an existing waiver (the horseback one on next year's
//              horseback activity, in one click);
//   new     -- write one here: a new agreements row, version 1;
//   revise  -- new text for the attached one: version n+1 of the same key.
const WAIVER_CHOICES = ['none', 'provider', 'ours'];
const WAIVER_MODES = ['keep', 'reuse', 'new', 'revise'];

function shapeWaiver(w) {
  // Callers that do not mention the waiver leave it exactly as it is.
  if (!w || typeof w !== 'object') return { waiver: null };
  const choice = WAIVER_CHOICES.includes(w.choice) ? w.choice : 'none';
  const mode = WAIVER_MODES.includes(w.mode) ? w.mode : 'keep';
  const title = String(w.title ?? '').trim();
  const body = String(w.body ?? '').trim();
  if (choice === 'ours') {
    if (mode === 'reuse' && !w.agreementId) {
      return { error: 'Choose a waiver from the list, or write a new one.' };
    }
    if (mode === 'new' || mode === 'revise') {
      if (!title) return { error: 'The waiver needs a title — what the family will see it called.' };
      if (title.length > 120) return { error: 'Keep the waiver title under 120 characters.' };
      if (body.length < 20) {
        return { error: 'The waiver needs its text — what the family is agreeing to.' };
      }
    }
  }
  return { waiver: { choice, mode, agreementId: w.agreementId || null, title, body } };
}

async function requireCoordinator() {
  const staff = await getStaff();
  if (!can(staff, 'write:setup')) {
    return { error: 'You do not have permission to change activities.' };
  }
  return { staff };
}

// Shared shaping so create and update cannot drift apart.
function shape(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) return { error: 'An activity needs a name.' };

  const mode = MODES.includes(input?.mode) ? input.mode : 'interest';

  let capacity = null;
  if (String(input?.capacity ?? '').trim() !== '') {
    const n = Number.parseInt(String(input.capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(n) || n < 0) {
      return { error: 'Places has to be a whole number, or blank for no limit.' };
    }
    capacity = n;
  }
  // "Interest" means we are asking who fancies it, not holding places. A
  // capacity on an interest activity would be counted against nothing and
  // shown to nobody, so it is dropped rather than quietly stored.
  if (mode === 'interest') capacity = null;

  const { waiver, error: waiverError } = shapeWaiver(input?.waiver);
  if (waiverError) return { error: waiverError };

  // The provider and the ministry's own waiver are one decision: naming a
  // provider while the waiver is chosen (or nothing) would have the family
  // told two different things, so the fields follow the choice.
  const provider = waiver && waiver.choice !== 'provider' ? '' : String(input?.providerName ?? '').trim();
  const url = waiver && waiver.choice !== 'provider' ? '' : String(input?.providerUrl ?? '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return { error: 'The provider link needs to start with http:// or https://' };
  }

  return {
    waiver,
    row: {
      name,
      description: String(input?.description ?? '').trim() || null,
      booking_mode: mode,
      capacity,
      // A provider name is what makes the site tell families the outfitter has
      // their own form. Blank means the ministry runs it.
      provider_name: provider || null,
      provider_url: url || null,
      active: input?.active !== false,
      sort_order: Number.parseInt(String(input?.sortOrder ?? '').trim(), 10) || 0,
    },
  };
}

export async function createActivity(eventId, input) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!eventId) return { ok: false, error: 'Which event?' };

  const { row, waiver, error } = shape(input);
  if (error) return { ok: false, error };

  const supabase = await createClient();
  const { data: made, error: dbError } = await supabase
    .from('activities')
    .insert({ event_id: eventId, ...row })
    .select('id')
    .single();
  if (dbError) {
    console.error('createActivity:', dbError.message);
    return { ok: false, error: `That could not be added: ${dbError.message}` };
  }

  // The activity exists now whatever happens below, so a waiver problem is
  // reported as its own thing rather than as "could not be added".
  const applied = await applyWaiver(supabase, made.id, waiver);
  revalidateAll();
  if (!applied.ok) {
    return { ok: false, error: `${row.name} was added, but its waiver was not: ${applied.error}` };
  }
  return { ok: true };
}

export async function updateActivity(activityId, input) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const { row, waiver, error } = shape(input);
  if (error) return { ok: false, error };

  const supabase = await createClient();

  // Refuse a capacity below the people already signed up, for the same reason
  // the event capacity refuses it: the number would be false the moment it
  // saved, and the list of names is the thing that is true.
  if (row.capacity != null) {
    const { count } = await supabase
      .from('activity_signups')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activityId)
      .neq('status', 'cancelled');
    if ((count ?? 0) > row.capacity) {
      return {
        ok: false,
        error: `${count} people are already signed up, so the number of places cannot be ${row.capacity}. Take names off first, or set a higher number.`,
      };
    }
  }

  const { error: dbError } = await supabase
    .from('activities')
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq('id', activityId);
  if (dbError) {
    console.error('updateActivity:', dbError.message);
    return { ok: false, error: `That could not be saved: ${dbError.message}` };
  }

  const applied = await applyWaiver(supabase, activityId, waiver);
  revalidateAll();
  if (!applied.ok) {
    return { ok: false, error: `The activity was saved, but its waiver was not: ${applied.error}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The ministry's own waiver on an activity (21 Oct 2026).
//
// 0116 attached the Horseback Riding Waiver by migration and said so in its
// header: a horseback activity on a later event needed a developer. This is
// the screen that was missing. The rows are the ones 0116 wrote by hand --
// an agreements row (key, version, title, body; delivery internal_document)
// and an agreement_requirements row scoped to the ACTIVITY, applies_to
// participant, required -- and the family's Activities page reads them
// unchanged.
//
// Rules, each for a reason:
//   * at most ONE ministry waiver per activity: the family page and the
//     staff page both assume it;
//   * text is never edited in place. A signature belongs to the words that
//     were on the screen when it was given (DECISIONS, 25 Aug), so a change
//     is a new VERSION of the same key, and the old version keeps its
//     signatures;
//   * revising moves THIS activity's requirement only. Another activity on
//     the same key (the other camp week, last year's event) stays where it
//     is -- the editor lists them so the staffer knows -- and the old version
//     is retired (active = false) only once nothing points at it any more,
//     because the family page refuses to show a retired version and a rider
//     on the other week would otherwise be able to sign up with no waiver.
//     admin_create_event() takes the newest ACTIVE version of a key either
//     way, so a copied event gets the revised text;
//   * taking the waiver off an activity deletes its requirement row and
//     nothing else -- never an agreement, never a signature.
//
// Nothing here is one transaction. The worst partial outcome is an
// agreements row with nothing pointing at it, which hurts nobody; every
// step's error comes back with the database's own words.

function slugOf(title) {
  return (
    String(title)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'waiver'
  );
}

// A key nobody has used: the slug of the title, then slug_2, slug_3 ...
async function freeKey(supabase, title) {
  const base = slugOf(title);
  const { data, error } = await supabase.from('agreements').select('key').like('key', `${base}%`);
  if (error) return { error: `The existing waivers could not be read: ${error.message}` };
  const taken = new Set((data ?? []).map((r) => r.key));
  if (!taken.has(base)) return { key: base };
  for (let i = 2; i < 1000; i += 1) {
    if (!taken.has(`${base}_${i}`)) return { key: `${base}_${i}` };
  }
  return { error: 'That title is already in use too many times — try another.' };
}

// This activity's requirement rows that point at a waiver signed on the site.
async function readActivityWaiver(supabase, activityId) {
  const { data, error } = await supabase
    .from('agreement_requirements')
    .select('id, agreement_id, agreements ( id, key, version, title, body, delivery, active )')
    .eq('activity_id', activityId);
  if (error) return { error: `The activity's waiver could not be read: ${error.message}` };
  return { rows: (data ?? []).filter((r) => r.agreements?.delivery === 'internal_document') };
}

async function insertAgreement(supabase, { key, version, title, body }) {
  const { data, error } = await supabase
    .from('agreements')
    .insert({ key, version, title, body, delivery: 'internal_document', external_url: null, active: true })
    .select('id')
    .single();
  if (error) return { error: `The waiver could not be saved: ${error.message}` };
  return { id: data.id };
}

async function applyWaiver(supabase, activityId, waiver) {
  if (!waiver) return { ok: true };

  const { rows, error: readError } = await readActivityWaiver(supabase, activityId);
  if (readError) return { ok: false, error: readError };
  const current = rows[0] ?? null;

  // None, or the provider's form: the requirement row goes; the agreement and
  // every signature stay.
  if (waiver.choice !== 'ours') {
    if (rows.length === 0) return { ok: true };
    const { error } = await supabase
      .from('agreement_requirements')
      .delete()
      .in('id', rows.map((r) => r.id));
    if (error) return { ok: false, error: `The waiver could not be taken off this activity: ${error.message}` };
    return { ok: true };
  }

  let agreementId;
  if (waiver.mode === 'keep') {
    if (!current) return { ok: false, error: 'Choose a waiver from the list, or write a new one.' };
    return { ok: true };
  }

  if (waiver.mode === 'reuse') {
    const { data: agr, error } = await supabase
      .from('agreements')
      .select('id, title, delivery, active')
      .eq('id', waiver.agreementId)
      .maybeSingle();
    if (error) return { ok: false, error: `That waiver could not be read: ${error.message}` };
    if (!agr) return { ok: false, error: 'That waiver no longer exists — choose another.' };
    if (agr.delivery !== 'internal_document') {
      return { ok: false, error: `${agr.title} is an outside link, not a waiver signed on the site.` };
    }
    if (!agr.active) {
      return { ok: false, error: `That version of ${agr.title} has been retired — choose the current one.` };
    }
    agreementId = agr.id;
  } else if (waiver.mode === 'new') {
    const { key, error } = await freeKey(supabase, waiver.title);
    if (error) return { ok: false, error };
    const made = await insertAgreement(supabase, { key, version: 1, title: waiver.title, body: waiver.body });
    if (made.error) return { ok: false, error: made.error };
    agreementId = made.id;
  } else {
    // revise: version n+1 of the attached waiver's key.
    if (!current) {
      return { ok: false, error: 'There is no waiver on this activity to revise — write a new one instead.' };
    }
    const old = current.agreements;
    if (old.title === waiver.title && String(old.body ?? '').trim() === waiver.body) {
      return { ok: true }; // nothing changed; no new version for no reason
    }
    const { data: latest, error: latestError } = await supabase
      .from('agreements')
      .select('version')
      .eq('key', old.key)
      .order('version', { ascending: false })
      .limit(1);
    if (latestError) return { ok: false, error: `The waiver's versions could not be read: ${latestError.message}` };
    const version = (latest?.[0]?.version ?? old.version) + 1;
    const made = await insertAgreement(supabase, { key: old.key, version, title: waiver.title, body: waiver.body });
    if (made.error) return { ok: false, error: made.error };
    agreementId = made.id;

    // Retire the old version once nothing else requires it (see the note at
    // the top of this section for why not always).
    const { count, error: othersError } = await supabase
      .from('agreement_requirements')
      .select('id', { count: 'exact', head: true })
      .eq('agreement_id', old.id)
      .neq('id', current.id);
    if (othersError) {
      return { ok: false, error: `Version ${version} was saved, but who else uses version ${old.version} could not be read: ${othersError.message}` };
    }
    if ((count ?? 0) === 0) {
      const { error: retireError } = await supabase
        .from('agreements')
        .update({ active: false })
        .eq('id', old.id);
      if (retireError) {
        return { ok: false, error: `Version ${version} was saved, but version ${old.version} could not be retired: ${retireError.message}` };
      }
    }
  }

  // Point this activity at it: the existing row re-pointed, or one added.
  // Any extra rows (there should be none) go, so one activity has one waiver.
  if (current) {
    if (current.agreement_id !== agreementId) {
      const { error } = await supabase
        .from('agreement_requirements')
        .update({ agreement_id: agreementId })
        .eq('id', current.id);
      if (error) return { ok: false, error: `The activity could not be pointed at the waiver: ${error.message}` };
    }
    if (rows.length > 1) {
      const { error } = await supabase
        .from('agreement_requirements')
        .delete()
        .in('id', rows.slice(1).map((r) => r.id));
      if (error) return { ok: false, error: `A duplicate waiver row could not be removed: ${error.message}` };
    }
  } else {
    const { error } = await supabase.from('agreement_requirements').insert({
      agreement_id: agreementId,
      event_id: null,
      activity_id: activityId,
      applies_to: 'participant',
      is_required: true,
    });
    if (error) return { ok: false, error: `The waiver could not be attached to this activity: ${error.message}` };
  }
  return { ok: true };
}

// Two different things, and the difference matters.
//
// TURNING IT OFF (active = false) hides it from families and keeps everything:
// who had signed up, when, and what they acknowledged. That is what you want
// for "not running this year".
//
// DELETING removes the row. Allowed only while nobody has signed up, because
// activity_signups cascades — deleting an activity with names on it would
// silently take a family's answer with it, and no screen would ever say so.
export async function setActivityActive(activityId, active) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };

  const supabase = await createClient();
  const { error } = await supabase
    .from('activities')
    .update({ active: Boolean(active), updated_at: new Date().toISOString() })
    .eq('id', activityId);
  if (error) return { ok: false, error: 'That could not be changed.' };

  revalidateAll();
  return { ok: true };
}

export async function deleteActivity(activityId) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const supabase = await createClient();
  const { count } = await supabase
    .from('activity_signups')
    .select('id', { count: 'exact', head: true })
    .eq('activity_id', activityId);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} ${
        count === 1 ? 'person has' : 'people have'
      } already put their name down for this. Turn it off instead — that hides it from families and keeps the record of who asked.`,
    };
  }

  const { error } = await supabase.from('activities').delete().eq('id', activityId);
  if (error) {
    console.error('deleteActivity:', error.message);
    return { ok: false, error: 'That could not be removed.' };
  }

  revalidateAll();
  return { ok: true };
}

function revalidateAll() {
  revalidatePath('/admin/activities');
  revalidatePath('/account/activities');
}

// ---------------------------------------------------------------------------
// Time slots (0052). The pontoon goes out four times on the Tuesday; the salon
// takes one person at a time. "Who is on the 2 o'clock boat" is the question
// the day is run from, and it had no home.
//
// Times are WALL-CLOCK AT CAMP -- a date and two times of day, stored as such.
// Nothing converts between zones, which is the point: a coordinator setting up
// from Mountain time is describing 2pm at camp, and a boarding time an hour out
// is discovered at the dock.

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function createSlot(activityId, input) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const date = String(input?.date ?? '').trim();
  const start = String(input?.start ?? '').trim();
  const end = String(input?.end ?? '').trim();
  if (!date) return { ok: false, error: 'Which day?' };
  if (!HHMM.test(start) || !HHMM.test(end)) {
    return { ok: false, error: 'Give a start and end time.' };
  }
  if (end <= start) return { ok: false, error: 'The end time is before the start time.' };

  let capacity = null;
  if (String(input?.capacity ?? '').trim() !== '') {
    const n = Number.parseInt(String(input.capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(n) || n < 1) {
      return { ok: false, error: 'Places has to be 1 or more, or blank for no limit.' };
    }
    capacity = n;
  }

  const supabase = await createClient();
  const { error } = await supabase.from('activity_slots').insert({
    activity_id: activityId,
    slot_date: date,
    start_time: start,
    end_time: end,
    label: String(input?.label ?? '').trim() || null,
    capacity,
  });
  if (error) {
    console.error('createSlot:', error.message);
    return { ok: false, error: 'That time could not be added.' };
  }

  revalidateAll();
  return { ok: true };
}

export async function deleteSlot(slotId) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!slotId) return { ok: false, error: 'Which time?' };

  const supabase = await createClient();

  // Refused while anyone is on it. Deleting would either orphan them onto the
  // activity with no time (which the 0052 guard forbids) or take their signup
  // with it -- and a family whose booking vanished is told by nothing.
  const { count } = await supabase
    .from('activity_signups')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slotId)
    .neq('status', 'cancelled');

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} ${
        count === 1 ? 'person is' : 'people are'
      } booked on this time. Move them to another time first — they cannot be left on the activity with no time.`,
    };
  }

  const { error } = await supabase.from('activity_slots').delete().eq('id', slotId);
  if (error) return { ok: false, error: 'That time could not be removed.' };

  revalidateAll();
  return { ok: true };
}

// Build a run of times in one go.
//
// The salon takes one person at a time from 9 to 5; the pontoon runs half-hour
// trips all Tuesday afternoon. Typing twenty of those by hand is how a
// coordinator decides the software is not worth it, and how the twelfth one
// ends up starting at 2:15 instead of 2:20 (asked for 25 Aug).
//
// Everything is checked BEFORE anything is written: a partial run is worse
// than none, because the gap is invisible until somebody cannot book.
export async function generateSlots(activityId, input) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const date = String(input?.date ?? '').trim();
  const start = String(input?.start ?? '').trim();
  const end = String(input?.end ?? '').trim();
  if (!date) return { ok: false, error: 'Which day?' };
  if (!HHMM.test(start) || !HHMM.test(end)) {
    return { ok: false, error: 'Give a start and an end time for the whole run.' };
  }
  if (end <= start) return { ok: false, error: 'The run ends before it starts.' };

  const minutes = Number.parseInt(String(input?.minutes ?? '').trim(), 10);
  if (Number.isNaN(minutes) || minutes < 5) {
    return { ok: false, error: 'How long is each slot? Five minutes or more.' };
  }

  let capacity = null;
  if (String(input?.capacity ?? '').trim() !== '') {
    const n = Number.parseInt(String(input.capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(n) || n < 1) {
      return { ok: false, error: 'Places per slot has to be 1 or more, or blank for no limit.' };
    }
    capacity = n;
  }

  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  const from = toMin(start);
  const to = toMin(end);
  const count = Math.floor((to - from) / minutes);
  if (count < 1) {
    return { ok: false, error: 'That run is shorter than one slot.' };
  }
  // A guard on the coordinator's own typo, not on the ministry: 5-minute slots
  // across a whole day is 200 rows, and nobody means that.
  if (count > 60) {
    return {
      ok: false,
      error: `That would make ${count} slots. If you really want that many, add them in a few runs — it is usually a typo in the length.`,
    };
  }

  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      activity_id: activityId,
      slot_date: date,
      start_time: toHHMM(from + i * minutes),
      end_time: toHHMM(from + (i + 1) * minutes),
      capacity,
      // Numbered so two slots at the same time on different boats can still be
      // told apart, and so the run reads as a run.
      label: String(input?.labelPrefix ?? '').trim()
        ? `${String(input.labelPrefix).trim()} ${i + 1}`
        : null,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from('activity_slots').insert(rows);
  if (error) {
    console.error('generateSlots:', error.message);
    return { ok: false, error: 'Those times could not be added.' };
  }

  revalidateAll();
  return { ok: true, made: rows.length };
}
