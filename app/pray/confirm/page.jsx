import TokenAction from '../TokenAction';

export const metadata = { title: 'Confirm — Prayer List' };

// The link in the prayer list's confirmation email lands here (0141).
export default async function PrayerConfirmPage({ searchParams }) {
  const params = await searchParams;
  const token = typeof params?.t === 'string' ? params.t : '';
  return (
    <section className="container-site mx-auto max-w-xl py-16 text-center">
      <h1 className="text-3xl font-bold">Join the prayer list</h1>
      <p className="mt-4 mb-8 text-lg">Press the button to confirm, and the prayer emails will start coming to you.</p>
      <TokenAction kind="confirm" token={token} />
    </section>
  );
}
