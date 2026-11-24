import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import BackLink from '@/components/BackLink';
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
    <div className="bg-white rounded-lg border border-neutral-200 shadow-xs p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Reset someone&rsquo;s two-factor</h2>
        <BackLink href="/admin/accounts/" label="Back to Accounts" />
      </div>
      <p className="text-sm text-neutral-500 mb-5 max-w-4xl">
        For someone who can&rsquo;t sign in because they lost their phone or reinstalled their
        authenticator app. This takes off their two-factor, so they sign in with their password and
        set it up again. Their password stays the same. You will be asked for your own code before
        it happens.
      </p>
      <AdminMfaReset />
    </div>
  );
}
