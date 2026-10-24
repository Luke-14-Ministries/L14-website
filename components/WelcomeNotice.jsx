'use client';

// "Welcome to our new registration site" -- a one-time card for families
// (Lawrence, 24 Oct 2026), shown on the family dashboard and at the start of
// the family registration wizard. Temporary: lib/notices.js holds the date it
// stops (WELCOME_NOTICE_UNTIL) and the storage key.
//
// Once per browser until dismissed WITH the tick: closing it any other way
// (Got it, Close, Escape) hides it for this page only, and it comes back on
// the next visit. The tick is stored in localStorage; private mode or blocked
// storage means the card simply comes back next time, which is the safe way
// round for a notice.
//
// Styled like the site's other overlays (components/IdleTimeout.jsx, the
// Creed pop-out on the volunteer form): a plain fixed overlay, no dialog
// library. Unlike them it is a full modal for keyboard users -- focus moves
// into the card, Tab stays inside it, and focus goes back where it was when
// the card closes.
//
// Storage is read through useSyncExternalStore (the pattern AdminNav uses):
// the server snapshot says "dismissed", so the server renders nothing and the
// browser decides after hydration -- no flash, no hydration mismatch.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { site } from '@/lib/site';
import { WELCOME_DISMISS_KEY, welcomeNoticeCurrent } from '@/lib/notices';

const listeners = new Set();
function subscribe(callback) {
  listeners.add(callback);
  window.addEventListener('storage', callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}
// true = do not show. Past the end date counts as dismissed.
function readHidden() {
  if (!welcomeNoticeCurrent()) return true;
  try {
    return window.localStorage.getItem(WELCOME_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberDismissed() {
  try {
    window.localStorage.setItem(WELCOME_DISMISS_KEY, '1');
  } catch (err) {
    // Not fatal: the card closes now and returns next visit. Said in the
    // console so a "it keeps coming back" report has something to find.
    console.warn('WelcomeNotice: could not save "don’t show again":', err?.message);
  }
  listeners.forEach((callback) => callback());
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function WelcomeNotice() {
  const hidden = useSyncExternalStore(subscribe, readHidden, () => true);
  const [closed, setClosed] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const titleId = useId();
  const bodyId = useId();
  const open = !hidden && !closed;

  // Read by the keyboard handler below, which is attached once per opening.
  const dontShowRef = useRef(false);

  // Focus in on open, back out on close.
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    panelRef.current?.querySelector('[data-autofocus]')?.focus();
    return () => {
      const el = returnFocusRef.current;
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
    };
  }, [open]);

  // Escape closes; Tab is kept inside the card. On the document rather than
  // the card, so it still holds after a click on the dimmed backdrop has
  // taken focus out to the page.
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (dontShowRef.current) rememberDismissed();
        setClosed(true);
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panelRef.current.contains(document.activeElement);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  function close() {
    if (dontShow) rememberDismissed();
    setClosed(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-sm px-2 py-1 text-2xl leading-none text-neutral-500 hover:text-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-brand"
        >
          &times;
        </button>
        <h2 id={titleId} className="pr-8 text-xl font-bold text-brand-dark">
          Welcome to our new registration site
        </h2>
        <div id={bodyId} className="mt-3 space-y-3 leading-relaxed text-neutral-700">
          <p>
            We&rsquo;ve rebuilt how families register for camp and our other events. If anything
            seems confusing, wrong, or could be better, please tell us &mdash; every note helps us
            get it right for everyone.
          </p>
          <p>
            Use the <em>Send us feedback</em> box on your dashboard, or email{' '}
            <a href={`mailto:${site.emails.info}`} className="text-brand underline">
              {site.emails.info}
            </a>
            .
          </p>
        </div>
        <label className="mt-5 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-[#14606a]"
            checked={dontShow}
            onChange={(e) => {
              setDontShow(e.target.checked);
              dontShowRef.current = e.target.checked;
            }}
          />
          <span className="text-sm">Don&rsquo;t show this again</span>
        </label>
        <button type="button" onClick={close} className="btn-primary mt-5" data-autofocus>
          Got it
        </button>
      </div>
    </div>
  );
}
