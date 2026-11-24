'use server';

// Cancellation requests, raised by a family and settled by staff.
//
// The family side of this deliberately cannot cancel anything. It records the
// ask. Staff release the places and settle any money, because both of those
// depend on a refund rule that is the board's to make, and because a place
// released by accident at eleven at night is not easily un-released.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { assertMine } from '@/lib/myHousehold';

export async function requestCancellation({ registrationId, participantIds, reason }) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please log in and try again.' };
  if (!registrationId) return { ok: false, error: 'Which registration?' };
  if (!(reason || '').trim()) {
    // Not a database rule, a working one: staff ring the family about these,
    // and "no reason given" makes that call start from nothing. It also gives
    // the ministry a chance to help with whatever the real problem is —
    // which, often enough, is money we could have covered.
    return {
      ok: false,
      error: 'Please tell us briefly why, so staff know how to help.',
    };
  }

  const supabase = await createClient();
  // The registration must be the caller's own (lib/myHousehold.js, 23 Nov
  // 2026), and every person named must be on it.
  const { error: scopeError } = await assertMine(supabase, { registration: registrationId });
  if (scopeError) return { ok: false, error: scopeError };
  const named = Array.isArray(participantIds) ? [...new Set(participantIds.filter((x) => typeof x === 'string'))] : [];
  if (named.length > 0) {
    const { data: onReg, error: onRegError } = await supabase
      .from('registration_participants')
      .select('id')
      .eq('registration_id', registrationId)
      .in('id', named);
    if (onRegError) {
      console.error('requestCancellation participants:', onRegError.message);
      return { ok: false, error: 'That request could not be sent. Please try again.' };
    }
    if ((onReg ?? []).length !== named.length) {
      return { ok: false, error: 'Someone named is not on this registration. Refresh the page and try again.' };
    }
  }

  // One open request at a time. A family clicking twice should not produce two
  // queue items staff have to reconcile against each other.
  const { data: existing, error: existingError } = await supabase
    .from('registration_cancellation_requests')
    .select('id')
    .eq('registration_id', registrationId)
    .eq('status', 'open')
    .maybeSingle();
  if (existingError) {
    console.error('requestCancellation:', existingError.message);
    return { ok: false, error: 'That request could not be sent. Please try again.' };
  }
  if (existing) {
    return {
      ok: false,
      error: 'You already have a cancellation request open for this registration. Staff will be in touch.',
    };
  }

  const { error } = await supabase.from('registration_cancellation_requests').insert({
    registration_id: registrationId,
    participant_ids: named,
    reason: reason.trim(),
    requested_by: user.id,
  });

  if (error) {
    console.error('requestCancellation:', error.message);
    return { ok: false, error: 'That request could not be sent. Please try again.' };
  }

  revalidatePath('/account/dashboard');
  revalidatePath('/admin/cancellations');
  return { ok: true };
}

// A family may take back a request staff have not acted on. RLS already
// refuses one that has been handled; this sets the only transition the family
// side is allowed to make.
export async function withdrawCancellation({ requestId }) {
  if (!requestId) return { ok: false, error: 'Nothing to withdraw.' };

  const supabase = await createClient();
  const { error: scopeError } = await assertMine(supabase, { cancellation: requestId });
  if (scopeError) return { ok: false, error: scopeError };
  const { data: changed, error } = await supabase
    .from('registration_cancellation_requests')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'open')
    .select('id');

  if (error) {
    console.error('withdrawCancellation:', error.message);
    return { ok: false, error: 'That could not be withdrawn. Staff may already have acted on it.' };
  }
  // No error and no row: staff settled it first (or a second click).
  if (!changed?.length) {
    return { ok: false, error: 'Staff have already dealt with this request, so it can no longer be withdrawn.' };
  }

  revalidatePath('/account/dashboard');
  revalidatePath('/admin/cancellations');
  return { ok: true };
}
