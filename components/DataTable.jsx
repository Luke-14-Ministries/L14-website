'use client';

// A staff table that sorts, resizes and searches (Lawrence, 26 Oct 2026, on
// My Program: "column widths should be adjustable and columns sortable; also
// should have a search/filter option"). One component so every table that
// wants this behaves the same way; plain React and CSS, no table library.
//
// Props
//   columns      [{ key, label, sortValue?(row), render?(row), defaultWidth?,
//                  align?: 'left'|'center'|'right', sortable?: false }]
//                sortValue defaults to row[key]; render defaults to row[key].
//   rows         the rows, in the order to show when no column is sorted
//   rowKey       a field name, or (row) => key
//   filterKeys   fields the search box matches; no search box when empty
//   storageKey   localStorage key for this table's column widths (optional)
//   emptyText    shown when there are no rows at all
//   searchPlaceholder, searchLabel   the search box's words
//
// Because columns carry functions, a server page cannot pass them across the
// client boundary: wrap the table in a small 'use client' file of its own
// that builds the columns (see app/admin/my-program/ProgramRosterTable.jsx).

import { useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';

const MIN_WIDTH = 60;
const DEFAULT_WIDTH = 160;
const KEY_STEP = 16;

// Natural order ("Cabin 2" before "Cabin 10"), and case and accents ignored.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const isBlank = (v) =>
  v == null || v === '' || (typeof v === 'number' && Number.isNaN(v)) || (Array.isArray(v) && !v.length);

function compareValues(a, b) {
  const na = typeof a === 'boolean' ? Number(a) : a;
  const nb = typeof b === 'boolean' ? Number(b) : b;
  if (typeof na === 'number' && typeof nb === 'number') return na - nb;
  return collator.compare(String(na), String(nb));
}

// "José" is found by typing "jose", and the other way round.
const fold = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// --- Remembered widths -------------------------------------------------------
// Read through useSyncExternalStore (the pattern AdminNav uses for its open
// group): the server and the first client render use the default widths, then
// the browser's saved ones, with no hydration mismatch and no setState in an
// effect. Storage can be unavailable (private window, blocked site data, full):
// the widths then live in `memory` for this visit and are forgotten on reload.
// That fallback IS the handling -- widths are a convenience, never data, so
// there is nothing to tell the user.
const memory = new Map();
const listeners = new Set();

function subscribeWidths(callback) {
  listeners.add(callback);
  window.addEventListener('storage', callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}

function readWidths(storageKey) {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved !== null) return saved;
  } catch {
    // Storage blocked: fall through to this visit's memory copy.
  }
  return memory.get(storageKey) ?? null;
}

function writeWidths(storageKey, value) {
  if (value === null) memory.delete(storageKey);
  else memory.set(storageKey, value);
  try {
    if (value === null) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, value);
  } catch {
    // Storage blocked: the memory copy above still carries this visit.
  }
  listeners.forEach((callback) => callback());
}

function parseWidths(raw, columns) {
  if (!raw) return {};
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    // A damaged entry (hand-edited, or from an old version): use defaults.
    return {};
  }
  const out = {};
  for (const c of columns) {
    const w = saved?.[c.key];
    if (typeof w === 'number' && Number.isFinite(w)) out[c.key] = Math.max(MIN_WIDTH, Math.round(w));
  }
  return out;
}

const noSubscribe = () => () => {};

export default function DataTable({
  columns,
  rows,
  rowKey = 'id',
  filterKeys = [],
  storageKey,
  emptyText = 'Nothing here yet.',
  searchPlaceholder = 'Search names…',
  searchLabel = 'Search this table',
}) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  // null = the order the rows arrived in; then asc, then desc, then null.
  const [sort, setSort] = useState(null);
  // Widths when there is no storageKey (not remembered between visits).
  const [localWidths, setLocalWidths] = useState({});
  // The column being dragged, shown live and saved on release.
  const [drag, setDrag] = useState(null);
  const dragStart = useRef(null);

  const storedRaw = useSyncExternalStore(
    storageKey ? subscribeWidths : noSubscribe,
    () => (storageKey ? readWidths(storageKey) : null),
    () => null
  );

  const defaults = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c.defaultWidth ?? DEFAULT_WIDTH])),
    [columns]
  );
  const custom = useMemo(
    () => (storageKey ? parseWidths(storedRaw, columns) : localWidths),
    [storageKey, storedRaw, columns, localWidths]
  );
  const widths = { ...defaults, ...custom };
  const widthOf = (key) => (drag?.key === key ? drag.width : widths[key]);
  const changed = columns.some((c) => custom[c.key] != null && custom[c.key] !== defaults[c.key]);

  function saveWidth(key, width) {
    const next = { ...custom, [key]: Math.max(MIN_WIDTH, Math.round(width)) };
    if (next[key] === defaults[key]) delete next[key];
    if (!storageKey) setLocalWidths(next);
    else writeWidths(storageKey, Object.keys(next).length ? JSON.stringify(next) : null);
  }

  function resetWidths() {
    if (!storageKey) setLocalWidths({});
    else writeWidths(storageKey, null);
  }

  function onHandlePointerDown(e, key) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Start from the width on screen: the last column may be showing wider
    // than its saved width because it is taking up the spare room.
    const shownWidth = Math.round(e.currentTarget.parentElement.getBoundingClientRect().width);
    dragStart.current = { key, x: e.clientX, width: shownWidth };
    setDrag({ key, width: shownWidth });
  }
  function onHandlePointerMove(e) {
    const start = dragStart.current;
    if (!start) return;
    setDrag({ key: start.key, width: Math.max(MIN_WIDTH, start.width + e.clientX - start.x) });
  }
  function onHandlePointerUp(e) {
    const start = dragStart.current;
    if (!start) return;
    dragStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    saveWidth(start.key, Math.max(MIN_WIDTH, start.width + e.clientX - start.x));
    setDrag(null);
  }
  function onHandleKeyDown(e, key) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const shownWidth = Math.round(e.currentTarget.parentElement.getBoundingClientRect().width);
    saveWidth(key, shownWidth + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP));
  }

  function clickHeader(key) {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  const keyOf = typeof rowKey === 'function' ? rowKey : (row) => row[rowKey];
  const needle = fold(query.trim());

  const filtered = useMemo(() => {
    if (!needle || !filterKeys.length) return rows;
    return rows.filter((row) =>
      filterKeys.some((k) => {
        const v = row[k];
        if (isBlank(v)) return false;
        return fold(Array.isArray(v) ? v.join(' ') : v).includes(needle);
      })
    );
  }, [rows, needle, filterKeys]);

  const shown = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const valueOf = col.sortValue ?? ((row) => row[col.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered
      .map((row, i) => ({ row, i, v: valueOf(row) }))
      .sort((a, b) => {
        // Blanks last in BOTH directions: a reversed sort that opens on a
        // screen of dashes answers nothing.
        const ba = isBlank(a.v);
        const bb = isBlank(b.v);
        if (ba || bb) return ba === bb ? a.i - b.i : ba ? 1 : -1;
        return compareValues(a.v, b.v) * dir || a.i - b.i;
      })
      .map((x) => x.row);
  }, [filtered, sort, columns]);

  // The last column takes whatever room is left, so on a wide screen the
  // table still fills its box and dragging any other edge moves it 1:1. Its
  // own handle widens the table past the box (which then scrolls); narrowing
  // it below the spare room changes nothing on screen, by design.
  const total = columns.reduce((sum, c) => sum + widthOf(c.key), 0);
  const alignCls = (a) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  if (!rows.length) {
    return (
      <p className="rounded-sm border border-neutral-200 bg-white p-6 text-neutral-500">{emptyText}</p>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        {filterKeys.length > 0 && (
          <div className="flex min-w-0 items-center gap-2">
            <label htmlFor={searchId} className="sr-only">
              {searchLabel}
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  setQuery('');
                }
              }}
              placeholder={searchPlaceholder}
              className="w-64 max-w-full min-w-0 rounded-sm border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-sm text-neutral-600 underline hover:text-brand-dark"
              >
                Clear
              </button>
            )}
          </div>
        )}
        <span className="text-sm text-neutral-500" aria-live="polite">
          {needle ? `Showing ${shown.length} of ${rows.length}` : ''}
        </span>
        {changed && (
          <button
            type="button"
            onClick={resetWidths}
            className="ml-auto text-xs text-neutral-500 underline hover:text-brand-dark"
          >
            Reset columns
          </button>
        )}
      </div>

      {/* Scrolls inside its own box, never the page (375 px phones). */}
      <div className="max-w-full overflow-x-auto rounded-sm border border-neutral-200 bg-white">
        <table className="text-sm" style={{ tableLayout: 'fixed', width: `max(100%, ${total}px)` }}>
          <colgroup>
            {columns.map((c, i) => (
              <col key={c.key} style={i === columns.length - 1 ? undefined : { width: widthOf(c.key) }} />
            ))}
          </colgroup>
          <thead className="bg-neutral-50">
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      !sortable ? undefined : active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                    className={`relative overflow-hidden px-3 py-2 font-semibold ${alignCls(c.align)}`}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => clickHeader(c.key)}
                        title={`Sort by ${c.label}`}
                        className="inline-flex max-w-full items-center gap-1 hover:text-neutral-800"
                      >
                        <span className="truncate">{c.label}</span>
                        {active && (
                          <span aria-hidden className="text-[10px]">
                            {sort.dir === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="block truncate">{c.label}</span>
                    )}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${c.label} column`}
                      aria-valuenow={widthOf(c.key)}
                      aria-valuemin={MIN_WIDTH}
                      aria-valuetext={`${widthOf(c.key)} pixels`}
                      tabIndex={0}
                      title="Drag to resize (or use the arrow keys)"
                      onPointerDown={(e) => onHandlePointerDown(e, c.key)}
                      onPointerMove={onHandlePointerMove}
                      onPointerUp={onHandlePointerUp}
                      onPointerCancel={onHandlePointerUp}
                      onKeyDown={(e) => onHandleKeyDown(e, c.key)}
                      className="group absolute top-0 right-0 flex h-full w-2.5 cursor-col-resize touch-none select-none justify-center focus-visible:outline-none"
                    >
                      <span
                        className={`h-full ${
                          drag?.key === c.key
                            ? 'w-1 bg-brand'
                            : 'w-px bg-neutral-300 group-hover:w-1 group-hover:bg-brand/50 group-focus-visible:w-1 group-focus-visible:bg-brand'
                        }`}
                      />
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr className="border-t border-neutral-100">
                <td colSpan={columns.length} className="px-3 py-4 text-neutral-500">
                  Nothing matches “{query.trim()}”.
                </td>
              </tr>
            ) : (
              shown.map((row) => (
                <tr key={keyOf(row)} className="border-t border-neutral-100 align-top">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 [overflow-wrap:anywhere] ${alignCls(c.align)}`}>
                      {c.render ? c.render(row) : (row[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
