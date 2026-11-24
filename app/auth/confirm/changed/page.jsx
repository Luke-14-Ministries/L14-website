import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Sign-in Email' };

// Where the button page sends someone after pressing an email-change link
// (23 Nov 2026). "Secure email change" is on in Supabase, so a change needs a
// link pressed in BOTH emails: the one to the new address and the one to the
// current address. The first press confirms one side and signs nobody in; the
// second finishes the change. Before this page, the first press dropped the
// person on the dashboard (or the sign-in screen) with no word that anything
// was still to do.
//
// What this page can know: if this browser is signed in, the account itself
// says whether a change is still waiting (new_email). If not, the button page
// says which press this was (?step=half or done).
export default async function EmailChangedPage({ searchParams }) {
  const params = await searchParams;
  const step = params?.step;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let heading;
  let body;
  if (user?.new_email) {
    heading = 'One link done';
    body = (
      <>
        Now press the link in the other email. Your sign-in email stays{' '}
        <strong className="break-all">{user.email}</strong> until both links are pressed.
      </>
    );
  } else if (user && step !== 'half') {
    heading = 'Your sign-in email has changed';
    body = (
      <>
        You now sign in with <strong className="break-all">{user.email}</strong>. Password
        reset emails go there too.
      </>
    );
  } else if (step === 'half') {
    heading = 'One link done';
    body = <>Now press the link in the other email. Nothing changes until both links are pressed.</>;
  } else if (step === 'done') {
    heading = 'Your sign-in email has changed';
    body = <>Log in with your new address from now on. Password reset emails go there too.</>;
  } else {
    heading = 'Sign-in email';
    body = (
      <>
        If you have pressed the links in both emails, your sign-in email has changed. If not,
        press the link in the other email.
      </>
    );
  }

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow-sm bg-white p-6 sm:p-8 text-center">
          <h1 className="text-3xl font-bold mb-3">{heading}</h1>
          <p className="text-neutral-700 mb-6">{body}</p>
          <p className="text-sm text-neutral-600 mb-6">
            This does not change where camp email goes. That is your household&rsquo;s contact
            email, on Manage Household.
          </p>
          <Link href={user ? '/account/dashboard/' : '/account/'} className="btn-primary w-full">
            {user ? 'Go to my dashboard' : 'Log in'}
          </Link>
        </div>
      </div>
    </section>
  );
}
