// One embedded video, 16:9, filling its column. Camp Memories had this inline;
// Party Memories, Kenya Memories, Camp Celebrate and Wheels for Kenya now
// show videos too (28 Oct 2026), so it lives here and they all match.
//
// Only YouTube and Vimeo, because those are the two players the content
// security policy in next.config.mjs lets the page frame (frame-src). A new
// video host needs adding THERE as well, or the policy reports (and, once it
// is enforced, blocks) the player.
//
// YouTube plays from www.youtube-nocookie.com since 23 Nov 2026 (security
// review): YouTube's privacy-enhanced player, which sets no tracking cookies
// until someone presses play. frame-src gained that host in the same commit.
// It looks and plays the same. The frame loads only when it scrolls near the
// screen (loading="lazy"), and tells YouTube or Vimeo which site it is on but
// not which page (strict-origin-when-cross-origin, which YouTube's player
// needs in order to play).
export default function VideoEmbed({ youtube, vimeo, title }) {
  const src = youtube
    ? `https://www.youtube-nocookie.com/embed/${youtube}`
    : `https://player.vimeo.com/video/${vimeo}`;
  return (
    <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
      <iframe
        src={src}
        title={title}
        className="absolute inset-0 h-full w-full rounded-sm"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        allowFullScreen
      />
    </div>
  );
}
