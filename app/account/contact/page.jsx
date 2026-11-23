import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import ContactManager from './ContactManager';
import BackLink, { TITLE_ROW } from '@/components/BackLink';

export const metadata = { title: 'My Account Details' };

// The person's own account details: name, personal phone, login email, and
// email preferences. Family/household contact info (the address and phone camp
// uses) lives under Manage Household -- this page links there.
export default async function ContactPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/account/?next=/account/contact/');

  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('first_name, last_name, phone, sms_opt_in, email_news')
    .eq('id', user.id)
    .maybeSingle();
  // CLAUDE.md: never swallow a query error -- here it would show empty boxes
  // as if nothing had ever been saved.
  if (profileError) throw new Error(`Your account details: ${profileError.message}`);

  // The household's contact email, shown so the two emails are told apart
  // (Lawrence, 23 Nov 2026): this page's is the sign-in one.
  const { data: membership, error: householdError } = await supabase
    .from('household_members')
    .select('households ( email )')
    .eq('profile_id', user.id)
    .limit(1)
    .maybeSingle();
  if (householdError) throw new Error(`Your household: ${householdError.message}`);
  const householdEmail = membership?.households?.email ?? null;

  return (
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-2xl mx-auto">
        <div className={`${TITLE_ROW} mb-2`}>
          <h1 className="text-3xl font-bold">My Account Details</h1>
          <BackLink />
        </div>
        <p className="text-neutral-600 mb-3">
          Your own details: your name, your phone and the email you sign in with.
        </p>
        <p className="mb-8 rounded-sm border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
          <strong>Camp reminders and payment receipts</strong> go to your household&rsquo;s contact
          email{householdEmail ? <>, <span className="font-semibold">{householdEmail}</span></> : null}, not
          necessarily the one you sign in with. Change it, and the household phone and address, on{' '}
          <Link href="/account/household/" className="text-brand font-semibold underline">
            Manage Household
          </Link>
          .
        </p>

        <ContactManager
          email={user.email}
          profile={{
            first_name: profile?.first_name ?? '',
            last_name: profile?.last_name ?? '',
            phone: profile?.phone ?? '',
            sms_opt_in: profile?.sms_opt_in === true,
            email_news: profile?.email_news !== false,
          }}
        />
      </div>
    </section>
  );
}
