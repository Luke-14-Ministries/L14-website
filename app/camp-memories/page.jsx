import PageHero from '@/components/PageHero';
import VideoYears from '@/components/VideoYears';
import { asset } from '@/lib/site';

export const metadata = { title: 'Camp Memories' };

// Year highlight videos from the original site's Camp Memories page, with
// 2026 (from its Camp Celebrate page) added at the top. 2014 is on Vimeo,
// not YouTube; next.config.mjs's frame-src lists player.vimeo.com for it.
const years = [
  { label: '2026 Week 1', youtube: 'uU4mb2_N4YA' },
  { label: '2026 Week 2', youtube: '93X7D2tUgiA' },
  { label: '2025 Week 1', youtube: 'K50SZpcMr08' },
  { label: '2025 Week 2', youtube: 'R6-cMWllAHs' },
  { label: '2024', youtube: 'Z1TrxIL0Ew4' },
  { label: '2023', youtube: 'v1h2fB7TdXg' },
  { label: '2022', youtube: 'rlGKgbCYOis' },
  { label: '2021', youtube: 'hUrnuHMkmIQ' },
  { label: '2019', youtube: 'HO9SmcHJlZU' },
  { label: '2018', youtube: 'MeNiytYb3gI' },
  { label: '2017', youtube: 'j4N1BRNzLVU' },
  { label: '2016', youtube: 'szH9i3RILJk' },
  { label: '2015', youtube: 'XrqYe-0KchQ' },
  { label: '2014', vimeo: '116121002' },
  { label: '2013', youtube: 'U51mWei6bwo' },
];

export default function CampMemoriesPage() {
  return (
    <>
      <PageHero image={asset('/images/DSC01463.jpg')} title="Camp Memories" />
      <VideoYears entries={years} titlePrefix="Camp Celebrate" />
    </>
  );
}
