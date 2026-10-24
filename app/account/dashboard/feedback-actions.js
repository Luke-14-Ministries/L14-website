'use server';

// "Send us feedback" on the family dashboard (Lawrence, 24 Oct 2026): while
// the new site is new, families are asked to say what is confusing, wrong or
// could be better. One email to the published info@ address per note, with
// Reply going back to the family. Nothing is stored -- the same choice as the
// contact form (app/contact/actions.js): the shared mailbox is where staff
// already work, and a table would be a second place holding what families
// write to us.
//
// NO PER-USER RATE LIMIT, deliberately. An in-memory "one per minute" is not
// real on a serverless host (each request may land on a different instance),
// and the durable place to check -- message_log -- is not readable by the
// family making the request. The sign-in requirement (with two-factor
// enforced by proxy.js on every signed-in server action) is the limit: a
// note can only come from a real, known account, and abuse would be visible
// and attributable in the inbox.

import { headers } from 'next/headers';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { sendEmail, websiteFeedbackEmail } from '@/lib/email';
import { whenInMorristown } from '@/lib/events';
import { site } from '@/lib/site';

const MIN_MESSAGE = 10;
const MAX_MESSAGE = 4000;
const MAX_PAGE = 200;
const MAX_UA = 400;

export async function sendWebsiteFeedback({ message, page, userAgent } = {}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please sign in again, then send your note.' };

  const text = String(message ?? '').trim();
  if (text.length < MIN_MESSAGE) {
    return { ok: false, error: `Please write a little more — at least ${MIN_MESSAGE} characters.` };
  }
  if (text.length > MAX_MESSAGE) {
    return { ok: false, error: `That is a little long — please keep it under ${MAX_MESSAGE} characters.` };
  }
  const pageText = String(page ?? '').trim().slice(0, MAX_PAGE);
  let ua = String(userAgent ?? '').trim();
  if (!ua) ua = (await headers()).get('user-agent') ?? '';
  ua = ua.slice(0, MAX_UA);

  const supabase = await createClient();
  const [{ data: profile, error: profileError }, { data: memberships, error: memberError }] =
    await Promise.all([
      supabase.from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle(),
      supabase.from('household_members').select('household_id').eq('profile_id', user.id),
    ]);
  if (profileError) console.error('sendWebsiteFeedback profile:', profileError.message);
  if (memberError) console.error('sendWebsiteFeedback household_members:', memberError.message);

  // The person's OWN household, by membership -- never by RLS alone, which
  // would hand a staff member every family's rows.
  let householdName = 'No household on this account yet';
  const householdIds = (memberships ?? []).map((m) => m.household_id);
  if (memberError) {
    householdName = '(could not be loaded)';
  } else if (householdIds.length) {
    const { data: households, error: householdError } = await supabase
      .from('households')
      .select('display_name')
      .in('id', householdIds);
    if (householdError) {
      console.error('sendWebsiteFeedback households:', householdError.message);
      householdName = '(could not be loaded)';
    } else {
      householdName =
        (households ?? []).map((h) => h.display_name).filter(Boolean).join(', ') ||
        '(household has no name)';
    }
  }

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  const mail = websiteFeedbackEmail({
    name,
    email: user.email,
    householdName,
    page: pageText,
    message: text,
    when: whenInMorristown(new Date().toISOString()),
    userAgent: ua,
  });

  const sent = await sendEmail({
    to: site.emails.info,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    replyTo: user.email,
  });

  // As on the contact form, the email IS the record: if it did not go,
  // nothing happened, and "thank you" would be untrue.
  if (!sent.ok) {
    console.error('sendWebsiteFeedback: not sent:', sent.error);
    return { ok: false, failed: true };
  }
  return { ok: true };
}
