import { asset } from '@/lib/site';
export const metadata = { title: 'Mission & Story' };

export default function MissionPage() {
  return (
    <>
      <section className="bg-brand-dark text-white py-16">
        <div className="container-site text-center max-w-3xl mx-auto">
          <p className="text-2xl sm:text-3xl font-heading leading-relaxed sm:leading-9">
            &ldquo;Go out quickly to the streets and lanes of the city, and
            bring in the poor and crippled and blind and lame...Go out to the
            highways and hedges and compel people to come in, that my house may
            be filled.&rdquo;
          </p>
          <p className="mt-6 text-lg text-neutral-200">— Luke 14:21–23</p>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold mb-6">Our Mission</h1>
        <div className="prose-site">
          <p className="font-semibold">
            Luke 14 Ministries exists to help families and individuals affected
            by disability find community and connection to Jesus through His
            church.
          </p>
          <p>
            This purpose is the driving force behind all that we do. From
            providing services to celebrations, we aim to train and build
            infrastructure for those affected by disability both locally and
            globally.
          </p>
        </div>

        <h2 className="text-3xl font-bold mt-12 mb-6">Our Story</h2>
        <div className="prose-site">
          <p>
            Luke 14 Ministries was formed as a non-profit organization in
            August of 2017. The non-profit was formed to provide clarity of
            vision, accountability, and efficiency for several ministries God
            was developing to serve people affected by disability, both locally
            and globally.
          </p>
          <p>
            As we have continued to grow, we can see that God is at work
            through our ministry and our programs. We hope you will consider
            becoming part of our story!
          </p>
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/DSC_0915.jpg')}
          alt="Camp Celebrate families"
          className="mt-10 rounded-lg shadow-sm w-full"
        />
      </section>
    </>
  );
}
