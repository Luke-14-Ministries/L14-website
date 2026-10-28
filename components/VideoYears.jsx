import VideoEmbed from '@/components/VideoEmbed';

// The "memories" pages (Camp, Party, Kenya): one card per year, newest first,
// alternating tints, each with that year's highlight video. They were three
// copies of the same markup on the old site and would have been three here.
//
// entries: [{ label: '2019', youtube: 'id' } | { label: '2014', vimeo: 'id' }]
// titlePrefix names each video for screen readers ("Luke 14 Party 2019").
export default function VideoYears({ entries, titlePrefix }) {
  return (
    <section className="container-site py-14 max-w-3xl mx-auto">
      <div className="space-y-12">
        {entries.map(({ label, youtube, vimeo }, i) => (
          <div
            key={label}
            className={`rounded-lg p-6 sm:p-10 text-center ${
              i % 2 === 0 ? 'bg-brand-light' : 'bg-white border border-neutral-200'
            }`}
          >
            <h2 className="text-4xl font-bold mb-6">{label}</h2>
            <VideoEmbed youtube={youtube} vimeo={vimeo} title={`${titlePrefix} ${label}`} />
          </div>
        ))}
      </div>
    </section>
  );
}
