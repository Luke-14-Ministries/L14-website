'use server';

// A family's reply to camp staff, from the dashboard (0126; Lawrence,
// 26 Oct 2026, Testing Script 6 items 2.8/2.9).
//
// Staff "Ask the family for more information…" (0089) and the family used
// to have no way to answer on the site. Now they write here, and
// family_reply_to_staff() does the rest in one place: the reply joins the
// registration's thread (registration_family_messages), "waiting on the
// family" clears, and family_replied_at is stamped so staff see a blue
// "Family replied" flag, the Awaiting Review tab and the nav count. A family
// may write at any time, asked or not.
//
// The membership check is the function's own, against household_members --
// not RLS, which reaches every registration for a staff member (CLAUDE.md:
// /account/* scopes by household explicitly). No email is sent: Lawrence
// chose one way to answer, in the app, and the app is where staff see it.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

const MAX_REPLY = 4000;

export async function replyToStaff({ registrationId, body } = {}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in again, then send your reply.' };
  if (!registrationId) return { ok: false, error: 'Which registration is this about?' };
  const text = String(body ?? '').trim();
  if (!text) return { ok: false, error: 'Write your reply first.' };
  if (text.length > MAX_REPLY) {
    return { ok: false, error: `That is a little long — please keep it under ${MAX_REPLY.toLocaleString('en-US')} characters.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('family_reply_to_staff', {
    p_registration_id: registrationId,
    p_body: text,
  });
  if (error) {
    console.error('replyToStaff:', error.message);
    // The function's own words are written for the family ("That
    // registration is not on your account.", "Write your reply first.").
    return {
      ok: false,
      error:
        error.code === '42501' || error.code === '22023'
          ? error.message
          : 'Your reply could not be sent. Please try again.',
    };
  }

  revalidatePath('/account/dashboard');
  revalidatePath('/admin/review');
  revalidatePath(`/admin/registrations/${registrationId}`);
  return { ok: true, sentAt: new Date().toISOString() };
}
