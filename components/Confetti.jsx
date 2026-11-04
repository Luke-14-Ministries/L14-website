'use client';

// A short burst of confetti falling from the top of the window (Lawrence,
// 4 Nov 2026: on "Registration submitted"). No library: about seventy
// coloured pieces with CSS keyframes, in the ministry's colours. It never
// blocks a click, removes itself after a few seconds, and does nothing for
// anyone whose system asks for reduced motion.

import { useEffect, useState } from 'react';

const COLOURS = ['#2a6f77', '#1d4e54', '#d99a2b', '#e8b44c', '#7fb8be', '#c0392b', '#f3e3b5'];

function makePieces(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    duration: 2.4 + Math.random() * 1.6,
    drift: (Math.random() - 0.5) * 160,
    spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
    width: 6 + Math.random() * 6,
    height: 8 + Math.random() * 8,
    colour: COLOURS[i % COLOURS.length],
  }));
}

export default function Confetti({ count = 70 }) {
  const [pieces, setPieces] = useState(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    // Made after mount, so nothing random runs during render.
    const start = setTimeout(() => setPieces(makePieces(count)), 0);
    const stop = setTimeout(() => setPieces(null), 5000);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, [count]);

  if (!pieces) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`
        @keyframes l14-confetti-fall {
          0% { transform: translate3d(0, -10vh, 0) rotate(0deg); opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translate3d(var(--drift), 105vh, 0) rotate(var(--spin)); opacity: 0; }
        }
      `}</style>
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            top: 0,
            left: `${p.left}%`,
            width: `${p.width}px`,
            height: `${p.height}px`,
            background: p.colour,
            borderRadius: '2px',
            '--drift': `${p.drift}px`,
            '--spin': `${p.spin}deg`,
            animation: `l14-confetti-fall ${p.duration}s cubic-bezier(0.25, 0.6, 0.4, 1) ${p.delay}s forwards`,
            transform: 'translate3d(0, -10vh, 0)',
          }}
        />
      ))}
    </div>
  );
}
