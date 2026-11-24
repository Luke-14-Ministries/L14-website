// The one sort mark on a staff table's column heading (23 Nov 2026, the admin
// review: some tables showed ▲/▼ only once sorted, some ↕ as well, in three
// sizes). ↕ on a column that can be sorted and is not; ▲ ascending, ▼
// descending. Hidden from screen readers: the heading's aria-sort, or its
// button's title, says it in words.
export default function SortMark({ dir }) {
  return (
    <span aria-hidden="true" className={`text-[10px] ${dir ? '' : 'text-neutral-400'}`}>
      {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
    </span>
  );
}
