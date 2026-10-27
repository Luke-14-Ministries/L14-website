'use server';

// Volunteer-application actions for the FAMILY side. Ownership is verified
// explicitly (the participant must belong to a household this login is a
// member of) before any write; row-level security is the backstop, and its
// family-update rule only permits the statuses 'applied' and 'withdrawn' —
// approval happens on the staff side only.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { volunteerApplicationProblem } from '@/lib/volunteer';

// Returns the participant's ids when this login owns it, or null. It used to
// return a boolean; the Creed signature needs person_id and registration_id,
// and re-querying for them would be a second chance to get the ownership check
// wrong. One lookup, one answer. A failed lookup returns { queryError } rather
// than null, so the family hears "try again", not "not on your account".
async function ownParticipant(supabase, userId, participantId) {
  const { data: memberships, error: membershipsError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', userId);
  if (membershipsError) return { queryError: membershipsError.message };
  const householdIds = (memberships ?? []).map((m) => m.household_id);
  if (!householdIds.length) return null;

  const { data: part, error: partError } = await supabase
    .from('registration_participants')
    .select('id, person_id, registration_id, registrations!inner ( household_id )')
    .eq('id', participantId)
    .in('registrations.household_id', householdIds)
    .maybeSingle();
  if (partError) return { queryError: partError.message };
  return part ? { personId: part.person_id, registrationId: part.registration_id } : null;
}

export async function submitVolunteerApplication(payload) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in and try again.' };

  const supabase = await createClient();
  const participantId = payload?.participantId;
  const owned = participantId ? await ownParticipant(supabase, user.id, participantId) : null;
  if (owned?.queryError) {
    console.error('submitVolunteerApplication:', owned.queryError);
    return { ok: false, error: 'The application could not be saved. Please try again.' };
  }
  if (!owned) {
    return { ok: false, error: 'That registration could not be found on your account.' };
  }

  // The required answers, refused here exactly as the form refuses them and
  // in the same words (lib/volunteer.js). Until 22 Oct 2026 only the browser
  // checked, so a stale tab or a hand-made request saved blanks.
  const problem = volunteerApplicationProblem(payload);
  if (problem) return { ok: false, error: problem };

  // The Apostles' Creed affirmation (migration 0062, item L2). Asked of
  // volunteers, never of families or campers -- which is why it is looked up
  // by key here rather than through agreement_requirements.
  //
  const { data: creedRows, error: creedError } = await supabase
    .from('agreements')
    .select('id, version')
    .eq('key', 'apostles_creed')
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1);
  // A failed read would save the application as though no Creed were asked.
  if (creedError) {
    console.error('submitVolunteerApplication:', creedError.message);
    return { ok: false, error: 'The application could not be saved. Please try again.' };
  }
  const creed = creedRows?.[0] ?? null;

  // NOT REQUIRED. Until 29 Sep 2026 an application without the affirmation
  // was refused here. The board's decision, relayed that day: ask everyone,
  // let somebody who is not comfortable leave it unticked and speak with
  // Larry, and make the omission conspicuous to staff at review (see the
  // Volunteers page) rather than a wall on the form. So the affirmation is
  // recorded when given and merely absent when not.

  const clean = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

  const { error } = await supabase.from('volunteer_applications').upsert(
    {
      registration_participant_id: participantId,
      first_time_volunteering: typeof payload.firstTime === 'boolean' ? payload.firstTime : null,
      preferred_areas: clean(payload.preferredAreas, 500),
      church_attendance: clean(payload.church, 300),
      faith_statement: clean(payload.faith),
      relevant_skills: clean(payload.skills),
      disability_experience: clean(payload.experience),
      // Optional tick beside the experience question (0118). Not one of the
      // required answers: the experience box is still answered either way.
      first_time_disability_ministry: payload?.firstTimeDisabilityMinistry === true,
      accompanying_adult_person_id: payload.accompanyingAdultId || null,
      // The answer AS LAST GIVEN (0075). Ticked = true; left unticked = false,
      // which re-flags the application at review even if an earlier save
      // recorded a signature. The signature itself is history and stays.
      creed_affirmed: creed ? payload?.creedAffirmed === true : null,
      // Any family save (first or edit) goes back under review.
      status: 'applied',
      reviewed_by: null,
      reviewed_at: null,
    },
    { onConflict: 'registration_participant_id' }
  );

  if (error) {
    console.error('submitVolunteerApplication:', error.message);
    return { ok: false, error: 'The application could not be saved. Please try again.' };
  }

  // Record the affirmation against the VERSION that was on screen, so "what
  // words did this person affirm, and when" stays answerable after a rewording.
  // Insert-once: re-saving the application must not stack duplicate signatures,
  // and the original date is the true one.
  //
  // Deliberately after the upsert and deliberately not fatal. The application
  // is saved by this point; failing the whole submit because a signature row
  // did not write would lose a filled-in form and tell a volunteer to start
  // again. It is logged loudly instead, and staff review every application
  // anyway.
  if (creed && owned.personId && payload?.creedAffirmed === true) {
    const { data: already, error: alreadyError } = await supabase
      .from('agreement_signatures')
      .select('id')
      .eq('agreement_id', creed.id)
      .eq('person_id', owned.personId)
      .limit(1);
    // A failed read is not "no signature yet": inserting would stack a
    // duplicate. Same warning as a failed insert below.
    if (alreadyError) {
      console.error('creed signature not recorded:', alreadyError.message);
      return {
        ok: true,
        warning:
          'Your application was saved, but the Creed affirmation could not be recorded. Please tell the volunteer team.',
      };
    }

    if (!already?.length) {
      // SIGNED WITH A NAME. Found 29 Sep 2026 (Testing Script 3 §3.5): this
      // insert carried no signer_name, the 0049 trigger refused it ("A
      // signature must be signed with a name"), the refusal was logged and
      // swallowed, and every volunteer was asked to affirm the Creed again on
      // every edit -- with nothing on record. An affirmation is signed by the
      // person affirming it, so the name is theirs (migration 0073 lets a
      // 'self' signature name the person rather than the household contact).
      const { data: who, error: whoError } = await supabase
        .from('people')
        .select('first_name, last_name')
        .eq('id', owned.personId)
        .maybeSingle();
      if (whoError) {
        console.error('creed signature not recorded:', whoError.message);
        return {
          ok: true,
          warning:
            'Your application was saved, but the Creed affirmation could not be recorded. Please tell the volunteer team.',
        };
      }
      const signerName = `${who?.first_name ?? ''} ${who?.last_name ?? ''}`.trim();
      const { error: sigError } = await supabase.from('agreement_signatures').insert({
        agreement_id: creed.id,
        person_id: owned.personId,
        registration_id: owned.registrationId ?? null,
        status: 'signed_here',
        signer_role: 'self',
        signer_name: signerName || null,
      });
      if (sigError) {
        console.error('creed signature not recorded:', sigError.message);
        // Still not fatal (the application is saved), but no longer silent:
        // the form can say the affirmation did not stick instead of asking
        // for it again next time as though nothing happened.
        return {
          ok: true,
          warning:
            'Your application was saved, but the Creed affirmation could not be recorded. Please tell the volunteer team.',
        };
      }
    }
  }

  revalidatePath('/register/volunteer');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

export async function withdrawVolunteerApplication(participantId) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in and try again.' };

  const supabase = await createClient();
  const owned = participantId ? await ownParticipant(supabase, user.id, participantId) : null;
  if (owned?.queryError) {
    console.error('withdrawVolunteerApplication:', owned.queryError);
    return { ok: false, error: 'The application could not be withdrawn. Please try again.' };
  }
  if (!owned) {
    return { ok: false, error: 'That registration could not be found on your account.' };
  }


  const { error } = await supabase
    .from('volunteer_applications')
    .update({ status: 'withdrawn' })
    .eq('registration_participant_id', participantId);

  if (error) {
    console.error('withdrawVolunteerApplication:', error.message);
    return { ok: false, error: 'The application could not be withdrawn. Please try again.' };
  }

  revalidatePath('/register/volunteer');
  revalidatePath('/account/dashboard');
  return { ok: true };
}
