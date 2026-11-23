import Link from 'next/link';
import { createClient, getCurrentUser } from '@/lib/supabase/server';

export const metadata = { title: 'Join your family' };

// Where an invite to share a household lands (W75, 0174). Like the other
// emailed links, opening it spends nothing: the button posts to ./accept/.
// It sits under /auth/ so the two-factor gate leaves it alone; the accept
// function checks the signed-in login's own email against the invite.
export default async function HouseholdInvitePage({ searchParams }) {
  const sp = await searchParams;
  const token = typeof sp?.token === 'string' ? sp.token : '';
  const error = typeof sp?.error === 'string' ? sp.error.slice(0, 300) : '';
  const supabase = await createClient();
  const user = await getCurrentUser();

  let invite = null;
  if (token) {
    const { data, error: previewError } = await supabase.rpc('household_invite_preview', { p_token: token });
    if (previewError) console.error('household invite preview:', previewError.message);
    invite = Array.isArray(data) ? data[0] ?? null : null;
  }

  const here = `/auth/household-invite/?token=${encodeURIComponent(token)}`;
  const signedInAs = (user?.email ?? '').toLowerCase();
  const rightLogin = invite && signedInAs === invite.email;

  let title = 'Join your family';
  let body = null;
  let action = null;

  if (!invite) {
    title = 'This invite link is not valid';
    body = 'The link may be incomplete. Open it again from the email, or ask your family to send a new invite.';
  } else if (invite.status !== 'open') {
    title =
      invite.status === 'accepted' ? 'This invite has been used' : invite.status === 'expired' ? 'This invite has expired' : 'This invite was cancelled';
    body =
      invite.status === 'accepted'
        ? 'If you accepted it, the household is on your dashboard.'
        : 'Ask your family to send a new one from Manage Household.';
    action = (
      <Link href="/account/dashboard/" className="btn-primary inline-block">
        Go to my dashboard
      </Link>
    );
  } else if (!user) {
    body = (
      <>
        {invite.invited_by_name || 'Someone in your family'} invited <strong>{invite.email}</strong> to share the{' '}
        <strong>{invite.household_name}</strong> household. Sign in with that address, or create an account with it,
        then come back to this link.
      </>
    );
    action = (
      <div className="flex flex-wrap justify-center gap-3">
        <Link href={`/account/?next=${encodeURIComponent(here)}`} className="btn-primary inline-block">
          Sign in
        </Link>
        <Link href={`/account/signup/?next=${encodeURIComponent(here)}`} className="btn-outline inline-block">
          Create an account
        </Link>
      </div>
    );
  } else if (!rightLogin) {
    title = 'Signed in with a different address';
    body = (
      <>
        This invite is for <strong>{invite.email}</strong>, and you are signed in as <strong>{user.email}</strong>. Sign out,
        then sign in or create an account with the invited address.
      </>
    );
    action = (
      <form action="/auth/signout/" method="post">
        <button type="submit" className="btn-outline">
          Sign out
        </button>
      </form>
    );
  } else {
    body = (
      <>
        {invite.invited_by_name || 'Someone in your family'} invited you to share the <strong>{invite.household_name}</strong>{' '}
        household. You&rsquo;ll see its registrations, payments and details with your own sign-in.
      </>
    );
    action = (
      <form action="/auth/household-invite/accept/" method="post">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="btn-primary w-full">
          Join the {invite.household_name} household
        </button>
      </form>
    );
  }

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow-sm bg-white p-6 sm:p-8 text-center">
          <h1 className="text-3xl font-bold mb-3">{title}</h1>
          {error && (
            <p role="alert" className="mb-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-left text-red-800">
              {error}
            </p>
          )}
          {body && <p className="text-neutral-700 mb-6">{body}</p>}
          {action}
        </div>
      </div>
    </section>
  );
}
