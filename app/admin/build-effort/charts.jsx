// Plain SVG charts for the build effort report, drawn on the server (no
// chart library, no 'use client'). Built to read in black and white when
// printed: measured or chosen bars are solid, estimated ones are hatched,
// recalled ones (a person's recollection, 28 Nov 2026) are dotted with a
// dashed outline, and a fourth kind is a light fill with an outline. Colours
// are the theme's variables, so dark mode swaps them.

const FILL = {
  solid: { fill: 'var(--color-brand)' },
  light: { fill: 'var(--color-neutral-200)', stroke: 'var(--color-neutral-600)', strokeWidth: 1 },
};
const TEXT = { fill: 'var(--color-neutral-600)', fontSize: 11 };

// The fill for a kind; a hatch needs the chart's own pattern id.
function fillFor(kind, id) {
  if (kind === 'hatch') return { fill: `url(#${id}-hatch)`, stroke: 'var(--color-brand)', strokeWidth: 1 };
  if (kind === 'dots') return { fill: `url(#${id}-dots)`, stroke: 'var(--color-neutral-600)', strokeWidth: 1, strokeDasharray: '3 2' };
  return FILL[kind] ?? FILL.solid;
}

function Hatch({ id }) {
  return (
    <defs>
      <pattern id={`${id}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="5" style={{ stroke: 'var(--color-brand)', strokeWidth: 2 }} />
      </pattern>
      <pattern id={`${id}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
        <circle cx="2.5" cy="2.5" r="1" style={{ fill: 'var(--color-neutral-600)' }} />
      </pattern>
    </defs>
  );
}

// A round top for the axis: 1, 2, 2.5 or 5 times a power of ten.
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// A key for a chart's kinds of bar: [kind, words, mark?]; the mark (an
// "Estimate" badge) follows the words.
export function Legend({ items, id }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-700">
      {items.map(([kind, label, mark]) => (
        <li key={label} className="flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true">
            <Hatch id={`${id}-${kind}`} />
            <rect x="0.5" y="0.5" width="13" height="13" style={fillFor(kind, `${id}-${kind}`)} />
          </svg>
          {label}
          {mark}
        </li>
      ))}
    </ul>
  );
}

// Vertical bars, stacked by series. `kindFor(row, series)` can override a
// series' kind for one bar (the hour-of-day chart marks the night).
export function VBars({ id, rows, series, xLabel, fmt = (v) => String(v), ariaLabel, kindFor = null, height = 220 }) {
  const W = 720;
  const H = height;
  const ml = 46;
  const mr = 6;
  const mt = 10;
  const mb = 26;
  const totals = rows.map((r) => series.reduce((a, s) => a + (Number(r[s.key]) || 0), 0));
  const top = niceMax(Math.max(0, ...totals));
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
  const y = (v) => mt + (H - mt - mb) * (1 - v / top);
  const step = (W - ml - mr) / Math.max(1, rows.length);
  const bw = step * 0.72;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} className="effort-chart block">
      <Hatch id={id} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={ml} x2={W - mr} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--color-neutral-200)', strokeWidth: 1 }} />
          <text x={ml - 6} y={y(t) + 4} textAnchor="end" style={TEXT}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        let base = 0;
        const x = ml + i * step + (step - bw) / 2;
        const label = xLabel(r, i);
        return (
          <g key={i}>
            {series.map((s) => {
              const v = Number(r[s.key]) || 0;
              if (!v) return null;
              const kind = kindFor ? kindFor(r, s) : s.kind;
              const rect = (
                <rect key={s.key} x={x} width={bw} y={y(base + v)} height={Math.max(1, y(base) - y(base + v))} style={fillFor(kind, id)}>
                  <title>{`${s.label}: ${fmt(v)}`}</title>
                </rect>
              );
              base += v;
              return rect;
            })}
            {label && (
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" style={TEXT}>
                {label}
              </text>
            )}
          </g>
        );
      })}
      <line x1={ml} x2={W - mr} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--color-neutral-500)', strokeWidth: 1 }} />
    </svg>
  );
}

// Horizontal ranges, low to high, one row each, with the range written at the
// end. `kind` per row.
export function RangeBars({ id, rows, fmt, ariaLabel }) {
  const W = 720;
  const rowH = 34;
  const ml = 210;
  const mr = 170;
  const H = rows.length * rowH + 24;
  const top = niceMax(Math.max(0, ...rows.map((r) => r.high)));
  const x = (v) => ml + (W - ml - mr) * (v / top);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} className="effort-chart block">
      <Hatch id={id} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={0} y2={H - 20} style={{ stroke: 'var(--color-neutral-200)', strokeWidth: 1 }} />
          <text x={x(t)} y={H - 6} textAnchor="middle" style={TEXT}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const yy = i * rowH + 6;
        return (
          <g key={r.label}>
            <text x={ml - 8} y={yy + 15} textAnchor="end" style={{ ...TEXT, fill: 'var(--color-neutral-800)', fontSize: 12 }}>
              {r.label}
            </text>
            <rect x={x(r.low)} width={Math.max(2, x(r.high) - x(r.low))} y={yy} height={rowH - 12} style={fillFor(r.kind, id)}>
              <title>{`${r.label}: ${fmt(r.low)} to ${fmt(r.high)}`}</title>
            </rect>
            <text x={x(r.high) + 6} y={yy + 15} style={TEXT}>
              {fmt(r.low)} to {fmt(r.high)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Two bars per line, old and new, with the dollars written beside each.
export function PairedBars({ id, rows, fmt, ariaLabel }) {
  const W = 720;
  const ml = 210;
  const mr = 70;
  const rowH = 40;
  const H = rows.length * rowH + 8;
  const top = niceMax(Math.max(1, ...rows.flatMap((r) => [r.old, r.new])));
  const x = (v) => ml + (W - ml - mr) * (Math.max(0, v) / top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} className="effort-chart block">
      <Hatch id={id} />
      {rows.map((r, i) => {
        const yy = i * rowH + 4;
        return (
          <g key={r.line}>
            <text x={ml - 8} y={yy + 18} textAnchor="end" style={{ ...TEXT, fill: 'var(--color-neutral-800)', fontSize: 12 }}>
              {r.line}
            </text>
            {[
              ['old', 'light', yy],
              ['new', 'solid', yy + 16],
            ].map(([key, kind, by]) => (
              <g key={key}>
                <rect x={ml} width={Math.max(1, x(r[key]) - ml)} y={by} height={13} style={fillFor(kind, id)}>
                  <title>{`${r.line}, ${key} setup: ${fmt(r[key])} a year`}</title>
                </rect>
                <text x={x(r[key]) + 5} y={by + 11} style={TEXT}>
                  {fmt(r[key])}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
