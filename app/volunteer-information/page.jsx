import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';
import { getCampFacts, campHeadline, dayRange, venueFor, sharedWeekday } from '@/lib/campFacts';
import { dollars } from '@/lib/payments';

export const metadata = { title: 'Volunteer (STM) Information' };

const whatToBring = [
  'Beach towels',
  'Money for camp store (if you would like)',
  'Bible, notebook, pen',
  'Bug spray, sunscreen',
  'Casual, comfortable clothing (please make modest clothing choices avoiding skinny strap tank tops, short shorts and skirts)',
  'Shoes comfortable for doing a lot of walking around camp',
  'Water shoes (for whitewater rafting)',
  'Modest, full coverage bathing suit',
  'Toiletries and other personal items',
  'Jacket',
  'Camping chair(s) with your name on them',
  'Special food or medical equipment needed',
  'Medication',
  'Pillow',
  'Sleeping bag or linens for twin bunk',
  'Towel for showering',
];

const linkCls = 'text-brand underline font-semibold';

// What a visitor can do today, from the registration window on Setup
// (camp.state, 23 Nov 2026, review A4-09), the same rule as Camper
// Information: register while it is open, make an account before it opens,
// and after it closes the office address and a log-in for volunteers already
// registered.
function RegisterBlock({ camp }) {
  const state = camp?.state ?? 'none';
  if (state === 'open') {
    return (
      <>
        <div className="prose-site mt-6">
          <p>
            To volunteer, create an account, register for the week you&rsquo;d
            like to serve (choose the role &ldquo;Volunteer&rdquo;), and fill
            out an application telling us where you&rsquo;d like to help. Start
            below and the page will walk you through it.
          </p>
        </div>
        <Link href="/register/volunteer" className="btn-primary mt-6 inline-block">
          Volunteer: Start Here
        </Link>
        <p className="mt-6 text-neutral-600">
          Already have an account?{' '}
          <Link href="/account/?next=/register/volunteer/" className={linkCls}>
            Log in and pick up where you left off
          </Link>
          .
        </p>
      </>
    );
  }
  if (state === 'soon') {
    return (
      <>
        <div className="prose-site mt-6">
          <p>
            Registration opens {camp.opensOn ?? 'soon'}. Create your account now so you are ready.
          </p>
        </div>
        <Link href="/account/signup/" className="btn-primary mt-6 inline-block">
          Create an Account
        </Link>
        <p className="mt-6 text-neutral-600">
          Already have an account?{' '}
          <Link href="/account/" className={linkCls}>
            Log in
          </Link>
          .
        </p>
      </>
    );
  }
  return (
    <div className="prose-site mt-6">
      <p>
        Questions about volunteering? Email{' '}
        <a href="mailto:registration@luke14ministries.net" className={linkCls}>
          registration@luke14ministries.net
        </a>
        .
      </p>
      <p>
        Already registered?{' '}
        <Link href="/account/" className={linkCls}>
          Log in
        </Link>
        .
      </p>
    </div>
  );
}

// Dates and price from Setup (getCampFacts, 28 Oct 2026). Volunteers arrive
// the day before campers (events.volunteer_arrives_on).
export default async function VolunteerInformationPage() {
  const camp = await getCampFacts();
  const venue = venueFor(camp);
  // Weekdays from the weeks' dates (23 Nov 2026, review A4-10): volunteers
  // from their arrival day, the camp's first day when Setup has none. The
  // page's Sunday and Friday when there is no camp or the weeks disagree.
  const arriveDay = (camp && sharedWeekday(camp.weeks.map((w) => w.volunteerArrivesOn ?? w.startsOn))) ?? 'Sunday';
  const leaveDay = (camp && sharedWeekday(camp.weeks.map((w) => w.endsOn))) ?? 'Friday';
  return (
    <>
      <PageHero
        image={asset('/images/_DSC0109.jpg')}
        title="Volunteer (STM) Information"
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <h2 className="text-3xl font-bold">
          {campHeadline(camp, { volunteers: true })}
        </h2>
        <div className="prose-site mt-6">
          <p>
            Camp Celebrate is only possible with the help of incredible
            volunteers. Come share in this week of Kingdom work by providing a
            space for fun, community, and belonging to families affected by
            disability.
          </p>
        </div>
        <RegisterBlock camp={camp} />
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/20210720_201746.jpg')}
            alt="Camp Celebrate volunteers"
            className="rounded-lg shadow-sm w-full mb-8"
          />
          <h2 className="text-3xl font-bold mb-6">Location, Dates, Schedule</h2>
          <div className="prose-site">
            {/* Setup's Location when set (0184, 23 Nov 2026), linked like
                Camper Information's (venueFor). */}
            <p>
              {venue.href ? (
                <a href={venue.href} target="_blank" rel="noopener" className="text-brand font-semibold underline">
                  {venue.name}
                </a>
              ) : (
                venue.name
              )}
            </p>
            {camp ? (
              <p>
                {camp.year} Dates:
                {camp.weeks.map((w, n) => (
                  <span key={w.name}>
                    <br />
                    {dayRange(w.volunteerArrivesOn ?? w.startsOn, w.endsOn)}
                    {n < camp.weeks.length - 1 ? ' and' : ''}
                  </span>
                ))}
              </p>
            ) : (
              <p>Next year&rsquo;s dates will be posted soon.</p>
            )}
            <p>
              Each week volunteers arrive at camp on {arriveDay} morning and leave
              by 3:00 PM on {leaveDay}. We will email arrival times before camp.
            </p>
          </div>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/DSC_0597.jpg')}
          alt="Camp Celebrate volunteers"
          className="rounded-lg shadow-sm w-full mb-8"
        />
        <h2 className="text-3xl font-bold mb-6">Cost</h2>
        {camp?.priceCents != null && (
          <p className="text-4xl font-bold text-brand mb-6">
            {dollars(camp.priceCents)}
            {camp.samePrice ? '' : ' and up'} a week
          </p>
        )}
        <div className="prose-site">
          {/* The both-weeks discount from Setup (23 Nov 2026, review A4-26);
              the page's own sentence when Setup sets none. */}
          {camp?.bothWeeksPercent > 0 ? (
            <p>Serving both weeks? The second week is {camp.bothWeeksPercent}% off.</p>
          ) : (
            <p>
              Assistance is available for the second week if a volunteer wishes
              to participate in both weeks.
            </p>
          )}
          <p>
            Keep in mind, this is a mission trip! You are leaving home and
            availing yourself to serve and share the love of Jesus with those
            whom the Lord loves. Don&rsquo;t be shy in asking for support for
            this week just as you would if you were going halfway around the
            world!
          </p>
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/DSC_0340.jpg')}
            alt="Camp Celebrate volunteers"
            className="rounded-lg shadow-sm w-full mb-8"
          />
          <h2 className="text-3xl font-bold mb-6">What to Expect</h2>
          <div className="prose-site">
            <p>
              The first day and a half of camp for STMs (short term
              missionaries) is filled with training to ensure you are equipped
              to effectively serve our families affected by disabilities. There
              will be plenty of time to ask questions! You will likely be a
              buddy assigned to a camper who has a disability. You will be
              there to help them, get to know their family, and give your
              camper the best Family Retreat possible! (You will not be
              required to help with the toileting needs of your buddies)
            </p>
            <p>
              If you are not assigned a specific camper, you&rsquo;ll be
              assigned as a helper in one of the program areas. You&rsquo;ll
              find out this assignment during your first day of training.
            </p>
            <p>
              You will stay on campus in an assigned bunkhouse or cabin with
              other volunteers for your home away from home.
            </p>
          </div>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/DSC_0382.jpg')}
          alt="Camp Celebrate volunteers"
          className="rounded-lg shadow-sm w-full mb-8"
        />
        <h2 className="text-3xl font-bold mb-6">What to Bring</h2>
        <ul className="list-disc pl-6 space-y-2 text-lg text-neutral-700">
          {whatToBring.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
