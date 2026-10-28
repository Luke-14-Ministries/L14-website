import Link from 'next/link';
import { redirect } from 'next/navigation';
import { passwordIsStale, getStaff, can } from '@/lib/staff';
import { getProgramLeadership } from '@/lib/programs';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { sinceISO, STAFF_ASSIGNED_TYPES, isCurrentEventRow } from '@/lib/events';
import { isMinor } from '@/lib/format';
import AdminNav from './AdminNav';

export const metadata = { title: 'Staff Admin — Luke 14 Ministries' };

// The full planned admin structure, gated by role. `ready: false` items show as
// greyed placeholders so the shape of the system (and the access model) is visible
// while the pages get built one at a time.
// A plain-language description of what each role can do, shown in the header so
// a staff member always knows which "hat" they are wearing and what it grants.
const ROLE_INFO = {
  admin: {
    label: 'Administrator',
    blurb:
      'Full access — registrations, rosters, settings, accounts, and two-factor resets; can grant or revoke any staff role, administrator included.',
  },
  registrar: {
    label: 'Registrar',
    blurb: 'What you can open is set by your grants on Staff & Access.',
  },
  coordinator: {
    label: 'Coordinator',
    blurb: 'What you can open is set by your grants on Staff & Access.',
  },
};

// group: 'events' items live inside the collapsible "Events" section of the
// sidebar; ungrouped items render at the top (before) or bottom (after) level.
const NAV = [
  { href: '/admin', label: 'Overview', need: 'staff', ready: true },
  // The review queue as its own page (14 Oct 2026): every family with
  // somebody still "submitted", with the deposit / scholarship state and
  // every flag in one row. The Overview's amber number links here.
  { href: '/admin/review', label: 'Awaiting Review', need: 'read:registration', ready: true },
  { href: '/admin/rosters', label: 'Roster: Campers & Families', need: 'read:registration', ready: true, group: 'events' },
  { href: '/admin/checkin', label: 'Check-In', need: 'read:registration', ready: true, group: 'events' },
  { href: '/admin/changes', label: 'Recent Changes', need: 'read:registration', ready: true, group: 'events' },
  // Staff-pressed email to the families of an event or an activity (22 Oct
  // 2026): Registration write, because it speaks to families for the ministry.
  { href: '/admin/email-families', label: 'Email Families', need: 'write:registration', ready: true, group: 'events' },
  { href: '/admin/dietary', label: 'Dietary & Allergies', need: 'sensitive', ready: true, group: 'events' },
  { href: '/admin/medical', label: 'Medical & Support', need: 'sensitive', ready: true, group: 'events' },
  { href: '/admin/volunteers', label: 'Volunteers', need: 'read:registration', ready: true, group: 'events' },
  { href: '/admin/activities', label: 'Activities', need: 'read:activities', ready: true, group: 'events' },
  { href: '/admin/buddies', label: 'Buddy Assignments', need: 'read:buddies', ready: true, group: 'events' },
  { href: '/admin/lodging', label: 'Rooms & Cabins', need: 'read:rooming', ready: true, group: 'events' },
  // Registrar rather than coordinator, deliberately: the write goes through
  // registration_participants' UPDATE policy, which is is_registrar(). A
  // coordinator offered this page would find Save did nothing and say
  // nothing, which is the failure this project keeps meeting.
  { href: '/admin/programs', label: 'Programs', need: 'read:programs', ready: true, group: 'events' },
  { href: '/admin/cancellations', label: 'Cancellations', need: 'read:registration', ready: true, group: 'events' },
  { href: '/admin/deletion-requests', label: 'Deletion Requests', need: 'read:registration', ready: true, group: 'events' },
  // "Scholarship Requests" wrapped to two lines, dropping its badge onto a
  // line of its own (25 Aug). Shortened to match its neighbours — Rosters,
  // Volunteers, Cancellations are all one word. The page keeps its full title.
  { href: '/admin/scholarships', label: 'Scholarship Requests', need: 'read:payments', ready: true, group: 'events' },
  { href: '/admin/payments', label: 'Event Payments', need: 'read:payments', ready: true, group: 'events' },
  { href: '/admin/giving', label: 'Giving', need: 'giving', ready: true },
  // The newsletter list (14 Oct 2026): who has news & updates on, who joined
  // or left lately, and a CSV. Sending stays in Resend for now.
  { href: '/admin/newsletter', label: 'Newsletter', need: 'read:registration', ready: true },
  // The prayer list (0141, 28 Oct 2026): who is on it, and the prayer team's
  // emails to it.
  { href: '/admin/prayer', label: 'Prayer List', need: 'read:prayer', ready: true },
  { href: '/admin/setup', label: 'Setup & Manage Events', need: 'write:setup', ready: true },
  // Accounts subsumes the old Two-Factor Resets page: the same reset lives in
  // each row's menu, without typing an email address. /admin/security still
  // works by URL as a fallback if the table itself is ever the thing broken.
  { href: '/admin/accounts', label: 'Accounts', need: 'admin', ready: true },
  { href: '/admin/staff', label: 'Staff & Access', need: 'admin', ready: true },
];

// The sidebar in sections (Lawrence, 14 Oct 2026, reviewing the hierarchy):
// the two queues at the top, then People, the camp-week tools (the one
// collapsible group), requests, money, communication and the admin pages. Scholarship
// requests sit under Event Payments because a scholarship decision is a money
// decision. An item that appears in no section (a leader's My Program) is
// shown on its own after the top two. Order inside a section is this list's.
const SECTIONS = [
  // Search is the box in the header, not a sidebar item (Lawrence, 15 Oct
  // 2026); /admin/search is only where a search lands.
  { key: 'people', label: 'People', hrefs: ['/admin/rosters', '/admin/volunteers', '/admin/changes'] },
  {
    key: 'camp',
    label: 'Camp Week',
    collapsible: true,
    hrefs: ['/admin/checkin', '/admin/dietary', '/admin/medical', '/admin/activities', '/admin/buddies', '/admin/lodging', '/admin/programs'],
  },
  { key: 'requests', label: 'Requests', hrefs: ['/admin/cancellations', '/admin/deletion-requests'] },
  { key: 'money', label: 'Money', hrefs: ['/admin/payments', '/admin/scholarships', '/admin/giving'] },
  // Everything that writes to people outside (Lawrence, 28 Oct 2026): the
  // emails to registered families, the newsletter list, the prayer list. A
  // prayer-team login with only the Prayer list grant sees this one section.
  { key: 'communication', label: 'Communication', hrefs: ['/admin/email-families', '/admin/newsletter', '/admin/prayer'] },
  { key: 'admin', label: 'Admin', hrefs: ['/admin/setup', '/admin/accounts', '/admin/staff'] },
];
const TOP = ['/admin', '/admin/review'];

export default async function AdminLayout({ children }) {
  const [staff, leaderships] = await Promise.all([getStaff(), getProgramLeadership()]);

  // TWO KINDS OF PERSON REACH THIS LAYOUT.
  //
  // Staff, who get the sidebar their role earns. And program leaders, who are
  // not staff at all -- no row in `staff`, no role, no permissions -- but hold
  // a grant naming one program at one event (migration 0061). A leader gets
  // into the staff area because that is where a roster sensibly lives, and
  // sees exactly one item in the navigation: their own program.
  //
  // Order matters below: a person who is BOTH staff and a named leader is
  // treated as staff, because the wider view already contains the narrower one.
  const isLeaderOnly = !staff && leaderships.length > 0;
  if (!staff && !isLeaderOnly) {
    // Logged out: go and log in, then come back. Logged IN but neither staff
    // nor a leader -- an ordinary family account that typed /admin, or a
    // leader whose grant was just removed -- must NOT be sent to the login
    // page: /account/ sends a signed-in person straight to ?next=, which is
    // this layout again, and the browser gives up (ERR_TOO_MANY_REDIRECTS;
    // Testing Script 3 §7.5, 29 Sep 2026). They go to their own dashboard.
    const user = await getCurrentUser();
    // ?noaccess=1 makes the dashboard say why they landed there (Script 6
    // 13.5): someone who thinks they should have access is told whom to ask.
    redirect(user ? '/account/dashboard/?noaccess=1' : '/account/?next=/admin/');
  }

  // Staff must have two-factor turned on before they can open the staff area,
  // because everything in here is other families' information. The check asks
  // the auth server for the live factor list; anything without a verified
  // factor is sent to set one up. This is an enrolment gate, not a per-visit
  // challenge -- the login form is what asks for the code each time a staffer
  // with a factor signs in.
  //
  // It used to read getAuthenticatorAssuranceLevel().nextLevel instead, and
  // that is answered from the session COOKIE's copy of the user, which is only
  // refreshed when the access token is (up to an hour). Lawrence, 8 September:
  // turned two-factor off, saw the "must turn it back on" banner, then walked
  // straight into the staff area, because the cookie still listed the factor
  // he had just removed. listFactors() is a server round-trip and cannot be
  // stale; the extra request on each staff page is the price of a gate that
  // holds.
  //
  // Program leaders are held to the SAME rule, and that is a decision rather
  // than an accident: what they can see is a list of disabled children's first
  // names, and a password alone is not enough of a door in front of that. It
  // does mean a volunteer leader has to set up an authenticator app before
  // their roster works, which is real friction at camp. If that proves too
  // much, this is the one line to revisit -- but revisit it deliberately.
  const supabase = await createClient();
  const { data: factorList, error: factorError } = await supabase.auth.mfa.listFactors();
  const hasVerifiedFactor = (factorList?.totp ?? []).some((f) => f.status === 'verified');
  // If the auth server cannot be asked, fail closed: the gate exists to keep
  // other families' data behind a second factor, so an unknown answer is "no".
  if (factorError || !hasVerifiedFactor) {
    redirect('/account/security?required=1');
  }

  // Staff change their password once a year (Lawrence, 18 Oct 2026). The date
  // is stamped when a password is set (0104); the clock started that day.
  if (staff) {
    const { data: pw, error: pwError } = await supabase
      .from('profiles')
      .select('password_changed_at')
      .eq('id', staff.userId)
      .maybeSingle();
    // Logged, not thrown: a throw in the layout would take down every admin
    // page. The check runs again on the next page load.
    if (pwError) console.error('annual password check:', pwError.message);
    if (passwordIsStale(pw?.password_changed_at)) {
      redirect('/account/reset-password/?reason=annual');
    }
  }

  // The person's own name, so the header shows clearly WHO is signed in --
  // not just their role and email.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = staff?.userId ?? user?.id ?? null;
  const viewerEmail = staff?.email ?? user?.email ?? '';

  const { data: profile, error: profileError } = viewerId
    ? await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', viewerId)
        .maybeSingle()
    : { data: null };
  // The header falls back to the email below; not worth every admin page.
  if (profileError) console.error('admin header name:', profileError.message);
  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    viewerEmail;

  // A leader's whole navigation. Not NAV filtered down -- built separately, so
  // that adding a page to NAV can never accidentally hand it to a leader.
  //
  // Staff who ALSO hold a current leadership get My Program too (Lawrence,
  // 26 Oct 2026), as an item of its own after the top two, from the same
  // getProgramLeadership() result read above. Staff who lead nothing see no
  // change.
  const myProgramItem = { href: '/admin/my-program', label: 'My Program', ready: true };
  const items = isLeaderOnly
    ? [myProgramItem]
    : [...NAV.filter((n) => can(staff, n.need)), ...(leaderships.length > 0 ? [myProgramItem] : [])];

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

  // A small attention dot on "Recent Changes" when unreviewed family edits
  // exist. Count only -- cheap head query; RLS scopes what this staffer may
  // count (support-detail rows stay invisible without the sensitive grant).
  let unreviewedChanges = 0;
  let volunteersAwaiting = 0;
  let volunteersMissingCheck = 0;
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
    // Nav badges are logged, never thrown: a throw in the layout would take
    // down every admin page. A failed count shows no badge.
    if (nError) console.error('accounts badge:', nError.message);
    recentAccounts = n ?? 0;
  }
  if (staff && can(staff, 'read:registration')) {
    const paymentsSince = sinceISO(7);
    const [
      { count: changesCount, error: changesError },
      { count: volCount, error: volError },
      { count: payCount, error: payError },
      { count: cancelCount, error: cancelError },
      { count: scholCount, error: scholError },
      { count: reviewCount, error: reviewError },
      { data: repliedRows, error: repliedError },
    ] = await Promise.all([
        supabase
          .from('family_change_log')
          .select('id', { count: 'exact', head: true })
          .is('reviewed_at', null),
        // Applications sitting in "applied" — same treatment as Recent
        // Changes: a number on the nav whenever something needs review.
        supabase
          .from('volunteer_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'applied'),
        // Payment ACTIVITY, not a review queue (asked for 24 Aug). Nothing
        // here is waiting on a decision; the number answers "has money moved
        // since I last looked?", which is the question the payments page gets
        // opened for. Seven days, matching the Accounts badge, so the two
        // numbers on the nav mean the same span of time.
        supabase
          .from('payments')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', paymentsSince),
        // Families waiting to hear back about cancelling. A queue that
        // DRAINS when staff act, so it takes the amber treatment rather
        // than the blue rolling-window one.
        supabase
          .from('registration_cancellation_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open'),
        // Families waiting to hear whether the ministry can help with the
        // fee. Another draining queue, so amber again -- and the one with
        // the least excuse for sitting: a family who has said cost is the
        // problem is deciding whether to come at all.
        supabase
          .from('scholarships')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'requested'),
        // New sign-ups waiting to be confirmed or waitlisted -- the biggest
        // review queue in the ministry, and until now the only one with no
        // number on the nav. It lives on the Overview, which meant the one
        // page that could tell you there was work to do was the one page you
        // had to already be on. Asked for 25 Aug: "not obvious where new
        // registrations get reviewed."
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
          .select('id, registrations!inner ( awaiting_family_since )', { count: 'exact', head: true })
          .eq('status', 'submitted')
          .is('registrations.awaiting_family_since', null),
        // A family that replied in the app and nobody has read it yet (0126)
        // is waiting on staff too. A reply clears "waiting on the family",
        // so anyone still submitted is already in the count above; what this
        // adds is the registration with nobody submitted (everyone already
        // confirmed or waitlisted) -- one per registration, so the family is
        // counted once.
        supabase
          .from('registrations')
          .select('id, registration_participants ( status )')
          .eq('family_reply_unread', true)
          .is('awaiting_family_since', null),
      ]);
    // A failed count is logged and shows no badge (null counts as 0).
    if (changesError) console.error('changes badge:', changesError.message);
    if (volError) console.error('volunteers badge:', volError.message);
    if (payError) console.error('payments badge:', payError.message);
    if (cancelError) console.error('cancellations badge:', cancelError.message);
    if (scholError) console.error('scholarships badge:', scholError.message);
    if (reviewError) console.error('review badge:', reviewError.message);
    if (repliedError) console.error('review badge (family replies):', repliedError.message);
    unreviewedChanges = changesCount ?? 0;
    volunteersAwaiting = volCount ?? 0;

    // Volunteers on an event that has not finished, counted by PERSON, whose
    // background check is not on file, current and marked OK (0091). Read
    // through clearance_status, which every staff member may see, so the
    // number is the same whoever is looking (Lawrence, 15 Oct 2026).
    {
      const today = new Date().toISOString().slice(0, 10);
      const { data: volRows, error: volRowsError } = await supabase
        .from('registration_participants')
        .select('person_id, people ( date_of_birth ), registrations!inner ( events!inner ( ends_on ) )')
        .eq('camp_role', 'volunteer')
        .neq('status', 'cancelled')
        .gte('registrations.events.ends_on', today);
      if (volRowsError) console.error('background-check badge:', volRowsError.message);
      // Adults only: Checkr does not screen under-18s (Lawrence, 15 Oct 2026).
      const volIds = [
        ...new Set(
          (volRows ?? [])
            .filter((r) => r.person_id && !isMinor(r.people?.date_of_birth))
            .map((r) => r.person_id)
        ),
      ];
      if (volIds.length) {
        const { data: statusRows, error: statusError } = await supabase
          .from('clearance_status')
          .select('person_id, on_file, is_current, verdict')
          .in('person_id', volIds);
        // No badge rather than a wrong one: an empty read would count every
        // volunteer as missing a check.
        if (statusError) {
          console.error('background-check badge:', statusError.message);
        } else {
          const ok = new Set(
            (statusRows ?? []).filter((c) => c.on_file && c.is_current && c.verdict === 'ok').map((c) => c.person_id)
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
    openScholarships = scholCount ?? 0;
    awaitingReview = reviewCount ?? 0;
    unreadReplies = (repliedRows ?? []).length;
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
        .select(
          'id, person_id, camp_role, registrations!inner ( events!inner ( ends_on, event_type ) )'
        )
        .neq('status', 'cancelled')
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
      ? await supabase
          .from('person_support')
          .select('person_id, buddy_required')
          .in('person_id', personIds)
      : { data: [] };
    // No badge rather than a wrong one: a failed read of the pairs or the
    // excusals would count campers who are paired or excused.
    const buddyError = livePartsError ?? pairedError ?? supportError;
    if (buddyError) {
      console.error('buddy badge:', buddyError.message);
    } else {
      // Only an explicit false excuses somebody. Absent row, or null, still counts.
      const excused = new Set(
        (supportRows ?? []).filter((r) => r.buddy_required === false).map((r) => r.person_id)
      );

      const hasBuddy = new Set((paired ?? []).map((b) => b.camper_participant_id));
      campersWithoutBuddy = (liveParts ?? []).filter(
        (p) => !excused.has(p.person_id) && !hasBuddy.has(p.id)
      ).length;
    }
  }

  // People on a roster for an event that has not finished, with no program
  // yet. A queue that drains: place them and it goes to zero, which is why it
  // is amber. Scoped to live events so last year's camp cannot hold it above
  // zero for ever -- the same trap the buddy badge had to avoid.
  let unplacedPeople = 0;
  if (staff && can(staff, 'read:programs')) {
    const today = new Date().toISOString().slice(0, 10);
    const { count, error } = await supabase
      .from('registration_participants')
      .select('id, registrations!inner ( events!inner ( ends_on, event_type ) )', {
        count: 'exact',
        head: true,
      })
      .is('program_id', null)
      .neq('status', 'cancelled')
      .gte('registrations.events.ends_on', today)
      // Camps only: other events have no programs to place people in (2-3 Oct 2026).
      .in('registrations.events.event_type', STAFF_ASSIGNED_TYPES);
    if (error) console.error('programs badge:', error.message);
    unplacedPeople = count ?? 0;
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
    // Logged, never thrown: a failed count shows no badge.
    if (error) console.error('activities badge:', error.message);
    else waiversToCheck = (pendingRows ?? []).filter((r) => isCurrentEventRow(r.activities?.events)).length;
  }

  return (
    <section className="bg-neutral-50 min-h-[70vh] print:bg-white">
      {/* Wider than the public site's container on purpose (24 Aug). The
          admin was living inside the marketing pages' reading-width column,
          which is why the roster needed sideways scrolling on an ordinary
          laptop. Data tables get the screen they're on. */}
      <div className="mx-auto max-w-[1500px] px-4 sm:px-6 py-8 print:p-0 print:max-w-none">
        {/* Header, tidied 23 Aug. It previously said the person's name twice,
            repeated a "My Account" link the site nav already carries, and led
            with the ACCESS LEVEL as the headline. The dashboard leads with the
            person; this now matches -- name first, what they can do second,
            spelled out once each. */}
        {/* min-w-0 flex-1 on the text block is what keeps the buttons ON this
            row: without it the blurb's natural width pushed them to wrap
            underneath (seen in testing screenshots, 24 Aug). */}
        <div className="mb-6 print:hidden flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
          {/* A program leader is not staff (Lawrence, 26 Oct 2026: "STAFF
              ADMIN" above a leader's name). Their pill below already says
              Program Leader, so the eyebrow is simply left off for them. */}
          {!isLeaderOnly && (
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Staff Admin
            </p>
          )}
          <h1 className="text-2xl font-bold">{fullName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-brand-light text-brand-dark px-2.5 py-0.5 text-xs font-semibold">
              {/* Everyone with a program_leaders grant is a leader; the one
                  marked is_lead is the head leader (Lawrence, 26 Oct 2026 --
                  "lead" beside "Program Leader" read as two things). */}
              {isLeaderOnly
                ? leaderships.some((l) => l.isLead)
                  ? 'Program Leader · Head'
                  : 'Program Leader'
                : (ROLE_INFO[staff.role] ?? {}).label ?? staff.role}
            </span>
            {/* The pills follow the GRANTS (0100), not the old staff columns:
                a Sensitive grant removed by hand left can_view_sensitive
                true and the header still said so (Script 5, 18 Oct 2026). */}
            {staff?.grants?.sensitive && (
              <span className="rounded-full bg-neutral-200 text-neutral-700 px-2.5 py-0.5 text-xs font-semibold">
                Sensitive access
              </span>
            )}
            {staff?.grants?.giving && (
              <span className="rounded-full bg-neutral-200 text-neutral-700 px-2.5 py-0.5 text-xs font-semibold">
                Giving
              </span>
            )}
            {/* The third grant gets a pill like the other two (15 Oct 2026);
                it had none since 0058. */}
            {staff?.grants?.background_checks === 'write' && (
              <span className="rounded-full bg-neutral-200 text-neutral-700 px-2.5 py-0.5 text-xs font-semibold">
                Background checks
              </span>
            )}
            <span className="text-xs text-neutral-500">{viewerEmail}</span>
          </div>
          <p className="text-xs text-neutral-500 mt-1.5">
            {isLeaderOnly
              ? `You lead ${leaderships
                  .map((l) => l.programName)
                  .join(', ')} — you see who is in your program, and nothing else.`
              : (ROLE_INFO[staff.role] ?? {}).blurb ?? 'Staff access.'}
            {staff?.grants?.sensitive ? ' Plus medical & support details.' : ''}
          </p>
          </div>

          {/* Leaving should not require a detour. Staff previously had to open
              the family dashboard just to find a Log Out button, and the only
              route back to their own account was the site nav's "My Account".
              Both are one click from here now. Sign-out is a POST form, not a
              link — see app/auth/signout/route.js for why. */}
          {/* The account buttons on their own row, the search on its own row
              beneath (Lawrence, 27 Oct 2026: the search box read as one strip
              with My Dashboard and Log Out). */}
          <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Link href="/account/dashboard/" className="btn-outline py-1.5! text-sm">
                My Dashboard
              </Link>
              <form action="/auth/signout/" method="post">
                <button type="submit" className="btn-outline py-1.5! text-sm">
                  Log Out
                </button>
              </form>
            </div>
            {/* Find a person or family from any staff page (14 Oct 2026).
                A plain GET form: no script between typing and results. */}
            {staff && can(staff, 'read:registration') && (
              <form action="/admin/search/" method="get" className="flex items-center gap-1">
                <input
                  type="search"
                  name="q"
                  placeholder="Find a person or family"
                  aria-label="Search people and families"
                  className="w-80 max-w-full rounded-sm border border-neutral-300 bg-white px-3 py-1.5 text-sm"
                />
                <button type="submit" className="btn-outline py-1.5! text-sm">
                  Search
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[220px_1fr] print:block">
          <div className="print:hidden">
            <AdminNav
            top={TOP.map((h) => items.find((n) => n.href === h)).filter(Boolean)}
            sections={SECTIONS.map((sec) => ({
              ...sec,
              items: sec.hrefs.map((h) => items.find((n) => n.href === h)).filter(Boolean),
            })).filter((sec) => sec.items.length > 0)}
            loose={items.filter(
              (n) => !TOP.includes(n.href) && !SECTIONS.some((sec) => sec.hrefs.includes(n.href))
            )}
            badges={{
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
            }}
            badgeTitles={{
              // [one, many]: AdminNav picks by the count.
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
            }}
            // The colour key is staff vocabulary ("waiting on staff",
            // background checks); a leader sees one blue number (26 Oct 2026).
            showLegend={!isLeaderOnly}
            mailBadges={{ '/admin/review': unreadReplies }}
            redBadges={{ '/admin/volunteers': volunteersMissingCheck }}
            redBadgeTitles={{
              '/admin/volunteers': ['adult volunteer without a current background check marked OK', 'adult volunteers without a current background check marked OK'],
            }}
            />
          </div>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
