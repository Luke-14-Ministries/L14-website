import PageHero from '@/components/PageHero';
import VideoYears from '@/components/VideoYears';
import { asset } from '@/lib/site';

export const metadata = { title: 'Kenya Memories' };

// The old site's Kenya Memories page (28 Oct 2026). All three years are
// YouTube videos there: what looked like 2017 and 2018 photos are the
// Squarespace template's stock placeholder images laid over the video
// players, not the ministry's pictures, so they are not copied. The hero is
// the old page's own photograph.
const years = [
  { label: '2019', youtube: 'ke5kUTNt7qE' },
  { label: '2018', youtube: '8jSzBpBeQJs' },
  { label: '2017', youtube: 'tu9goYe48pQ' },
];

export default function KenyaMemoriesPage() {
  return (
    <>
      <PageHero image={asset('/images/Picture1.jpg')} title="Kenya Memories" />
      <VideoYears entries={years} titlePrefix="Wheels for Kenya" />
    </>
  );
}
