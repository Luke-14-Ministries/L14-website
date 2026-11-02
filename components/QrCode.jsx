'use client';

// A QR code drawn as plain SVG, in the browser. qrcode-generator (no
// dependencies of its own; added 1 Nov 2026 with Lawrence's yes) works out
// the squares; React draws them as one path, so no HTML string is injected
// and the link never leaves the site for an outside QR service.
//
// Error correction 'M' (about 15% of the code can be smudged or glared and it
// still scans) -- the usual choice for a phone held up to a phone.

import qrcode from 'qrcode-generator';

export default function QrCode({ value, size = 240, label }) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4; // the white border scanners need, in squares
  let d = '';
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(row, col)) d += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const box = n + quiet * 2;
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      role="img"
      aria-label={label ?? `QR code for ${value}`}
      shapeRendering="crispEdges"
    >
      {/* White behind it always: a QR code on a dark background does not scan. */}
      <rect width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
