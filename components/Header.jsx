'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { nav, site } from '@/lib/site';
import ThemeSwitch from '@/components/ThemeSwitch';

function DesktopDropdown({ group }) {
  if (!group.items) {
    return (
      <Link
        href={group.href}
        className="px-3 py-2 font-medium text-neutral-700 hover:text-brand"
      >
        {group.label}
      </Link>
    );
  }
  return (
    <div className="relative group">
      <button className="px-3 py-2 font-medium text-neutral-700 group-hover:text-brand">
        {group.label} <span aria-hidden>▾</span>
      </button>
      <div className="absolute left-0 top-full hidden group-hover:block bg-white shadow-lg border border-neutral-100 rounded-b min-w-56 z-40">
        {group.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block px-4 py-2.5 text-neutral-700 hover:bg-brand-light hover:text-brand-dark"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// On the staff pages the header uses the staff area's wider container
// (app/admin/layout.jsx: max-w-[1500px], the same side padding), so the logo
// lines up with the left edge of the staff menu and the nav with the right
// edge of the staff content (Lawrence, 26 Oct 2026). Everywhere else it keeps
// the public site's container-site.
const ADMIN_CONTAINER = 'mx-auto max-w-[1500px] px-4 sm:px-6';

// The signed-in pages, where a person may choose dark mode (6 Nov 2026,
// components/ThemeSwitch.jsx). The marker below is what app/theme-dark.css
// looks for; public pages carry none and stay light.
const THEMED = ['/admin', '/account', '/register'];

export default function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? '';
  const container = pathname.startsWith('/admin') ? ADMIN_CONTAINER : 'container-site';
  const themed = THEMED.some((p) => pathname.startsWith(p));
  // The public pages keep the header in view as you scroll, on every screen
  // size (phones first, from the home page review; computers too, Lawrence
  // 10 Nov 2026). Once the page has scrolled a little it slims down (smaller
  // logo, less padding) so it doesn't crowd a laptop screen; at the top of
  // the page it looks as it always did. Not on the signed-in pages, whose
  // forms and staff screens have their own layout.
  const pinned = !themed && !pathname.startsWith('/admin');
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!pinned) return undefined;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pinned]);
  const slim = pinned && scrolled;

  return (
    <header
      className={`bg-white border-b border-neutral-200 ${pinned ? 'sticky top-0 z-40' : ''} ${
        slim ? 'shadow-sm' : ''
      }`}
    >
      {themed && <span data-theme-area hidden />}
      <div
        className={`${container} flex items-center justify-between transition-[padding] duration-200 ${
          slim ? 'py-2' : 'py-3 sm:py-4'
        }`}
      >
        <Link href="/" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={site.logo}
            alt="Luke 14 Ministries"
            className={`site-logo-light w-auto transition-[height] duration-200 ${slim ? 'h-10 sm:h-12' : 'h-12 sm:h-16'}`}
          />
          {/* Dark mode's copy, words light (app/theme-dark.css swaps them).
              Lazy, so it is fetched only once it shows. */}
          {themed && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={site.logoDark}
              alt="Luke 14 Ministries"
              loading="lazy"
              className="site-logo-dark hidden h-12 sm:h-16 w-auto"
            />
          )}
        </Link>

        <div className="flex items-center gap-3">
          <nav className="hidden lg:flex items-center gap-1">
            {nav.map((group) => (
              <DesktopDropdown key={group.label} group={group} />
            ))}
            <Link href="/donate" className="btn-gold ml-3 py-2!">
              Donate
            </Link>
          </nav>

          {themed && <ThemeSwitch className="lg:ml-2" />}

          {/* Donate stays one tap away on a phone, not only inside the menu. */}
          <Link href="/donate" className="lg:hidden btn-gold px-3! py-1.5! text-sm">
            Donate
          </Link>

          <button
            className="lg:hidden text-3xl min-h-11 min-w-11 flex items-center justify-center"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            ☰
          </button>
        </div>
      </div>

      {open && (
        <nav className="lg:hidden border-t border-neutral-200 pb-4 max-h-[calc(100vh-5rem)] overflow-y-auto">
          <div className="px-6 pt-4">
            <Link
              href="/camp-celebrate"
              className="btn-primary"
              onClick={() => setOpen(false)}
            >
              Register for camp
            </Link>
          </div>
          {nav.map((group) =>
            group.items ? (
              <div key={group.label} className="px-6 pt-3">
                <div className="font-semibold text-neutral-500 uppercase text-sm">
                  {group.label}
                </div>
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block py-2 pl-3 text-neutral-800"
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : (
              <Link
                key={group.label}
                href={group.href}
                className="block px-6 pt-3 font-semibold text-neutral-800"
                onClick={() => setOpen(false)}
              >
                {group.label}
              </Link>
            )
          )}
          <div className="px-6 pt-4">
            <Link
              href="/donate"
              className="btn-gold"
              onClick={() => setOpen(false)}
            >
              Donate
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
