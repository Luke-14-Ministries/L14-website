// Who, on staff, is the current viewer? Server-only.
//
// Reads the caller's own row from public.staff. The staff_select policy in
// 0001_core_schema.sql lets a signed-in user read their own staff row, so this
// needs no elevated access. Returns null for anyone who is not active staff.
//
// Access model since 0101 (16-17 Oct 2026; Luke14-Access-Model-Plan;
// lib/grants.js): a staff member holds read/write GRANTS on ten areas --
// registration, payments, giving, background_checks, sensitive, setup,
// activities, rooming, buddies, programs -- set by presets on Staff & Access
// and logged. can(staff, 'read:payments') / can(staff, 'write:buddies') read
// them; the database's policies ask has_grant() for the same areas. The
// role column now says one thing: 'admin' (can(staff, 'admin')) -- granting,
// accounts, naming a leader, the doctor's dated grant. 'registrar' and
// 'coordinator' are labels. These checks MIRROR row-level security; RLS is
// the real backstop, so a page that forgets a check still cannot read data
// it shouldn't.

import { redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { getProgramLeadership } from '@/lib/programs';

export async function getStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('staff')
    .select('role, can_view_sensitive, can_view_giving, can_view_background_checks, title, active')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!data || !data.active) return null;
  // The grants (0100): area -> 'read' | 'write'. The staff_grants_read policy
  // lets a person read their own rows.
  const { data: grantRows } = await supabase
    .from('staff_grants')
    .select('area, level')
    .eq('profile_id', user.id);
  const grants = {};
  for (const g of grantRows ?? []) grants[g.area] = g.level;
  // Two-factor, checked the way the database checks it (0104/0105): a session
  // that entered a code, or one registered from a remembered browser. A weak
  // session keeps `staff` (so the layout can send them to set up or enter a
  // code) but can() refuses every area -- exports and server actions do not
  // run the layout, so this is where they are stopped.
  const { data: strong } = await supabase.rpc('session_is_strong');
  return { ...data, grants, strong: strong === true, userId: user.id, email: user.email };
}

export function can(staff, need) {
  if (!staff) return false;
  if (staff.strong === false && need !== 'staff') return false;
  // Checked before the split below: 'decide:scholarships' contains a colon and
  // would otherwise be read as level "decide" of an area "scholarships" and
  // refused -- which blocked every administrator from scholarships, hand-set
  // discounts and deposit waivers (Testing Script 5 13.4, 18 Oct 2026).
  if (need === 'decide:scholarships') {
    // 0102: deciding a scholarship (or a hand-set discount, or waiving a
    // deposit) is a family act -- Payments write AND Registration write.
    // Finance (payments W, registration R) records money but does not decide.
    return can(staff, 'write:payments') && can(staff, 'write:registration');
  }
  // 'read:<area>' / 'write:<area>' (0100, enforced since 0101). Read is
  // satisfied by read or write. The areas are lib/grants.js.
  if (typeof need === 'string' && need.includes(':')) {
    const [level, area] = need.split(':');
    const g = staff.grants?.[area];
    if (level === 'read') return Boolean(g);
    if (level === 'write') return g === 'write';
    return false;
  }
  switch (need) {
    case 'staff':
      return true;
    case 'admin':
      // The one thing the role still says (0101): granting, accounts, naming
      // a leader, the doctor's dated grant. Presets set it.
      return staff.role === 'admin';
    // The three old tick boxes, as the grants they became. Kept as names so
    // the pages that ask for them read as before.
    case 'sensitive':
      return can(staff, 'read:sensitive');
    case 'giving':
      return can(staff, 'read:giving');
    case 'background_checks':
      // The table and its log are the administrator's; the three facts are
      // the clearance_status view, which every staff member reads.
      return can(staff, 'write:background_checks');
    default:
      // 'registrar', 'coordinator' and 'door' retired with 0101. A page that
      // still asks is a bug to fix, not a door to open.
      return false;
  }
}

// WHERE A NON-STAFF VISITOR TO A STAFF PAGE GOES.
//
// Every /admin page starts with `if (!staff) redirect(...)`. Until 29 Sep 2026
// the target was always `/account/?next=<this page>`, which is right for a
// family member who wandered in -- log in, come back. It was wrong for a
// PROGRAM LEADER: the layout admits leaders (migration 0061), the page then
// throws them to /account/, /account/ sees a signed-in person and sends them
// back to ?next=, and the browser gives up with ERR_TOO_MANY_REDIRECTS. Found
// by Testing Script 3 §6.2/§7.1: a leader who typed /admin got an error page
// instead of their own roster. No staff content leaked; it was a loop, not a
// hole. A leader now lands on My Program; everyone else still goes to log in.
export async function bounceNonStaff(nextPath) {
  const leaderships = await getProgramLeadership();
  if (leaderships.length > 0) redirect('/admin/my-program/');
  // Signed in but neither staff nor leader: the dashboard, never the login
  // page (which would send them straight back here -- see app/admin/layout).
  const user = await getCurrentUser();
  redirect(user ? '/account/dashboard/' : `/account/?next=${nextPath}`);
}

// Staff change their password once a year (Lawrence, 18 Oct 2026; 0104).
// A missing date is not stale: the clock started when the column was added.
export function passwordIsStale(changedAtIso, now = Date.now()) {
  if (!changedAtIso) return false;
  const t = Date.parse(changedAtIso);
  return Number.isFinite(t) && now - t > 365 * 24 * 60 * 60 * 1000;
}
