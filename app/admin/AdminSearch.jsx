'use client';

// The staff header's "Find a person or family" box (14 Oct 2026), as a small
// client component since 23 Nov 2026 so it can leave itself off
// /admin/search: that page has its own box with the words already typed, and
// two search boxes on one page asked which to use. Still a plain GET form, no
// script between typing and results.
//
// It takes the screen's width on a phone and a fixed width from sm up
// (23 Nov 2026 review: w-80 ran past a 390px screen).

import { usePathname } from 'next/navigation';

export default function AdminSearch() {
  const pathname = usePathname() ?? '';
  if (pathname === '/admin/search' || pathname.startsWith('/admin/search/')) return null;
  return (
    <form action="/admin/search/" method="get" className="flex w-full items-center gap-1 sm:w-auto">
      <input
        type="search"
        name="q"
        placeholder="Find a person or family"
        aria-label="Search people and families"
        className="min-w-0 flex-1 rounded-sm border border-neutral-300 bg-white px-3 py-1.5 text-sm sm:w-80 sm:flex-none"
      />
      <button type="submit" className="btn-outline shrink-0 py-1.5! text-sm">
        Search
      </button>
    </form>
  );
}
