import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Resources' };

// The PDFs are served from public/resources/ (copied from the old Squarespace
// site, 28 Oct 2026). They were linked at luke14ministries.net/s/..., which
// stops existing the day the domain points at this site; next.config.mjs
// redirects those old addresses here. To replace a guide, overwrite the file
// under the same name and every link keeps working.
const resources = [
  {
    title: 'Camp Celebrate Family Guide',
    description:
      'The Family Guide provides a detailed look at what Camp Celebrate is, what we do, and a closer look at the day-to-day of camp.',
    image:
      asset('/images/70b14bdc-5032-402f-a334-d0a64ef15914.jpg'),
    linkText: 'Download the Family Guide',
    href: '/resources/camp-celebrate-family-guide.pdf',
  },
  {
    title: 'Camp Celebrate Volunteer Guide',
    description:
      'This guide provides an in-depth overview of Cemp Celebrate and what it looks like to work as a volunteer.',
    image:
      asset('/images/PXL_20240722_172319434.jpg'),
    linkText: 'Download the Volunteer Guide',
    href: '/resources/camp-celebrate-volunteer-guide.pdf',
  },
  {
    title: 'Camp Celebrate Family Fundraising Guide',
    description:
      'Camp can be costly. This guide can help you walk through options on how to raise funds for the best week of the year!',
    image:
      asset('/images/DSC_0850__281_29.jpg'),
    linkText: 'Download the Fundraising Guide',
    href: '/resources/camp-celebrate-fundraising-guide.pdf',
  },
  {
    title: 'Camp Celebrate Volunteer Fundraising Guide',
    description:
      'Volunteering your time and money can be hard. This guide can provide helpful resources for raising funds to ease the financial commitment of serving at Camp Celebrate.',
    image:
      asset('/images/DSC04574.jpg'),
    linkText: 'Click Here',
    href: '/resources/camp-celebrate-volunteer-fundraising-guide.pdf',
  },
  {
    title: 'Luke 14 Ministries Brochure',
    description: 'An overview of the branches of Luke 14 Ministries.',
    image:
      asset('/images/Luke_14_Ministries_Brochure.jpg'),
    linkText: 'Click here to download the brochure',
    href: '/resources/luke-14-ministries-brochure.pdf',
  },
  {
    title: 'Camp Celebrate Brochure',
    description: '',
    image:
      asset('/images/Camp_Celebrate_Brochure.jpg'),
    linkText: 'Download the brochure',
    href: '/resources/camp-celebrate-brochure.pdf',
  },
  {
    title: 'Wheels For Kenya Brochure',
    description: 'Learn more about Wheels For Kenya!',
    image:
      asset('/images/Wheels_For_Kenya_Brochure.jpg'),
    linkText: 'Download the brochure',
    href: '/resources/wheels-for-kenya-brochure.pdf',
  },
];

export default function ResourcesPage() {
  return (
    <>
      <PageHero
        image={asset('/images/DSC_0135.jpg')}
        title="Luke 14 Ministries Resources"
        subtitle="Find helpful resources below!"
      />

      <section className="container-site py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((resource) => (
            <div
              key={resource.title}
              className="bg-white rounded-lg shadow-sm overflow-hidden flex flex-col"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resource.image}
                alt={resource.title}
                className="w-full h-52 object-cover"
              />
              <div className="p-6 flex-1 flex flex-col">
                <h2 className="text-xl font-bold mb-3">{resource.title}</h2>
                {resource.description && (
                  <p className="text-neutral-700 leading-relaxed mb-5">
                    {resource.description}
                  </p>
                )}
                <div className="mt-auto">
                  <a
                    href={resource.href}
                    target="_blank"
                    rel="noopener"
                    className="btn-primary"
                  >
                    {resource.linkText}
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
