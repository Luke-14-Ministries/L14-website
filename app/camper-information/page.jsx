import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';
import { getCampFacts, campHeadline, dayRange, venueFor, sharedWeekday } from '@/lib/campFacts';
import { formatDueDate } from '@/lib/events';
import { dollars } from '@/lib/payments';

export const metadata = { title: 'Camper Information' };

const whatToBring = [
  'Beach towels',
  'Money for camp store (if you would like)',
  'Bible, notebook, pen',
  'Bug spray, sunscreen',
  'Casual, comfortable clothing',
  'Shoes comfortable for walking around camp',
  'Water shoes (for whitewater rafting)',
  'Modest, full coverage bathing suit',
  'Toiletries and other personal items',
  'Jacket',
  'Camping chair(s) with your name on them',
  'Camera',
  'Special food or medical equipment needed',
  'Medication',
];

const linkCls = 'text-brand underline font-semibold';

// What a visitor can do today, from the registration window on Setup
// (camp.state, 23 Nov 2026, review A4-09). The page offered "Get Started"
// and "Log in and register" all year, so in December it sent families into
// a wizard with no week to choose. Before opening day it offers the account
// only; once registration has closed (or camp is underway, or Setup has no
// camp ahead) it gives the office address and a log-in for families already
// registered.
function RegisterBlock({ camp }) {
  const state = camp?.state ?? 'none';
  if (state === 'open') {
    return (
      <>
        <div className="prose-site mt-6">
          {camp.early && (
            <p>
              Register by <strong>{formatDueDate(camp.early.endsOn)}</strong> and get{' '}
              {dollars(camp.early.cents)} off each person when you pay in full or set up a payment plan.
            </p>
          )}
          <p>New to Camp Celebrate? Create an account to get started and register.</p>
        </div>
        <Link href="/account/signup/?next=/register/family/" className="btn-primary mt-6 inline-block">
          Get Started
        </Link>
        <p className="mt-6 text-neutral-600">
          Already have an account?{' '}
          <Link href="/account/?next=/register/family/" className={linkCls}>
            Log in and register
          </Link>
          . Volunteering? Start at the{' '}
          <Link href="/register/volunteer" className={linkCls}>
            volunteer page
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
          {/* The headline above already gives the opening day. */}
          <p>Create your account now so you are ready.</p>
          {camp.early && (
            <p>
              Register by <strong>{formatDueDate(camp.early.endsOn)}</strong> and get{' '}
              {dollars(camp.early.cents)} off each person when you pay in full or set up a payment plan.
            </p>
          )}
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
        Questions about camp? Email{' '}
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

// The dates, price and early offer come from Setup (getCampFacts, 28 Oct
// 2026), so this page can never again advertise last month's offer.
export default async function CamperInformationPage() {
  const camp = await getCampFacts();
  const venue = venueFor(camp);
  // The weekdays from the weeks' own dates (23 Nov 2026, review A4-10); the
  // page's long-standing Monday and Friday when Setup has no camp or the
  // weeks fall on different days.
  const arriveDay = (camp && sharedWeekday(camp.weeks.map((w) => w.startsOn))) ?? 'Monday';
  const leaveDay = (camp && sharedWeekday(camp.weeks.map((w) => w.endsOn))) ?? 'Friday';
  return (
    <>
      <PageHero
        image={asset('/images/DSC_0834.jpg')}
        title="Camper Information"
      />

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <h2 className="text-3xl font-bold">
          {campHeadline(camp)}
        </h2>
        <RegisterBlock camp={camp} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/20210720_195424.jpg')}
          alt="Camp Celebrate"
          className="mt-12 rounded-lg shadow-sm w-full"
        />
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">Location, Dates, Schedule</h2>
          <div className="prose-site">
            {/* The event's Location from Setup when staff have set it (0184,
                23 Nov 2026); the venue this page always named otherwise,
                linked to its current page (venueFor, lib/campFacts.js). */}
            <p>
              {venue.href ? (
                <a href={venue.href} target="_blank" rel="noopener" className="text-brand font-semibold underline">
                  {venue.name}
                </a>
              ) : (
                <span className="font-semibold">{venue.name}</span>
              )}
            </p>
            {camp ? (
              <p>
                {camp.year} Dates:
                {camp.weeks.map((w, n) => (
                  <span key={w.name}>
                    <br />
                    {dayRange(w.startsOn, w.endsOn)}
                    {w.full && !camp.full ? ' (full: registering joins the waiting list)' : ''}
                    {n < camp.weeks.length - 1 ? ' and' : ''}
                  </span>
                ))}
              </p>
            ) : (
              <p>Next year&rsquo;s dates will be posted soon.</p>
            )}
            <p>
              Campers arrive on {arriveDay} afternoon each week and leave before
              lunch on {leaveDay}. We will email arrival times before camp.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/DSC_0945.jpg')}
            alt="Camp Celebrate"
            className="mt-10 rounded-lg shadow-sm w-full"
          />
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-6">Cost</h2>
        {camp?.priceCents != null && (
          <p className="text-4xl font-bold text-brand mb-6">
            {dollars(camp.priceCents)}
            {camp.samePrice ? '' : ' and up'}
          </p>
        )}
        <div className="prose-site">
          <p>
            The rooms for families are hotel-style rooms with 2 double beds
            each (limited number of rollaways available). If you will need a
            second room, please contact us at{' '}
            <a
              href="mailto:registration@luke14ministries.net"
              className="text-brand font-semibold underline"
            >
              registration@luke14ministries.net
            </a>{' '}
            to discuss your specific situation.
          </p>
          <p>
            <em>
              Please <strong>do not</strong> let the cost keep you from
              inquiring about attending camp. Please go ahead and register or
              reach out to{' '}
              <a
                href="mailto:registration@luke14ministries.net"
                className="text-brand font-semibold underline"
              >
                registration@luke14ministries.net
              </a>{' '}
              if you have a question about scholarship money.
            </em>
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/20210721_140401.jpg')}
          alt="Camp Celebrate"
          className="mt-10 rounded-lg shadow-sm w-full"
        />
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">What to Expect</h2>
          <div className="prose-site">
            <p>
              You can expect lots of time to enjoy activities as a family,
              teaching and worship times as a large group, free time to spend
              while your children are well cared for, refreshing and
              encouraging time with other men and women who have walked a road
              similar to yours, fun, safe and age appropriate programs for each
              camper attending, and so much more!
            </p>
            <p>
              There will be a buddy assigned to your family member who has a
              disability. They will be there to help you, get to know you all
              and give your camper the best Family Retreat possible! (They
              cannot help with personal needs, so you&rsquo;ll set meeting
              times and places to take care of those needs.)
            </p>
            <p>
              Carson Springs Baptist Conference Center has beautiful
              hotel-style accommodations, and the dining hall is in the same
              building for quick and easy access.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/DSC_0060.jpg')}
            alt="Camp Celebrate"
            className="mt-10 rounded-lg shadow-sm w-full"
          />
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
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
