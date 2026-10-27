import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { isCurrentEventRow } from '@/lib/events';
import EmailFamiliesForm from './EmailFamiliesForm';
import { previewFamilyEmail } from './actions';
import { searchEmailLog, emailFiltersFrom, groupEmailsBySend, groupSendsByEvent } from '@/lib/emailLog';
import EmailsSentSection from './EmailsSentSection';
import UpcomingReminders from './UpcomingReminders';
import { createAdminClient } from '@/lib/supabase/admin';
import { upcomingReminders, reminderMode } from '@/lib/reminders/run';
import { todayInMorristown } from '@/lib/events';

export const metadata = { title: 'Email Families — Staff Admin' };

// A long list is sent one email at a time, with a pause between (actions.js),
// so the Send can take a minute; the default function time would cut it off.
export const maxDuration = 300;

// Email the families of an event, or of one activity, about a change
// (22 Oct 2026). Registration write. Nothing is sent until a staff member
// reads the preview and presses Send -- see actions.js for why it is never
// automatic. The Activities editor links here after a waiver or an outside
// provider is added to an activity people were already signed up for, with
// ?event, ?activity, ?outstanding=1 and ?suggest=1 (a suggested subject and
// message) -- ids only in the URL, never an address.
export default async function EmailFamiliesPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/email-families/');
  if (!can(staff, 'write:registration')) redirect('/admin');

  const supabase = await createClient();
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, archived_at')
    .order('starts_on');
  if (eventsError) throw new Error(`Events: ${eventsError.message}`);

  const requested = typeof params?.event === 'string' ? params.event : '';
  const current = (events ?? []).filter(isCurrentEventRow);
  // The chosen event stays in the list even when it is past or archived, so
  // a link from an older registration still opens on it.
  const listed = current.some((e) => e.id === requested)
    ? current
    : [...current, ...(events ?? []).filter((e) => e.id === requested)];
  const eventId = listed.some((e) => e.id === requested) ? requested : '';

  const { data: activities, error: actError } = eventId
    ? await supabase
        .from('activities')
        .select('id, name, active, provider_name, provider_url, sort_order')
        .eq('event_id', eventId)
        .order('sort_order')
    : { data: [], error: null };
  if (actError) throw new Error(`Activities: ${actError.message}`);

  const requestedActivity = typeof params?.activity === 'string' ? params.activity : '';
  const activity = (activities ?? []).find((a) => a.id === requestedActivity) ?? null;
  const outstanding = params?.outstanding === '1';
  const event = listed.find((e) => e.id === eventId) ?? null;

  // The suggested words, when the editor sent someone here after adding a
  // waiver or a provider. Staff edit them freely; nothing is sent from them
  // as they stand.
  let suggestion = null;
  if (params?.suggest === '1' && activity && event) {
    const provider = activity.provider_name || activity.provider_url;
    suggestion = provider
      ? {
          subject: `${activity.name} at ${event.name}: the outfitter's form`,
          message: `Hello,\n\n${activity.name} at ${event.name} is run by ${
            activity.provider_name || 'an outside provider'
          }, who need their own form completed for everyone taking part. Please complete it with them, then upload their confirmation (a screenshot, a photo of the signed page, or the PDF they send) on your Activities page.\n\nThank you — and if anything about this is a worry, just reply to this email.`,
        }
      : {
          subject: `${activity.name} at ${event.name} now needs a waiver`,
          message: `Hello,\n\nWe have added a waiver to ${activity.name} at ${event.name}, and it is needed for everyone already signed up. It takes a minute or two to read and sign on your Activities page, and nothing else about the place changes.\n\nThank you — and if you have any questions, just reply to this email.`,
        };
  }

  // Who it would reach, worked out here by the same function the Send uses.
  // Choosing another event, activity or "waiver outstanding" changes the URL
  // (ids only) and this page answers again.
  const preview = eventId
    ? await previewFamilyEmail({ eventId, activityId: activity?.id ?? null, outstandingOnly: outstanding })
    : null;

  // The emails the site sent families, so a send stays visible after its
  // "N emails sent" card is gone (26 Oct 2026) -- filtered by the sent_*
  // and q params, grouped by send and by event (27 Oct 2026; lib/emailLog.js).
  const sentFilters = emailFiltersFrom(params);
  const sent = await searchEmailLog(supabase, sentFilters);
  const eventNames = new Map((events ?? []).map((e) => [e.id, e.name]));
  const sentByEvent = groupSendsByEvent(groupEmailsBySend(sent.emails), (id) => eventNames.get(id) ?? null);
  // The event filter offers the current events; one chosen from a link to an
  // older event stays in the list, as the send form's does.
  const sentEventOptions = [
    ...current,
    ...(events ?? []).filter((e) => e.id === sentFilters.eventId && !current.some((c) => c.id === e.id)),
  ].map((e) => ({ id: e.id, name: e.name }));

  // The address the email's Activities link uses, so the preview shows it as
  // the family will see it.
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host');
  const origin = host ? `${hdrs.get('x-forwarded-proto') ?? 'https'}://${host}` : '';

  // The automatic emails' next 7 days (0138). Read with the job's own
  // service-role client -- it has to see every family's money and details to
  // know who is owed what -- and shown as names, events and kinds only. A
  // failure is said on the card, never shown as "nothing due".
  const remindersAdmin = createAdminClient();
  let upcoming = null;
  let upcomingError = null;
  if (!remindersAdmin) {
    upcomingError = 'Not set up yet: SUPABASE_SERVICE_ROLE_KEY is not set in Vercel, so the automatic emails cannot run.';
  } else {
    try {
      upcoming = await upcomingReminders(remindersAdmin, { today: todayInMorristown(), origin, days: 7 });
    } catch (e) {
      upcomingError = `The list could not be worked out: ${e?.message ?? 'unknown error'}`;
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Email Families</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Tell the families of an event — or of one activity — about a change. One email per
        family, to the household&rsquo;s email, sent from registration@ when you press Send and
        never before. Each send is recorded in the message log.
      </p>
      <EmailFamiliesForm
        events={listed.map((e) => ({ id: e.id, name: e.name, startsOn: e.starts_on }))}
        eventId={eventId}
        activities={(activities ?? []).map((a) => ({ id: a.id, name: a.name, active: a.active !== false }))}
        activityId={activity?.id ?? ''}
        outstanding={outstanding}
        suggestion={suggestion}
        preview={preview}
        origin={origin}
      />

      <UpcomingReminders rows={upcoming ?? []} mode={reminderMode()} error={upcomingError} />

      <EmailsSentSection
        result={sent}
        byEvent={sentByEvent}
        filters={sentFilters}
        eventOptions={sentEventOptions}
        keepParams={{
          event: eventId,
          activity: activity?.id ?? '',
          outstanding: outstanding ? '1' : '',
          suggest: params?.suggest === '1' ? '1' : '',
        }}
      />
    </div>
  );
}
