import Link from 'next/link';

export const metadata = { title: 'Confirm your contact email' };

// Where the "confirm your contact email" link lands (0171, 23 Nov 2026).
// Like /auth/confirm, the link itself spends nothing: mail scanners fetch
// links, and only the button (a POST to ./done/) confirms. The link works
// without signing in, because it may be opened on another device; holding the
// token is the proof. It sits under /auth/ so the two-factor gate in the proxy
// leaves it alone.
export default async function ConfirmContactEmailPage({ searchParams }) {
  const sp = await searchParams;
  const token = typeof sp?.token === 'string' ? sp.token : '';
  const status = typeof sp?.status === 'string' ? sp.status : '';

  let title = 'Confirm your contact email';
  let body = 'Press the button to start using this address for camp reminders and payment receipts.';
  if (status === 'ok') {
    title = 'Thank you';
    body = 'Your contact email is confirmed. Camp reminders and payment receipts will go there from now on.';
  } else if (status === 'expired' || (!status && !token)) {
    title = 'This link has expired';
    body =
      'The link has already been used, is more than 3 days old, or was replaced by a newer one. Sign in and save the email on the Household page again to get a new link.';
  }

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow-sm bg-white p-6 sm:p-8 text-center">
          <h1 className="text-3xl font-bold mb-3">{title}</h1>
          <p className="text-neutral-700 mb-6">{body}</p>
          {!status && token ? (
            <form action="/auth/confirm-contact/done/" method="post">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="btn-primary w-full">
                Confirm this email
              </button>
            </form>
          ) : (
            <Link href="/account/household/" className="btn-primary inline-block">
              Go to my household
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
