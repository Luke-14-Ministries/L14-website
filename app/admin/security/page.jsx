import { redirect } from 'next/navigation';
import AdminPageHeader from '@/components/AdminPageHeader';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import AdminMfaReset from './AdminMfaReset';

export const metadata = { title: 'Reset Two-Factor · Staff Admin' };

// Admin-only. The /admin layout already requires staff + two-factor; this adds
// the admin check for this particular tool. Not in the menu: the Accounts
// page's row menu does the same reset, and links here at its foot for the
// day the table itself is what is broken (23 Nov 2026: back pill, plainer
// heading and words).
export default async function AdminSecurityPage() {
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/security/');
  if (!can(staff, 'admin')) redirect('/admin');

  return (
    <div>
      <AdminPageHeader
        title="Reset someone&rsquo;s two-factor"
        back={{ href: '/admin/accounts/', label: 'Back to Accounts' }}
        intro={
          <>
            For someone who can&rsquo;t sign in because they lost their phone or reinstalled their
            authenticator app. This takes off their two-factor, so they sign in with their password and
            set it up again. Their password stays the same. You will be asked for your own code before
            it happens.
          </>
        }
      />
      <div className="card">
        <AdminMfaReset />
      </div>
    </div>
  );
}
