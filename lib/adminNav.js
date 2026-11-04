// The staff sidebar's pages and the grant each needs, in sidebar order
// (moved out of app/admin/layout.jsx on 4 Nov 2026 so the Overview can send a
// staffer without Registration read to the first page they can open).
// `need` is a can() key (lib/staff.js).

export const ADMIN_NAV = [
  // Registration read (Lawrence, 4 Nov 2026: a prayer-team login does not
  // need it): the Overview is registration numbers. Staff without it land on
  // the first page here they can open (app/admin/page.jsx).
  { href: '/admin', label: 'Overview', need: 'read:registration', ready: true },
  // The review queue as its own page (14 Oct 2026): every family with
  // somebody still "submitted", with the deposit / scholarship state and
  // every flag in one row. The Overview's amber number links here.
  { href: '/admin/review', label: 'Awaiting Review', need: 'read:registration', ready: true },
  { href: '/admin/rosters', label: 'Roster: Campers & Families', need: 'read:registration', ready: true, group: 'events' },
  { href: '/admin/checkin', label: 'Check-In', need: 'read:registration', ready: true, group: 'events' },
  { href: '/admin/changes', label: 'Recent Changes', need: 'read:registration', ready: true, group: 'events' },
  // Staff-pressed email to the families of an event or an activity (22 Oct
  // 2026): Registration write, because it speaks to families for the ministry.
  { href: '/admin/email-families', label: 'Email Registrants', need: 'write:registration', ready: true, group: 'events' },
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
