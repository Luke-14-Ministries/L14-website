'use client';

// A leader's bio, folded to its first few lines with "Read more" (Lawrence,
// 9 Nov 2026: bios run from 3 lines to 12, which left most cards in a row
// half empty). The button appears only when the text is actually cut off, so
// a short bio shows whole with nothing under it. Folded by height (not
// line-clamp, which does not fold across several paragraphs), so the full text
// is in the page for search engines and screen readers.

import { useEffect, useRef, useState } from 'react';

export default function LeaderBio({ paragraphs, name }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => {
      if (!open) setCut(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  return (
    <div>
      {/* Six lines at leading-relaxed (26px each), faded at the foot when cut. */}
      <div
        ref={box}
        className={
          open
            ? ''
            : `max-h-[9.75rem] overflow-hidden ${cut ? '[mask-image:linear-gradient(to_bottom,black_65%,transparent)]' : ''}`
        }
      >
        {paragraphs.map((paragraph, i) => (
          <p key={i} className="text-neutral-700 leading-relaxed mb-3 last:mb-0">
            {paragraph}
          </p>
        ))}
      </div>
      {(cut || open) && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="mt-2 text-sm font-semibold text-brand underline"
        >
          {open ? 'Show less' : 'Read more'}
          <span className="sr-only"> about {name}</span>
        </button>
      )}
    </div>
  );
}
