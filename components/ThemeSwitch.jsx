'use client';

import { useSyncExternalStore } from 'react';
import { THEME_KEY as KEY } from '@/lib/theme';

// The Light / Dark switch on the signed-in pages (Lawrence, 6 Nov 2026).
// Light is the default for everyone, whatever their device prefers; Dark is a
// choice each person makes, remembered in this browser (localStorage).
//
// The choice lives on <html data-theme="dark">. THEME_SCRIPT (lib/theme.js),
// run in <head> by app/layout.jsx before the page paints, puts it back on
// every load, so a dark page never flashes white. The colours themselves are
// app/theme-dark.css, which only acts on pages carrying the [data-theme-area]
// marker (Header renders it on /admin, /account and /register): public pages
// stay light.

const listeners = new Set();
function subscribe(callback) {
  listeners.add(callback);
  // A tab that sat on a public page (no switch mounted, so no listener) when
  // another tab changed the choice catches up here.
  try {
    apply(window.localStorage.getItem(KEY) === 'dark');
  } catch {}
  // Another tab flipping the switch flips this one too.
  const onStorage = (e) => {
    if (e.key !== KEY) return;
    apply(e.newValue === 'dark');
    callback();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', onStorage);
  };
}
const isDark = () => document.documentElement.dataset.theme === 'dark';
function apply(dark) {
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

export default function ThemeSwitch({ className = '' }) {
  // The server cannot know the choice, so it draws Light; the browser then
  // reads <html>, which THEME_SCRIPT has already set.
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = !dark;
    apply(next);
    try {
      if (next) window.localStorage.setItem(KEY, 'dark');
      else window.localStorage.removeItem(KEY);
    } catch {}
    listeners.forEach((l) => l());
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={toggle}
      title={dark ? 'Dark mode is on' : 'Dark mode is off'}
      className={`inline-flex items-center gap-2 text-sm font-medium text-neutral-600 hover:text-neutral-800 ${className}`}
    >
      <span
        aria-hidden="true"
        // On/off is drawn by app/theme-dark.css from <html>, not from `dark`:
        // the server draws every switch off, and a dark page would show it
        // sliding on once React arrived.
        className="theme-switch-track relative inline-block h-5 w-9 rounded-full bg-neutral-300 transition-colors"
      >
        <span
          className="theme-switch-knob absolute top-0.5 left-0.5 h-4 w-4 rounded-full shadow-sm transition-transform"
          // The knob stays white in dark mode too (bg-white turns dark there).
          style={{ backgroundColor: '#fff' }}
        />
      </span>
      <span>Dark</span>
    </button>
  );
}
