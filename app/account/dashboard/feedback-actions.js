'use server';

// "Send us feedback" on the family dashboard (Lawrence, 24 Oct 2026): while
// the new site is new, families are asked to say what is confusing, wrong or
// could be better. One email to the published info@ address per note, with
// Reply going back to the family. The note's words are not stored -- the same
// choice as the contact form (app/contact/actions.js): the shared mailbox is
// where staff already work, and a table would be a second place holding what
// families write to us.
//
// FIVE AN HOUR PER LOGIN, counted in the database (security review, 23 Nov
// 2026, 0178). The earlier "no limit" was a choice against an in-memory limit,
// which is not real on a serverless host. Each send now leaves a line in
// message_log (to info@, no words) through log_own_household_email(), and
// my_feedback_notes_this_hour() counts this login's lines before sending.

import { headers } from 'next/headers';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { sendEmail, websiteFeedbackEmail, logOwnEmail } from '@/lib/email';
import { whenInMorristown } from '@/lib/events';
import { site } from '@/lib/site';

const MIN_MESSAGE = 10;
const MAX_MESSAGE = 4000;
const MAX_PAGE = 200;
const MAX_UA = 400;
const PER_HOUR = 5;
const ENOUGH = 'Thank you, we have your notes. Please email info@luke14ministries.net for anything more.';

export async function sendWebsiteFeedback({ message, page, userAgent } = {}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Please log in again, then send your note.' };

  const text = String(message ?? '').trim();
  if (text.length < MIN_MESSAGE) {
    return { ok: false, error: `Please write a little more, at least ${MIN_MESSAGE} characters.` };
  }
  if (text.length > MAX_MESSAGE) {
    return { ok: false, error: `That is a little long. Please keep it under ${MAX_MESSAGE} characters.` };
  }
  const pageText = String(page ?? '').trim().slice(0, MAX_PAGE);
  let ua = String(userAgent ?? '').trim();
  if (!ua) ua = (await headers()).get('user-agent') ?? '';
  ua = ua.slice(0, MAX_UA);

  const supabase = await createClient();
  // A count that cannot be read lets the note through (and says so in the
  // server log): a note lost to a database hiccup is worse than a sixth one.
  const { data: recent, error: countError } = await supabase.rpc('my_feedback_notes_this_hour');
  if (countError) console.error('sendWebsiteFeedback count:', countError.message);
  if ((recent ?? 0) >= PER_HOUR) return { ok: false, error: ENOUGH };

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

  // The line that counts toward the hourly limit; who and when, never the words.
  await logOwnEmail(supabase, {
    householdId: memberError ? null : householdIds[0] ?? null,
    to: site.emails.info,
    templateKey: 'website_feedback',
    subject: mail.subject,
    sent,
    bodyText: '(A feedback note to info@. The note itself is in that mailbox.)',
  });

  // As on the contact form, the email IS the record: if it did not go,
  // nothing happened, and "thank you" would be untrue.
  if (!sent.ok) {
    console.error('sendWebsiteFeedback: not sent:', sent.error);
    return { ok: false, failed: true };
  }
  return { ok: true };
}
