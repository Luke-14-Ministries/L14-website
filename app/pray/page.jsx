import PageHero from '@/components/PageHero';
import { asset, site } from '@/lib/site';
import PrayerSignup from './PrayerSignup';

export const metadata = { title: 'Pray' };

export default function PrayPage() {
  return (
    <>
      <PageHero
        image={asset('/images/DSC_0975.jpg')}
        title="Pray With Us"
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <div className="prose-site">
          <p>
            Our prayer warriors are one of the most powerful groups aiding our
            ministry. Those who boldly approach Our Savior with prayer give God
            the opportunity to fill our friends with His spirit and spread His
            love through our volunteers.
          </p>
          <p>
            Once you&rsquo;ve added us to your prayer list, you can follow us
            on social media to learn about our current needs, and sign up for
            our prayer email list below!
          </p>
        </div>
        {/* The prayer list (0141, Lawrence 28 Oct 2026), in place of the
            Google Form: a sign-up here, the prayer team's emails to the list,
            and an unsubscribe link in every one. Requests go to the team's
            address, not through the site. */}
        <div className="mx-auto mt-10 max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-xs">
          <h2 className="mb-1 text-2xl font-bold">Join the prayer email list</h2>
          <p className="mb-5 text-neutral-600">
            Prayer emails from our prayer team, now and then. Leave any time with the link at the
            bottom of each one.
          </p>
          <PrayerSignup />
        </div>
        <p className="mt-8 text-lg">
          Have a prayer request? Send it to{' '}
          <a href={`mailto:${site.emails.pray}`} className="font-semibold text-brand underline">
            {site.emails.pray}
          </a>
          , and our prayer team will pray with you.
        </p>
      </section>
    </>
  );
}
