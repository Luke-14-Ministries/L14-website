import Link from 'next/link';
import { asset } from '@/lib/site';

export const metadata = { title: 'The Hazelnut Movement' };

const BOOK_PROGRAM_URL =
  'https://airtable.com/appWUKasL3QE7kQdp/shrPF27Ua1vizjOOY';
const FREE_BOOKS_URL = 'https://airtable.com/appWUKasL3QE7kQdp/shrf3dAY60vKCRqa8';
const DONATE_SQUARE_URL =
  'https://checkout.square.site/merchant/MLJ34EFRHQKNZ/checkout/CMHHU42EH3T752PHIFSW652F';
const AMAZON_STORE_URL =
  'https://www.amazon.com/stores/Julia-Erman/author/B0CMXYYSF1?ref=ap_rdr&isDramIntegrated=true&shoppingPortalEnabled=true&ccs_id=d209bfdf-1c85-48b0-ad5e-7b217cf13daa';

const faqs = [
  {
    question: 'How much does the assembly cost?',
    answer: [
      'The cost of an assembly varies depending on the program, the number of students, and how many sessions we host at your school. We never want cost to hold you back from bringing this message to your students. Thanks to our generous donors and sponsors, we’re often able to reduce or fully cover program fees through grants or sponsorships.',
      '👉 Reach out to our team, and we’ll work together to make it possible for your school!',
    ],
  },
  {
    question: 'How long is the school assembly?',
    answer: [
      'Each assembly typically runs 30 to 45 minutes, depending on your school’s schedule and needs.',
    ],
  },
  {
    question: 'What age group is the assembly best for?',
    answer: [
      'Our school assembly is designed for Kindergarten through 5th grade students. While all age groups are positively impacted, we find that 2nd to 5th graders often connect with the message on a deeper level.',
      'To ensure the content is developmentally appropriate, we usually divide the presentation into two groups:',
      '• Kindergarten–1st Grade: A simplified, interactive version of the message',
      '• 2nd–5th Grade: A slightly more in-depth presentation that encourages empathy, understanding, and action',
    ],
  },
  {
    question: 'What is the main message of the assembly?',
    answer: [
      'The main message of the assembly is that we are all created different and unique on purpose. We encourage students to discover and embrace their superpower—that one thing they’re truly gifted at. Rather than focusing on weaknesses or what makes them different, we help them see their challenges—and the challenges of others, including those impacted by disability—as a potential strength.',
      'Students walk away empowered to appreciate their own uniqueness and to show kindness and understanding toward others.',
    ],
  },
];

export default function HazelnutMovementPage() {
  return (
    <>
      <section className="bg-brand-dark text-white py-16">
        <div className="container-site max-w-3xl mx-auto text-center">
          <h1 className="text-4xl font-bold mb-6">The Hazelnut Movement</h1>
          <p className="text-xl leading-relaxed">
            Children and adults alike walk away from our programs with a deeper
            sense of compassion &mdash; for themselves, their friends, and
            individuals affected by disabilities. They leave with a rich
            understanding that every life has purpose, every story matters, and
            we are all uniquely created on purpose, for a purpose.
          </p>
          <a
            href={BOOK_PROGRAM_URL}
            target="_blank"
            rel="noopener"
            className="btn-gold mt-8 inline-block"
          >
            Book a Kids Program
          </a>
        </div>
      </section>

      <section className="container-site py-14">
        <div className="grid gap-6 sm:grid-cols-2 max-w-4xl mx-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/IMG_9248.jpg')}
            alt="Hazelnut Movement program"
            className="rounded-lg shadow-sm w-full h-72 object-cover"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/IMG_9247.jpg')}
            alt="Hazelnut Movement program"
            className="rounded-lg shadow-sm w-full h-72 object-cover"
          />
        </div>

        <blockquote className="max-w-3xl mx-auto mt-12 text-center">
          <p className="text-xl italic leading-relaxed text-neutral-700">
            &ldquo;The Hazelnut Movement school assembly was amazing and I
            could hear the students talking about it in the hallway. I
            recommend you invite her to talk to your students and staff. She
            has an amazing story to share. Thank you, Julia for sharing your
            journey with Soddy Elementary School!&rdquo;
          </p>
          <footer className="mt-4 font-bold">
            - Christina Moore- Assistant Principle
          </footer>
        </blockquote>

        <div className="flex flex-wrap justify-center gap-4 mt-10">
          <a
            href={BOOK_PROGRAM_URL}
            target="_blank"
            rel="noopener"
            className="btn-primary"
          >
            Book a Kids Program
          </a>
          <a
            href={DONATE_SQUARE_URL}
            target="_blank"
            rel="noopener"
            className="btn-gold"
          >
            Donate
          </a>
          <a
            href={FREE_BOOKS_URL}
            target="_blank"
            rel="noopener"
            className="btn-outline"
          >
            Free Books for Educators
          </a>
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-2">About the Movement</h2>
          <p className="text-lg text-brand font-semibold mb-6">
            Sharing stories, encouraging questions and inspiring compassion
          </p>
          <div className="prose-site">
            <p>
              The Hazelnut Movement was started in 2022 by Julia Erman. She
              embarked on a mission to provide parents and educators with
              resources to help them teach their children about other children
              with special needs.
            </p>
            <p>
              Having been a special needs parent with two children affected by
              a very rare genetic disorder within the NKH family, she come to
              realize that many parents and educators lack the knowledge of how
              to discuss children with special needs. Some fear saying the
              wrong thing, while others simply avoid the topic due to a lack of
              proper guidance. This is where the Hazelnut Movement steps in!
            </p>
            <p>
              We believe that storytelling is the catalyst for compassion. One
              book at a time, we aim to initiate those crucial conversations.
            </p>
            <p>
              If you haven&rsquo;t yet explored our selection of books, I
              encourage you to do so. I assure you that each page will warm
              your heart and leave you feeling blessed after reading.
            </p>
            <p>
              As of July 1, 2024, Luke 14 Ministries and The Hazelnut Movement
              school programs have officially partnered.
            </p>
          </div>
          <div className="mt-8">
            <a
              href={BOOK_PROGRAM_URL}
              target="_blank"
              rel="noopener"
              className="btn-primary"
            >
              Book a School Program
            </a>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 mt-10 items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset('/images/IMG_0710.jpg')}
              alt="Julia Erman"
              className="rounded-lg shadow-sm w-full h-80 object-cover object-top"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset('/images/Hazelnut_Movement_Logo.png')}
              alt="Hazelnut Movement logo"
              className="w-full max-w-xs mx-auto"
            />
          </div>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-2">Kids Programming</h2>
        <p className="text-lg font-bold mb-6">
          Inspiring Kids to See Differences as Superpowers
        </p>
        <div className="prose-site">
          <p>
            Our interactive programs help children discover that{' '}
            <strong>we are all created differently on purpose</strong> &mdash;
            and that our differences are what make us powerful. Through
            storytelling, hands-on learning, and reflection, kids learn to
            embrace their strengths, appreciate others, and use their
            &ldquo;superpowers&rdquo; to make a difference.
          </p>
          <p>
            We customize each experience to fit your setting &mdash; whether
            it&rsquo;s a <strong>school, church, or community organization</strong>.
            Programs are available in{' '}
            <strong>both inclusive public-school formats</strong> and{' '}
            <strong>faith-based options</strong> for churches or Christian
            schools.
          </p>
        </div>
        <div className="mt-8">
          <a
            href="https://www.youtube.com/watch?v=JZEqrfORvNQ&feature=youtu.be"
            target="_blank"
            rel="noopener"
            className="btn-outline"
          >
            Preview the Program
          </a>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 mt-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/P2070845__281_29.jpeg')}
            alt="Kids programming"
            className="rounded-lg shadow-sm w-full h-64 object-cover"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/C0735049-811C-481C-A7C8-72D443391391__281_29.jpeg')}
            alt="Kids programming"
            className="rounded-lg shadow-sm w-full h-64 object-cover"
          />
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">For Public Schools</h2>
          <div className="prose-site">
            <p>
              Our flexible school program is designed for{' '}
              <strong>assemblies, or classroom visits</strong>.
            </p>
            <p>
              Through <em>The Hazelnut Takeover Assembly</em>, students are
              invited into Hazel&rsquo;s story &mdash; a story that helps them
              see their own challenges and differences as gifts. With engaging
              storytelling, group participation, and reflection, students walk
              away inspired to use their unique &ldquo;superpowers&rdquo; to
              create a kinder, more inclusive community.
            </p>
            <p>
              <em>Program length:</em> 30&ndash;45 minutes
              <br />
              <em>Ideal for:</em> Grades K&ndash;5th
            </p>
          </div>
          <div className="mt-8">
            <a
              href="https://www.instagram.com/reel/DL4hShBsa9E/?igsh=MTQ5b2MwaHJ0dGt3bA%3D%3D"
              target="_blank"
              rel="noopener"
              className="btn-outline"
            >
              Sneak Peek Here
            </a>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/IMG_4641.png')}
            alt="The Hazelnut Takeover Assembly"
            className="mt-10 rounded-lg shadow-sm w-full"
          />
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-6">
          For Churches &amp; Christian Schools
        </h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/IMG_6763.jpeg')}
          alt="Church program"
          className="rounded-lg shadow-sm w-full mb-8"
        />
        <div className="prose-site">
          <p className="font-bold">
            Helping kids see their unique differences as an opportunity to lean
            into use their superpowers we know as unique gifts.
          </p>
          <p>
            In our faith-based version, we connect the message of inclusion and
            purpose to <strong>biblical truth</strong>, helping kids see how
            God designed every person with unique gifts and abilities.
          </p>
          <p>
            Through stories, interactive teaching, and reflection, children
            learn that their differences are part of God&rsquo;s plan &mdash;
            and that His power shines through our weakness.
          </p>
          <p>
            <em>
              &ldquo;Each of you should use whatever gift you have received to
              serve others.&rdquo; &mdash; 1 Peter 4:10
              <br />
              &ldquo;My power is made perfect in weakness.&rdquo; &mdash; 2
              Corinthians 12:9
            </em>
          </p>
          <p>
            <em>Program length:</em> 30&ndash;45 minutes
            <br />
            <em>Ideal for:</em> Sunday School, Kids Church, or Chapel
          </p>
          <p>
            Through engaging storytelling and interactive moments, this program
            inspires students to see differences as strengths and empowers them
            to use their individual superpowers to support and uplift those
            around them.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 mt-8">
          <a
            href={BOOK_PROGRAM_URL}
            target="_blank"
            rel="noopener"
            className="btn-primary"
          >
            Request a Visit
          </a>
          <a
            href="https://www.instagram.com/reel/DQL_rJ9EfbB/?igsh=MWY0N2pwMTZvazZyOA%3D%3D"
            target="_blank"
            rel="noopener"
            className="btn-outline"
          >
            Sneak Peek
          </a>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 mt-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/IMG_4735.jpeg')}
            alt="Church program"
            className="rounded-lg shadow-sm w-full h-64 object-cover"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset('/images/IMG_3401.jpg')}
            alt="Church program"
            className="rounded-lg shadow-sm w-full h-64 object-cover"
          />
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">For Community Programs</h2>
          <div className="prose-site">
            <p>
              Our community-focused version offers{' '}
              <strong>hands-on, empathy-building experiences</strong> through
              three activity stations where kids explore what it&rsquo;s like
              to live without a certain ability &mdash; such as sight, speech,
              or mobility.
            </p>
            <p className="font-bold">These experiences help children:</p>
            <p>
              &bull; Develop compassion and understanding for others
              <br />
              &bull; Recognize their own strengths and challenges
              <br />
              &bull; Learn how to include and support others in meaningful ways
            </p>
            <p>
              <em>Program length:</em> 60&ndash;75 minutes
              <br />
              <em>Ideal for:</em> Boys &amp; Girls Clubs, after-school
              programs, or summer camps
            </p>
          </div>
          <div className="mt-8">
            <a
              href={BOOK_PROGRAM_URL}
              target="_blank"
              rel="noopener"
              className="btn-primary"
            >
              Book a Program
            </a>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 mt-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset('/images/tempImageuBFyHu.jpg')}
              alt="Community program"
              className="rounded-lg shadow-sm w-full h-64 object-cover"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset('/images/tempImage3gs7hu.jpg')}
              alt="Community program"
              className="rounded-lg shadow-sm w-full h-64 object-cover"
            />
          </div>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-2">Books for Educators</h2>
        <p className="text-lg text-brand font-semibold mb-6">
          Gifting books to educators all over the US and Canada
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset('/images/C0735049-811C-481C-A7C8-72D443391391.jpg')}
          alt="Books for Educators"
          className="rounded-lg shadow-sm w-full mb-8"
        />
        <h3 className="text-xl font-bold uppercase mb-4">What We Do</h3>
        <div className="prose-site">
          <p>
            We share stories, encourage questions and inspire compassion for
            the special needs and disability communities. After seeing how this
            simple mission has impacted so many lives we want to make sure that
            all educators can have access to The Hazelnut Books in their
            classroom if they so desire which is why we created the &ldquo;Books
            for Educators Program.&rdquo;
          </p>
          <p>
            $10 gifts a book to an educator for this school year. Our goal is
            to donate 2,000 books this year! So far we have had 27 books
            donated! What do you say you partner with us and help us reach out
            goal!
          </p>
          <p>
            And if you are an educator request a book for your classroom today!
            Just fill out the information below and we will consider you for
            our program!
          </p>
        </div>
        <div className="mt-8">
          <a
            href={FREE_BOOKS_URL}
            target="_blank"
            rel="noopener"
            className="btn-primary"
          >
            Apply for a FREE book
          </a>
        </div>
      </section>

      <section className="bg-brand-light py-14">
        <div className="container-site max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">Our Books</h2>
          <div className="prose-site">
            <p>
              <strong>Giving Every Story a Voice,</strong> One Book at a Time
              &mdash; <strong>Because Every Life Has Purpose,</strong> Every
              Story Matters, and No Family Should Ever Walk Their Journey
              Alone.
            </p>
            <p>
              Our books are written and published by{' '}
              <strong>Julia Erman</strong>, the founder of{' '}
              <strong>The Hazelnut Movement</strong>, and are an important part
              of how we share our message with kids and families.
            </p>
            <p>
              Each story helps children see that every life has purpose, every
              story matters, and no one should walk their journey alone. These
              books are also used throughout our{' '}
              <strong>Hazelnut Movement programs</strong> as tools to spark
              conversations about inclusion, empathy, and purpose.
            </p>
          </div>

          <h3 className="text-2xl font-bold mt-10 mb-4">
            Every Book You Buy Gives a Book
          </h3>
          <div className="prose-site">
            <p>
              For each book purchased, we donate the proceeds to gift books to
              children and educators. Because every child deserves to feel seen
              and every classroom needs these books.
            </p>
          </div>
          <div className="mt-8">
            <a
              href={AMAZON_STORE_URL}
              target="_blank"
              rel="noopener"
              className="btn-primary"
            >
              Shop All Books
            </a>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 mt-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset('/images/P2140153.png')}
              alt="Hazelnut Movement books"
              className="rounded-lg shadow-sm w-full h-64 object-cover"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset('/images/B5C7DD63-1654-438E-94E7-FD55B426D2F1.jpg')}
              alt="Hazelnut Movement books"
              className="rounded-lg shadow-sm w-full h-64 object-cover"
            />
          </div>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto">
        <h2 className="text-3xl font-bold mb-8">Frequently Asked Questions</h2>
        <div className="space-y-8">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <h3 className="text-xl font-bold mb-3">{faq.question}</h3>
              {faq.answer.map((paragraph, i) => (
                <p
                  key={i}
                  className="text-lg leading-relaxed text-neutral-700 mb-2"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-10">
          <a
            href={BOOK_PROGRAM_URL}
            target="_blank"
            rel="noopener"
            className="btn-primary"
          >
            Request a Visit
          </a>
        </div>
      </section>

      <section className="bg-brand-dark text-white py-16">
        <div className="container-site max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">
            Your Gift Creates Compassion
          </h2>
          <p className="text-lg leading-relaxed text-neutral-200">
            Every donation helps us provide books and resources to families,
            educators, and children who need them most. Whether you give $5 or
            $50, you&rsquo;re helping us spark empathy, inclusion, and lifelong
            understanding
          </p>
          <p className="mt-6 text-xl font-semibold">
            To make a donation, simply follow the link below and select
            &lsquo;The Hazelnut Movement&rsquo; as the designated recipient.
          </p>
          <Link href="/donate" className="btn-gold mt-8 inline-block">
            Donate
          </Link>
        </div>
      </section>

      <section className="container-site py-14 max-w-3xl mx-auto text-center">
        <p className="text-lg italic leading-relaxed text-neutral-700">
          &ldquo;I am so inspired by this amazing mother and human, Julia
          Erman! I drove an hour to see her perform the Hazelnut Program at a
          school and she completely moved me. Her story is that of a true hero:
          grounded, resilient, and shaped by incredible life experiences. As a
          cancer survivor and mom of two children with ultra-rare diseases,
          Julia speaks with a strength and joy that is truly remarkable. She
          wears her story with pride, her head held high, and a smile that
          lights up a room. Her message is both heartfelt and to the point. She
          is authentic, engaging, and has a special gift for capturing
          kids&rsquo; attention with her energetic and fun personality. Julia
          also interacts beautifully with her audience, making everyone feel
          connected and seen.&rdquo;
        </p>
        <p className="mt-6 font-bold text-lg">Carolina Sommer</p>
      </section>
    </>
  );
}
