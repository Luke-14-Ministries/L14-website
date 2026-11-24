import PageHero from '@/components/PageHero';
import VideoYears from '@/components/VideoYears';
import { asset } from '@/lib/site';
import { CAMP_VIDEOS, videoLabel } from '@/lib/campVideos';

export const metadata = { title: 'Camp Memories' };

// The videos are lib/campVideos.js, shared with Camp Celebrate's highlights
// (23 Nov 2026).
const years = CAMP_VIDEOS.map((v) => ({ label: videoLabel(v), youtube: v.youtube, vimeo: v.vimeo }));

export default function CampMemoriesPage() {
  return (
    <>
      <PageHero image={asset('/images/DSC01463.jpg')} title="Camp Memories" />
      <VideoYears entries={years} titlePrefix="Camp Celebrate" />
    </>
  );
}
