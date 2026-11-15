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

import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    const table = ref.current?.querySelector('table');
    const ths = table ? [...table.querySelectorAll(':scope > thead > tr > th')] : [];
    if (!ths.length) return undefined;

    const apply = (widths) => {
      ths.forEach((th, i) => {
        th.style.width = `${widths[i]}px`;
      });
      table.style.tableLayout = 'fixed';
      table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
      table.style.minWidth = '100%';
    };
    const fallback = () => ths.map((th, i) => defaults[i] ?? Math.max(MIN, Math.round(th.getBoundingClientRect().width)));
    const current = () => {
      const saved = load(storageKey);
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
          save(storageKey, widths);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
      const onKey = (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        set(widths[i] + (e.key === 'ArrowRight' ? STEP : -STEP));
        save(storageKey, widths);
      };
      const onReset = () => {
        save(storageKey, null);
      };
      h.addEventListener('pointerdown', onDown);
      h.addEventListener('keydown', onKey);
      h.addEventListener('dblclick', onReset);
      th.appendChild(h);
      return h;
    });

    // Another table with this key (or a reset) changed the widths.
    const follow = (e) => {
      if (e.detail !== storageKey) return;
      ths.forEach((th) => {
        th.style.width = '';
      });
      widths = current();
      apply(widths);
    };
    window.addEventListener('resizable-table', follow);
    return () => {
      window.removeEventListener('resizable-table', follow);
      handles.forEach((h) => h.remove());
    };
    // defaults is a fixed list per table; the key decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return <div ref={ref}>{children}</div>;
}
