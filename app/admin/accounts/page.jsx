import { redirect } from 'next/navigation';
import AdminPageHeader from '@/components/AdminPageHeader';
import Link from 'next/link';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { sinceISO, whenInMorristown } from '@/lib/events';
import AccountsManager from './AccountsManager';

export const metadata = { title: 'Accounts · Staff Admin' };

// "1 person", "2 people": the log's counts in words.
const count = (n, one, many) => `${n ?? 0} ${(n ?? 0) === 1 ? one : many}`;

// One admin_account_log row (0180) as a sentence.
function logLine(row) {
  const c = row.counts ?? {};
  switch (row.action) {
    case 'purge_household': {
      const kept = Array.isArray(c.logins_kept) && c.logins_kept.length ? ` Kept: ${c.logins_kept.join(', ')}.` : '';
      return `Deleted ${row.household_name ?? 'a family'}: ${count(c.registrations, 'registration', 'registrations')}, ${count(
        c.people,
        'person',
        'people'
      )}, ${count(c.logins_deleted, 'account', 'accounts')}.${kept}`;
    }
    case 'delete_login':
      return `Removed the account ${row.target_email ?? ''}${row.household_name ? ` (${row.household_name})` : ''}${c.was_staff ? ', who was staff' : ''}.`;
    case 'link_login':
      return `Linked ${row.target_email ?? 'an account'} to ${row.household_name ?? 'a household'}${c.role === 'owner' ? ', as the person who set it up' : ''}.`;
    case 'merge_households':
      return `Merged ${row.household_name ?? 'a household'} into ${row.other_household_name ?? 'another'}.`;
    default:
      return row.action;
  }
}

// Every login on the platform -- families and staff alike -- with the account
// facts that do not live anywhere else: when it was created, when it last
// signed in, whether the email is confirmed, whether two-factor is on.
//
// The data comes from admin_list_accounts() (migration 0022), a SECURITY
// DEFINER function that re-checks is_admin() server-side. auth.users is not
// reachable any other way, which is the point: the page is a convenience, the
// function is the boundary.
export default async function AccountsPage() {
  const staff = await getStaff();
  if (!can(staff, 'admin')) redirect('/admin/');

  const supabase = await createClient();
  const [
    { data: accounts, error },
    { data: households, error: householdsError },
    { data: unclaimedPeople, error: unclaimedError },
    { data: linkedPeople, error: linkedError },
    { data: logins, error: loginsError },
    { data: invites, error: invitesError },
    { data: logRows, error: logError },
  ] =
    await Promise.all([
      supabase.rpc('admin_list_accounts'),
      // For the "Link to household" picker. Staff RLS on households already
      // allows this read; sorted so the dropdown is scannable.
      supabase
        .from('households')
        .select('id, display_name, city')
        .order('display_name'),
      // People no login has claimed as "this is me" -- the optional second
      // dropdown in the link modal. Children are filtered out client-side
      // (a login always belongs to an adult), but fetching them all keeps
      // this one simple query.
      supabase
        .from('people')
        .select('id, household_id, first_name, last_name, date_of_birth')
        .is('profile_id', null)
        .order('last_name'),
      // Each login's own person record, so the name can open the person's
      // page (Lawrence, 4 Nov 2026).
      supabase.from('people').select('id, profile_id').not('profile_id', 'is', null),
      // Who signs in to each household, and how they joined (0180): a family
      // can now invite a second adult itself (W75), so the office should see
      // who did, without an approval step (23 Nov 2026).
      supabase.rpc('staff_household_logins'),
      // Invites still waiting to be accepted.
      supabase
        .from('household_invites')
        .select('id, household_id, email, invited_by, created_at, expires_at')
        .is('accepted_at', null)
        .is('cancelled_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at'),
      // The last account changes made here (0180).
      supabase
        .from('admin_account_log')
        .select('id, action, actor_email, target_email, household_name, other_household_name, counts, created_at')
        .order('created_at', { ascending: false })
        .limit(25),
    ]);

  if (error) {
    console.error('admin_list_accounts:', error.message);
  }
  // CLAUDE.md: never turn a query error into an empty list -- the link
  // pickers would read as "no households" and "nobody to claim".
  if (householdsError) throw new Error(`Households: ${householdsError.message}`);
  if (unclaimedError) throw new Error(`Unclaimed people: ${unclaimedError.message}`);
  if (linkedError) throw new Error(`People linked to logins: ${linkedError.message}`);
  if (loginsError) throw new Error(`Who signs in to each household: ${loginsError.message}`);
  if (invitesError) throw new Error(`Household invites: ${invitesError.message}`);
  if (logError) throw new Error(`Account changes log: ${logError.message}`);
  const personIdByUser = Object.fromEntries((linkedPeople ?? []).map((p) => [p.profile_id, p.id]));

  // { householdId: [login, ...] } and { householdId: [open invite, ...] },
  // the inviter named from the household's own logins.
  const loginsByHousehold = {};
  for (const l of logins ?? []) (loginsByHousehold[l.household_id] ??= []).push(l);
  const invitesByHousehold = {};
  for (const i of invites ?? []) {
    const by = (loginsByHousehold[i.household_id] ?? []).find((l) => l.profile_id === i.invited_by);
    (invitesByHousehold[i.household_id] ??= []).push({
      id: i.id,
      email: i.email,
      created_at: i.created_at,
      expires_at: i.expires_at,
      invited_by_name: by?.name ?? null,
    });
  }

  return (
    <div>
      {/* max-w-prose caps this at a 65-character measure, as everywhere else
          in the staff pages. Reworded 23 Nov 2026: no more "test data" (the
          site is live) and no sentence about the menu badge's colour. */}
      <AdminPageHeader
        title="Accounts"
        intro={
          <>
            Every account on the site, families and staff. Removing an account never deletes a
            family&rsquo;s registrations or payments. &ldquo;Delete family &amp; all their data&rdquo;
            does, and only for a family with no card or bank payments on record. Resetting two-factor, removing an
            account and deleting a family each ask for your own two-factor code first.
          </>
        }
      />
      <AccountsManager
        accounts={accounts ?? []}
        households={households ?? []}
        unclaimedPeople={unclaimedPeople ?? []}
        personIdByUser={personIdByUser}
        loginsByHousehold={loginsByHousehold}
        invitesByHousehold={invitesByHousehold}
        selfId={staff.userId}
        loadError={Boolean(error)}
        // "New this week" for the quick filter, decided here on the server so
        // the table never reads the clock while rendering. Mirrors the nav
        // badge, which asks the database for the same seven days.
        newSince={sinceISO(7)}
      />

      {/* Outside the table on purpose: if the table itself is ever what is
          broken, the reset by email still works (23 Nov 2026). */}
      <p className="mt-4 text-sm text-neutral-600">
        Need to reset someone&rsquo;s two-factor by their email address instead?{' '}
        <Link href="/admin/security/" className="font-semibold text-brand-dark hover:underline">
          Reset two-factor by email →
        </Link>
      </p>

      <details className="card mt-6 p-0">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-neutral-700">
          Account changes made here{' '}
          <span className="font-normal text-neutral-500">
            ({(logRows ?? []).length === 0 ? 'none yet' : `last ${(logRows ?? []).length}`})
          </span>
        </summary>
        <div className="border-t border-neutral-100 px-4 py-3">
          <p className="text-xs text-neutral-500 mb-2">
            Every deleted family, removed account, link and merge, with who did it. Two-factor
            resets are on the Staff &amp; Access log.
          </p>
          {(logRows ?? []).length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {(logRows ?? []).map((r) => (
                <li key={r.id}>
                  <span className="text-neutral-500">{whenInMorristown(r.created_at)}</span>
                  {' · '}
                  <span className="text-neutral-600">{r.actor_email ?? 'someone'}</span>
                  {' · '}
                  {logLine(r)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
