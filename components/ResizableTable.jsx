'use client';

// Adjustable column widths for an ordinary table (Lawrence, 15 Nov 2026: "set
// consistent width and/or make widths adjustable"). Wrap any server-rendered
// <table> in it: it fixes the table's layout to the given widths, puts a drag
// handle on the right edge of each header cell, and remembers the widths in
// this browser under storageKey. Tables that share a storageKey share widths,
// so the three cards on Background Checks line up.
//
// components/DataTable.jsx also resizes, sorts and searches, but builds its
// own rows; this leaves the rows alone, so a table with a fold under each row
// (Background Checks' record) keeps working.
//
// Handles: drag, or focus one and use the arrow keys; double-click resets the
// table to its default widths. Storage can be unavailable (private window,
// blocked site data): the widths then last for this visit only. Widths are a
// convenience, never data, so there is nothing to tell anyone.

import { useEffect, useRef, useState } from 'react';

const MIN = 56;
const STEP = 16;

function load(key) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function save(key, widths) {
  try {
    if (widths) window.localStorage.setItem(key, JSON.stringify(widths));
    else window.localStorage.removeItem(key);
  } catch {
    // Not saved: the widths last for this visit.
  }
  // Other tables with the same key follow along.
  window.dispatchEvent(new CustomEvent('resizable-table', { detail: key }));
}

export default function ResizableTable({ storageKey, defaults = [], children }) {
  const ref = useRef(null);
  // True when the columns are wider than the box shows (23 Nov 2026, the
  // admin review: Background Checks' Status column ran past the card's edge
  // with nothing to say the table scrolled sideways).
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const table = ref.current?.querySelector('table');
    const ths = table ? [...table.querySelectorAll(':scope > thead > tr > th')] : [];
    if (!ths.length) return undefined;
    // The column count is part of the key: the same table with a column more
    // or less (one shown only with a permission) keeps its own widths.
    const key = `${storageKey}:${ths.length}`;

    // Widths that add up to more than the box can hold are scaled down to
    // fit when the box around the table does not scroll (Lawrence, 23 Nov
    // 2026: Accounts ran past its border). Staff tables let the box overflow on
    // desktop on purpose, so a row menu can open over the edge, which means a
    // too-wide table spilled outside its own border instead of scrolling. The
    // saved widths are kept as set; only what is shown is scaled.
    const fit = (widths) => {
      const total = widths.reduce((a, b) => a + b, 0);
      const room = ref.current?.clientWidth ?? 0;
      const box = ref.current?.parentElement;
      const scrolls = box ? getComputedStyle(box).overflowX !== 'visible' : true;
      if (scrolls || room <= 0 || total <= room) return widths;
      return widths.map((w) => Math.max(MIN, Math.floor((w * room) / total)));
    };
    const apply = (widths) => {
      const shown = fit(widths);
      ths.forEach((th, i) => {
        th.style.width = `${shown[i]}px`;
      });
      table.style.tableLayout = 'fixed';
      table.style.width = `${shown.reduce((a, b) => a + b, 0)}px`;
      table.style.minWidth = '100%';
      // Measured after layout, outside React's render.
      requestAnimationFrame(() => {
        const room = ref.current?.clientWidth ?? 0;
        setOverflows(room > 0 && table.offsetWidth > room + 1);
      });
    };
    const fallback = () => ths.map((th, i) => defaults[i] ?? Math.max(MIN, Math.round(th.getBoundingClientRect().width)));
    const current = () => {
      const saved = load(key);
      return saved && saved.length === ths.length ? saved : fallback();
    };
    let widths = current();
    apply(widths);

    const handles = ths.map((th, i) => {
      th.style.position = 'relative';
      const h = document.createElement('span');
      h.setAttribute('role', 'separator');
      h.setAttribute('aria-orientation', 'vertical');
      h.setAttribute('aria-label', `Resize column ${th.textContent.trim() || i + 1}`);
      h.title = 'Drag to resize. Double-click to reset all columns.';
      h.tabIndex = 0;
      h.className = 'absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize select-none hover:bg-brand/30 focus:bg-brand/40 focus:outline-none';
      const set = (w) => {
        widths = widths.map((x, j) => (j === i ? Math.max(MIN, Math.round(w)) : x));
        apply(widths);
      };
      const onDown = (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = widths[i];
        const move = (ev) => set(startW + ev.clientX - startX);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          save(key, widths);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
      const onKey = (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        set(widths[i] + (e.key === 'ArrowRight' ? STEP : -STEP));
        save(key, widths);
      };
      const onReset = () => {
        save(key, null);
      };
      h.addEventListener('pointerdown', onDown);
      h.addEventListener('keydown', onKey);
      h.addEventListener('dblclick', onReset);
      th.appendChild(h);
      return h;
    });

    // Another table with this key (or a reset) changed the widths.
    const follow = (e) => {
      if (e.detail !== key) return;
      ths.forEach((th) => {
        th.style.width = '';
      });
      widths = current();
      apply(widths);
    };
    window.addEventListener('resizable-table', follow);
    // A narrower window may no longer fit the widths (or a wider one may fit
    // them again).
    const refit = () => apply(widths);
    window.addEventListener('resize', refit);
    return () => {
      window.removeEventListener('resizable-table', follow);
      window.removeEventListener('resize', refit);
      handles.forEach((h) => h.remove());
    };
    // defaults is a fixed list per table; the key decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return (
    <div ref={ref}>
      {overflows && (
        <p className="mb-1 text-xs text-neutral-500 print:hidden">
          More columns than fit: scroll sideways, or drag a column edge to narrow it.
        </p>
      )}
      {children}
    </div>
  );
}
