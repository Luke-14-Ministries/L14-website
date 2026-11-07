// "What the flags mean", said once, plainly -- so that a leader who wonders
// where the allergy details are does not go hunting, or worse, ask a family
// directly. Shared by the My Program page and its print view (26 Oct 2026) so
// the paper copy says exactly what the screen says.
export default function FlagsNote({ needAsking, className = '' }) {
  return (
    <div className={className}>
      <strong>What the flags mean.</strong> A flag means there is something to ask about. It
      doesn&rsquo;t say what. The camp coordinator keeps allergy details, medications and support
      plans, and will go through them with you before the week starts.{' '}
      {needAsking > 0 ? (
        <>
          <strong>
            {needAsking} {needAsking === 1 ? 'person' : 'people'}
          </strong>{' '}
          in this list {needAsking === 1 ? 'has' : 'have'} a flag.
        </>
      ) : (
        'Nobody in this list has a flag yet.'
      )}
    </div>
  );
}
