'use client';

// An open/closed choice the family made on the dashboard, kept for THIS VISIT
// only (Lawrence, 26 Oct 2026): sessionStorage, so it lasts while the tab is
// open -- through a trip to the support form and back -- and is gone with the
// tab. Never localStorage: a collapse remembered from June would hide July's
// deposit ask (see RegistrationCard.jsx).
//
// Callers put what is outstanding into the key, so a choice made about one
// state of things does not carry over to a new one: hide a registration that
// needed a deposit, and a staff question arriving later opens it again.
//
// Read through useSyncExternalStore (the pattern WelcomeNotice and AdminNav
// use): the server snapshot is "no choice", so the server renders the
// default and the browser applies a stored choice after hydration, with no
// hydration mismatch. Blocked storage (private mode, strict settings) falls
// back to memory, so the toggle still works for the page; the failure is said
// in the console, never swallowed.

import { useCallback, useSyncExternalStore } from 'react';

const memory = new Map();
const listeners = new Set();

function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function read(key) {
  try {
    const v = window.sessionStorage.getItem(key);
    if (v != null) return v;
  } catch (err) {
    if (!memory.has(`warned:${key}`)) {
      memory.set(`warned:${key}`, true);
      console.warn('Dashboard: could not read a remembered open/closed choice:', err?.message);
    }
  }
  return memory.get(key) ?? null;
}

// [open, setOpen]. `defaultOpen` applies until the person chooses.
export function useVisitChoice(key, defaultOpen) {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null
  );
  const open = stored === 'open' ? true : stored === 'closed' ? false : defaultOpen;
  const setOpen = useCallback(
    (next) => {
      const value = next ? 'open' : 'closed';
      memory.set(key, value);
      try {
        window.sessionStorage.setItem(key, value);
      } catch (err) {
        console.warn('Dashboard: could not remember an open/closed choice for this visit:', err?.message);
      }
      listeners.forEach((callback) => callback());
    },
    [key]
  );
  return [open, setOpen];
}
