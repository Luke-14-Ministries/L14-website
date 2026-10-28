// One embedded video, 16:9, filling its column. Camp Memories had this inline;
// Party Memories, Kenya Memories, Camp Celebrate and Wheels for Kenya now
// show videos too (28 Oct 2026), so it lives here and they all match.
//
// Only YouTube and Vimeo, because those are the two players the content
// security policy in next.config.mjs lets the page frame (frame-src). A new
// video host needs adding THERE as well, or the policy reports (and, once it
// is enforced, blocks) the player. The plain www.youtube.com player is the
// one Camp Memories has always used; switching to youtube-nocookie.com would
// mean changing that frame-src entry in the same commit.
export default function VideoEmbed({ youtube, vimeo, title }) {
  const src = youtube
    ? `https://www.youtube.com/embed/${youtube}`
    : `https://player.vimeo.com/video/${vimeo}`;
  return (
    <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
      <iframe
        src={src}
        title={title}
        className="absolute inset-0 h-full w-full rounded-sm"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
