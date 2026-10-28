import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Wheels For Kenya' };

// Full photo gallery from the original page
const galleryImages = [
  '20140301_Trade-151_0124-copy.jpg',
  'Kenya_2018_1948.jpg',
  'Kenya_2018_0230.jpg',
  'Kenya_2018_0241.jpg',
  'Kenya_2018_0249.jpg',
  'Kenya_2018_0382.jpg',
  'Kenya_2018_0400.jpg',
  'Kenya_2018_0415.jpg',
  'Kenya_2018_0464.jpg',
  'Kenya_2018_0763.jpg',
  'Kenya_2018_0772.jpg',
  'Kenya_2018_0804.jpg',
  'Kenya_2018_0812.jpg',
  'Kenya_2018_1440.jpg',
  'Kenya_2018_1454.jpg',
  'Kenya_2018_1631.jpg',
  'Kenya_2018_1795.jpg',
  'Kenya_2018_1958.jpg',
  'Kenya_2018_3478.jpg',
  'Kenya_2018_3554.jpg',
].map((f) => ({ src: asset(`/images/${f}`), alt: 'Wheels for Kenya photo' }));

export default function WheelsForKenyaPage() {
  return (
    <>
      <PageHero
        image={asset('/images/Kenya_2018_0775.jpg')}
        title="Wheels for Kenya"
        subtitle={'“This is the Lord’s doing. It is marvelous in our eyes!” - Psalm 118:23'}
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <h2 className="text-2xl sm:text-3xl font-bold leading-snug sm:leading-9">
          Our Wheels for Kenya program is responsible for organizing and
          carrying out a wheelchair distribution program across Kenya.
        </h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/Kenya_2018_0380.jpg')}
          alt="Kenya_2018_0380.jpg"
          className="mt-10 rounded-lg shadow-sm w-full"
        />
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">About Wheels for Kenya</h2>
          <div className="prose-site">
            <p>
              In October 2015, we had the opportunity to share what God has been
              doing through Luke 14 Ministries with an International Overflow
              Conference at Heritage Fellowship Church in Jefferson City,
              Tennessee. Christian leaders were there from 14 different
              countries, including Pastor Hudson Bande from Nairobi, Kenya.
              Pastor Hudson was moved by our presentation and asked if we would
              come to Kenya and help them start a ministry there. We agreed, and
              a few months later we found ourselves on a plane heading to east
              Africa to explore Kenya&rsquo;s needs and opportunities.
            </p>
            <p>
              After realizing that mobility is a serious need there, we turned
              to Joni &amp; Friends and asked if they could organize a
              wheelchair distribution through their &ldquo;Wheels for the
              World&rdquo; program. They declined as they were already maxed
              out, going to 26 other countries that year. But they did offer us
              200 refurbished chairs if we would like to apply to become a
              &ldquo;Harvest Project.&rdquo; We applied and were granted the
              200 chairs, as well as additional walkers, canes, and crutches!
            </p>
            <p>
              We began asking the Lord for a team, and 9 months later we found
              ourselves flying back to Africa with 16 beautiful people the Lord
              had hand-picked for service! Physical therapists, mechanics,
              nurses, and support people became the hands and feet of Christ,
              reaching out to dear ones in a culture that views their disability
              as a curse from God. Being able to love and assure them that God
              loves them and wants them to know it and have this chair as a
              sign is a beautiful blessing to witness! As local pastors
              ministered to them after they received their chairs, the Gospel
              was shared in their own language and they were told, &ldquo;God
              has remembered you this day&rdquo;. Many gave their hearts to
              Jesus. He had seen their misery. He had heard their cries. He had
              shown them He was concerned about their suffering and was coming
              down to rescue them! (Exodus 3)
            </p>
          </div>
        </div>
      </section>

      <section className="bg-brand-dark text-white py-16">
        <div className="container-site max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-bold">Join us on our next trip!</h2>
          <p className="mt-4 text-2xl">May 23rd-June 3rd 2026</p>
          <p className="mt-4 text-lg text-neutral-200">
            Click the link below to learn more and apply for this opportunity.
            We are excited to serve alongside you.
          </p>
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSfje5aflYozY1nXcQQggT5apLlbcJO_F8jrOF0D_7lxb8LduA/viewform"
            target="_blank"
            rel="noopener"
            className="btn-gold mt-8 inline-block"
          >
            Sign up here!
          </a>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-6">Wheelchairs</h2>
        <div className="prose-site">
          <p>
            One of the sources of our wheelchairs is through the Joni and
            Friends&rsquo; Wheels for the World program. This program takes old
            wheelchairs that have been outgrown or discarded by their original
            users and refurbishes them before distributing them throughout the
            world!
          </p>
          <p>
            In addition to distributing wheelchairs, we are also happy to
            arrange the collection of outgrown or unused wheelchairs! If you
            have a chair you would like to donate, please contact Darlene
            LaPlue at{' '}
            <a
              href="mailto:darlene@luke14ministries.net"
              className="text-brand font-semibold underline"
            >
              darlene@luke14ministries.net
            </a>
            .
          </p>
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">Mission Trips</h2>
          <div className="prose-site">
            <p>
              After leading distributions for several years, we began working
              with Hope Mobility in Kenya to distribute wheelchairs. Each year,
              Luke 14 Ministries in conjunction with Hope Mobility, holds a
              wheelchair distribution in Kenya. We bring medical professionals,
              mechanics, and administrative support from the United States to
              give 200 of our disabled friends in Kenya the gift of mobility.
            </p>
            <p>
              If you are a physical or occupational therapist, mechanically
              inclined, an organized administrator, or in a profession similar
              to any of these, we would love for you to consider joining us on
              this trip!
            </p>
            <p>
              There are many blessings from being involved with the trip.
              Giving the gift of mobility to someone who has literally crawled
              on the ground their whole life is an experience unlike any other.
            </p>
            <p>
              There are a variety of support roles here in the United States to
              help prepare for the trip, and we would love to have your help!
              If you&rsquo;re interested, contact Darlene LaPlue at{' '}
              <a
                href="mailto:darlene@luke14ministries.net"
                className="text-brand font-semibold underline"
              >
                darlene@luke14ministries.net
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      <section className="container-site py-14">
        <h2 className="text-3xl font-bold text-center mb-10">
          From the Field
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {galleryImages.map((image) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={image.src}
              src={image.src}
              alt={image.alt}
              className="rounded-lg shadow-sm w-full h-64 object-cover"
            />
          ))}
        </div>
        <div className="text-center mt-10">
          <Link href="/kenya-memories/" className="btn-outline">
            Kenya Memories
          </Link>
        </div>
      </section>
    </>
  );
}
