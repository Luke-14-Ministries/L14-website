'use server';

// Server actions for the Accounts page. Every one of these re-checks admin
// here AND relies on the database function's own is_admin() check -- the same
// belt-and-braces pattern as the rest of the admin area. If this file were
// deleted, nothing would open up; if the database checks were deleted, this
// file would still refuse. Both have to fail before anything leaks.
//
// Since 0180 (security review, 23 Nov 2026) the reset, the removal and the
// purge also need this session to have entered the administrator's own code
// just now (aal2): the page's step-up box (components/StepUpModal.jsx) does
// that before calling them, and the database refuses without it. Purge,
// removal, link and merge each write a row to admin_account_log.

import { revalidatePath } from 'next/cache';
import { siteOrigin } from '@/lib/origin';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { withReason } from '@/lib/dbErrors';

// Remove a login only. The database cascades take the profile, staff row and
// MFA devices; the family's records survive untouched (see migration 0022 for
// the full accounting of what goes and what stays).
export async function removeLogins(userIds) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { ok: false, error: 'Nothing selected.' };
  }

  const supabase = await createClient();
  const failed = [];
  // One at a time, on purpose: a batch with one failure in the middle should
  // still remove the others, and report which one refused rather than a
  // single unhelpful "something went wrong".
  for (const id of userIds) {
    const { error } = await supabase.rpc('admin_delete_login', { p_user_id: id });
    if (error) failed.push({ id, message: withReason('', error).trim() });
  }

  revalidatePath('/admin/accounts');
  if (failed.length > 0) {
    return {
      ok: false,
      removed: userIds.length - failed.length,
      error:
        failed.length === 1
          ? `${userIds.length === 1 ? 'The account was not removed.' : '1 account was not removed.'} ${failed[0].message}`
          : `${failed.length} of ${userIds.length} accounts were not removed. The first reason: ${failed[0].message}`,
    };
  }
  return { ok: true, removed: userIds.length };
}

// Delete a household and everything under it -- registrations, participants,
// people, and the member logins that are nothing else. Since 0180 the
// function refuses a family with real money on file (a Stripe payment, or a
// plan still running: those are Deletion Requests), keeps a login that is
// staff, a program leader or in another household, and says which it kept.
// Gift records survive as anonymous rows.
export async function purgeHousehold(householdId) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!householdId) return { ok: false, error: 'Missing household.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_purge_household', {
    p_household_id: householdId,
  });

  if (error) {
    console.error('admin_purge_household:', error.message);
    return { ok: false, error: withReason('The family was not deleted.', error) };
  }
  revalidatePath('/admin/accounts');
  revalidatePath('/admin/people');
  return {
    ok: true,
    loginsDeleted: data?.logins_deleted ?? 0,
    loginsKept: Array.isArray(data?.logins_kept) ? data.logins_kept : [],
  };
}

// Clear someone's two-factor so they can sign in with just their password and
// set it up again. Same operation as /admin/security, minus the typed email
// address -- the row already says who.
export async function resetMfa(userId) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!userId) return { ok: false, error: 'Missing account.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_reset_mfa', {
    p_user_id: userId,
  });

  if (error) {
    console.error('admin_reset_mfa:', error.message);
    return { ok: false, error: withReason('Two-factor was not reset.', error) };
  }
  revalidatePath('/admin/accounts');
  revalidatePath('/admin/staff/access-log');
  return { ok: true, removed: data ?? 0 };
}

// Attach a login to an existing household -- the reverse of removeLogins,
// for reconnecting a family after staff have verified who they are. Kept
// staff-mediated on purpose: automatic relinking by email address would hand
// the household's records to whoever controls that mailbox later.
export async function linkLoginToHousehold(userId, householdId, personId = null) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!userId || !householdId) return { ok: false, error: 'Missing account or household.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_link_login_to_household', {
    p_user_id: userId,
    p_household_id: householdId,
    // Optional "this login IS this family member" claim. The function verifies
    // the person belongs to the household and is unclaimed.
    p_person_id: personId || null,
  });

  if (error) {
    console.error('admin_link_login_to_household:', error.message);
    return { ok: false, error: withReason('The account was not linked.', error) };
  }
  revalidatePath('/admin/accounts');
  return { ok: true, role: data };
}

// Merge one household into another (0151, 0180): everything that points at
// `mergeId` moves to `keepId`, then `mergeId` is deleted. The function checks
// the administrator and refuses when both are registered for the same event;
// its message says which event, so withReason shows it as it is.
export async function mergeHouseholds(keepId, mergeId) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!keepId || !mergeId || keepId === mergeId) {
    return { ok: false, error: 'Choose two different households.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_merge_households', {
    p_keep: keepId,
    p_merge: mergeId,
  });

  if (error) {
    console.error('admin_merge_households:', error.message);
    return { ok: false, error: withReason('The households were not merged.', error) };
  }
  revalidatePath('/admin/accounts');
  revalidatePath('/admin/people');
  return { ok: true, moved: data?.moved ?? {} };
}

// Take a login off a household without deleting it (0178's
// remove_household_login(): never the person who set the household up,
// never yourself). Registration write, as in the database; used from the
// Accounts page and the registration page's "Who can sign in" card.
export async function takeOutOfHousehold(householdId, profileId) {
  const staff = await getStaff();
  if (!can(staff, 'write:registration')) return { ok: false, error: 'Not permitted.' };
  if (!householdId || !profileId) return { ok: false, error: 'Missing household or account.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('remove_household_login', {
    p_household_id: householdId,
    p_profile_id: profileId,
  });
  if (error) {
    console.error('remove_household_login:', error.message);
    return { ok: false, error: withReason('They were not taken out of the household.', error) };
  }
  revalidatePath('/admin/accounts');
  revalidatePath('/admin/registrations', 'layout');
  return { ok: true };
}

// Re-send the confirmation email to an account that never confirmed.
// Supabase asks every auth email for a bot-check token, this one included, so
// the page shows the Turnstile widget first and passes its token here
// (security review, 23 Nov 2026: without one the button could only fail on
// the live site). Supabase's two likely refusals are put in plain sentences.
export async function resendVerification(email, captchaToken = null) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!email) return { ok: false, error: 'Missing email.' };

  const origin = await siteOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      ...(captchaToken ? { captchaToken } : {}),
      emailRedirectTo: `${origin}/auth/callback/?next=%2Faccount%2Fdashboard%2F`,
    },
  });

  if (error) {
    console.error('resendVerification:', error.message);
    const msg = String(error.message ?? '');
    if (error.status === 429 || /rate limit|only request this|security purposes/i.test(msg)) {
      return {
        ok: false,
        error: 'A confirmation email went to this address a moment ago. Wait a minute or two, then try again.',
      };
    }
    if (/captcha/i.test(msg)) {
      return {
        ok: false,
        error: 'The bot check did not go through. Close this box, open it again and tick the check before sending.',
      };
    }
    // 23 Nov 2026: the sign-in service's own words go to the server log.
    console.error('admin account email:', msg);
    return { ok: false, error: 'The email was not sent. Try again in a few minutes, and tell an administrator if it keeps happening.' };
  }
  return { ok: true };
}
