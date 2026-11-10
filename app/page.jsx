import Link from 'next/link';
import { asset } from '@/lib/site';
import { getCampFacts, getRetreatFacts } from '@/lib/campFacts';

// The home page, revised 10 Nov 2026 after a side-by-side review against the
// live Squarespace site (Lawrence: "implement all of those suggestions"):
//   - a short headline, with the mission sentence under it in smaller type;
//   - one line under each program card saying who it is for, and a
//     registration line read from Setup for the programs that register here;
//   - Adult Adventure Retreat as a fourth program (it registers on this site);
//   - one wide camp photo with a verse, borrowed from the live site's
//     full-width photo bands, which gave the pictures room;
//   - an action line on each Get Involved card;
//   - card photos are decoration (alt=""), so a screen reader reads each
//     card's title once, not twice;
//   - the last section meets the footer (no empty white strip).

// What a program card says about registration, from the events on Setup
// (getCampFacts / getRetreatFacts). Nothing when Setup has no event ahead.
function registrationLine(facts) {
  if (!facts) return null;
  if (facts.state === 'open') return 'Registration open';
  if (facts.state === 'soon') return facts.opensOn ? `Registration opens ${facts.opensOn}` : 'Registration opens soon';
  return null;
}

function ProgramCard({ title, line, status, href, image }) {
  return (
    <Link href={href} className="group relative block overflow-hidden rounded-lg shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt=""
        className="h-72 w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/30 to-black/0" />
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        {status && (
          <span className="mb-2 inline-block rounded-full bg-brand-gold px-2.5 py-0.5 text-xs font-bold text-neutral-900">
            {status}
          </span>
        )}
        <h3 className="text-2xl sm:text-3xl font-bold drop-shadow-sm">{title}</h3>
        <p className="mt-1 text-sm sm:text-base text-white/90">{line}</p>
      </div>
    </Link>
  );
}

function ActionCard({ title, line, href, image }) {
  return (
    <Link href={href} className="group relative block overflow-hidden rounded-lg shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt=""
        className="h-56 w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/25 to-black/0" />
      <div className="absolute inset-x-0 bottom-0 p-5 text-center text-white">
        <h3 className="text-2xl sm:text-3xl font-bold drop-shadow-sm">{title}</h3>
        <p className="mt-1 text-sm sm:text-base text-white/90">{line}</p>
      </div>
    </Link>
  );
}

const actions = [
  { title: 'Volunteer', line: 'Serve at camp or an event', href: '/volunteer-information', image: asset('/images/DSC_0199.jpg') },
  { title: 'Donate', line: 'Give online', href: '/donate', image: asset('/images/Kenya_2018_3268.jpg') },
  { title: 'Pray', line: 'Join the prayer list', href: '/pray', image: asset('/images/DSC_0264.jpg') },
];

// No buttons on the photo (Lawrence, 10 Nov 2026: "distracting and
// redundant"): Donate is in the header and the camp is the first program card.
export default async function HomePage() {
  const [camp, retreat] = await Promise.all([getCampFacts(), getRetreatFacts()]);

  const programs = [
    {
      title: 'Camp Celebrate',
      line: 'A family retreat for those affected by disability',
      status: registrationLine(camp),
      href: '/camp-celebrate',
      image: asset('/images/DSC_0012.jpg'),
    },
    {
      title: 'Adult Adventure Retreat',
      line: 'A retreat for independent adults with disabilities',
      status: registrationLine(retreat),
      href: '/adult-adventure-retreat',
      image: asset('/images/IMG_2225.jpg'),
    },
    {
      title: 'Luke 14 Party',
      line: 'A celebration of friends with disabilities',
      href: '/luke-14-party',
      image: asset('/images/DSC_4801.jpg'),
    },
    {
      title: 'Wheels for Kenya',
      line: 'Wheelchairs for people with disabilities across Kenya',
      href: '/wheels-for-kenya',
      image: asset('/images/Picture2.jpg'),
    },
  ];

  return (
    <>
      {/* The group photo's people run from about 23% to 90% of its height
          (raised hands to the front row's feet). A fixed 480px band cut off
          the front row and the top (Lawrence, 10 Nov 2026), so on wider
          screens the band keeps a 21:10 shape and sits a little low, which
          shows everyone; phones keep the 480px minimum the words need. */}
      <section
        className="relative flex items-center justify-center min-h-[480px] sm:aspect-[21/10] bg-cover"
        style={{
          backgroundImage: `url(${asset('/images/IMG_3690_2__281_29.jpg')})`,
          backgroundPosition: 'center 62%',
        }}
      >
        <div className="absolute inset-0 bg-black/45" />
        <div className="relative container-site py-20 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-white drop-shadow-sm">
            Every family has a place here
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg sm:text-xl leading-relaxed text-white/95 drop-shadow-sm">
            Luke 14 Ministries helps families and individuals affected by disability find community
            and connection to Jesus through His church.
          </p>
        </div>
      </section>

      <section className="container-site py-14">
        <h2 className="text-3xl font-bold text-center mb-8">Our Programs</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {programs.map((p) => (
            <ProgramCard key={p.href} {...p} />
          ))}
        </div>
      </section>

      {/* The live site's full-width photo bands gave the camp pictures room;
          one band keeps that warmth. The verse is the mission page's. */}
      <section
        className="relative bg-cover bg-center"
        style={{ backgroundImage: `url(${asset('/images/DSC_0661.jpg')})` }}
      >
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative container-site max-w-3xl mx-auto py-24 sm:py-32 text-center text-white">
          <p className="text-2xl sm:text-3xl font-heading leading-relaxed drop-shadow-sm">
            &ldquo;Go out to the highways and hedges and compel people to come in, that my house may
            be filled.&rdquo;
          </p>
          <p className="mt-4 text-lg text-white/90">Luke 14:23</p>
        </div>
      </section>

      {/* -mb-16 meets the footer, whose mt-16 otherwise left a white strip
          under this tinted section. */}
      <section className="bg-brand-light py-14 -mb-16">
        <div className="container-site">
          <h2 className="text-3xl font-bold text-center mb-8">Get Involved</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {actions.map((a) => (
              <ActionCard key={a.href} {...a} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
