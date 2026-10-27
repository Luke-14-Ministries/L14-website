'use server';

// Activity choices, made by the family for their own people.
//
// Row-level security already scopes activity_signups to my_participant_ids(),
// so a family physically cannot write a choice onto someone else's place --
// these actions add the human-readable errors and the rules that are policy
// rather than permission (capacity, closed windows, waiver acknowledgement).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

// The capacities a signature is given in -- the wizard's vocabulary
// (app/register/family/actions.js), and its notes, so a staff member reading
// the signatures table sees one kind of row whichever page wrote it.
const SIGNER_ROLES = new Set(['self', 'parent_guardian', 'legal_guardian', 'authorized_adult']);
const SIGNER_NOTE = {
  self: 'Signed for themselves.',
  parent_guardian: 'Signed by their parent or legal guardian.',
  legal_guardian: 'Signed by their legal guardian.',
  authorized_adult:
    'Signed on their behalf; the signer affirmed this adult gave permission to sign for them.',
};
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Age at the start of the event, as the wizard counts it.
function ageAt(dob, onDate) {
  if (!dob || !onDate) return null;
  const [by, bm, bd] = String(dob).split('-').map(Number);
  const [y, m, d] = String(onDate).split('-').map(Number);
  if (!by || !y) return null;
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

// What is wrong with a signature as sent, in the family's words, or null.
// The rules are the wizard's: the agreement is read and agreed to, a real
// name is typed, the capacity is one we know; a minor at the start of the
// event is signed for by a parent or guardian, never by themselves; signing
// as the rider means typing the rider's own name; signing for another adult
// needs their permission affirmed.
function signatureProblem(signature, participant) {
  if (signature.agreed !== true) {
    return 'Please tick to confirm you have read the agreement and agree to it.';
  }
  const name = String(signature.signerName ?? '').trim();
  if (name.length < 2 || name.length > 120) {
    return 'Please type the full name of the person signing.';
  }
  const role = signature.signerRole;
  if (!SIGNER_ROLES.has(role)) return 'Please say who is signing.';
  const rider = `${participant.people?.first_name ?? ''} ${participant.people?.last_name ?? ''}`;
  const age = ageAt(participant.people?.date_of_birth, participant.registrations?.events?.starts_on);
  if (age !== null && age < 18 && role !== 'parent_guardian' && role !== 'legal_guardian') {
    return `${participant.people?.first_name ?? 'The rider'} is under 18 at the start of the event, so a parent or legal guardian signs for them.`;
  }
  if (role === 'self' && norm(name) !== norm(rider)) {
    return `To sign as the rider, type the rider's own name (${rider.trim()}) — or choose how you are signing for them.`;
  }
  if (role === 'authorized_adult' && signature.affirmed !== true) {
    return `Please confirm that ${participant.people?.first_name ?? 'the rider'} has given you permission to sign on their behalf.`;
  }
  return null;
}

// The activity and the person a choice or a signature is about, read on the
// server and checked against the caller's own household -- the part
// setActivityChoice() and signActivityWaiver() share, so the two cannot
// drift apart. Returns { activity, participant } or { error }.
async function activityAndPerson(supabase, participantId, activityId, label) {
  const { data: activity, error: actError } = await supabase
    .from('activities')
    .select('id, event_id, name, booking_mode, capacity, provider_name, provider_url, active, signup_opens_at, signup_closes_at')
    .eq('id', activityId)
    .maybeSingle();
  if (actError) {
    console.error(`${label} activity:`, actError.message);
    return { error: `That activity could not be read: ${actError.message}` };
  }
  if (!activity) return { error: 'That activity could not be found.' };
  if (!activity.active) return { error: 'That activity is not open at the moment.' };

  // Whose place this is. RLS lets a family read only their own participants,
  // so a row here is the family's; the person, registration and event start
  // are what the waiver below is written against -- read here, never taken
  // from the browser.
  const { data: participant, error: partError } = await supabase
    .from('registration_participants')
    .select(
      `id, person_id, registration_id, camp_role, status,
       people ( first_name, last_name, date_of_birth ),
       registrations ( household_id, event_id, events ( starts_on ) )`
    )
    .eq('id', participantId)
    .maybeSingle();
  if (partError) {
    console.error(`${label} participant:`, partError.message);
    return { error: `That person could not be read: ${partError.message}` };
  }
  if (!participant) return { error: 'That person is not on one of your registrations.' };
  // Explicit household scope, not RLS alone (CLAUDE.md): staff who are also a
  // family read every participant, and must still sign only for their own.
  const { data: { user } = {} } = await supabase.auth.getUser();
  const { data: memberships, error: memError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user?.id ?? '00000000-0000-0000-0000-000000000000');
  if (memError) {
    console.error(`${label} memberships:`, memError.message);
    return { error: `Your household could not be read: ${memError.message}` };
  }
  if (!(memberships ?? []).some((m) => m.household_id === participant.registrations?.household_id)) {
    return { error: 'That person is not on one of your registrations.' };
  }
  return { activity, participant };
}

// THE WAIVER (0116). An activity may carry a required agreement of its own
// (agreement_requirements.activity_id) -- the horseback waiver. Each one not
// yet signed for this person on this registration is signed now, from
// `signature`, with the same shape the wizard gives the event agreements;
// without a matching signature the caller is told what is missing. Never
// removes a signature: what was agreed to stays agreed to. Returns
// { ok: true } or { error }.
async function signRequiredWaivers(supabase, { activity, participant, signature, label }) {
  const { data: reqRows, error: reqError } = await supabase
    .from('agreement_requirements')
    .select('agreement_id, agreements ( id, title, active, delivery )')
    .eq('activity_id', activity.id)
    .eq('is_required', true);
  if (reqError) {
    console.error(`${label} requirements:`, reqError.message);
    return { error: `The activity's agreements could not be read: ${reqError.message}` };
  }
  const required = (reqRows ?? [])
    .map((r) => r.agreements)
    .filter((a) => a?.active && a.delivery === 'internal_document');

  for (const agreement of required) {
    const { data: have, error: haveError } = await supabase
      .from('agreement_signatures')
      .select('id')
      .eq('agreement_id', agreement.id)
      .eq('person_id', participant.person_id)
      .eq('registration_id', participant.registration_id)
      .limit(1);
    if (haveError) {
      console.error(`${label} signatures:`, haveError.message);
      return { error: `The signatures could not be read: ${haveError.message}` };
    }
    if ((have ?? []).length > 0) continue;

    if (!signature || signature.agreementId !== agreement.id) {
      return {
        error: `${activity.name} needs the ${agreement.title} signed first. Tick the activity to read and sign it.`,
      };
    }
    const problem = signatureProblem(signature, participant);
    if (problem) return { error: problem };

    const role = signature.signerRole;
    const { error: sigError } = await supabase.from('agreement_signatures').insert({
      agreement_id: agreement.id,
      person_id: participant.person_id,
      registration_id: participant.registration_id,
      status: 'signed_here',
      signed_at: new Date().toISOString(),
      signer_name: signature.signerName.trim(),
      signer_role: role,
      note: `${SIGNER_NOTE[role]} For ${activity.name}.`,
    });
    if (sigError) {
      console.error(`${label} sign:`, sigError.message);
      return { error: `The ${agreement.title} could not be recorded: ${sigError.message}` };
    }
  }
  return { ok: true };
}

// One activity choice for one person.
//
// `status` is the schema's own vocabulary and the three values mean genuinely
// different things:
//   interested  -- "we'd like to" on an interest-mode activity. Holds nothing.
//   signed_up   -- a place is taken. Counts against capacity.
//   cancelled   -- they had one and gave it back. Kept rather than deleted so
//                  staff can see a place was released, not that it never was.
export async function setActivityChoice({
  participantId,
  activityId,
  status,
  acknowledgeWaiver,
  // Which sitting (0052). Null for activities that do not run in sittings; the
  // database refuses a null on one that does, so this cannot be forgotten
  // quietly.
  slotId = null,
  // The ministry's own waiver for this activity (0116), signed on the page:
  // { agreementId, signerName, signerRole, agreed, affirmed }. Required the
  // first time a person takes an activity that carries one; ignored after.
  signature = null,
}) {
  if (!participantId || !activityId) {
    return { ok: false, error: 'Something is missing — please refresh and try again.' };
  }
  if (!['interested', 'signed_up', 'cancelled'].includes(status)) {
    return { ok: false, error: 'That is not a choice we recognise.' };
  }

  const supabase = await createClient();

  const found = await activityAndPerson(supabase, participantId, activityId, 'setActivityChoice');
  if (found.error) return { ok: false, error: found.error };
  const { activity, participant } = found;

  // Signup windows, checked on the server because a page left open overnight
  // is the normal way a closed window gets a late write.
  const now = Date.now();
  if (activity.signup_opens_at && new Date(activity.signup_opens_at).getTime() > now) {
    return { ok: false, error: 'Sign-ups for this one have not opened yet.' };
  }
  if (activity.signup_closes_at && new Date(activity.signup_closes_at).getTime() < now) {
    return { ok: false, error: 'Sign-ups for this one have closed — please ask camp staff.' };
  }

  // A provider-run activity cannot be taken without the family being told that
  // the provider's own paperwork is theirs to complete. We record the
  // acknowledgement; we never record a waiver as signed, because we cannot
  // know that and a column that claimed to would eventually be believed.
  const needsAck = Boolean(activity.provider_url || activity.provider_name);
  if (status === 'signed_up' && needsAck && !acknowledgeWaiver) {
    return {
      ok: false,
      error: `${activity.name} is run by an outside provider. Please tick to confirm you understand their own form has to be completed with them.`,
    };
  }

  // THE WAIVER (0116). Taking the activity needs its own waiver signed for
  // this person on this registration: the signature row is written first and
  // the signup only after. Cancelling needs nothing.
  if (status !== 'cancelled') {
    const signed = await signRequiredWaivers(supabase, {
      activity,
      participant,
      signature,
      label: 'setActivityChoice',
    });
    if (signed.error) return { ok: false, error: signed.error };
  }

  const row = {
    registration_participant_id: participantId,
    activity_id: activityId,
    status,
    slot_id: status === 'cancelled' ? null : slotId || null,
    added_source: 'family',
    waiver_acknowledged_at:
      status === 'signed_up' && needsAck && acknowledgeWaiver ? new Date().toISOString() : null,
  };

  // UNIQUE (registration_participant_id, activity_id) makes this an upsert --
  // changing your mind edits the same row rather than stacking choices.
  const { error } = await supabase
    .from('activity_signups')
    .upsert(row, { onConflict: 'registration_participant_id,activity_id' });

  if (error) {
    // The capacity trigger speaks SQL; a family should not have to.
    // The two slot guards from 0052 speak SQL; a family should not have to.
    if (/choose a time/i.test(error.message)) {
      return { ok: false, error: 'Please choose a time for this one.' };
    }
    if (/that time is full/i.test(error.message)) {
      return {
        ok: false,
        error:
          'That time filled up while you were choosing. Pick another — or email info@luke14ministries.net and staff will see whether they can make room.',
      };
    }
    if (/activity full/i.test(error.message)) {
      return {
        ok: false,
        // Camp's own ethos, stated in the 25 Aug notes: the instinct is to
        // find a way for everyone to do everything -- wheelchair users go down
        // the river and up the climbing wall. A message that closes the
        // subject contradicts the ministry it is speaking for. Capacity is a
        // number staff can often move; the family should be told that.
        error: `${activity.name} is full at the moment — but please ask. Email info@luke14ministries.net and staff will look at whether the numbers can stretch. Camp would far rather find a way than turn someone away.`,
      };
    }
    console.error('setActivityChoice:', error.message);
    return { ok: false, error: 'That choice could not be saved. Please try again.' };
  }

  revalidatePath('/account/activities');
  revalidatePath('/account/dashboard');
  revalidatePath('/admin/activities');
  return { ok: true };
}

// The waiver alone, for a person ALREADY on the activity (22 Oct 2026).
//
// Staff can attach a waiver to an activity after families have signed people
// up (the Waiver block on the staff Activities editor, 0117) -- and the tick
// that opens the signing box for a new signup never fires for a place that is
// already saved, so until now nobody already signed up was asked. This writes
// ONLY the signature: the signup row, its time and its acknowledgement are
// not touched, and a closed signup window does not stop it -- the place was
// taken while the window was open; this is the paperwork for it. The checks
// are setActivityChoice()'s own (activityAndPerson, signRequiredWaivers), so
// the same household scope and the same signing rules apply.
export async function signActivityWaiver({ participantId, activityId, signature }) {
  if (!participantId || !activityId) {
    return { ok: false, error: 'Something is missing — please refresh and try again.' };
  }
  if (!signature) {
    return { ok: false, error: 'Please read the waiver, tick to agree, and type the name of the person signing.' };
  }

  const supabase = await createClient();

  const found = await activityAndPerson(supabase, participantId, activityId, 'signActivityWaiver');
  if (found.error) return { ok: false, error: found.error };
  const { activity, participant } = found;

  // Only for a place that is actually held, or a volunteer (below): a new
  // camper signup signs through setActivityChoice, together with the place.
  const { data: signup, error: signupError } = await supabase
    .from('activity_signups')
    .select('status')
    .eq('registration_participant_id', participantId)
    .eq('activity_id', activityId)
    .maybeSingle();
  if (signupError) {
    console.error('signActivityWaiver signup:', signupError.message);
    return { ok: false, error: `The signup could not be read: ${signupError.message}` };
  }
  // A volunteer has no signup of their own -- they go where their camper goes
  // (26 Oct 2026) -- but may sign the ministry's waiver ahead, "ready in
  // case", the way they upload an outside provider's form. Their own active
  // place on a registration for THIS activity's event is what allows it.
  const volunteerReady =
    participant.camp_role === 'volunteer' &&
    participant.status !== 'cancelled' &&
    activity.event_id === participant.registrations?.event_id;
  if ((!signup || signup.status === 'cancelled') && !volunteerReady) {
    return { ok: false, error: `${participant.people?.first_name ?? 'This person'} is not signed up for ${activity.name}. Tick the activity to sign up and sign together.` };
  }

  const signed = await signRequiredWaivers(supabase, {
    activity,
    participant,
    signature,
    label: 'signActivityWaiver',
  });
  if (signed.error) return { ok: false, error: signed.error };

  revalidatePath('/account/activities');
  revalidatePath('/account/dashboard');
  revalidatePath('/admin/activities');
  revalidatePath('/admin/review');
  return { ok: true };
}
