'use client';

import { useState } from 'react';
import Link from 'next/link';
import { nav, site } from '@/lib/site';

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

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="bg-white border-b border-neutral-200">
      <div className="container-site flex items-center justify-between py-4">
        <Link href="/" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={site.logo}
            alt="Luke 14 Ministries"
            className="h-14 sm:h-16 w-auto"
          />
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {nav.map((group) => (
            <DesktopDropdown key={group.label} group={group} />
          ))}
          <Link href="/donate" className="btn-gold ml-3 py-2!">
            Donate
          </Link>
        </nav>

        <button
          className="lg:hidden text-3xl px-2"
          aria-label="Menu"
          onClick={() => setOpen(!open)}
        >
          ☰
        </button>
      </div>

      {open && (
        <nav className="lg:hidden border-t border-neutral-200 pb-4">
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
