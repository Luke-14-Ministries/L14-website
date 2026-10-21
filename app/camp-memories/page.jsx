import PageHero from '@/components/PageHero';
import { asset } from '@/lib/site';

export const metadata = { title: 'Camp Memories' };

// Year highlight videos from the original site's Camp Memories page
const years = [
  { year: '2024', video: 'Z1TrxIL0Ew4' },
  { year: '2023', video: 'v1h2fB7TdXg' },
  { year: '2022', video: 'rlGKgbCYOis' },
  { year: '2021', video: 'hUrnuHMkmIQ' },
  { year: '2019', video: 'HO9SmcHJlZU' },
  { year: '2018', video: 'MeNiytYb3gI' },
  { year: '2017', video: 'j4N1BRNzLVU' },
  { year: '2016', video: 'szH9i3RILJk' },
  { year: '2015', video: 'XrqYe-0KchQ' },
  { year: '2014', video: null },
  { year: '2013', video: 'U51mWei6bwo' },
];

export default function CampMemoriesPage() {
  return (
    <>
      <PageHero
        image={asset('/images/DSC01463.jpg')}
        title="Camp Memories"
      />

      <section className="container-site py-14 max-w-3xl mx-auto">
        <div className="space-y-12">
          {years.map(({ year, video }, i) => (
            <div
              key={year}
              className={`rounded-lg p-6 sm:p-10 text-center ${
                i % 2 === 0 ? 'bg-brand-light' : 'bg-white border border-neutral-200'
              }`}
            >
              <h2 className="text-4xl font-bold mb-6">{year}</h2>
              {video ? (
                <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${video}`}
                    title={`Camp Celebrate ${year} highlights`}
                    className="absolute inset-0 h-full w-full rounded-sm"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <p className="text-lg text-neutral-600 italic">
                  Highlights video not available for this year
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
