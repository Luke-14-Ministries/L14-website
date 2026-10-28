// One glanceable mark for a yes/no or short-status cell on staff print sheets
// and tables (Lawrence, 28 Oct 2026: "No background check on file" in a narrow
// column wrapped to four lines and could not be scanned; a tick or a cross,
// with brief words only where the mark alone would lose the meaning).
//
// No 'use client' and no hooks, so server print pages and client tables can
// both render it. Unicode glyphs rather than an icon set: no dependency, and
// they print in black ink. Colour is for the screen only (print: overrides),
// because the sheets are photocopied in black and white.
//
// Props
//   state   'yes' ✓ | 'no' ✗ | 'warn' ⚠ | 'na' —
//   label   brief visible words beside the mark ("Approved", "Under 18").
//           An 'na' mark with a label shows the label alone, in grey.
//   title   the full words: the tooltip, and what a screen reader hears
//           instead of the glyph and label. Without it a screen reader hears
//           the label, or the state's word.
//
// Never collapse two states into one mark: where two states share a glyph,
// the label is what tells them apart.

// U+FE0E asks for the text form of ⚠, so it prints as ink, not a colour emoji.
const GLYPH = { yes: '✓', no: '✗', warn: '⚠︎', na: '—' };
const WORD = { yes: 'Yes', no: 'No', warn: 'Needs follow-up', na: 'Not applicable' };
const TONE = {
  yes: 'text-green-700 print:text-black',
  no: 'text-red-700 font-bold print:text-black',
  warn: 'text-amber-700 font-semibold print:text-black',
  na: 'text-neutral-400 print:text-neutral-500',
};

export default function StatusMark({ state, label, title, className = '' }) {
  const s = GLYPH[state] ? state : 'na';
  const spoken = title ?? (label ? null : WORD[s]);
  const labelOnly = s === 'na' && label;
  return (
    <span title={title} className={`inline-flex items-baseline gap-1 whitespace-nowrap ${className}`}>
      {!labelOnly && (
        <span aria-hidden="true" className={TONE[s]}>
          {GLYPH[s]}
        </span>
      )}
      {label && (
        <span aria-hidden={title ? 'true' : undefined} className={labelOnly ? 'text-xs text-neutral-500' : ''}>
          {label}
        </span>
      )}
      {spoken && <span className="sr-only">{spoken}</span>}
    </span>
  );
}

// The key line at the top of a sheet: [[state, words], …], e.g.
// [['yes', 'yes'], ['no', 'no'], ['warn', 'needs follow-up']]. Printed too --
// the paper has no tooltips. Hidden from screen readers, which hear each
// mark's own words instead.
export function StatusLegend({ items, className = '' }) {
  return (
    <p aria-hidden="true" className={`text-xs text-neutral-600 ${className}`}>
      {items.map(([state, words], i) => (
        <span key={`${state}:${words}`}>
          {i > 0 && <span className="mx-1.5 text-neutral-400">·</span>}
          <span aria-hidden="true" className={TONE[state] ?? TONE.na}>
            {GLYPH[state] ?? GLYPH.na}
          </span>{' '}
          {words}
        </span>
      ))}
    </p>
  );
}
