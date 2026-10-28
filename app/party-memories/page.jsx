import PageHero from '@/components/PageHero';
import VideoYears from '@/components/VideoYears';
import { asset } from '@/lib/site';

export const metadata = { title: 'Party Memories' };

// The old site's Party Memories page, year for year (28 Oct 2026); it has no
// 2016. The hero is the old page's own photograph.
const years = [
  { label: '2019', youtube: 'SYNE4S1NGG8' },
  { label: '2018', youtube: 'vMjJ9xC08qU' },
  { label: '2017', youtube: 'PnfBKhLtwns' },
  { label: '2015', youtube: 'Gm_iSwiBGHM' },
  { label: '2014', youtube: 'eLj6ny6gFqI' },
  { label: '2013', youtube: 'r-lZTvmpTbk' },
];

export default function PartyMemoriesPage() {
  return (
    <>
      <PageHero image={asset('/images/IMG_9841.jpg')} title="Party Memories" />
      <VideoYears entries={years} titlePrefix="Luke 14 Party" />
    </>
  );
}
