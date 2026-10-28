import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Host a Speaker' };

const BOOK_SPEAKER_URL =
  'https://airtable.com/appWUKasL3QE7kQdp/shrFHqX38Vb49fbkY';

export default function HostASpeakerPage() {
  return (
    <>
      <PageHero
        image={asset('/images/DSC_0239.jpg')}
        title="Host a Luke 14 Ministries Speaker at Your Church or Event"
      />

      <section className="container-site py-14 max-w-3xl mx-auto">
        <div className="prose-site">
          <p>
            We love sharing the incredible ways God is moving through Luke 14
            Ministries and would be honored to speak at your church,
            conference, or community event.
          </p>
          <p>
            Our speakers bring stories of hope, inclusion, and God&rsquo;s
            redemptive work through disability ministry. Whether you&rsquo;d
            like to learn more about our programs, discover how to serve
            families affected by disability in your area, or explore how your
            church can create spaces of true belonging, we would love to
            connect.
          </p>
          <p>
            Use the form below to reach out and invite one of our speakers to
            share encouragement, inspiration, and practical tools for making
            the Church a place where <em>everyone belongs</em>.
          </p>
        </div>
      </section>

      <section className="bg-brand-dark text-white py-16">
        <div className="container-site max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold">
            Your church. Your community. God&rsquo;s story of belonging.
          </h2>
          <a
            href={BOOK_SPEAKER_URL}
            target="_blank"
            rel="noopener"
            className="btn-gold mt-8 inline-block"
          >
            Book a Speaker
          </a>
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-10">Meet Our Speakers</h2>

          <div className="space-y-12">
            <div>
              <h3 className="text-xl font-bold mb-3">
                Darlene LaPlue &mdash; Events Planner
              </h3>
              <div className="prose-site">
                <p>
                  Darlene is a farm girl from Kentucky who loves Jesus and
                  loves being busy about the work of His Kingdom. She fell in
                  love with disability ministry nearly 25 years ago after
                  meeting so many amazing and beautiful people and seeing the
                  heart of God in a brand-new way.
                </p>
                <p>
                  Today, Darlene serves in multiple roles with Luke 14
                  Ministries&mdash;planning the annual Luke 14 Dinner Party,
                  helping lead wheelchair distribution teams to Kenya,
                  directing Camp Celebrate, and teaching an Adult Special
                  Friends Sunday School Class at her church in Morristown. Her
                  spiritual gift is <em>throwing a party</em>, and she&rsquo;s
                  passionate about taking back the &ldquo;party&rdquo; for the
                  Kingdom!
                </p>
                <p>
                  Darlene is a dynamic and joy-filled speaker who loves to
                  teach on topics such as{' '}
                  <em>how to start a disability ministry</em>,{' '}
                  <em>how to plan a Luke 14 Party</em>, and{' '}
                  <em>
                    what the Bible says about serving those affected by
                    disability.
                  </em>
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-bold mb-3">
                Larry LaPlue &mdash; Executive Director
              </h3>
              <div className="prose-site">
                <p>
                  Larry has worked as a volunteer serving individuals with
                  disabilities for more than 20 years. His experience includes
                  volunteering at family camps, coordinating the annual Luke 14
                  banquet, and leading international mission trips to
                  distribute wheelchairs.
                </p>
                <p>
                  As Executive Director of Luke 14 Ministries, Larry brings
                  both leadership and compassion to every project. His passion
                  for practical service and his heart for people make his talks
                  both encouraging and inspiring for churches and organizations
                  seeking to better serve their communities.
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-bold mb-3">Our Ministry Team</h3>
              <div className="prose-site">
                <p>
                  Several members of our Luke 14 Ministries team are also
                  available to speak about our mission, programs, and the
                  impact of our work around the world. Each speaker brings
                  unique experiences and insights to help your church or
                  organization take the next step in disability ministry.
                </p>
              </div>
            </div>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/tempImageUC97ga.jpg')}
            alt="Luke 14 Ministries team"
            className="mt-12 rounded-lg shadow-sm w-full"
          />
        </div>
      </section>

      <section className="container-site py-16 max-w-3xl mx-auto text-center">
        <h2 className="text-3xl font-bold">
          Because everyone deserves a seat at the table.
        </h2>
        <a
          href={BOOK_SPEAKER_URL}
          target="_blank"
          rel="noopener"
          className="btn-primary mt-8 inline-block"
        >
          Book a Speaker
        </a>
      </section>
    </>
  );
}
