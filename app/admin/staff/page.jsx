import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import StaffManager from './StaffManager';

const SUMMARY =
  'flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden';

function Chevron() {
  return (
    <span aria-hidden="true" className="text-neutral-400 transition-transform group-open:rotate-180">
      &#9662;
    </span>
  );
}

export const metadata = { title: 'Staff & Access — Staff Admin' };

// Who is on staff, wearing which hat, holding which grants. Admin-only; the
// staff_write RLS policy is the real gate. One login, many hats: roles say what
// a person DOES, while sensitive/giving are separate need-to-know grants.
export default async function StaffAccessPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/staff/');
  if (!can(staff, 'admin')) redirect('/admin');

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('staff')
    .select(
      'profile_id, role, title, can_view_sensitive, can_view_giving, can_view_background_checks, active, profiles ( first_name, last_name )'
    )
        .order('active', { ascending: false })
    .order('role');

  // The login address, beside every name. Emails live in auth.users, which the
  // client may not read; admin_list_accounts (0023) is the admin-only function
  // the Accounts page already uses, and this page is admin-only too. Worth the
  // extra query because access follows the LOGIN, not the person: on 2 Sep 2026
  // a staff member appeared to have no admin access -- she had it, on a second
  // account, and nothing on this page said which address the row belonged to.
  // The grants (0100): every staff member's areas, for the panel under each row.
  const { data: grantRows } = await supabase.from('staff_grants').select('profile_id, area, level');
  const grantsById = new Map();
  for (const g of grantRows ?? []) {
    if (!grantsById.has(g.profile_id)) grantsById.set(g.profile_id, {});
    grantsById.get(g.profile_id)[g.area] = g.level;
  }

  const { data: accounts } = await supabase.rpc('admin_list_accounts');
    const emailById = new Map((accounts ?? []).map((a) => [a.user_id, a.email]));

  // The same list feeds the "add a staff member" picker, so an administrator
  // chooses an existing login rather than typing an address from memory --
  // mistyping is how a grant lands on the wrong (or no) account. Names help
  // when the address is not obvious; the staff flag marks who is already here.
  const pickable = (accounts ?? [])
    .filter((a) => a.email)
    .map((a) => ({
      email: a.email,
      name: [a.first_name, a.last_name].filter(Boolean).join(' ').trim(),
      onStaff: !!a.staff_role && a.staff_active !== false,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));

  const members = (rows ?? []).map((r) => ({
    profileId: r.profile_id,
    email: emailById.get(r.profile_id) ?? '',
    name:
      [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(' ').trim() ||
      '(no name on profile)',
    role: r.role,
    title: r.title ?? '',
    sensitive: r.can_view_sensitive === true,
    giving: r.can_view_giving === true,
    backgroundChecks: r.can_view_background_checks === true,
    active: r.active === true,
    grants: grantsById.get(r.profile_id) ?? {},
  }));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-bold mb-1">Staff &amp; Access</h2>
        {/* The log is only worth keeping if somebody can read it. */}
        <a href="/admin/staff/access-log" className="btn-outline !py-2 shrink-0">
          Access changes
        </a>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        Who can do what. Each person holds <span className="font-semibold">grants</span> on ten
        areas — read, write or nothing — set by a <span className="font-semibold">preset</span> in
        one click and adjusted underneath (the <em>Grants</em> button on each row). The role is a
        label, except that <em>Administrator</em> is what lets a person grant anything. One
        login, many hats: nobody needs a second account.
      </p>

      {/* Explanation cards are collapsed by default (Lawrence, 2 Oct 2026): the
          page is for doing, and the long explanations pushed the staff list below
          the fold. <details> needs no client JS and keeps the text one click away. */}
      <div className="mb-3 grid gap-3 sm:grid-cols-3 text-sm items-start">
        <details className="group rounded-lg bg-white border border-neutral-200 p-4">
          <summary className={SUMMARY}>
            <span className="font-bold">Registrar</span>
            <Chevron />
          </summary>
          <p className="text-neutral-600 mt-2">
            A label since 17 Oct 2026. What a registrar may do is their grants — typically the{' '}
            <em>Registration &amp; coordination</em> or <em>Finance</em> preset: families, money,
            rosters, check-in, tracked changes, exports.
          </p>
        </details>
        <details className="group rounded-lg bg-white border border-neutral-200 p-4">
          <summary className={SUMMARY}>
            <span className="font-bold">Coordinator</span>
            <Chevron />
          </summary>
          <p className="text-neutral-600 mt-2">
            A label since 17 Oct 2026. Typically the <em>Operations lead</em> or{' '}
            <em>Operations helper</em> preset: the door, activities, rooms and buddies; no money.
            The grants decide.
          </p>
        </details>
        <details className="group rounded-lg bg-white border border-neutral-200 p-4">
          <summary className={SUMMARY}>
            <span className="font-bold">Administrator</span>
            <Chevron />
          </summary>
          <p className="text-neutral-600 mt-2">
            The one role the database still reads: an administrator can add and remove staff,
            change anyone&rsquo;s grants and role, and <span className="font-semibold">grant or
            revoke administrator itself</span>. All administrators are equal (there is no
            &ldquo;super admin&rdquo;), and nobody can demote, deactivate, or remove
            themselves — that always takes another administrator, which is one reason to
            have two. Also: event setup, accounts, two-factor resets, and each event&rsquo;s
            medical contact. Sensitive and Giving are separate grants even for
            administrators — self-grantable, but deliberately not automatic. Keep this
            list short.
          </p>
        </details>
      </div>
      <details className="group mb-6 rounded-lg bg-white border border-neutral-200 p-4 text-sm">
        <summary className={SUMMARY}>
          <span className="font-bold">The ten areas, and the three that are never automatic</span>
          <Chevron />
        </summary>
        <p className="text-neutral-600 mt-2">
          <span className="font-semibold">Registration info</span>, <span className="font-semibold">Payments
          &amp; scholarships</span>, <span className="font-semibold">Events &amp; camp setup</span> (the
          definitions), and the four placements — <span className="font-semibold">Activities, Rooming,
          Buddies, Programs</span> (who is in what). Then the three that are need-to-know:{' '}
          <span className="font-semibold">Sensitive</span> — medical, dietary and support details
          (Dietary, Medical &amp; Support, red flags at check-in);{' '}
          <span className="font-semibold">Giving</span> — donor gift records, never set by a preset;{' '}
          <span className="font-semibold">Background checks</span> — read is the three facts everyone
          sees (on file, current, verdict); write — ordering, importing, the verdict — is the
          administrator&rsquo;s alone.
        </p>
        <p className="text-neutral-600 mt-2">
          <span className="font-semibold">Why Sensitive and Giving are not automatic, even for
          administrators:</span> nothing about running the platform requires seeing medical
          details or donor giving, and an administrator with the grant <em>off</em> has safe
          screens to project at check-in or share in a meeting — and keeps the list of people who
          can see that information short and nameable. The Administrator preset sets Sensitive;
          Giving is always a hand tick. Every change is in the access log.
        </p>
      </details>

      {/* The grants model (0100 recorded it, 0101 enforces it; 16-17 Oct 2026). */}
      <details className="group mb-6 rounded-lg bg-white border border-brand/40 p-4 text-sm">
        <summary className={SUMMARY}>
          <span className="font-bold">Grants by area — how access works since 17 Oct 2026</span>
          <Chevron />
        </summary>
        <p className="text-neutral-600 mt-2">
          Each person&rsquo;s <strong>Grants</strong> button opens ten areas, each <em>read</em>,{' '}
          <em>write</em> or nothing, with preset buttons (Administrator, Registration &amp;
          coordination, Finance, Operations lead, Operations helper) that set them in one click.
          The database&rsquo;s own security rules read these grants, so a tick here is the
          access, not a note about it. Giving is never set by a preset. Every change is in the
          access log. The plan is in SharePoint: <em>Luke14-Access-Model-Plan</em>.
        </p>
      </details>

      <StaffManager members={members} selfId={staff.userId} accounts={pickable} />
    </div>
  );
}
