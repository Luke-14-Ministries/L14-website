// The staff sidebar's numbers, counted once per request (23 Nov 2026 review).
//
// Until 23 Nov 2026 every count lived inside app/admin/layout.jsx, so the
// Overview could not show the same numbers without counting them a second
// way. Now the layout (the badges) and the Overview (its "Waiting on staff"
// card) both call loadAdminBadges(), which React's cache() runs once for the
// whole request and hands the same answer to each. One function, one answer:
// a queue's number on the Overview is the menu's number.
//
// Every count is logged, never thrown: a throw here would take down every
// staff page. A failed count shows no badge (null counts as 0).
//
// Only for server components (cache() is per request on the server).

import { cache } from 'react';
import { getStaff, can } from '@/lib/staff';
import { getProgramLeadership } from '@/lib/programs';
import { createClient } from '@/lib/supabase/server';
import { sinceISO, STAFF_ASSIGNED_TYPES, isCurrentEventRow, todayInMorristown } from '@/lib/events';
import { VOLUNTEER_ROLES } from '@/lib/roles';
import { adultOnFirstDay } from '@/lib/backgroundChecks';
import { backgroundCheckWork } from '@/lib/backgroundCheckWork';
import { afterApprovalFilter } from '@/lib/changesAfterApproval';
import { volunteerBadgeMode } from '@/lib/volunteerBadge';

// Who is looking, once per request: the layout and loadAdminBadges() share
// these, so the staff row and the leader grants are read once, not twice.
export const currentStaff = cache(getStaff);
export const currentLeadership = cache(getProgramLeadership);

// Badge words after the number: a phrase, or [one, many] so a count of 1
// reads "1 family waiting" and not "1 families waiting" (Script 5). AdminNav
// shows them as tooltips; the Overview's card shows them as its lines.
export const BADGE_TITLES = {
  '/admin/review': ['person newly signed up and waiting on staff', 'people newly signed up and waiting on staff'],
  '/admin/accounts': 'created in the last 7 days',
  '/admin/cancellations': ['family waiting to hear back', 'families waiting to hear back'],
  '/admin/deletion-requests': ['family asking for its data to be deleted', 'families asking for their data to be deleted'],
  '/admin/scholarships': ['family waiting on a decision about the fee', 'families waiting on a decision about the fee'],
  '/admin/buddies': ['camper who asked for a buddy and still has nobody', 'campers who asked for a buddy and still have nobody'],
  '/admin/payments': ['payment in the last 7 days', 'payments in the last 7 days'],
  '/admin/programs': ['person on a roster with no program yet', 'people on a roster with no program yet'],
  '/admin/activities': ['outside-provider confirmation waiting to be checked', 'outside-provider confirmations waiting to be checked'],
  '/admin/my-program': ['person in your program', 'people in your program'],
  '/admin/background-checks': [
    'adult who still needs a background check (not counting invites out with VolunteerBadge)',
    'adults who still need a background check (not counting invites out with VolunteerBadge)',
  ],
  '/admin/changes': [
    'family who changed details after being approved, not yet marked reviewed',
    'families who changed details after being approved, not yet marked reviewed',
  ],
  '/admin/volunteers': ['volunteer application waiting for a decision', 'volunteer applications waiting for a decision'],
};

export const RED_BADGE_TITLES = {
  '/admin/background-checks': [
    'adult volunteer who can’t be approved yet: no current background check marked OK',
    'adult volunteers who can’t be approved yet: no current background check marked OK',
  ],
};

export const MAIL_BADGE_TITLES = {
  '/admin/review': ['family reply to read', 'family replies to read'],
};

// The blue numbers: a rolling window or a size, not a queue (AdminNav.jsx
// explains the two colors). The Overview's card lists only the amber ones.
export const WINDOW_BADGES = new Set(['/admin/accounts', '/admin/payments', '/admin/my-program']);

export const loadAdminBadges = cache(async () => {
  const [staff, leaderships] = await Promise.all([currentStaff(), currentLeadership()]);
  const supabase = await createClient();

  // The leader's own count: how many people are in their program(s). This is a
  // BLUE badge, not amber, and the distinction is the one AdminNav documents --
  // amber is a queue that drains when you act, blue is a number that just is.
  // A leader has nothing to clear here; they are being told the size of their
  // group, which is exactly the thing they want to know before Monday. The
  // same count for a staff member who leads.
  let myProgramCount = 0;
  for (const g of leaderships) {
    const { count, error } = await supabase
      .from('program_roster')
      .select('participant_id', { count: 'exact', head: true })
      .eq('program_id', g.programId)
      .eq('event_id', g.eventId);
    // A badge, not a page: logged, and that program adds nothing to it.
    if (error) console.error('my-program badge:', error.message);
    myProgramCount += count ?? 0;
  }

  // The amber number on Changes to Review when unreviewed family edits
  // exist. RLS scopes what this staffer may count (support-detail rows stay
  // invisible without the sensitive grant).
  let unreviewedChanges = 0;
  let volunteersAwaiting = 0;
  let volunteersMissingCheck = 0;
  // Adults who aren't volunteers with a registry search due (0162).
  let registrySearchesDue = 0;
  let recentAccounts = 0;
  let recentPayments = 0;
  let openCancellations = 0;
  let openDeletions = 0;
  let openScholarships = 0;
  let awaitingReview = 0;
  // Unread family replies (0126), counted apart so they show as their own
  // envelope badge rather than vanishing into the sign-up number.
  let unreadReplies = 0;
  let campersWithoutBuddy = 0;
  if (staff && can(staff, 'admin')) {
    // Accounts created in the last 7 days -- the same amber treatment as the
    // review queues, so a burst of new signups is visible from any admin page.
    const { data: n, error: nError } = await supabase.rpc('admin_recent_account_count', { p_days: 7 });
    if (nError) console.error('accounts badge:', nError.message);
    recentAccounts = n ?? 0;
  }
  if (staff && can(staff, 'read:registration')) {
    const paymentsSince = sinceISO(7);
    const [
      { data: changesRows, error: changesError },
      { count: volCount, error: volError },
      { count: payCount, error: payError },
      { count: cancelCount, error: cancelError },
      { count: scholCount, error: scholError },
      { count: reviewCount, error: reviewError },
      { data: repliedRows, error: repliedError },
      { data: familyScholRows, error: familyScholError },
    ] = await Promise.all([
      // Families with unreviewed changes, not one per field changed (Fable
      // badge review, 14 Nov 2026): the page groups by family.
      // Since 15 Nov 2026, only changes made after approval count
      // (lib/changesAfterApproval.js), so the person and time come too.
      supabase
        .from('family_change_log')
        .select('household_id, person_id, changed_at')
        .is('reviewed_at', null)
        .limit(5000),
      // Applications sitting in "applied" — same treatment as Changes to
      // Review: a number on the nav whenever something needs review.
      // Not for an archived event (Lawrence, 4 Nov 2026): no badge counts
      // an event staff have taken off every current list.
      // Current events only, and not a cancelled place: the same people as
      // the Volunteers page's "volunteers to decide" (14 Nov 2026).
      supabase
        .from('volunteer_applications')
        .select('id, registration_participants!inner ( status, registrations!inner ( events!inner ( archived_at, ends_on ) ) )', { count: 'exact', head: true })
        .eq('status', 'applied')
        .neq('registration_participants.status', 'cancelled')
        .gte('registration_participants.registrations.events.ends_on', new Date().toISOString().slice(0, 10))
        .is('registration_participants.registrations.events.archived_at', null),
      // Payment ACTIVITY, not a review queue (asked for 24 Aug). Nothing
      // here is waiting on a decision; the number answers "has money moved
      // since I last looked?", which is the question the payments page gets
      // opened for. Seven days, matching the Accounts badge, so the two
      // numbers on the nav mean the same span of time.
      supabase
        .from('payments')
        .select('id, registrations!inner ( events!inner ( archived_at ) )', { count: 'exact', head: true })
        .gte('created_at', paymentsSince)
        .is('registrations.events.archived_at', null),
      // Families waiting to hear back about cancelling. A queue that
      // DRAINS when staff act, so it takes the amber treatment rather
      // than the blue rolling-window one.
      supabase
        .from('registration_cancellation_requests')
        .select('id, registrations!inner ( events!inner ( archived_at ) )', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('registrations.events.archived_at', null),
      // Families waiting to hear whether the ministry can help with the
      // fee. Another draining queue, so amber again -- and the one with
      // the least excuse for sitting: a family who has said cost is the
      // problem is deciding whether to come at all.
      supabase
        .from('scholarships')
        .select('id, registration_participants!inner ( registrations!inner ( events!inner ( archived_at ) ) )', { count: 'exact', head: true })
        .eq('status', 'requested')
        // A share of a family request is counted once, below (0159).
        .is('family_request_id', null)
        .is('registration_participants.registrations.events.archived_at', null),
      // New sign-ups waiting to be confirmed or waitlisted -- the biggest
      // review queue in the ministry. Asked for 25 Aug: "not obvious where
      // new registrations get reviewed."
      //
      // 'submitted' only. Waitlisted is a decision already made, and
      // counting it here would put a badge on the nav that no amount of
      // reviewing could clear.
      //
      // And not a registration staff have sent back to the family for
      // more information (0089, 15 Oct 2026): that one is waiting on them,
      // and a badge that cannot drop until the family replies is a badge
      // staff learn to ignore.
      supabase
        .from('registration_participants')
        .select('id, registrations!inner ( awaiting_family_since, events!inner ( archived_at ) )', { count: 'exact', head: true })
        .eq('status', 'submitted')
        .is('registrations.awaiting_family_since', null)
        .is('registrations.events.archived_at', null),
      // A family that replied in the app and nobody has read it yet (0126)
      // is waiting on staff too. A reply clears "waiting on the family",
      // so anyone still submitted is already in the count above; what this
      // adds is the registration with nobody submitted (everyone already
      // confirmed or waitlisted) -- one per registration, so the family is
      // counted once.
      supabase
        .from('registrations')
        .select('id, registration_participants ( status ), events!inner ( archived_at )')
        .eq('family_reply_unread', true)
        .is('awaiting_family_since', null)
        .is('events.archived_at', null),
      // Family scholarship requests (0159): waiting on a decision, or
      // decided and flagged since. One per family.
      supabase
        .from('family_scholarship_requests')
        .select('status, needs_review_since, registrations!inner ( events!inner ( archived_at ) )')
        .in('status', ['requested', 'granted'])
        .is('registrations.events.archived_at', null),
    ]);
    if (changesError) console.error('changes badge:', changesError.message);
    if (volError) console.error('volunteers badge:', volError.message);
    if (payError) console.error('payments badge:', payError.message);
    if (cancelError) console.error('cancellations badge:', cancelError.message);
    if (scholError) console.error('scholarships badge:', scholError.message);
    if (familyScholError) console.error('family scholarships badge:', familyScholError.message);
    if (reviewError) console.error('review badge:', reviewError.message);
    if (repliedError) console.error('review badge (family replies):', repliedError.message);
    try {
      const afterApproval = (changesRows ?? []).length ? await afterApprovalFilter(supabase) : () => false;
      unreviewedChanges = new Set((changesRows ?? []).filter(afterApproval).map((r) => r.household_id ?? 'none')).size;
    } catch (err) {
      console.error('changes badge:', err.message);
    }
    volunteersAwaiting = volCount ?? 0;

    // Volunteers on an event that has not finished, counted by PERSON, whose
    // background check is not on file, current and marked OK (0091). Read
    // through clearance_status, which every staff member may see, so the
    // number is the same whoever is looking (Lawrence, 15 Oct 2026).
    {
      const today = new Date().toISOString().slice(0, 10);
      const { data: volRows, error: volRowsError } = await supabase
        .from('registration_participants')
        .select('person_id, people ( date_of_birth ), registrations!inner ( events!inner ( starts_on, ends_on, archived_at ) )')
        .in('camp_role', [...VOLUNTEER_ROLES])
        .neq('status', 'cancelled')
        .gte('registrations.events.ends_on', today)
        .is('registrations.events.archived_at', null);
      if (volRowsError) console.error('background-check badge:', volRowsError.message);
      // Adults only: Checkr does not screen under-18s (Lawrence, 15 Oct 2026),
      // counted on the event's first day, the one age rule (11 Nov 2026).
      const volIds = [
        ...new Set(
          (volRows ?? [])
            .filter((r) => r.person_id && adultOnFirstDay(r.people?.date_of_birth, r.registrations?.events?.starts_on))
            .map((r) => r.person_id)
        ),
      ];
      if (volIds.length) {
        const { data: statusRows, error: statusError } = await supabase
          .from('clearance_status')
          .select('person_id, on_file, is_current, verdict, provider')
          .in('person_id', volIds);
        // No badge rather than a wrong one: an empty read would count every
        // volunteer as missing a check.
        if (statusError) {
          console.error('background-check badge:', statusError.message);
        } else {
          const ok = new Set(
            // A registry search is not a volunteer's check (0161).
            (statusRows ?? [])
              .filter((c) => c.on_file && c.is_current && c.verdict === 'ok' && c.provider !== 'registry_search')
              .map((c) => c.person_id)
          );
          volunteersMissingCheck = volIds.filter((id) => !ok.has(id)).length;
        }
      }
    }
    recentPayments = payCount ?? 0;
    openCancellations = cancelCount ?? 0;
    {
      // Deletion requests waiting on staff (0081).
      const { count: delCount, error: delError } = await supabase
        .from('data_deletion_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'requested');
      if (delError) console.error('deletion requests badge:', delError.message);
      openDeletions = delCount ?? 0;
    }
    openScholarships =
      (scholCount ?? 0) +
      (familyScholRows ?? []).filter((f) => f.status === 'requested' || f.needs_review_since).length;
    awaitingReview = reviewCount ?? 0;
    unreadReplies = (repliedRows ?? []).length;
  }

  // Registry searches due (0162): every adult who isn't a volunteer with no
  // current search, the same people as the queue on Background Checks. For
  // holders of the background-checks grant, who are the ones who can do it.
  // Since 14 Nov 2026 (Fable badge review): what staff can do now, the same
  // number as the page's top line (lib/backgroundCheckWork.js).
  if (staff && can(staff, 'background_checks')) {
    try {
      registrySearchesDue = (
        await backgroundCheckWork(supabase, { sandbox: volunteerBadgeMode() === 'test', today: todayInMorristown() })
      ).total;
    } catch (err) {
      console.error('background check badge:', err.message);
    }
  }

  // Campers who asked for a one-to-one buddy and still have nobody. Asked for
  // 25 Aug: the count existed only as a grey line ON the buddy page, so the
  // one number that says whether camp is ready was invisible from everywhere
  // else. Amber, and it reaches zero when the work is done.
  //
  // Two reads rather than a join: buddy_assignments is keyed by camper
  // participant, and the open ones are the rows with no end date. Scoped to
  // events that have not finished, so last year's camp cannot hold the badge
  // above zero for ever.
  if (staff && can(staff, 'read:buddies')) {
    const today = new Date().toISOString().slice(0, 10);
    // Counts everybody the Buddies board shows, which after 0066 is every
    // camper EXCEPT those a coordinator has explicitly excused.
    //
    // Two things had to change together. The filter was `= true`, which now
    // misses the undecided; and the join was person_support!inner, which
    // dropped anybody with no support row at all — the most undecided people
    // there are. A badge that silently omits the people nobody has looked at
    // is worse than no badge, because it reads as "this queue is short".
    //
    // Done as two lookups and a filter in JS rather than one clever query: "is
    // not false, INCLUDING where the row is absent" is not a thing PostgREST
    // expresses well, and this runs over one camp, not a population.
    const [{ data: liveParts, error: livePartsError }, { data: paired, error: pairedError }] = await Promise.all([
      supabase
        .from('registration_participants')
        .select('id, person_id, camp_role, registrations!inner ( events!inner ( ends_on, event_type, archived_at ) )')
        .neq('status', 'cancelled')
        .is('registrations.events.archived_at', null)
        // The same people the board lists (ruling 29 Sep 2026, §17.1):
        // campers and siblings. This badge still excluded only volunteers,
        // so every parent, guardian and caregiver counted as "without a
        // buddy" and the nav said 19 while the two boards said 4 and 7
        // (Lawrence, 15 Oct 2026).
        .in('camp_role', ['camper', 'sibling'])
        .gte('registrations.events.ends_on', today)
        // Camps only: other events pair buddies on arrival (2-3 Oct 2026).
        .in('registrations.events.event_type', STAFF_ASSIGNED_TYPES),
      supabase.from('buddy_assignments').select('camper_participant_id').is('ended_at', null),
    ]);

    const personIds = [...new Set((liveParts ?? []).map((p) => p.person_id).filter(Boolean))];
    const { data: supportRows, error: supportError } = personIds.length
      ? await supabase.from('person_support').select('person_id, buddy_required').in('person_id', personIds)
      : { data: [] };
    // No badge rather than a wrong one: a failed read of the pairs or the
    // excusals would count campers who are paired or excused.
    const buddyError = livePartsError ?? pairedError ?? supportError;
    if (buddyError) {
      console.error('buddy badge:', buddyError.message);
    } else {
      // Only an explicit false excuses somebody. Absent row, or null, still counts.
      const excused = new Set((supportRows ?? []).filter((r) => r.buddy_required === false).map((r) => r.person_id));
      const hasBuddy = new Set((paired ?? []).map((b) => b.camper_participant_id));
      campersWithoutBuddy = (liveParts ?? []).filter((p) => !excused.has(p.person_id) && !hasBuddy.has(p.id)).length;
    }
  }

  // People on a roster for an event that has not finished, with no program
  // yet. A queue that drains: place them and it goes to zero, which is why it
  // is amber. Scoped to live events so last year's camp cannot hold it above
  // zero for ever -- the same trap the buddy badge had to avoid.
  let unplacedPeople = 0;
  if (staff && can(staff, 'read:programs')) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: unplaced, error } = await supabase
      .from('registration_participants')
      .select('id, registrations!inner ( events!inner ( ends_on, event_type ) )')
      .is('program_id', null)
      .neq('status', 'cancelled')
      .gte('registrations.events.ends_on', today)
      // Camps only: other events have no programs to place people in (2-3 Oct 2026).
      .in('registrations.events.event_type', STAFF_ASSIGNED_TYPES);
    if (error) console.error('programs badge:', error.message);
    // A buddy in a live pairing goes with their camper (14 Nov 2026), so is
    // never waiting to be placed.
    const ids = (unplaced ?? []).map((r) => r.id);
    let following = new Set();
    if (ids.length) {
      const { data: pairs, error: pairsError } = await supabase
        .from('buddy_assignments')
        .select('buddy_participant_id')
        .in('buddy_participant_id', ids)
        .is('ended_at', null);
      if (pairsError) console.error('programs badge pairings:', pairsError.message);
      following = new Set((pairs ?? []).map((p) => p.buddy_participant_id));
    }
    unplacedPeople = ids.filter((id) => !following.has(id)).length;
  }

  // Outside-provider confirmations awaiting a staff check (0124), at current
  // events (Lawrence, 26 Oct 2026: Activities "not showing any indication of
  // this waiver waiting for review"). A queue that drains -- accept or reject
  // and it goes -- so amber, and only for those who can clear it
  // (Registration write). Families' missing and rejected uploads are theirs
  // to fix and stay on Awaiting Review's Waiver outstanding tab.
  let waiversToCheck = 0;
  if (staff && can(staff, 'write:registration')) {
    const { data: pendingRows, error } = await supabase
      .from('activity_waiver_uploads')
      .select('id, activities ( events ( starts_on, ends_on, archived_at ) )')
      .eq('review_status', 'pending');
    if (error) console.error('activities badge:', error.message);
    else waiversToCheck = (pendingRows ?? []).filter((r) => isCurrentEventRow(r.activities?.events)).length;
  }

  return {
    badges: {
      // Overview carries no badge: it was the same number as Awaiting
      // review's, twice in a row (Lawrence, 15 Oct 2026).
      '/admin/review': awaitingReview,
      '/admin/changes': unreviewedChanges,
      '/admin/volunteers': volunteersAwaiting,
      '/admin/accounts': recentAccounts,
      '/admin/cancellations': openCancellations,
      '/admin/deletion-requests': openDeletions,
      '/admin/scholarships': openScholarships,
      '/admin/buddies': campersWithoutBuddy,
      '/admin/payments': recentPayments,
      '/admin/programs': unplacedPeople,
      '/admin/activities': waiversToCheck,
      '/admin/my-program': myProgramCount,
      '/admin/background-checks': registrySearchesDue,
    },
    mailBadges: { '/admin/review': unreadReplies },
    // On Background Checks since 23 Nov 2026 (it was on Volunteers,
    // Lawrence 15 Oct): that is where the background check is sent and
    // recorded. Volunteers still says how many on its own tile.
    redBadges: { '/admin/background-checks': volunteersMissingCheck },
  };
});
