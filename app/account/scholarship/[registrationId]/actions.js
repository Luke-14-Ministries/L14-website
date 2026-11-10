'use server';

// A family asking for help with the fee.
//
// No migration: scholarships and its row-level security have existed since
// 0001, and the policies were already written for exactly this. A family may
// insert a request for their own participant, read their own, and update it
// ONLY while status is 'requested' or 'withdrawn' AND granted_cents is 0 —
// so once staff have granted an award the family can no longer edit the
// request behind it. That rule lives in Postgres, not here.
//
// The admin side has been able to review and grant these since August; there
// was simply no way to ask.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

const MAX_CENTS = 10_000_00; // A sanity bound, not a policy. See below.

// Signs the scholarship agreement for this registration if the family ticked
// it (see the comment inside). Returns an error message, or null when there
// is nothing to say. Shared by the per-person and the family request.
async function signAgreementIfNeeded(supabase, user, registrationId, input) {
  // The scholarship agreement is signed HERE, with the first request on a
  // registration -- it moved out of the everyone-signs block on the
  // registration form (24 Aug) because terms should be signed by the people
  // they bind, when they start to bind them. The insert-once guard mirrors
  // the registration RPC: an existing signature stands and is never
  // rewritten. The signer is the logged-in account holder, named from their
  // profile so the record carries a person, not a checkbox.
  if (input?.agreementKey !== 'scholarship_agreement') return null;
  // Every read here is checked: a failed one must not skip the signature
  // (or the primary-contact check) and carry on as if none were needed.
  const { data: agreementRow, error: agreementError } = await supabase
    .from('agreements')
    .select('id')
    .eq('key', 'scholarship_agreement')
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (agreementError) return `Could not save your request: ${agreementError.message}`;

  const { data: regRow, error: regError } = await supabase
    .from('registrations')
    .select('household_id')
    .eq('id', registrationId)
    .maybeSingle();
  if (regError) return `Could not save your request: ${regError.message}`;

  if (agreementRow && regRow) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) return `Could not save your request: ${profileError.message}`;
    // The name the person actually TYPED, when they typed one. Falling
    // straight to the profile made every scholarship signature read as
    // whoever was logged in, which is not the same claim -- and testing
    // (25 Aug) rightly asked who was signing. The profile stays as the
    // fallback for a request made before the box existed.
    //
    // Whichever it ends up being, it must be the household's primary
    // contact. The form refuses anything else and 0049 refuses it in
    // Postgres; this check is here so the family gets a sentence rather
    // than a database error.
    const typed = (input?.signerName || '').trim();
    const signerName =
      typed ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
      user.email;

    const { data: contactPerson, error: contactError } = regRow.household_id
      ? await supabase
          .from('households')
          .select('people!households_primary_contact_person_id_fkey ( first_name, last_name )')
          .eq('id', regRow.household_id)
          .maybeSingle()
      : { data: null };
    if (contactError) return `Could not save your request: ${contactError.message}`;
    const contactFull = contactPerson?.people
      ? `${contactPerson.people.first_name ?? ''} ${contactPerson.people.last_name ?? ''}`
      : '';
    const norm = (v) => (v || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (contactFull.trim() && norm(signerName) !== norm(contactFull)) {
      return `The agreement has to be signed by ${contactFull.trim()}, the primary contact for your family. Change the primary contact under Manage Household if someone else is signing.`;
    }

    const { data: existingSig, error: existingSigError } = await supabase
      .from('agreement_signatures')
      .select('id')
      .eq('agreement_id', agreementRow.id)
      .eq('registration_id', registrationId)
      .limit(1);
    if (existingSigError) return `Could not save your request: ${existingSigError.message}`;

    if (!existingSig?.length) {
      const { error: sigError } = await supabase.from('agreement_signatures').insert({
        agreement_id: agreementRow.id,
        household_id: regRow.household_id,
        registration_id: registrationId,
        status: 'signed_here',
        signer_name: signerName,
        signer_role: 'account_holder',
      });
      if (sigError) return `Could not sign the agreement: ${sigError.message}`;
    }
  }
  return null;
}

export async function requestScholarship(registrationId, participantId, input) {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: 'Your session has expired. Please log in and try again.' };
  }

  const dollars = Number(input?.amount);
  if (!Number.isFinite(dollars) || dollars < 0) {
    return { ok: false, error: 'Please enter an amount, or 0 if you would rather not name one.' };
  }
  const cents = Math.round(dollars * 100);
  if (cents > MAX_CENTS) {
    return { ok: false, error: 'That amount looks like a typo. Please check it.' };
  }

  const statement = (input?.statement || '').trim();

  const supabase = await createClient();

  const agreementError = await signAgreementIfNeeded(supabase, user, registrationId, input);
  if (agreementError) return { ok: false, error: agreementError };

  // One request per participant. An existing one is updated rather than
  // duplicated; RLS refuses the update if staff have already granted against
  // it, which surfaces as the message below rather than a silent no-op.
  const { data: existing, error: existingError } = await supabase
    .from('scholarships')
    .select('id, status, granted_cents')
    .eq('registration_participant_id', participantId)
    .maybeSingle();
  // Read as "no request yet", a failed lookup would insert a duplicate.
  if (existingError) return { ok: false, error: `Could not save your request: ${existingError.message}` };

  if (existing) {
    if ((existing.granted_cents ?? 0) > 0) {
      return {
        ok: false,
        error:
          'Camp staff have already awarded a scholarship for this person, so this request can no longer be changed. Please contact the office if something needs to be different.',
      };
    }
    const { error } = await supabase
      .from('scholarships')
      // family_request_id cleared: a share of a family request that was
      // declined or withdrawn becomes this person's own request (0160).
      .update({ requested_cents: cents, family_statement: statement || null, status: 'requested', family_request_id: null })
      .eq('id', existing.id);
    if (error) return { ok: false, error: `Could not save your request: ${error.message}` };
  } else {
    const { error } = await supabase.from('scholarships').insert({
      registration_participant_id: participantId,
      requested_cents: cents,
      family_statement: statement || null,
      status: 'requested',
    });
    if (error) return { ok: false, error: `Could not save your request: ${error.message}` };
  }

  revalidatePath('/account/dashboard');
  revalidatePath(`/account/scholarship/${registrationId}`);
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}

export async function withdrawScholarship(registrationId, participantId) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('scholarships')
    .update({ status: 'withdrawn' })
    .eq('registration_participant_id', participantId);

  if (error) return { ok: false, error: `Could not withdraw the request: ${error.message}` };
  revalidatePath('/account/dashboard');
  revalidatePath(`/account/scholarship/${registrationId}`);
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}

// One request for the whole family on this registration (0159, Lawrence
// 10 Nov 2026): a percentage, an amount, or help without a figure. The
// database splits it over the people by each person's fee and refuses it
// once staff have decided, or beside a per-person award; its messages are
// written for the family and shown as they are.
export async function requestFamilyScholarship(registrationId, input) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in and try again.' };

  const kind = ['percent', 'amount', 'unsure'].includes(input?.kind) ? input.kind : null;
  if (!kind) return { ok: false, error: 'Choose a percentage, an amount, or not sure.' };
  let percent = null;
  let cents = null;
  if (kind === 'percent') {
    percent = Number(input?.percent);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      return { ok: false, error: 'Enter a percentage from 1 to 100.' };
    }
  }
  if (kind === 'amount') {
    const d = Number(String(input?.amount ?? '').replace(/[$,\s]/g, ''));
    if (!Number.isFinite(d) || d <= 0) return { ok: false, error: 'Enter an amount in dollars.' };
    cents = Math.round(d * 100);
    if (cents > MAX_CENTS) return { ok: false, error: 'That amount looks like a typo. Please check it.' };
  }

  const supabase = await createClient();
  const agreementError = await signAgreementIfNeeded(supabase, user, registrationId, input);
  if (agreementError) return { ok: false, error: agreementError };

  const { error } = await supabase.rpc('family_request_scholarship', {
    p_registration_id: registrationId,
    p_kind: kind,
    p_percent: percent,
    p_cents: cents,
    p_statement: (input?.statement || '').trim() || null,
  });
  if (error) return { ok: false, error: `Could not save your request: ${error.message}` };

  revalidatePath('/account/dashboard');
  revalidatePath(`/account/scholarship/${registrationId}`);
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}

export async function withdrawFamilyScholarship(registrationId) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Your session has expired.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('family_withdraw_scholarship', { p_registration_id: registrationId });
  if (error) return { ok: false, error: `Could not withdraw the request: ${error.message}` };
  revalidatePath('/account/dashboard');
  revalidatePath(`/account/scholarship/${registrationId}`);
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true };
}
