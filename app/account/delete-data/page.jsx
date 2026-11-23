import BackLink, { TITLE_ROW } from '@/components/BackLink';
import { redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import DeleteDataForm from './DeleteDataForm';

export const metadata = { title: 'Delete my data' };

const SCOPE = {
  medical: 'Medical information',
  account_and_medical: 'Account and medical information',
};
const STATUS = { requested: 'With staff', done: 'Done', declined: 'Closed' };

export default async function DeleteDataPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/account/?next=/account/delete-data/');
  const supabase = await createClient();
  const { data: member, error: memberError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id)
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error(`Your household: ${memberError.message}`);
  const [{ data: requests, error: requestsError }, { data: logins, error: loginsError }] = member?.household_id
    ? await Promise.all([
        supabase
          .from('data_deletion_requests')
          .select('id, scope, status, created_at, staff_note, requested_by')
          .eq('household_id', member.household_id)
          .order('created_at', { ascending: false }),
        // Who asked (23 Nov 2026, A5-07): a household can have more than one
        // sign-in since W75, so a request shows whose it was. Names come from
        // the household's own sign-ins (my_household_logins(), 0174).
        supabase.rpc('my_household_logins', { p_household_id: member.household_id }),
      ])
    : [{ data: [] }, { data: [] }];
  // A failed read must not look like "no requests" -- the family would ask again.
  if (requestsError) throw new Error(`Your deletion requests: ${requestsError.message}`);
  if (loginsError) throw new Error(`Who signs in to your household: ${loginsError.message}`);
  const askedBy = new Map((logins ?? []).map((l) => [l.profile_id, l.is_me ? 'you' : l.name || 'another adult']));
  const open = (requests ?? []).some((r) => r.status === 'requested');

  return (
    <section className="mx-auto max-w-2xl px-4 py-10">
      <div className={TITLE_ROW}>
        <h1 className="text-3xl font-bold">Delete my data</h1>
        <BackLink />
      </div>
      <p className="mt-3 text-neutral-700">
        You can ask us to delete your family&rsquo;s medical information, or your whole account. A
        staff member looks at every request and contacts your household&rsquo;s primary contact
        before anything is removed, so nothing goes on one adult&rsquo;s word alone. Some records,
        such as payments and signed releases, have to be kept for a time even after the rest is
        gone. Staff will tell you which.
      </p>
      {(requests ?? []).length > 0 && (
        <ul className="mt-6 divide-y divide-neutral-200 rounded-sm border border-neutral-200 bg-white text-sm">
          {requests.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <span className="font-semibold">{SCOPE[r.scope]}</span> · requested{' '}
              {new Date(r.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} ·{' '}
              {STATUS[r.status]}
              {askedBy.has(r.requested_by) && <span className="text-neutral-600"> · asked by {askedBy.get(r.requested_by)}</span>}
              {r.staff_note && <span className="block text-neutral-600">{r.staff_note}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
        {open ? (
          <p className="text-neutral-700">Your request is with staff. They will be in touch.</p>
        ) : (
          <DeleteDataForm />
        )}
      </div>
    </section>
  );
}
