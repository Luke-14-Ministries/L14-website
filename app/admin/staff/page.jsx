import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import StaffManager from './StaffManager';

// The site's fold arrow on the left (fold-summary in globals.css, 26 Oct 2026).
const SUMMARY = 'fold-summary flex items-center gap-1';

export const metadata = { title: 'Staff & Access — Staff Admin' };

// Who is on staff, wearing which hat, holding which grants. Admin-only; the
// staff_write RLS policy is the real gate. One login, many hats: roles say what
// a person DOES, while sensitive/giving are separate need-to-know grants.
export default async function StaffAccessPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/staff/');
  if (!can(staff, 'admin')) redirect('/admin');

  const supabase = await createClient();
  const { data: rows, error: staffError } = await supabase
    .from('staff')
    .select(
      'profile_id, role, title, can_view_sensitive, can_view_giving, can_view_background_checks, active, profiles ( first_name, last_name )'
    )
        .order('active', { ascending: false })
    .order('role');
  // CLAUDE.md: never turn a query error into an empty list -- here it would
  // read as "no staff" or "no access granted".
  if (staffError) throw new Error(`Staff: ${staffError.message}`);

  // The login address, beside every name. Emails live in auth.users, which the
  // client may not read; admin_list_accounts (0023) is the admin-only function
  // the Accounts page already uses, and this page is admin-only too. Worth the
  // extra query because access follows the LOGIN, not the person: on 2 Sep 2026
  // a staff member appeared to have no admin access -- she had it, on a second
  // account, and nothing on this page said which address the row belonged to.
  // The grants (0100): every staff member's areas, for the panel under each row.
  const { data: grantRows, error: grantsError } = await supabase.from('staff_grants').select('profile_id, area, level');
  if (grantsError) throw new Error(`Staff access: ${grantsError.message}`);
  const grantsById = new Map();
  for (const g of grantRows ?? []) {
    if (!grantsById.has(g.profile_id)) grantsById.set(g.profile_id, {});
    grantsById.get(g.profile_id)[g.area] = g.level;
  }

  const { data: accounts, error: accountsError } = await supabase.rpc('admin_list_accounts');
  if (accountsError) throw new Error(`Login addresses: ${accountsError.message}`);
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
        <a href="/admin/staff/access-log" className="btn-outline py-2! shrink-0">
          Access changes
        </a>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        Who can do what. Each person has <span className="font-semibold">grants</span> on ten
        areas: read, write or no access. Set them with a <span className="font-semibold">preset</span>,
        then adjust them with the <em>Grants</em> button on each row. Only someone with the{' '}
        <span className="font-semibold">Administrator</span> box checked can grant access. Every
        change goes in the access log. One login covers every role, so nobody needs a second account.
      </p>

      {/* One fold, collapsed by default (Lawrence, 2 Oct 2026: the page is for
          doing). <details> needs no client JS. Consolidated 21 Oct 2026 from
          five folds that narrated how the page had changed. */}
      <details className="group mb-6 rounded-lg bg-white border border-neutral-200 p-4 text-sm">
        <summary className={SUMMARY}>
          <span className="font-bold">How access works</span>
        </summary>
        <p className="text-neutral-600 mt-3">
          <span className="font-semibold">The presets.</span>{' '}
          <em>Every area, read and write</em>: all nine areas at write.{' '}
          <em>Registration &amp; coordination</em>: families, money and placements.{' '}
          <em>Finance</em>: records payments and refunds, and reads names and events. Scholarship
          decisions also need Registration write, so they stay with Registration &amp; coordination.{' '}
          <em>Operations lead</em>: the door, rooms, activities and buddies, but no money.{' '}
          <em>Operations helper</em>: reads what&rsquo;s needed to move people around camp safely,
          and writes nothing. After applying a preset, you can adjust any area by hand. No preset
          makes someone an administrator. That&rsquo;s the box in the{' '}
          <em>Administrator (grants access)</em> column. Only an administrator can grant access, add
          or remove staff, name a program leader, or reset two-factor.
        </p>
        <p className="text-neutral-600 mt-3">
          <span className="font-semibold">The ten areas.</span>{' '}
          <span className="font-semibold">Registration info</span>,{' '}
          <span className="font-semibold">Payments &amp; scholarships</span>,{' '}
          <span className="font-semibold">Events &amp; camp setup</span> (the definitions), and four
          placement areas: <span className="font-semibold">Activities, Rooming, Buddies, Programs</span>{' '}
          (who is in what). Three more are need-to-know.{' '}
          <span className="font-semibold">Sensitive:</span> medical, dietary and support details.{' '}
          <span className="font-semibold">Giving:</span> donor gift records. It&rsquo;s never set by a
          preset, only checked by hand for a named person.{' '}
          <span className="font-semibold">Background checks:</span> read shows the three facts every
          staff member sees (on file, current, verdict). Write covers ordering, importing and the
          verdict, and is for administrators only.
        </p>
        <p className="text-neutral-600 mt-3">
          <span className="font-semibold">Administrators.</span> An administrator adds and removes
          staff, changes anyone&rsquo;s grants, and can make or remove another administrator. All
          administrators are equal. Nobody can remove or deactivate themselves. Another
          administrator has to do it, which is one reason to have two. Sensitive and Giving are
          separate grants, even for administrators. Running the site doesn&rsquo;t need medical
          details or donor giving, and an administrator without them can safely project their screen
          at check-in. Keep the administrator list short.
        </p>
      </details>

      <StaffManager members={members} selfId={staff.userId} accounts={pickable} />
    </div>
  );
}
