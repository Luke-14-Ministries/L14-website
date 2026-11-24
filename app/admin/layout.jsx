import Link from 'next/link';
import { ADMIN_NAV as NAV, SECTIONS, TOP } from '@/lib/adminNav';
import { redirect } from 'next/navigation';
import { passwordIsStale, can } from '@/lib/staff';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import AdminNav from './AdminNav';
import AdminSearch from './AdminSearch';
import {
  loadAdminBadges,
  currentStaff,
  currentLeadership,
  BADGE_TITLES,
  RED_BADGE_TITLES,
} from '@/lib/adminBadges';

export const metadata = { title: 'Staff Admin' };

// A plain-language description of what each role can do, shown in the header so
// a staff member always knows which "hat" they are wearing and what it grants.
const ROLE_INFO = {
  admin: {
    label: 'Administrator',
    // One plain sentence (23 Nov 2026 review); the list of areas it named
    // was the whole sidebar again.
    blurb: 'You can open everything and change who has access.',
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

// The sidebar's pages, sections and order are lib/adminNav.js (ADMIN_NAV,
// SECTIONS, TOP; moved there 23 Nov 2026).

export default async function AdminLayout({ children }) {
  // The cached readers (lib/adminBadges.js): the badges below ask the same
  // questions, and cache() answers them once per request.
  const [staff, leaderships] = await Promise.all([currentStaff(), currentLeadership()]);

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

  // Every number on the sidebar, counted in lib/adminBadges.js (moved out
  // of this file on 23 Nov 2026 so the Overview's "Waiting on staff" card
  // shows the same numbers; cache() counts them once per request).
  const { badges, mailBadges, redBadges } = await loadAdminBadges();

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
          {/* A <p>, not an <h1> (23 Nov 2026 review): the page's own heading
              is what the page is about; the signed-in name is context. */}
          <p className="text-2xl font-bold font-heading">{fullName}</p>
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
          {/* Hidden on a phone (23 Nov 2026 review): it pushed the page's
              own content a screen down, and the role pill above says it. */}
          <p className="hidden sm:block text-xs text-neutral-500 mt-1.5">
            {isLeaderOnly
              ? `You lead ${leaderships
                  .map((l) => l.programName)
                  .join(', ')}. You can see who is in your program and nothing else.`
              : (ROLE_INFO[staff.role] ?? {}).blurb ?? 'Staff access.'}
            {staff?.grants?.sensitive ? ' You can also see medical and support details.' : ''}
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
          <div className="flex w-full shrink-0 flex-col items-stretch gap-3 sm:w-auto sm:items-end">
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Link href="/account/dashboard/" className="btn-outline btn-sm">
                My Dashboard
              </Link>
              <form action="/auth/signout/" method="post">
                <button type="submit" className="btn-outline btn-sm">
                  Log Out
                </button>
              </form>
            </div>
            {/* Find a person or family from any staff page (14 Oct 2026).
                AdminSearch leaves it off /admin/search, which has its own
                box (23 Nov 2026 review: two search boxes on one page). */}
            {staff && can(staff, 'read:registration') && <AdminSearch />}
          </div>
        </div>

        {/* 240px, not 220 (23 Nov 2026): "Background Checks" with its amber
            and red numbers fits on one line. */}
        <div className="grid gap-6 lg:grid-cols-[240px_1fr] print:block">
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
            badges={badges}
            // [one, many]: AdminNav picks by the count.
            badgeTitles={BADGE_TITLES}
            // The colour key is staff vocabulary ("waiting on staff",
            // background checks); a leader sees one blue number (26 Oct 2026).
            showLegend={!isLeaderOnly}
            mailBadges={mailBadges}
            redBadges={redBadges}
            redBadgeTitles={RED_BADGE_TITLES}
            />
          </div>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
