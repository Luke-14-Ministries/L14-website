import TokenAction from '../TokenAction';

export const metadata = { title: 'Unsubscribe — Prayer List' };

// The footer link in every prayer email lands here (0141). Without a token
// (a staff test send, or a link copied short) there is nothing to act on.
export default async function PrayerUnsubscribePage({ searchParams }) {
  const params = await searchParams;
  const token = typeof params?.t === 'string' ? params.t : '';
  return (
    <section className="container-site mx-auto max-w-xl py-16 text-center">
      <h1 className="text-3xl font-bold">Leave the prayer list</h1>
      {token ? (
        <>
          <p className="mt-4 mb-8 text-lg">Press the button and no more prayer emails will be sent to you.</p>
          <TokenAction kind="unsubscribe" token={token} />
        </>
      ) : (
        <p className="mt-4 text-lg">
          This link is not complete. Please use the Unsubscribe link at the bottom of a prayer email.
          A test email sent to staff has no real unsubscribe link.
        </p>
      )}
    </section>
  );
}
