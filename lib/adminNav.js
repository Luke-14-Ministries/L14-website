// The staff sidebar: its pages, the grant each needs, and the sections they
// sit in. ADMIN_NAV moved out of app/admin/layout.jsx on 4 Nov 2026 so the
// Overview can send a staffer without Registration read to the first page
// they can open; SECTIONS and TOP followed on 23 Nov 2026, so the order
// lives in one file. `need` is a can() key (lib/staff.js).
//
// ADMIN_NAV is in sidebar order, because the Overview's "first page they can
// open" walks it top to bottom: keep it in the same order as SECTIONS.

export const ADMIN_NAV = [
  // Registration read (Lawrence, 4 Nov 2026: a prayer-team login does not
  // need it): the Overview is registration numbers. Staff without it land on
  // the first page here they can open (app/admin/page.jsx).
  { href: '/admin', label: 'Overview', need: 'read:registration', ready: true },
  // The review queue as its own page (14 Oct 2026): every family with
  // somebody still "submitted", with the deposit / scholarship state and
  // every flag in one row. The Overview's amber number links here.
  { href: '/admin/review', label: 'Awaiting Review', need: 'read:registration', ready: true },

  // Registration.
  // One name per page in the sidebar, the heading and the browser title
  // (23 Nov 2026 review): "Roster: Campers & Families" was "Rosters" on the
  // page itself.
  { href: '/admin/rosters', label: 'Rosters', need: 'read:registration', ready: true },
  { href: '/admin/volunteers', label: 'Volunteers', need: 'read:registration', ready: true },
  // Its own item since 11 Nov 2026 (it was under Volunteers from 9 Nov):
  // every adult's background check, the VolunteerBadge invites (Send
  // Background Check Invites, /admin/background-checks/screening/), the
  // registry searches for everyone else, and how long a check lasts. Its own
  // address since 13 Nov 2026 (it was /admin/volunteers/background-checks/;
  // next.config.mjs redirects the old addresses).
  { href: '/admin/background-checks', label: 'Background Checks', need: 'background_checks', ready: true },
  // "Recent Changes" until 23 Nov 2026: since 15 Nov it lists only changes
  // made after approval, waiting to be marked reviewed, so it is a queue.
  { href: '/admin/changes', label: 'Changes to Review', need: 'read:registration', ready: true },
  { href: '/admin/cancellations', label: 'Cancellations', need: 'read:registration', ready: true },

  // Money. Scholarship requests sit here because a scholarship decision is a
  // money decision.
  { href: '/admin/payments', label: 'Event Payments', need: 'read:payments', ready: true },
  { href: '/admin/scholarships', label: 'Scholarship Requests', need: 'read:payments', ready: true },
  { href: '/admin/giving', label: 'Giving', need: 'giving', ready: true },

  // Camp Planning: the placements made in the weeks before camp.
  // Registrar rather than coordinator, deliberately: the write goes through
  // registration_participants' UPDATE policy, which is is_registrar(). A
  // coordinator offered this page would find Save did nothing and say
  // nothing, which is the failure this project keeps meeting.
  // "Program Groups", not "Programs" (23 Nov 2026), so it is not confused
  // with the public site's Programs menu in the header above it.
  { href: '/admin/programs', label: 'Program Groups', need: 'read:programs', ready: true },
  { href: '/admin/buddies', label: 'Buddy Assignments', need: 'read:buddies', ready: true },
  { href: '/admin/lodging', label: 'Rooms & Cabins', need: 'read:rooming', ready: true },
  { href: '/admin/activities', label: 'Activities', need: 'read:activities', ready: true },

  // Camp Week: what is open on the table at camp.
  { href: '/admin/checkin', label: 'Check-In', need: 'read:registration', ready: true },
  { href: '/admin/medical', label: 'Medical & Support', need: 'sensitive', ready: true },
  { href: '/admin/dietary', label: 'Dietary & Allergies', need: 'sensitive', ready: true },

  // Communication.
  // Staff-pressed email to the families of an event or an activity (22 Oct
  // 2026): Registration write, because it speaks to families for the
  // ministry. "Email Families" (23 Nov 2026, was "Email Registrants"): the
  // route's word, and one email goes to each household.
  { href: '/admin/email-families', label: 'Email Families', need: 'write:registration', ready: true },
  // The newsletter list (14 Oct 2026): who has news & updates on, who joined
  // or left lately, and a CSV. Sending stays in Resend for now.
  { href: '/admin/newsletter', label: 'Newsletter', need: 'read:registration', ready: true },
  // The prayer list (0141, 28 Oct 2026): who is on it, and the prayer team's
  // emails to it.
  { href: '/admin/prayer', label: 'Prayer List', need: 'read:prayer', ready: true },

  // Admin.
  { href: '/admin/setup', label: 'Setup & Manage Events', need: 'write:setup', ready: true },
  // Accounts subsumes the old Two-Factor Resets page: the same reset lives in
  // each row's menu, without typing an email address. /admin/security still
  // works by URL as a fallback if the table itself is ever the thing broken.
  { href: '/admin/accounts', label: 'Accounts', need: 'admin', ready: true },
  { href: '/admin/staff', label: 'Staff & Access', need: 'admin', ready: true },
  // Last: rare, and a request to remove a family's records, not daily work.
  { href: '/admin/deletion-requests', label: 'Deletion Requests', need: 'read:registration', ready: true },
];

// Above every section: the Overview and the review queue.
export const TOP = ['/admin', '/admin/review'];

// The sidebar in sections, in the order a season's work comes (23 Nov 2026
// review; Lawrence set the first sections on 14 Oct): registration, the
// money, planning the week, the week itself, then writing to people and the
// admin pages. An item in no section (a leader's My Program) shows on its
// own after TOP. Order inside a section is this list's.
//
// `collapsible` sections fold, each remembering open or closed in this
// browser under its own `storeKey` (AdminNav.jsx). Camp Week keeps the key it
// has had since August, so nobody's saved choice is lost.
export const SECTIONS = [
  // Search is the box in the header, not a sidebar item (Lawrence, 15 Oct
  // 2026); /admin/search is only where a search lands.
  {
    key: 'registration',
    label: 'Registration',
    hrefs: ['/admin/rosters', '/admin/volunteers', '/admin/background-checks', '/admin/changes', '/admin/cancellations'],
  },
  { key: 'money', label: 'Money', hrefs: ['/admin/payments', '/admin/scholarships', '/admin/giving'] },
  {
    key: 'planning',
    label: 'Camp Planning',
    collapsible: true,
    storeKey: 'l14_admin_nav_planning_open',
    hrefs: ['/admin/programs', '/admin/buddies', '/admin/lodging', '/admin/activities'],
  },
  {
    key: 'camp',
    label: 'Camp Week',
    collapsible: true,
    storeKey: 'l14_admin_nav_events_open',
    hrefs: ['/admin/checkin', '/admin/medical', '/admin/dietary'],
  },
  // Everything that writes to people outside (Lawrence, 28 Oct 2026): the
  // emails to registered families, the newsletter list, the prayer list. A
  // prayer-team login with only the Prayer list grant sees this one section.
  { key: 'communication', label: 'Communication', hrefs: ['/admin/email-families', '/admin/newsletter', '/admin/prayer'] },
  { key: 'admin', label: 'Admin', hrefs: ['/admin/setup', '/admin/accounts', '/admin/staff', '/admin/deletion-requests'] },
];
