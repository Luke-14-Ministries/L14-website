'use server';

import { dobProblem } from '@/lib/format';
import { caregiverPhoneProblem, hasPhone } from '@/lib/caregivers';
// Server actions for the staff registration-management screen.
//
// Every action re-checks that the caller is a registrar (or admin) before it
// touches anything. That check is a courtesy that yields a friendly message --
// it is NOT the security boundary. The real boundary is row-level security in
// 0001_core_schema.sql: the registrar grants on people, households,
// registrations and registration_participants are what actually permit these
// writes, and a non-registrar's request is refused by Postgres even if this
// guard were removed. Each action runs as the signed-in user (the request-scoped
// client), so RLS applies to it exactly as it would to a family editing their
// own record.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';
import { getStripe } from '@/lib/stripe/server';
import { registrationDepositCents } from '@/lib/payments';

const STATUSES = ['draft', 'submitted', 'waitlisted', 'confirmed', 'cancelled'];
const CAMP_ROLES = [
  'camper',
  'parent_guardian',
  'sibling',
  'caregiver',
  'volunteer',
  'childcare',
  'support_team',
];

// Fields a staff member may edit on a person and on a household. Anything not
// on these lists is ignored rather than trusted -- the client cannot widen the
// write surface by sending extra keys.
const PERSON_FIELDS = [
  'first_name',
  'last_name',
  'preferred_name',
  'date_of_birth',
  'gender',
  'email',
  'phone',
];
const HOUSEHOLD_FIELDS = [
  'display_name',
  'email',
  'phone',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'postal_code',
  'home_church',
  // Asked once at registration and never again, so when it is wrong or blank
  // this page is the only way to correct it.
  'how_did_you_hear',
  'how_did_you_hear_from',
];

// The nine sizes the registration form offers. A staff member correcting a
// size over the phone must not be able to invent a tenth.
const TSHIRT_SIZES = [
  'Youth S', 'Youth M', 'Youth L',
  'Adult S', 'Adult M', 'Adult L', 'Adult XL', 'Adult 2XL', 'Adult 3XL',
];

// Empty strings from a form become NULL in the database, so a cleared field
// reads back as "not provided" rather than as an empty value that looks set.
function clean(fields, allowed) {
  const out = {};
  for (const k of allowed) {
    if (k in fields) {
      const v = fields[k];
      out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
    }
  }
  return out;
}

async function requireRegistrar(need = 'write:registration') {
  const staff = await getStaff();
  if (!can(staff, need)) {
    return { staff: null, error: 'You do not have permission to change registrations.' };
  }
  return { staff, error: null };
}

// After any write, refresh the screens that show this data. The detail page is
// the one being edited; the overview and rosters show counts and status chips
// that just changed.
function revalidateAll(registrationId) {
  revalidatePath(`/admin/registrations/${registrationId}`);
  revalidatePath('/admin');
  revalidatePath('/admin/rosters');
  // Check-In now carries the photo preference, so a permission recorded here
  // has to reach the door immediately -- a stale cache is the one way this
  // change could be made and still not honoured.
  revalidatePath('/admin/checkin');
  // The review queue is its own page from 14 Oct 2026.
  revalidatePath('/admin/review');
}

// The early-registration discount (0080) depends on who is on a registration,
// their fees and reductions, and the payment plan -- so anything here that
// changes one of those re-runs it. Never fatal, for the same reason as the
// both-weeks recalc: the change itself has saved.
async function recalcEarly(registrationId) {
  try {
    const supabase = await createClient();
    // The family discount first (0081): the 3rd and later person gets $50
    // off, and the early discount's cap leaves room for it.
    const { error: famError } = await supabase.rpc('recalc_family_discount', {
      p_registration_id: registrationId,
    });
    if (famError) console.error('family discount recalc:', famError.message);
    const { error } = await supabase.rpc('recalc_early_registration_discount', {
      p_registration_id: registrationId,
    });
    if (error) console.error('early discount recalc:', error.message);
  } catch (e) {
    console.error('early discount recalc:', e?.message);
  }
}

// #14 -- move a participant off "submitted / pending review" (or anywhere else).
export async function setParticipantStatus(
  registrationId,
  participantId,
  status,
  options = {}
) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  if (!STATUSES.includes(status)) return { ok: false, error: 'Unknown status.' };

  // Waitlisting says why (0128, Lawrence 26 Oct 2026: "not obvious they were
  // waitlisted or why"). Written in the same update as the status; the
  // database stamps who and when, and clears the reason when the person
  // leaves the waitlist. The family reads it on their dashboard.
  let waitlistReason = null;
  if (status === 'waitlisted') {
    waitlistReason = typeof options.reason === 'string' ? options.reason.trim() : '';
    if (!waitlistReason) return { ok: false, error: 'Say why they are waitlisted — the family sees the reason.' };
    if (waitlistReason.length > 500) {
      return { ok: false, error: 'Keep the waitlist reason to 500 characters.' };
    }
  }

  // CONFIRMED MEANS THE PLACE IS HELD, AND A PLACE IS HELD BY A DEPOSIT.
  //
  // Asked for 31 Aug 2026. Nothing checked before: a registrar could confirm a
  // family who had paid nothing, and the deposit banner would keep asking them
  // for money against a registration already marked confirmed.
  //
  // Two things stop this being a trap. A registration reduced to zero by a
  // scholarship or discount owes no deposit -- registrationDepositCents caps at
  // the balance -- so the fully-funded family sails through without anybody
  // thinking about it. And a registrar who genuinely needs to confirm anyway
  // (a cheque in the post, a board decision) can, by confirming a second time:
  // this returns needsOverride rather than a flat no. A hard block that staff
  // cannot get past is worked around by recording a payment that did not
  // happen, which is worse than the thing it prevents.
  if (status === 'confirmed' && options.override !== true) {
    const supabaseCheck = await createClient();
    // What has really been paid, for ANY staff member (0111). The balances
    // view runs with the caller's own rights, so a reviewer without Payments
    // read saw $0 paid on every family and was told to confirm twice.
    const [{ data: reg }, { data: bal }, { data: paidReal }] = await Promise.all([
      supabaseCheck
        .from('registrations')
        .select('id, deposit_waived_at, events ( deposit_cents ), registration_participants ( id, person_id, status )')
        .eq('id', registrationId)
        .maybeSingle(),
      supabaseCheck
        .from('registration_balances')
        .select('paid_cents, balance_cents')
        .eq('registration_id', registrationId)
        .maybeSingle(),
      supabaseCheck.rpc('registration_paid_cents', { p_registration_id: registrationId }),
    ]);

    const paid = Number(paidReal ?? bal?.paid_cents ?? 0);
    // The view's balance counts only the payments the caller may see; put the
    // real figure back in. Since 0114 the view returns NO row to a reviewer
    // without Payments read; then the balance is unknown and must not read as
    // zero (which would make the deposit "nothing due" and wave the family
    // through) -- the full per-person deposit is asked for instead.
    const owed = bal ? (bal.balance_cents ?? 0) + (bal.paid_cents ?? 0) - paid : Number.POSITIVE_INFINITY;
    const due = registrationDepositCents({
      perPersonCents: reg?.events?.deposit_cents,
      participants: reg?.registration_participants,
      balanceCents: owed,
    });

    // A waived deposit (0096) is not short: the registrar has already decided.
    if (!reg?.deposit_waived_at && due > 0 && paid < due) {
      const fmt = (c) =>
        `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return {
        ok: false,
        needsOverride: true,
        error:
          `The deposit for this registration is ${fmt(due)} and ${fmt(paid)} has been ` +
          `received. Confirming marks the places as held. Record the payment first, or ` +
          `confirm again to do it anyway.`,
      };
    }
  }

  const now = new Date().toISOString();
  const patch = { status };
  // Stamp the moment of the transition. These are lifecycle markers only --
  // whether money has arrived is answered by the payments table, never here.
  if (status === 'submitted') patch.submitted_at = now;
  if (status === 'confirmed') patch.confirmed_at = now;
  if (status === 'cancelled') patch.cancelled_at = now;
  if (status === 'waitlisted') patch.waitlist_reason = waitlistReason;

  const supabase = await createClient();
  const { error } = await supabase
    .from('registration_participants')
    .update(patch)
    .eq('id', participantId);

  if (error) return { ok: false, error: error.message };

  // Cancelling one week must take the both-weeks discount off the other (0070).
  // This is the moment that stops being true, and the discount is derived, so
  // it is recomputed rather than adjusted. Not fatal: the status change has
  // already saved, and a stale discount is a visible number staff can re-run,
  // where a failed status change would be a place still held.
  try {
    const supabase2 = await createClient();
    const { data: who } = await supabase2
      .from('registration_participants')
      .select('person_id')
      .eq('id', participantId)
      .maybeSingle();
    if (who?.person_id) {
      await supabase2.rpc('recalc_multi_week_discount', { p_person_id: who.person_id });
    }
  } catch (e) {
    console.error('multi-week discount recalc:', e?.message);
  }
  await recalcEarly(registrationId);

  // A hold (0098) ends when the re-check is finished, whether by Approve all
  // or one person at a time: once nobody on the registration is still
  // submitted, it is lifted (18 Oct review).
  if (status !== 'submitted') {
    const supabase3 = await createClient();
    const { count } = await supabase3
      .from('registration_participants')
      .select('id', { count: 'exact', head: true })
      .eq('registration_id', registrationId)
      .eq('status', 'submitted');
    if ((count ?? 0) === 0) {
      await supabase3
        .from('registrations')
        .update({ hold_since: null, hold_reason: null, hold_by: null })
        .eq('id', registrationId)
        .not('hold_since', 'is', null);
    }
  }

  revalidateAll(registrationId);
  return { ok: true };
}

// #15 -- edit a camper's own details.
export async function updatePerson(registrationId, personId, fields, options = {}) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const patch = clean(fields || {}, PERSON_FIELDS);
  if (!patch.first_name && 'first_name' in patch) {
    return { ok: false, error: 'A first name is required.' };
  }
  {
    const bad = dobProblem(patch.date_of_birth);
    if (bad) return { ok: false, error: bad };
  }

  const supabase = await createClient();

  // A linked caregiver must have a phone (Lawrence, 26 Oct; lib/caregivers.js).
  // Staff create no caregiver links -- families do, on Manage Household -- so
  // the one way this screen could break the rule is CLEARING the number of
  // someone already linked. That is refused, in the family page's words. A
  // caregiver who never had a number is not blocked here: staff fixing a name
  // over the phone should not be stopped by a gap they cannot fill.
  if ('phone' in patch && !hasPhone(patch.phone)) {
    const { data: before, error: beforeError } = await supabase
      .from('people')
      .select('first_name, phone')
      .eq('id', personId)
      .maybeSingle();
    if (beforeError) return { ok: false, error: `This person could not be read: ${beforeError.message}` };
    if (before && hasPhone(before.phone)) {
      const { data: links, error: linkError } = await supabase
        .from('person_caregivers')
        .select('person_id')
        .eq('caregiver_person_id', personId);
      if (linkError) return { ok: false, error: `Caregiver links could not be read: ${linkError.message}` };
      const ids = (links ?? []).map((l) => l.person_id);
      if (ids.length > 0) {
        const { data: deps, error: depError } = await supabase
          .from('people')
          .select('first_name')
          .in('id', ids)
          .order('created_at');
        if (depError) return { ok: false, error: `Caregiver links could not be read: ${depError.message}` };
        const bad = caregiverPhoneProblem({
          name: patch.first_name ?? before.first_name,
          phone: patch.phone,
          caresFor: (deps ?? []).map((d) => d.first_name),
        });
        if (bad) return { ok: false, error: bad };
      }
    }
  }

  // ⭐ IDENTITY CHANGES ON A REGISTERED PERSON NEED A DELIBERATE YES.
  //
  // Families are blocked from this outright and told to ask staff (25 Aug).
  // That advice was only honest if the staff path is safer than the family
  // one, and it was not: this action had no check at all, and the change log
  // deliberately skips staff, so a rename left no guard and no trace.
  //
  // Staff genuinely need to do it — correcting a typo is the common case, and
  // blocking that would be worse than the problem. So it is allowed, but not
  // by accident: the caller must pass confirmIdentityChange, and the reply
  // below tells them exactly what is at stake so the confirmation is informed.
  //
  // Migration 0046 closed the other half: identity edits are now logged even
  // when staff make them.
  const identityKeys = ['first_name', 'last_name', 'date_of_birth'];
  const touchingIdentity = identityKeys.some((k) => k in patch);

  if (touchingIdentity && !options.confirmIdentityChange) {
    const { data: before } = await supabase
      .from('people')
      .select('first_name, last_name, date_of_birth')
      .eq('id', personId)
      .maybeSingle();

    const changed = identityKeys.filter(
      (k) => k in patch && (patch[k] ?? '') !== (before?.[k] ?? '')
    );

    if (changed.length > 0) {
      const { count } = await supabase
        .from('registration_participants')
        .select('id', { count: 'exact', head: true })
        .eq('person_id', personId)
        .neq('status', 'cancelled');

      if ((count ?? 0) > 0) {
        return {
          ok: false,
          needsConfirm: true,
          error:
            `${before?.first_name ?? 'This person'} ${before?.last_name ?? ''}`.trim() +
            ' is on a live registration. Changing their name or date of birth also changes ' +
            'what appears on rosters and check-in lists, and the agreements already signed ' +
            'will still carry the old name. Returning families are matched by name and date ' +
            'of birth, so an edit here can create a duplicate person at their next ' +
            'registration. This will be recorded in Recent Changes.',
        };
      }
    }
  }

  const { error } = await supabase.from('people').update(patch).eq('id', personId);
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// #15 -- edit the family's contact details.
export async function updateHousehold(registrationId, householdId, fields) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const patch = clean(fields || {}, HOUSEHOLD_FIELDS);
  const supabase = await createClient();
  const { error } = await supabase.from('households').update(patch).eq('id', householdId);
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// The two enrolment answers the family gives per person, per event. Staff need
// them because these arrive by phone as often as by form ("actually make that
// an Adult L"), and until now there was nowhere to put that.
export async function setParticipantEnrollment(registrationId, participantId, input) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const patch = {};
  if ('tshirt' in (input || {})) {
    const v = (input.tshirt || '').trim();
    if (v && !TSHIRT_SIZES.includes(v)) return { ok: false, error: 'Unknown t-shirt size.' };
    patch.tshirt_size = v || null;
  }
  if ('firstTime' in (input || {})) {
    const v = input.firstTime;
    // '' means "not answered", which must stay null rather than becoming "no".
    patch.first_time_attending = v === '' || v == null ? null : v === true || v === 'true';
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from('registration_participants')
    .update(patch)
    .eq('id', participantId);
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// Record a media or directory permission on the family's behalf -- the phone
// call that says "actually, please don't use photos of Tommy after all".
//
// This INSERTS rather than updates: person_consents is append-only, because a
// withdrawn permission does not erase the fact that the earlier one was in
// force when a photo was published. recorded_as marks it as staff-entered so
// the trail shows a person typed it, not the family.
export async function setPersonConsent(registrationId, personId, kind, granted) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  if (!['media', 'directory'].includes(kind)) return { ok: false, error: 'Unknown permission.' };
  if (typeof granted !== 'boolean') return { ok: false, error: 'Answer must be yes or no.' };

  const supabase = await createClient();
  const staff = await getStaff();

  // Don't stack identical rows: if the current answer already says this,
  // there is nothing to record.
  const { data: current } = await supabase
    .from('person_current_consents')
    .select('granted')
    .eq('person_id', personId)
    .eq('kind', kind)
    .maybeSingle();
  if (current?.granted === granted) return { ok: true };

  const { error } = await supabase.from('person_consents').insert({
    person_id: personId,
    kind,
    granted,
    recorded_by: staff?.userId ?? null,
    recorded_as: 'staff',
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// #15 -- add a person to this registration by hand. Creates the person in the
// family's household and a participant row for them on the chosen camp option.
export async function addParticipant(registrationId, input) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const first = (input?.first_name || '').trim();
  const last = (input?.last_name || '').trim();
  const optionId = input?.event_option_id;
  const role = CAMP_ROLES.includes(input?.camp_role) ? input.camp_role : 'camper';
  if (!first || !last) return { ok: false, error: 'A first and last name are required.' };
  if (!optionId) return { ok: false, error: 'Please choose which camp option to add them to.' };

  const supabase = await createClient();

  // The household to attach the new person to, read from the registration.
  const { data: reg, error: regError } = await supabase
    .from('registrations')
    .select('household_id')
    .eq('id', registrationId)
    .maybeSingle();
  if (regError) return { ok: false, error: regError.message };
  if (!reg) return { ok: false, error: 'Registration not found.' };

  // The option must exist -- a friendlier answer than the foreign-key error.
  // Its fee is NOT read here: since 0114 a trigger on registration_participants
  // copies the option's fee into participant_money the moment the row is
  // inserted, the same for staff-added and family-added people, so nothing in
  // the app sets a fee. (The old early-bird PRICE is retired, 0080: early
  // registration is a flat per-person discount from
  // recalc_early_registration_discount().)
  const { data: opt, error: optError } = await supabase
    .from('event_options')
    .select('id')
    .eq('id', optionId)
    .maybeSingle();
  if (optError) return { ok: false, error: optError.message };
  if (!opt) return { ok: false, error: 'That camp option no longer exists.' };

  // Staff can SELECT any person (people_select allows is_staff), so the insert
  // may safely return the new id -- the RETURNING-under-RLS pitfall that bites
  // a family creating their first household does not apply here.
  {
    const bad = dobProblem(input?.date_of_birth);
    if (bad) return { ok: false, error: bad };
  }
  // A possible duplicate is offered, not silently created (Lawrence, 18 Oct
  // 2026; Script 5 8.3). The household's people with the same first and last
  // name -- ignoring case and spacing, and not when both dates of birth are
  // known and differ -- come back to the form, which offers "use this person"
  // or "add as a new person anyway". Using the existing person means 0086's
  // one-role-per-event rule refuses a second role instead of a second person
  // quietly appearing.
  let personId = null;
  if (input?.existing_person_id) {
    const { data: existing, error: exError } = await supabase
      .from('people')
      .select('id')
      .eq('id', input.existing_person_id)
      .eq('household_id', reg.household_id)
      .maybeSingle();
    if (exError) return { ok: false, error: exError.message };
    if (!existing) return { ok: false, error: 'That person is not in this household.' };
    personId = existing.id;
  } else if (!input?.confirm_new) {
    const { data: same, error: sameError } = await supabase
      .from('people')
      .select('id, first_name, last_name, date_of_birth')
      .eq('household_id', reg.household_id);
    if (sameError) return { ok: false, error: sameError.message };
    const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const dob = input?.date_of_birth || null;
    const matches = (same ?? []).filter(
      (q) =>
        norm(q.first_name) === norm(first) &&
        norm(q.last_name) === norm(last) &&
        !(dob && q.date_of_birth && q.date_of_birth !== dob)
    );
    if (matches.length > 0) {
      return {
        ok: false,
        duplicates: matches.map((q) => ({
          id: q.id,
          name: `${q.first_name} ${q.last_name}`,
          date_of_birth: q.date_of_birth,
        })),
        error: 'This household already has someone by that name. Is it the same person?',
      };
    }
  }

  if (!personId) {
    const { data: person, error: personError } = await supabase
      .from('people')
      .insert({
        household_id: reg.household_id,
        first_name: first,
        last_name: last,
        date_of_birth: input?.date_of_birth ? input.date_of_birth : null,
        gender: (input?.gender || '').trim() || null,
      })
      .select('id')
      .single();
    if (personError) return { ok: false, error: personError.message };
    personId = person.id;
  }

  const { error: partError } = await supabase.from('registration_participants').insert({
    registration_id: registrationId,
    person_id: personId,
    event_option_id: optionId,
    camp_role: role,
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    // No fee_cents: the participant_money trigger fills it (0114).
  });
  if (partError) {
    // 0086: one role per person per event.
    if (/one role|already/i.test(partError.message)) {
      return { ok: false, error: 'That person is already at this event in another role. Change their role on their existing row instead.' };
    }
    return { ok: false, error: partError.message };
  }
  await recalcEarly(registrationId);

  revalidateAll(registrationId);
  return { ok: true };
}

// #15 -- permanently delete a participant. Deliberately a two-step safety net:
// the everyday "remove from week" is a reversible status change to 'cancelled'
// (setParticipantStatus above), and ONLY a participant already cancelled can be
// hard-deleted here. So a single misclick can never wipe a real registration --
// you cancel first (undoable), and deleting is a separate, deliberate second
// action. Even then it removes only this week's entry, never the person's
// household record.
export async function deleteParticipantPermanently(registrationId, participantId) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };

  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from('registration_participants')
    .select('status')
    .eq('id', participantId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: 'That entry no longer exists.' };
  if (row.status !== 'cancelled') {
    return {
      ok: false,
      error: 'Cancel this person first (which is reversible), then you can permanently delete them.',
    };
  }

  const { error } = await supabase
    .from('registration_participants')
    .delete()
    .eq('id', participantId);
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  return { ok: true };
}

// Scholarships & fee adjustments. The amounts live in participant_money
// (0114; scholarship_cents / discount_cents, one row per participant) -- that
// is what the registration_balances view subtracts, so granting here flows
// into every balance, statement, and the family's dashboard automatically.
// Nobody signed in may write that table directly: the only door is the
// set_participant_adjustments() function, which checks the caller may decide
// scholarships, refuses a total above the fee, and logs to money_change_log.
// A scholarships row is kept alongside as the audit trail (who granted what,
// when, and the staff note -- NOT the family's statement, which belongs to
// the family and is never overwritten here).
//
// This editor is the "I already know what I'm doing" path: it sets amounts
// directly, with no reference to whether anybody asked. The answer to an
// actual request is the Approve/Decline pair on the review card.
export async function setAdjustments(registrationId, participantId, input) {
  // Scholarships and hand-set discounts are decisions, not bookkeeping (0102).
  const { staff, error: authError } = await requireRegistrar('decide:scholarships');
  if (authError) return { ok: false, error: authError };

  const toCents = (v) => {
    const n = Number.parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
    if (Number.isNaN(n)) return 0;
    return Math.round(n * 100);
  };
  const scholarship = toCents(input?.scholarship);
  const discount = toCents(input?.discount);
  const note = String(input?.note ?? '').trim();
  if (scholarship < 0 || discount < 0) {
    return { ok: false, error: 'Amounts cannot be negative.' };
  }

  const supabase = await createClient();

  // The current discount and its reason. The reason is how the discount
  // rules tell their own work apart: recalc_multi_week_discount() and friends
  // touch only a discount carrying THEIR reason (0070/0080/0081), and a null
  // reason means a person set it by hand. So: a discount the registrar left
  // as it was keeps its reason, and a rule will still keep it up to date; a
  // discount they changed is now a hand-set one and the reason is cleared,
  // so no rule quietly overwrites what they typed.
  const { data: part, error: readError } = await supabase
    .from('registration_participants')
    .select('id, participant_money ( discount_cents, discount_reason )')
    .eq('id', participantId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!part) return { ok: false, error: 'That participant no longer exists.' };
  const current = part.participant_money;
  if (!current) {
    // Someone who may decide holds Payments write, so the money row is theirs
    // to read; its absence means the row was never created, not a gate.
    return { ok: false, error: 'This person has no fee record yet. Try again in a moment.' };
  }
  const reason = discount === (current.discount_cents ?? 0) ? current.discount_reason ?? null : null;

  // The fee cap is checked by the function, in the database, with the words
  // the editor shows ("Scholarship plus discount cannot exceed the fee for
  // this person.") -- so its message is passed through as it is.
  const { error } = await supabase.rpc('set_participant_adjustments', {
    p_participant_id: participantId,
    p_scholarship_cents: scholarship,
    p_discount_cents: discount,
    p_discount_reason: reason,
  });
  if (error) return { ok: false, error: error.message };

  // Audit trail in the scholarships table (one row per participant).
  const { data: existing } = await supabase
    .from('scholarships')
    .select('id, status')
    .eq('registration_participant_id', participantId)
    .maybeSingle();

  // Two bugs lived in the three lines this replaces.
  //
  // FIRST: the note was written into family_statement, which is the family's
  // own words explaining why the fee was hard. Granting an award therefore
  // deleted the reason it had been asked for, and nothing warned anybody
  // because the note that replaced it looked like a note. 0048 gave the staff
  // note its own column.
  //
  // SECOND: clearing an amount set the status to 'withdrawn' -- a statement
  // that the FAMILY took their request back. A registrar typing 0 is not the
  // family doing anything. Now: an amount is a grant; zeroing an award that
  // was granted records that it is no longer granted; and zeroing against a
  // request nobody has answered yet leaves it waiting, because clearing a
  // figure is not a decision. Turning a request DOWN is a deliberate act with
  // its own button, in app/admin/scholarships/actions.js.
  const nextStatus =
    scholarship > 0
      ? 'granted'
      : existing?.status === 'requested'
        ? 'requested'
        : 'declined';

  const auditRow = {
    registration_participant_id: participantId,
    granted_cents: scholarship,
    status: nextStatus,
    staff_note: note || null,
    reviewed_by: staff.userId,
    reviewed_at: new Date().toISOString(),
  };
  // Never swallow these errors: a refused audit write is how the
  // "who granted this" record silently stayed empty until 0020.
  const { error: auditError } = existing
    ? await supabase.from('scholarships').update(auditRow).eq('id', existing.id)
    : scholarship > 0
      ? await supabase.from('scholarships').insert(auditRow)
      : { error: null };
  if (auditError) {
    return {
      ok: false,
      error: `The amounts saved, but the grant record did not: ${auditError.message}`,
    };
  }
  await recalcEarly(registrationId);

  revalidateAll(registrationId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notes TO the family (registration_family_messages, 0019): short messages
// shown on the family's dashboard — "We added a $100 scholarship credit to
// your registration on 8/17." Since 0126 the same table is the whole
// conversation: the family's replies (family_reply_to_staff(), from their
// dashboard) sit in it too, and nobody signed in inserts directly -- staff
// write through staff_message_to_family(), which checks Registration write
// and counts an unread family reply as read (writing back is reading it).

export async function addFamilyMessage(registrationId, body) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) return { ok: false, error: 'Not permitted.' };
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return { ok: false, error: 'Write the note first.' };
  if (text.length > 4000) return { ok: false, error: 'That note is too long — please keep it under 4,000 characters.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('staff_message_to_family', {
    p_registration_id: registrationId,
    p_body: text,
  });
  if (error) {
    console.error('addFamilyMessage:', error.message);
    return { ok: false, error: `The note could not be saved: ${error.message}` };
  }
  revalidatePath(`/admin/registrations/${registrationId}`);
  revalidatePath('/admin/review');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

// "Mark as read" on a family's reply (0126): stamps family_reply_seen_at,
// which turns off the blue "Family replied" flag, the queue's tab and the nav
// count. family_replied_at is left alone, so the family's dashboard still says
// when their reply was sent. The guard on registrations lets only
// Registration write move the stamp.
export async function markFamilyReplyRead(registrationId) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('registrations')
    .update({ family_reply_seen_at: new Date().toISOString() })
    .eq('id', registrationId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: 'That registration could not be updated.' };
  revalidateAll(registrationId);
  return { ok: true };
}

// The review decision for a whole registration (Lawrence, 15 Oct 2026):
// approve or waitlist everyone still "submitted", or send it back to the
// family for more information. See ReviewCard.jsx for the why; 0089 for the
// two columns the "ask" writes.
//
// Approve and waitlist go through setParticipantStatus one person at a time,
// so the deposit guard (and its override) and the discount recalcs happen
// exactly as they do from the per-person dropdown. A needsOverride comes
// back from the FIRST person, before anybody has changed.
export async function reviewRegistration(registrationId, { action, reason = '', override = false } = {}) {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  const supabase = await createClient();

  if (action === 'approve' || action === 'waitlist') {
    const { data: rows, error } = await supabase
      .from('registration_participants')
      .select('id')
      .eq('registration_id', registrationId)
      .eq('status', 'submitted');
    if (error) return { ok: false, error: error.message };
    if (!rows?.length) return { ok: false, error: 'Nobody on this registration is waiting on review.' };
    const next = action === 'approve' ? 'confirmed' : 'waitlisted';
    // Waitlisting needs its reason (0128); checked once, before anybody moves.
    const waitlistReason = next === 'waitlisted' && typeof reason === 'string' ? reason.trim() : '';
    if (next === 'waitlisted' && !waitlistReason) {
      return { ok: false, error: 'Say why they are waitlisted — the family sees the reason.' };
    }
    if (waitlistReason.length > 500) return { ok: false, error: 'Keep the waitlist reason to 500 characters.' };
    for (const r of rows) {
      const res = await setParticipantStatus(registrationId, r.id, next, {
        override,
        ...(next === 'waitlisted' ? { reason: waitlistReason } : {}),
      });
      if (!res.ok) return res;
    }
    // A decision made is no longer waiting on anybody, and lifts a hold (0098).
    const { error: clearError } = await supabase
      .from('registrations')
      .update({
        awaiting_family_since: null,
        awaiting_family_reason: null,
        hold_since: null,
        hold_reason: null,
        hold_by: null,
      })
      .eq('id', registrationId);
    if (clearError) return { ok: false, error: clearError.message };
    revalidateAll(registrationId);
    return { ok: true, count: rows.length };
  }

  if (action === 'ask') {
    const text = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
    if (!text) return { ok: false, error: 'Say what you need from the family first.' };
    // The ask is a note to the family like any other, so it shows on their
    // dashboard and stays in the notes list after the state is cleared.
    const note = await addFamilyMessage(registrationId, text);
    if (!note.ok) return note;
    const { error } = await supabase
      .from('registrations')
      .update({ awaiting_family_since: new Date().toISOString(), awaiting_family_reason: text })
      .eq('id', registrationId);
    if (error) return { ok: false, error: error.message };
    revalidateAll(registrationId);
    return { ok: true };
  }

  if (action === 'answered') {
    const { error } = await supabase
      .from('registrations')
      .update({ awaiting_family_since: null, awaiting_family_reason: null })
      .eq('id', registrationId);
    if (error) return { ok: false, error: error.message };
    revalidateAll(registrationId);
    return { ok: true };
  }

  // A hold (0098): everyone confirmed or waitlisted goes back to submitted
  // and the registration says why. Lifting it leaves statuses as they are --
  // the registrar then approves or waitlists as usual.
  if (action === 'hold') {
    return holdRegistration(registrationId, reason);
  }
  if (action === 'lift_hold') {
    const { error } = await supabase
      .from('registrations')
      .update({ hold_since: null, hold_reason: null, hold_by: null })
      .eq('id', registrationId);
    if (error) return { ok: false, error: error.message };
    revalidateAll(registrationId);
    revalidatePath('/admin/review');
    return { ok: true };
  }

  // Waive the deposit (0096): one definer function does the mark and the
  // scholarships and recalculates, so the page can never half-do it.
  if (action === 'waive_deposit') {
    const { data: n, error } = await supabase.rpc('waive_deposit', {
      p_registration_id: registrationId,
      p_reason: typeof reason === 'string' ? reason.trim().slice(0, 300) : null,
    });
    if (error) return { ok: false, error: error.message };
    revalidateAll(registrationId);
    revalidatePath('/admin/payments');
    revalidatePath('/admin/scholarships');
    return { ok: true, count: n ?? 0 };
  }

  // Undo the waiver (0127; Lawrence, 26 Oct 2026: "suppose it was done in
  // error??"). The function puts back each person's scholarship from before
  // the waiver where it is still the waiver's, clears the mark and
  // recalculates. Nobody is un-approved: the registration just reads its
  // real deposit again. A reason is required -- it becomes the staff note.
  if (action === 'undo_deposit_waiver') {
    const { error: decideError } = await requireRegistrar('decide:scholarships');
    if (decideError) return { ok: false, error: decideError };
    const text = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
    if (!text) return { ok: false, error: 'Say why the waiver is being undone.' };
    const { data: n, error } = await supabase.rpc('undo_deposit_waiver', {
      p_registration_id: registrationId,
      p_reason: text,
    });
    if (error) return { ok: false, error: error.message };
    revalidateAll(registrationId);
    revalidatePath('/admin/payments');
    revalidatePath('/admin/scholarships');
    revalidatePath('/admin/review');
    return { ok: true, count: n ?? 0 };
  }

  // "Talked with Larry about the Apostles' Creed" (0129; Lawrence, 26 Oct
  // 2026). The database stamps who and when; the note is optional. The
  // Creed flag itself stays -- it is a fact about the volunteer's
  // application -- and this records that the conversation happened.
  if (action === 'creed_discussed') {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (text.length > 500) return { ok: false, error: 'Keep the note to 500 characters.' };
    const { error } = await supabase.rpc('mark_creed_discussed', {
      p_registration_id: registrationId,
      p_note: text || null,
    });
    if (error) return { ok: false, error: error.message };
    revalidateAll(registrationId);
    return { ok: true };
  }
  if (action === 'clear_creed_discussed') {
    const { error } = await supabase.rpc('clear_creed_discussed', { p_registration_id: registrationId });
    if (error) return { ok: false, error: error.message };
    revalidateAll(registrationId);
    return { ok: true };
  }

  return { ok: false, error: 'Unknown review action.' };
}

// Put a registration on hold (0098; Larry and Ellen, 15-16 Oct 2026): the
// decision is being re-made, so everyone confirmed or waitlisted goes back
// to 'submitted' (the review queue and the nav badge count them again) and
// the registration records when, why and who. Called from the Review card
// and from Recent Changes. No email is sent -- by hand from Outlook, as
// agreed on the call.
export async function holdRegistration(registrationId, reason = '') {
  const { error: authError } = await requireRegistrar();
  if (authError) return { ok: false, error: authError };
  const text = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
  if (!text) return { ok: false, error: 'Say why the registration is going on hold — the family sees it.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const now = new Date().toISOString();

  const { error: partError } = await supabase
    .from('registration_participants')
    .update({ status: 'submitted', submitted_at: now })
    .eq('registration_id', registrationId)
    .in('status', ['confirmed', 'waitlisted']);
  if (partError) return { ok: false, error: partError.message };

  // A hold is staff's move, so it replaces "waiting on the family".
  const { error } = await supabase
    .from('registrations')
    .update({
      hold_since: now,
      hold_reason: text,
      hold_by: user?.id ?? null,
      awaiting_family_since: null,
      awaiting_family_reason: null,
    })
    .eq('id', registrationId);
  if (error) return { ok: false, error: error.message };

  revalidateAll(registrationId);
  revalidatePath('/admin/review');
  revalidatePath('/admin/changes');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

export async function deleteFamilyMessage(registrationId, messageId) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) return { ok: false, error: 'Not permitted.' };

  const supabase = await createClient();
  // Only a STAFF note can be removed (0126's delete policy): a family's reply
  // is their words and stays in the record.
  const { data, error } = await supabase
    .from('registration_family_messages')
    .delete()
    .eq('id', messageId)
    .eq('registration_id', registrationId)
    .eq('author_kind', 'staff')
    .select('id');
  if (error) {
    console.error('deleteFamilyMessage:', error.message);
    return { ok: false, error: 'The note could not be removed.' };
  }
  if (!data?.length) return { ok: false, error: 'That note could not be removed — a family’s reply stays in the record.' };
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}

// --- refunds -----------------------------------------------------------------
//
// Money back to a family, in full or in part (board direction, 24 Aug: credits
// alone are not enough). A refund reverses a specific PAYMENT, never a balance
// -- Stripe can only refund a charge it made, and a partial refund is
// meaningless without knowing which transaction it came out of.
//
// Two routes, deliberately kept apart:
//   * a payment Stripe handled -> ask Stripe, record what it says
//   * a check or cash payment  -> record only. The ministry writes the check;
//     the site's job is to make sure the balance and the paper agree.
//
// The database is the real guard: the trigger on payment_refunds refuses any
// total above the original payment, so a stale page or a doubled click cannot
// over-refund. The checks here exist to give a person a sentence they can
// understand instead of a constraint violation.
export async function refundPayment(registrationId, input) {
  const staff = await getStaff();
  if (!can(staff, 'write:payments')) return { ok: false, error: 'Not permitted.' };

  const { paymentId, amountCents, feeCoverCents = 0, reason, note, requestKey } = input || {};
  const amount = Math.round(Number(amountCents));
  const feeCover = Math.round(Number(feeCoverCents) || 0);

  if (!paymentId) return { ok: false, error: 'Which payment is being refunded?' };
  if (!Number.isFinite(amount) || amount < 1) {
    return { ok: false, error: 'Enter a refund amount of at least $0.01.' };
  }
  if (!(reason || '').trim()) {
    // Not a database rule, a working one: a refund with no reason is
    // unanswerable when someone asks about it next year.
    return { ok: false, error: 'Please give a short reason for the refund.' };
  }

  const supabase = await createClient();

  const { data: payment, error: payError } = await supabase
    .from('payments')
    .select('id, registration_id, amount_cents, fee_cover_cents, status, method, stripe_payment_intent_id')
    .eq('id', paymentId)
    .eq('registration_id', registrationId)
    .maybeSingle();
  if (payError || !payment) return { ok: false, error: 'That payment could not be found.' };

  const { data: priorRefunds } = await supabase
    .from('payment_refunds')
    .select('amount_cents, fee_cover_cents, status')
    .eq('payment_id', paymentId);
  const alreadyRefunded = (priorRefunds ?? [])
    .filter((r) => r.status === 'pending' || r.status === 'succeeded')
    .reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const refundable = (payment.amount_cents ?? 0) - alreadyRefunded;

  if (amount > refundable) {
    return {
      ok: false,
      error:
        refundable <= 0
          ? 'This payment has already been refunded in full.'
          : `The most that can still be refunded on this payment is $${(refundable / 100).toFixed(2)}.`,
    };
  }
  const feeAlready = (priorRefunds ?? [])
    .filter((r) => r.status === 'pending' || r.status === 'succeeded')
    .reduce((s, r) => s + (r.fee_cover_cents ?? 0), 0);
  if (feeCover > (payment.fee_cover_cents ?? 0) - feeAlready) {
    return { ok: false, error: 'That is more than the processing-fee contribution left on this payment.' };
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const row = {
    payment_id: paymentId,
    registration_id: registrationId,
    amount_cents: amount,
    fee_cover_cents: feeCover,
    reason: (reason || '').trim(),
    note: (note || '').trim() || null,
    refunded_by: staff.userId ?? null,
    refunded_on: today,
    // One per refund form (RefundForm makes it when it opens). The database
    // keeps it unique among live refunds, so pressing Refund twice, or in two
    // tabs, records and sends one refund (0107).
    request_key: typeof requestKey === 'string' && requestKey ? requestKey.slice(0, 100) : null,
  };

  // A check or cash refund moves no money here: record it and finish.
  if (!payment.stripe_payment_intent_id) {
    const { error: insertError } = await supabase
      .from('payment_refunds')
      .insert({ ...row, method: 'check', status: 'succeeded' });
    if (insertError) {
      console.error('refundPayment insert:', insertError.message);
      return { ok: false, error: refundRefusal(insertError), duplicate: insertError.code === '23505' };
    }
    return finishRefund(supabase, registrationId, paymentId, amount, refundable, 'succeeded', null);
  }

  const stripe = getStripe();
  if (!stripe) {
    return { ok: false, error: 'Stripe is not configured, so this payment cannot be refunded here.' };
  }

  // RESERVE first (0107): the over-refund guard runs, and holds a lock on the
  // payment, before any money moves. If Stripe then refuses, the reservation
  // is cancelled and the balance is as it was.
  const { data: reserved, error: reserveError } = await supabase
    .from('payment_refunds')
    .insert({ ...row, method: 'stripe', status: 'pending' })
    .select('id')
    .single();
  if (reserveError || !reserved) {
    console.error('refundPayment reserve:', reserveError?.message);
    // `duplicate` tells the form to keep its key: pressing again must not
    // become a second refund.
    return { ok: false, error: refundRefusal(reserveError), duplicate: reserveError?.code === '23505' };
  }

  let refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        // Stripe's own cut is not returned, so the fee contribution is added
        // to what the family gets back only when staff have chosen to.
        amount: amount + feeCover,
        reason: 'requested_by_customer',
        metadata: {
          registration_id: registrationId,
          payment_id: paymentId,
          // The refund webhook fills THIS row rather than adding another.
          refund_row_id: reserved.id,
          recorded_reason: (reason || '').slice(0, 400),
        },
      },
      // Same key, same refund: a retry after a dropped connection gets the
      // refund Stripe already made instead of a second one.
      { idempotencyKey: `refund:${reserved.id}` }
    );
  } catch (e) {
    console.error('refundPayment stripe:', e?.type, e?.code, e?.message);
    await supabase.from('payment_refunds').update({ status: 'canceled' }).eq('id', reserved.id);
    return {
      ok: false,
      error: 'Stripe did not accept the refund, so nothing was sent and nothing was recorded. Check the payment in Stripe, then try again.',
    };
  }

  // Stripe returns 'succeeded' for cards almost always, and 'pending' for
  // bank refunds that take days. Either way the money is committed, and the
  // balance view counts both. The webhook may already have filled the row.
  const status = refund.status === 'succeeded' ? 'succeeded' : 'pending';
  const { error: fillError } = await supabase
    .from('payment_refunds')
    .update({ stripe_refund_id: refund.id, status })
    .eq('id', reserved.id);
  if (fillError?.code === '23505') {
    // The refund webhook got there first and recorded its own row for this
    // refund. Keep that one, give it the registrar's words and the split
    // between refund and fee, and release the reservation -- one row, not two.
    await supabase.from('payment_refunds').update({ status: 'canceled' }).eq('id', reserved.id);
    await supabase
      .from('payment_refunds')
      .update({
        amount_cents: amount,
        fee_cover_cents: feeCover,
        reason: row.reason,
        note: row.note,
        refunded_by: row.refunded_by,
      })
      .eq('stripe_refund_id', refund.id);
  } else if (fillError) {
    // The money has left; the reservation still counts it (pending), so the
    // balance is right, but the Stripe reference is missing. Loud, not lost.
    console.error('refundPayment fill:', fillError.message, { refund: refund.id, row: reserved.id });
    return {
      ok: false,
      error: `Stripe issued refund ${refund.id} and it is counted on the balance, but its reference could not be saved. Tell an administrator.`,
    };
  }

  return finishRefund(supabase, registrationId, paymentId, amount, refundable, status, refund.id);
}

// What a registrar is told when the database refuses a refund. The detail goes
// to the server log; the screen gets words (audit L4).
function refundRefusal(error) {
  const m = error?.message ?? '';
  if (error?.code === '23505') {
    return 'This refund has already been sent. Refresh the page to see it.';
  }
  if (/exceed/i.test(m)) {
    return 'That would refund more than this payment has left. Refresh the page — another refund may have just been recorded.';
  }
  if (/status/i.test(m)) return 'This payment has not been received, so there is nothing to refund yet.';
  return 'The refund could not be recorded. Nothing was sent. Please try again, or tell an administrator.';
}

async function finishRefund(supabase, registrationId, paymentId, amount, refundable, status, stripeRefundId) {
  // payments.status now follows the refunds on file in the database (0111):
  // the client update this used to make never reached a card payment (the
  // staff policy covers check/cash rows only), so a fully refunded card
  // payment stayed "received" on the Payments page.
  // The early-registration discount depends on what has been paid, so it is
  // re-run after money goes back (audit M2: it used to wait for the next
  // caller, whoever that was).
  await recalcEarly(registrationId);

  revalidatePath(`/admin/registrations/${registrationId}`);
  revalidatePath('/admin/payments');
  revalidatePath('/account/dashboard');
  return { ok: true, status, stripeRefundId };
}


// ---------------------------------------------------------------------------
// Payment plans (0080). Staff can pause, resume, retry or cancel a plan.
// Nobody on staff ever sees or enters card details: changing the payment
// method is the family's, on their dashboard, through Stripe's own page.
// ---------------------------------------------------------------------------

export async function setPlanStatus(registrationId, { action, keepsEarlyDiscount }) {
  const { staff, error: authError } = await requireRegistrar('write:payments');
  if (authError) return { ok: false, error: authError };
  const supabase = await createClient();

  const { data: plan, error: readError } = await supabase
    .from('payment_plans')
    .select('id, status')
    .eq('registration_id', registrationId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!plan) return { ok: false, error: 'This registration has no payment plan.' };

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  let update;
  if (action === 'pause') {
    if (plan.status !== 'active') return { ok: false, error: 'Only an active plan can be paused.' };
    update = { status: 'paused' };
  } else if (action === 'resume') {
    if (!['paused', 'failed'].includes(plan.status)) {
      return { ok: false, error: 'Only a paused or stopped plan can be resumed.' };
    }
    update = { status: 'active' };
  } else if (action === 'cancel') {
    if (['cancelled', 'completed'].includes(plan.status)) {
      return { ok: false, error: 'This plan has already ended.' };
    }
    update = {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: staff?.userId ?? null,
      // Staff decide (agreed 30 Sep): does the family keep the early discount?
      keeps_early_discount: Boolean(keepsEarlyDiscount),
    };
  } else if (action === 'discount') {
    update = { keeps_early_discount: Boolean(keepsEarlyDiscount) };
  } else {
    return { ok: false, error: 'Unknown action.' };
  }

  const { error } = await supabase.from('payment_plans').update(update).eq('id', plan.id);
  if (error) return { ok: false, error: error.message };

  if (action === 'cancel') {
    const { error: instError } = await supabase
      .from('payment_installments')
      .update({ status: 'cancelled' })
      .eq('payment_plan_id', plan.id)
      .in('status', ['scheduled', 'failed']);
    if (instError) return { ok: false, error: `The plan is cancelled, but its schedule was not: ${instError.message}` };
  }
  if (action === 'resume') {
    // Charges that fell due while it was stopped are not all taken at once:
    // the schedule is rebuilt from today, spreading what is owed over the
    // dates that are left. Failed charges get a fresh set of tries.
    const { error: failError } = await supabase
      .from('payment_installments')
      .update({ status: 'cancelled' })
      .eq('payment_plan_id', plan.id)
      .eq('status', 'failed');
    if (failError) return { ok: false, error: failError.message };
    const { error: buildError } = await supabase.rpc('build_plan_installments', {
      p_plan_id: plan.id,
      p_today: today,
    });
    if (buildError) return { ok: false, error: `Resumed, but the schedule was not rebuilt: ${buildError.message}` };
  }

  await recalcEarly(registrationId);
  revalidateAll(registrationId);
  revalidatePath('/admin/payments');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fees (0123): a staff-added fee (Payments write), and waiving any fee
// (Payments and Registration write -- a decision, as a scholarship is).
// Both go through definer functions -- nobody signed in writes
// registration_fees directly -- and both land in money_change_log. The
// family sees the reason for an added fee on their dashboard and statement.
// ---------------------------------------------------------------------------
export async function addRegistrationFee(registrationId, { dollars, reason } = {}) {
  const { error: authError } = await requireRegistrar('write:payments');
  if (authError) return { ok: false, error: authError };
  const n = Number.parseFloat(String(dollars ?? '').replace(/[$,\s]/g, ''));
  if (Number.isNaN(n) || n <= 0) return { ok: false, error: 'Give the fee as a dollar amount over $0.' };
  const why = String(reason ?? '').trim();
  if (!why) return { ok: false, error: 'Give the reason for the fee; the family sees it.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('add_registration_fee', {
    p_registration_id: registrationId,
    p_amount_cents: Math.round(n * 100),
    p_reason: why.slice(0, 300),
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  revalidatePath('/admin/payments');
  return { ok: true };
}

export async function waiveRegistrationFee(registrationId, feeId, reason) {
  // A waiver is a decision, like a scholarship (0102): Payments AND
  // Registration write. The database asks can_decide_scholarships() too.
  const { error: authError } = await requireRegistrar('decide:scholarships');
  if (authError) return { ok: false, error: authError };
  const why = String(reason ?? '').trim();
  if (!why) return { ok: false, error: 'Give the reason for waiving the fee.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('waive_registration_fee', {
    p_fee_id: feeId,
    p_reason: why.slice(0, 300),
  });
  if (error) return { ok: false, error: error.message };
  revalidateAll(registrationId);
  revalidatePath('/admin/payments');
  return { ok: true };
}
