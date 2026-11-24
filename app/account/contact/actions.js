'use server';

// My account details (was My Contact Info & Preferences). Everything here is the signed-in user's own
// record: profiles_update_self RLS allows only their row, and the login-email
// change goes through Supabase Auth's own confirmation flow.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { familyError } from '@/lib/dbErrors';
import { myHouseholdIds } from '@/lib/myHousehold';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function updateMyProfile(form) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in again.' };

  const first = clean(form.first_name);
  const last = clean(form.last_name);
  // sms_opt_in is no longer sent (23 Nov 2026: the "OK to text me" tick is
  // hidden until texting families is planned), so it is left out of the
  // update and the two opt-ins already saved stay as they are.
  const { error } = await supabase
    .from('profiles')
    .update({ first_name: first, last_name: last, phone: clean(form.phone) })
    .eq('id', user.id);
  if (error) return { ok: false, error: familyError('updateMyProfile', error, 'Your details could not be saved.') };

  // The caller's own card on Manage household follows a corrected name
  // (23 Nov 2026), so the spelling reaches rosters and nametags. One
  // direction only, and only their OWN person row (people.profile_id = this
  // login) in a household they belong to: scoped by membership explicitly,
  // never by RLS alone (staff RLS reads every family). Blank names never
  // overwrite the card, and a person on a registration keeps their name, the
  // same lock as updatePersonInfo (rosters and signed agreements use it).
  let note = null;
  if (first || last) {
    const { ids, error: idsError } = await myHouseholdIds(supabase);
    if (idsError) return { ok: false, error: `Your details were saved, but your household card was not: ${idsError}` };
    if (ids.length > 0) {
      const { data: me, error: meError } = await supabase
        .from('people')
        .select('id, household_id, first_name, last_name')
        .eq('profile_id', user.id)
        .in('household_id', ids)
        .limit(1)
        .maybeSingle();
      if (meError) {
        return { ok: false, error: familyError('updateMyProfile person', meError, 'Your details were saved, but your household card could not be read.') };
      }
      const changed = me && ((first && first !== me.first_name) || (last && last !== me.last_name));
      if (changed) {
        const { count, error: countError } = await supabase
          .from('registration_participants')
          .select('id', { count: 'exact', head: true })
          .eq('person_id', me.id)
          .neq('status', 'cancelled');
        if (countError) {
          return { ok: false, error: familyError('updateMyProfile registrations', countError, 'Your details were saved, but your registrations could not be read.') };
        }
        if ((count ?? 0) > 0) {
          note =
            'Saved. Your name on camp registrations stays as it was, because rosters and signed agreements already use it. Email the ministry and staff can correct it.';
        } else {
          const { error: personError } = await supabase
            .from('people')
            .update({ first_name: first ?? undefined, last_name: last ?? undefined })
            .eq('id', me.id)
            .eq('household_id', me.household_id);
          if (personError) {
            return { ok: false, error: familyError('updateMyProfile person', personError, 'Your details were saved, but your household card was not.') };
          }
        }
      }
    }
  }
  revalidatePath('/account/contact');
  revalidatePath('/account/dashboard');
  revalidatePath('/account/household');
  return note ? { ok: true, message: note } : { ok: true };
}

// Changing the LOGIN email is an auth operation: Supabase emails a
// confirmation link to the new address, and nothing changes until it is
// clicked. (With "secure email change" enabled, the old address gets one too.)
// An account with two-factor needs a code-verified (aal2) session before
// Supabase will change its login email, and a remembered browser is only aal1
// (the skip is ours, not Supabase's). Lawrence hit Supabase's refusal on
// 23 Nov 2026, the same wall the password reset hit on 21 Nov. So the form
// asks for the authenticator code when needed and verifies it here first.
async function verifyAnyFactor(supabase, code) {
  const { data: list, error } = await supabase.auth.mfa.listFactors();
  if (error) return false;
  const verified = (list?.totp ?? []).filter((f) => f.status === 'verified');
  for (const f of verified) {
    const { error: vError } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code });
    if (!vError) return true;
  }
  return false;
}

export async function requestLoginEmailChange(newEmail, code = '') {
  const email = String(newEmail ?? '').trim();
  if (!email || !email.includes('@')) return { ok: false, error: 'Enter a valid email address.' };

  const supabase = await createClient();
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits) {
    if (!(await verifyAnyFactor(supabase, digits))) {
      return {
        ok: false,
        needsCode: true,
        error: 'That code did not match. It changes every 30 seconds, so try the current one.',
      };
    }
  }
  const { error } = await supabase.auth.updateUser({ email });
  if (error) {
    // Not about the address, so it can be said plainly.
    if (error.code === 'insufficient_aal' || /AAL2/i.test(error.message ?? '')) {
      return {
        ok: false,
        needsCode: true,
        error: 'Your account has two-factor turned on, so changing the login email needs the 6-digit code from your authenticator app too.',
      };
    }
    // Words of our own (security audit, 20 Oct 2026): Supabase's message can
    // say whether the new address already has an account, which would make
    // this form a way to test addresses.
    console.error('requestLoginEmailChange:', error.message);
    return { ok: false, error: 'That address could not be used. Check it, or try a different one.' };
  }
  return {
    ok: true,
    // "Secure email change" is on in Supabase: both addresses get a link.
    message: `We sent a link to ${email} and one to your current address. Your login email changes once both are pressed.`,
  };
}

export async function setEmailNews(optIn) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in again.' };

  const { error } = await supabase
    .from('profiles')
    .update({ email_news: !!optIn })
    .eq('id', user.id);
  if (error) return { ok: false, error: familyError('setEmailNews', error, 'Your choice could not be saved.') };
  revalidatePath('/account/household');
  return { ok: true };
}
