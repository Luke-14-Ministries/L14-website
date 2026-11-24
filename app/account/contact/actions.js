'use server';

// My Account Details (was My Contact Info & Preferences). Everything here is the signed-in user's own
// record: profiles_update_self RLS allows only their row, and the login-email
// change goes through Supabase Auth's own confirmation flow.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

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

  const { error } = await supabase
    .from('profiles')
    .update({
      first_name: clean(form.first_name),
      last_name: clean(form.last_name),
      phone: clean(form.phone),
      sms_opt_in: form.sms_opt_in === 'on' || form.sms_opt_in === true,
    })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/contact');
  revalidatePath('/account/dashboard');
  return { ok: true };
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
        error: 'Your account has two-factor turned on, so changing the sign-in email needs the 6-digit code from your authenticator app too.',
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
    message: `We sent a link to ${email} and one to your current address. Your sign-in email changes once both are pressed.`,
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
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/household');
  return { ok: true };
}
