import Link from 'next/link';
import { Rubik } from 'next/font/google';
import { asset } from '@/lib/site';
import { getRetreatFacts } from '@/lib/campFacts';
import { formatDueDate } from '@/lib/events';
import { dollars } from '@/lib/payments';

export const metadata = { title: 'Adult Adventure Retreat' };

// The dates, price, spots and whether registration is open come from the
// retreat event on Setup (getRetreatFacts, Lawrence 5 Nov 2026), like the camp
// pages. Until then this page printed them by hand and sent people to
// CampSite, where the 2026 retreat registered (Ellen, 14 Oct 2026); that
// retreat is over, and the next one registers here. With no retreat
// published ahead, the page says the dates are coming and offers no button.
//
// The arrival time is not a Setup field, so it stays here: the weekday follows
// the start date, the time is this line.
const ARRIVAL_TIME = '6:00 PM';

const day = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

// "Oct 29 – Nov 1" (short months: the hero's four-column grid is narrow).
function shortRange(fromIso, toIso) {
  if (!toIso || toIso === fromIso) return day(fromIso, { month: 'short', day: 'numeric' });
  return fromIso.slice(5, 7) === toIso.slice(5, 7)
    ? `${day(fromIso, { month: 'short', day: 'numeric' })}–${day(toIso, { day: 'numeric' })}`
    : `${day(fromIso, { month: 'short', day: 'numeric' })} – ${day(toIso, { month: 'short', day: 'numeric' })}`;
}

// The banner's dates (Lawrence, 5 Nov 2026: "a dynamically visual version
// where dates appear when the event gets published"). The artwork is the old
// banner with its "Oct. 29 - Nov. 1" painted out (adult_adventure_banner_no_
// dates.jpeg; the original is adult_adventure_screen_snip.jpeg), and the page
// sets the dates from Setup over the blank band: same gold, a heavy rounded
// face close to the artwork's, placed and sized in proportion to the image
// (cqw), so it sits right at any width. No retreat published, no dates: the
// band is simply empty.
const bannerFont = Rubik({ subsets: ['latin'], weight: '900', display: 'swap' });
const BANNER_GOLD = '#FCB316';
// AP style, as the artwork had it: "Oct.", "Nov.", but "May", "June", "July".
const AP_MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
function bannerDates(fromIso, toIso) {
  const md = (iso) => [AP_MONTHS[Number(iso.slice(5, 7)) - 1], Number(iso.slice(8, 10))];
  const [m1, d1] = md(fromIso);
  if (!toIso || toIso === fromIso) return `${m1} ${d1}`;
  const [m2, d2] = md(toIso);
  return m1 === m2 ? `${m1} ${d1} – ${d2}` : `${m1} ${d1} – ${m2} ${d2}`;
}

// One line beside the button: what a visitor can do today.
function statusLine(r) {
  if (!r) return 'Dates and registration for the next retreat will be posted here soon.';
  if (r.state === 'open') {
    return r.early
      ? `Register by ${formatDueDate(r.early.endsOn)} and get ${dollars(r.early.cents)} off each person.`
      : `Registration for ${r.year} is open.`;
  }
  if (r.state === 'underway') return `The ${r.year} retreat is underway!`;
  if (r.state === 'closed') return `Registration for ${r.year} has closed.`;
  return r.opensOn ? `Registration for ${r.year} opens ${r.opensOn}.` : `Registration for ${r.year} opens soon.`;
}

// The hero borrows the BANNER'S PALETTE rather than reproducing the banner at
// full bleed. Three reasons:
//
//   1. The artwork is 16:9. Full width, it fills an entire laptop viewport
//      before a single word of the page is visible — a poster, not a header.
//   2. Its words are pixels. Dates, tagline and program name set as real text
//      can be selected, searched, read by a screen reader, and corrected in
//      one line when they change. This page having the WRONG dates until
//      today is exactly what happens when the facts live only in an image.
//   3. Keeping the artwork beside the text lets both do their job: the mark
//      and the colours carry the feel, the text carries the information.
//
// Colours sampled from the banner: deep pine, the gold of the header band, the
// mid-green of the treeline.
const PINE = '#14544A';
const GOLD = '#F7B32B';

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-white/60">{label}</dt>
      <dd className="mt-0.5 font-bold">{children}</dd>
    </div>
  );
}

function RegisterButton({ retreat, className }) {
  if (!retreat?.open) return null;
  return (
    <Link href={retreat.registerHref} className={className}>
      Register for {retreat.year}
    </Link>
  );
}

export default async function AdultAdventureRetreatPage() {
  const retreat = await getRetreatFacts();
  return (
    <>
      <section style={{ backgroundColor: PINE }} className="text-white">
        <div className="container-site py-12 lg:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p
                className="text-sm font-bold uppercase tracking-[0.2em]"
                style={{ color: GOLD }}
              >
                Camp Celebrate
              </p>
              <h1 className="mt-2 text-4xl sm:text-5xl font-bold leading-tight sm:leading-none">
                Adult Adventure Retreat
              </h1>
              <p className="mt-4 text-xl text-white/90">
                A retreat tailored for independent adults with disabilities
                &mdash; adventure, worship and community in the mountains near Gatlinburg.
              </p>

{retreat && (
                <dl className="mt-7 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
                  {/* The YEAR belongs here: without it a returning family
                      cannot tell this year's retreat from last year's page
                      (25 Aug). On its own line, so the range never wraps
                      across the dash (25 Aug). */}
                  <Fact label="Dates">
                    <span className="whitespace-nowrap">{shortRange(retreat.startsOn, retreat.endsOn)}</span>
                    <br />
                    {retreat.year}
                  </Fact>
                  <Fact label="Arrival">
                    {ARRIVAL_TIME} {day(retreat.startsOn, { weekday: 'long' })}
                  </Fact>
                  {retreat.priceCents != null && <Fact label="Cost">{dollars(retreat.priceCents)} per person</Fact>}
                  {retreat.capacity != null && <Fact label="Spots">Limited to {retreat.capacity}</Fact>}
                </dl>
              )}

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <RegisterButton retreat={retreat} className="btn-gold px-8!" />
                <span className="text-white/80">{statusLine(retreat)}</span>
              </div>
            </div>

            {/* Decorative: everything it says is also said in text beside it,
                so it carries an empty alt (and the dates aria-hidden) rather
                than repeating the page to someone using a screen reader.
                Sized up and centre-aligned with the text block (24 Aug
                feedback) so the two read as one composition rather than a
                picture stapled to a paragraph. */}
            <div className="@container relative self-start lg:scale-105 lg:origin-left">
              <img
                src={asset('/images/adult_adventure_banner_no_dates.jpeg')}
                alt=""
                className="block w-full h-auto rounded-lg shadow-xl"
              />
              {retreat?.startsOn && (
                <span
                  aria-hidden="true"
                  // Where the artwork's dates were: centred at 78% across and
                  // 73% down; 3.7cqw gives their height.
                  className={`${bannerFont.className} pointer-events-none absolute left-[78%] top-[73%] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[3.7cqw] leading-none`}
                  style={{ color: BANNER_GOLD }}
                >
                  {bannerDates(retreat.startsOn, retreat.endsOn)}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* One prose section, and it deliberately does NOT repeat the hero.
          Dates, price, capacity and the buddy promise are already above;
          repeating them here was the redundancy testing flagged. This section
          answers the next questions instead: what the weekend is actually
          like, and what happens after registering. */}
      <section className="py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">What the weekend looks like</h2>
          <div className="prose-site">
            <p>
              Days are built around real adventure in the Smokies &mdash; time outdoors,
              activities chosen for the group, and space to try things with support close
              by. Evenings are worship, food, and the kind of unhurried time together
              that turns a retreat into friendships that last past the weekend.
            </p>
            <p>
              It is designed for adults who manage their day-to-day with a degree of
              independence &mdash; and the trained buddy each participant is paired with
              is there to make the adventure bigger, not smaller.
            </p>
            {retreat?.open && <p>Registering takes a few minutes and holds your place.</p>}
          </div>
          {retreat?.open ? (
            <div className="mt-8 flex flex-wrap gap-4">
              <RegisterButton retreat={retreat} className="btn-primary px-8!" />
            </div>
          ) : (
            <p className="mt-8 text-neutral-700">
              Questions about the next retreat?{' '}
              <Link href="/contact/" className="text-brand underline font-semibold">
                Get in touch
              </Link>
              .
            </p>
          )}
        </div>
      </section>
    </>
  );
}
