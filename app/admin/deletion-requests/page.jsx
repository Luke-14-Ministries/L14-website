import { formatPhone } from '@/lib/format';
import AdminPageHeader from '@/components/AdminPageHeader';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import DeletionList from './DeletionList';

export const metadata = { title: 'Deletion Requests · Staff Admin' };

// Families asking for their medical information, or their whole account, to
// be deleted (Lawrence, 30 Sep 2026). A queue, like cancellations: closing a
// request here records what a person did -- it deletes nothing by itself.
// Retention policy (not published): records are kept three years after a
// family's last event; payments, signed releases and background checks are
// what usually has to stay.
export default async function DeletionRequestsPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/deletion-requests/');
  if (!can(staff, 'read:registration')) redirect('/admin');
  const showClosed = params?.closed === '1';

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('data_deletion_requests')
    .select('id, household_id, scope, family_note, status, staff_note, created_at, households ( display_name, email, phone )')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Deletion requests: ${error.message}`);

  // Counted for the two pills (23 Nov 2026 review): one text link that said
  // "Show closed requests" gave no sign whether anything was open.
  const openCount = (rows ?? []).filter((r) => r.status === 'requested').length;
  const closedCount = (rows ?? []).length - openCount;
  const shaped = (rows ?? [])
    .filter((r) => (showClosed ? r.status !== 'requested' : r.status === 'requested'))
    .map((r) => ({
      id: r.id,
      householdId: r.household_id,
      household: r.households?.display_name ?? 'Household',
      email: r.households?.email ?? '',
      phone: formatPhone(r.households?.phone ?? ''),
      scope: r.scope,
      familyNote: r.family_note,
      status: r.status,
      staffNote: r.staff_note,
      createdAt: r.created_at,
    }));

  return (
    <div>
      <AdminPageHeader
        title="Deletion Requests"
        intro={
          <>
            Families asking us to delete their medical information or their account. Contact the
            family, delete what can go, and note what was kept and why. Payments, signed releases and
            background checks are kept for three years.
          </>
        }
      />
      {/* Open and Closed pills, the same as Cancellations (23 Nov 2026). */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          href="/admin/deletion-requests"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            !showClosed ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
          }`}
        >
          Open ({openCount})
        </Link>
        <Link
          href="/admin/deletion-requests?closed=1"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            showClosed ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
          }`}
        >
          Closed ({closedCount})
        </Link>
      </div>
      {shaped.length === 0 ? (
        <p className="text-neutral-500">{showClosed ? 'Nothing closed yet.' : 'No open requests.'}</p>
      ) : (
        <DeletionList rows={shaped} />
      )}
    </div>
  );
}
