import { redirect } from 'next/navigation';
import BackLink, { TITLE_ROW } from '@/components/BackLink';
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
    // The account pages' one shell and title row (23 Nov 2026), shared with
    // Change password and Delete my data: gray band, heading left, Back pill
    // right. It was a blue band with the pill alone above a card.
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-2xl mx-auto">
        <div className={`${TITLE_ROW} mb-6`}>
          <h1 className="text-3xl font-bold">Security</h1>
          <BackLink />
        </div>
        {/* isStaff for the 7-day words (23 Nov 2026); required also covers
            ?required=1 from the admin gate. */}
        <SecurityManager required={required || Boolean(staff)} isStaff={Boolean(staff)} />
      </div>
    </section>
  );
}
