import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Luke 14 Party' };

// Full photo gallery from the original page
const galleryImages = [
  'DSC_0811.jpg',
  'DSC_0899.jpg',
  'DSC_1188.jpg',
  'DSC_2474.jpg',
  'DSC00091_4.jpg',
  'DSC01873.jpg',
  'DSC01901.jpg',
  'DSC01983.jpg',
  'DSC02018.jpg',
  'DSC02055.jpg',
  'Edited-L14-BCB_8403_5.jpg',
  'Edited-L14-BCB_8604_5.jpg',
  'Edited-L14-BCB_8670_5.jpg',
  'Edited-L14-BCB_8703_5.jpg',
  'Edited-L14-BCB_8844_4.jpg',
  'IMG_0411.jpg',
  'IMG_0812.jpg',
  'IMG_1581.jpg',
  'IMG_1655_4.jpg',
  'IMG_6455.jpg',
  'IMG_6535.jpg',
  'IMG_6667.jpg',
  'img-2368_4.jpg',
  'img-2704_4.jpg',
  'P1050180.jpg',
].map((f) => ({ src: asset(`/images/${f}`), alt: 'Luke 14 Party photo' }));

export default function Luke14PartyPage() {
  return (
    <>
      <PageHero
        image={asset('/images/DSC_1122.jpg')}
        title="Luke 14 Party!"
        subtitle="A celebration of friends with disabilities"
      />

      <section className="container-site py-14 text-center">
        <h2 className="text-3xl font-bold">April 2027</h2>
        <p className="mt-3 text-4xl font-bold text-brand">Date TBD</p>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/DSC_1034.jpg')}
            alt="DSC_1034.JPG"
            className="rounded-lg shadow-sm w-full mb-10"
          />
          <h2 className="text-3xl font-bold mb-6">
            The Greatest Party Around!
          </h2>
          <div className="prose-site">
            <p>
              Luke 14 Ministries annually hosts a unique banquet in Morristown,
              TN where the guests of honor are those in and around our community
              with disabilities. Guests enjoy themed exhibits and fun activities
              before sitting down to a delicious feast!
            </p>
            <p>
              <em>
                Free t-shirt will be provided for the guest of honor. Extra
                t-shirts for family and friends will be available for purchase
                at the party.
              </em>
            </p>
          </div>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <p className="text-2xl sm:text-3xl font-heading leading-relaxed">
          &ldquo;But when you give a banquet, invite the poor, the crippled,
          the lame, the blind, and you will be blessed.&rdquo;
        </p>
        <p className="mt-6 text-lg text-neutral-600">&mdash; Luke 14: 13-14a</p>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">We would love to meet you!</h2>
          <div className="prose-site">
            <p>
              Luke 14 Ministries is always looking to partner with churches and
              individuals interested in serving the special needs community. If
              you would like to learn more or have us give a presentation to
              your church or small group, please contact us. We are excited to
              talk about the greatest party of the year&hellip;every year!
            </p>
          </div>
        </div>
      </section>

      <section className="container-site py-14">
        <h2 className="text-3xl font-bold text-center mb-10">Party Photos</h2>
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
          <a
            href="https://luke14ministries.net/party-memories"
            target="_blank"
            rel="noopener"
            className="btn-primary"
          >
            See More Party Memories
          </a>
        </div>
      </section>
    </>
  );
}
