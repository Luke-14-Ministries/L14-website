'use client';

// A searchable dropdown: one text box that filters a list as you type.
//
// Asked for 26 Oct 2026 on Buddy Sheets. The print pages had a row of links,
// one per buddy ("Print: every buddy · Ellen Odom · …"), which is fine with
// three test buddies and unmanageable with a full camp. Larry: a searchable
// dropdown with "Every buddy" pinned at the top as the default is better.
//
// It is a WAI-ARIA combobox (the "list autocomplete" pattern): the input has
// role="combobox", the list role="listbox", the highlighted option is named by
// aria-activedescendant, so a screen reader announces it while focus stays in
// the box. Keys: ↓/↑ move (↓ also opens), Enter chooses, Escape closes (a
// second Escape clears the typing), Tab leaves.
//
// Matching ignores case and accents ("jose" finds "José", the same fold as
// DataTable) and every word typed must appear somewhere in the label or the
// hint, so "rowan ellen" finds Ellen's sheet by her camper's name.
//
// `pinned` options ("Every buddy") are shown first whatever is typed: the way
// back to the whole booklet is never filtered away.
//
// Two exports. `SearchSelect` takes an onChange(value) for client pages.
// `SearchSelectLinks` is for server pages, which cannot hand a function to a
// client component: each option carries its own `href` and choosing one
// router.push()es it, so the page keeps building its URLs exactly as before
// and existing links keep working.

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function matches(option, words) {
  if (words.length === 0) return true;
  const hay = fold(`${option.label} ${option.hint ?? ''}`);
  return words.every((w) => hay.includes(w));
}

export default function SearchSelect({
  options = [],
  value = '',
  onChange,
  pinned = [],
  placeholder = 'Type to search',
  label,
  // Words before the chosen option's name on the printed line, e.g.
  // "Sheets for". Defaults to the label.
  printPrefix,
  // [singular, plural] for the count beside the label: "12 buddies".
  noun = ['option', 'options'],
  // While the caller's navigation is under way.
  busy = false,
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const words = fold(query).split(/\s+/).filter(Boolean);
  const shown = [...pinned, ...options.filter((o) => matches(o, words))];
  const filtered = shown.length - pinned.length;
  const selected = [...pinned, ...options].find((o) => o.value === value) ?? null;
  const selectedIsPinned = pinned.some((o) => o.value === value);

  const count =
    words.length > 0
      ? `${filtered} of ${options.length} ${options.length === 1 ? noun[0] : noun[1]}`
      : `${options.length} ${options.length === 1 ? noun[0] : noun[1]}`;

  const openList = () => {
    if (open) return;
    // Start on the current choice, so ↓ moves on from where you are.
    const at = shown.findIndex((o) => o.value === value);
    setActive(at >= 0 ? at : 0);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (option) => {
    if (!option) return;
    close();
    inputRef.current?.blur();
    if (option.value !== value) onChange?.(option.value, option);
  };

  // Keep the highlighted option in view as ↓/↑ walk a long list.
  const moveTo = (i) => {
    setActive(i);
    const el = listRef.current?.querySelector(`[data-index="${i}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) return openList();
      moveTo(Math.min(active + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      moveTo(Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      } else if (query) {
        setQuery('');
      }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div>
      <div className="mb-1 flex print:hidden items-baseline gap-2 text-sm">
        {label && (
          <label htmlFor={id} className="font-semibold text-neutral-700">
            {label}
          </label>
        )}
        <span className="text-neutral-500" aria-live="polite">
          {busy ? 'Opening…' : count}
        </span>
      </div>
      <div className="relative w-full max-w-md print:hidden">
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          // Closed, the box reads as the current choice; open, it is the filter.
          value={open ? query : selected?.label ?? ''}
          placeholder={open ? selected?.label ?? placeholder : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={openList}
          onClick={openList}
          onBlur={close}
          onKeyDown={onKeyDown}
          className="w-full rounded-sm border border-neutral-300 bg-white px-3 py-1.5 pr-8 text-sm focus:border-brand focus:outline-none"
        />
        <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">
          ▾
        </span>
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={label}
          hidden={!open}
          // Keep focus in the input while an option is clicked, so the blur
          // that closes the list does not fire before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-neutral-300 bg-white p-1 shadow-lg"
        >
          {shown.map((o, i) => {
            const isSelected = o.value === value;
            const isLastPinned = i === pinned.length - 1 && filtered > 0;
            return (
              <li
                key={`${i < pinned.length ? 'pin' : 'opt'}-${o.value}`}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                onClick={() => choose(o)}
                onMouseMove={() => active !== i && setActive(i)}
                className={`cursor-pointer rounded-sm px-2 py-1.5 text-sm ${
                  i === active ? 'bg-neutral-100' : ''
                } ${isSelected ? 'font-bold text-brand' : ''} ${
                  isLastPinned ? 'mb-1 border-b border-neutral-200' : ''
                }`}
              >
                {o.label}
                {o.hint && <span className="block text-xs font-normal text-neutral-500">{o.hint}</span>}
              </li>
            );
          })}
          {filtered === 0 && words.length > 0 && (
            <li role="presentation" className="px-2 py-2 text-sm text-neutral-500">
              Nothing matches &ldquo;{query}&rdquo;.
            </li>
          )}
        </ul>
      </div>
      {/* On paper the box is gone; one small line says which sheet this is. */}
      {selected && !selectedIsPinned && (
        <p className="hidden text-xs text-neutral-500 print:block">
          {(printPrefix ?? label) ? `${printPrefix ?? label}: ` : ''}
          {selected.label}
        </p>
      )}
    </div>
  );
}

// For server pages: options carry an `href`; choosing one navigates to it.
export function SearchSelectLinks({ options = [], pinned = [], value = '', ...rest }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <SearchSelect
      {...rest}
      options={options}
      pinned={pinned}
      value={value}
      busy={pending}
      onChange={(_, option) => startTransition(() => router.push(option.href))}
    />
  );
}
