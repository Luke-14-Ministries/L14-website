import { redirect } from 'next/navigation';
import BackLink from '@/components/BackLink';
import { createClient } from '@/lib/supabase/server';
import { getStaff } from '@/lib/staff';
import SecurityManager from './SecurityManager';

export const metadata = { title: 'Security' };

// Manage two-factor for your own account. Optional for families, required for
// staff -- when ?required=1 is present (staff sent here by the admin gate) the
// manager shows the "you must turn this on" note.
export default async function SecurityPage({ searchParams }) {
  const params = await searchParams;
  const required = params?.required === '1';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/account/?next=/account/security/');

  const staff = await getStaff();

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-lg mx-auto">
        {/* The account pages' back pill (26 Oct 2026); the page's title is
            SecurityManager's own heading, just below. */}
        <div className="mb-4 flex justify-end">
          <BackLink />
        </div>
        <SecurityManager required={required || Boolean(staff)} />
      </div>
    </section>
  );
}
